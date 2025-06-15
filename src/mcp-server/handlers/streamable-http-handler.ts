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
    // [TOOL_CALL] 打印请求头和关键认证信息
    console.info('[TOOL_CALL] Incoming /mcp POST request');
    console.info('[TOOL_CALL] Request headers:', JSON.stringify(req.headers, null, 2));
    console.info('[TOOL_CALL] Authorization header:', req.headers.authorization || 'NOT_FOUND');
    console.info('[TOOL_CALL] req.user:', req.user || 'NOT_FOUND');
    const sessionId = req.headers[SESSION_ID_HEADER] as string | undefined;
    let transport: StreamableHTTPServerTransport;
    const userId = requireUserId(req);
    const currentAccessToken = getUserAccessToken(req);
    console.info('[TOOL_CALL] userId:', userId);
    console.info('[TOOL_CALL] accessToken:', currentAccessToken ? (currentAccessToken.substring(0, 20) + '...') : 'NOT_FOUND');

    try {
      // 已有会话，复用
      if (sessionId && this.transports[sessionId]) {
        transport = this.transports[sessionId];
        // 设置请求上下文
        if (currentAccessToken) {
          const requestContext = {
            userId,
            accessToken: currentAccessToken,
            userName: getUserName(req),
            sessionId,
            clientId: req.user?.client_id,
          };
          setRequestContext(sessionId, requestContext);
          console.log(`[TOOL_CALL] Set request context for tool execution - User: ${userId}, Token: ${currentAccessToken.substring(0, 20)}...`);
        } else {
          console.warn(`[TOOL_CALL] ⚠️ No access token found in current request for user: ${userId}`);
        }
        try {
          await transport.handleRequest(req, res, req.body);
        } finally {
          if (currentAccessToken) {
            setTimeout(() => clearRequestContext(sessionId), 1000);
          }
        }
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