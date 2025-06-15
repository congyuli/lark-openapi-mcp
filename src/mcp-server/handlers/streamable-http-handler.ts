import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { UserManager } from '../user-manager';
import { requireUserId, getUserName, getUserAccessToken } from '../user-manager';
import { setRequestContext, clearRequestContext } from '../../mcp-tool/utils/handler';

// 会话ID头部
const SESSION_ID_HEADER = 'mcp-session-id';

export class StreamableHTTPHandler {
  private transports: Record<string, StreamableHTTPServerTransport> = {};

  constructor(
    private mcpServer: McpServer,
    private userManager: UserManager,
    private port: number
  ) {}

  // 处理POST /mcp
  async handlePost(req: Request, res: Response): Promise<void> {
    const sessionId = req.headers[SESSION_ID_HEADER] as string | undefined;
    let transport: StreamableHTTPServerTransport;
    const userId = requireUserId(req);
    const currentAccessToken = getUserAccessToken(req);

    try {
      // 已有会话，复用
      if (sessionId && this.transports[sessionId]) {
        transport = this.transports[sessionId];
        await transport.handleRequest(req, res, req.body);
        return;
      }
      // 新会话初始化
      if (!sessionId && this.isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            this.transports[sid] = transport;
          },
        });
        // 连接MCP server
        await this.mcpServer.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }
      // 非法请求
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided',
        },
        id: null,
      });
    } catch (error) {
      console.error('[ERROR] StreamableHTTPHandler POST error:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
          },
          id: null,
        });
      }
    }
  }

  // 处理GET /mcp（SSE流/通知）
  async handleGet(req: Request, res: Response): Promise<void> {
    const sessionId = req.headers[SESSION_ID_HEADER] as string | undefined;
    if (!sessionId || !this.transports[sessionId]) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Invalid or missing session ID',
        },
        id: null,
      });
      return;
    }
    const transport = this.transports[sessionId];
    await transport.handleRequest(req, res);
  }

  // 处理DELETE /mcp（会话终止）
  async handleDelete(req: Request, res: Response): Promise<void> {
    const sessionId = req.headers[SESSION_ID_HEADER] as string | undefined;
    if (!sessionId || !this.transports[sessionId]) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Invalid or missing session ID',
        },
        id: null,
      });
      return;
    }
    const transport = this.transports[sessionId];
    transport.close();
    delete this.transports[sessionId];
    res.status(200).json({
      jsonrpc: '2.0',
      result: 'Session terminated',
      id: null,
    });
  }

  // 判断是否为初始化请求
  private isInitializeRequest(body: any): boolean {
    // 兼容单个或批量
    if (Array.isArray(body)) {
      return body.some((item) => item?.method === 'initialize');
    }
    return body?.method === 'initialize';
  }
} 