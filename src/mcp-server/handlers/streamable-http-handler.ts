import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { UserManager } from '../user-manager';
import { requireUserId, getUserName, getUserAccessToken } from '../user-manager';
import { setRequestContext, clearRequestContext } from '../../mcp-tool/utils/handler';
import { Logger } from '../shared/logger';

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
    const startTime = Date.now();
    const sessionId = req.headers[SESSION_ID_HEADER] as string | undefined;
    const userId = req.user?.lark_user_id;
    const clientId = req.user?.client_id;
    Logger.info('[MCP][Request]', {
      method: req.method,
      path: req.path,
      userId,
      clientId,
      sessionId,
      userAgent: req.get('User-Agent')
    });
    let status = 200;
    try {
      // [TOOL_CALL] 打印请求头和关键认证信息
      console.info('[TOOL_CALL] Authorization header:', req.headers.authorization?.substring(0, 8) + '...');
      let transport: StreamableHTTPServerTransport;
      const userId = requireUserId(req);
      const currentAccessToken = getUserAccessToken(req);
      console.info('[TOOL_CALL] userId:', userId);

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
          console.log(`[TOOL_CALL] Set request context for tool execution - User: ${userId}`);
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
      status = 500;
      Logger.error('[MCP][Error]', error as Error, { method: req.method, path: req.path, userId, clientId, sessionId });
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
    } finally {
      const durationMs = Date.now() - startTime;
      Logger.info('[MCP][Response]', {
        method: req.method,
        path: req.path,
        userId,
        clientId,
        sessionId,
        status: res.statusCode || status,
        durationMs
      });
    }
  }

  // 处理GET /mcp（SSE流/通知）
  async handleGet(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    const sessionId = req.headers[SESSION_ID_HEADER] as string | undefined;
    const userId = req.user?.lark_user_id;
    const clientId = req.user?.client_id;
    Logger.info('[MCP][Request]', {
      method: req.method,
      path: req.path,
      userId,
      clientId,
      sessionId,
      userAgent: req.get('User-Agent')
    });
    let status = 200;
    try {
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
    } catch (error) {
      status = 500;
      Logger.error('[MCP][Error]', error as Error, { method: req.method, path: req.path, userId, clientId, sessionId });
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
    } finally {
      const durationMs = Date.now() - startTime;
      Logger.info('[MCP][Response]', {
        method: req.method,
        path: req.path,
        userId,
        clientId,
        sessionId,
        status: res.statusCode || status,
        durationMs
      });
    }
  }

  // 处理DELETE /mcp（会话终止）
  async handleDelete(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    const sessionId = req.headers[SESSION_ID_HEADER] as string | undefined;
    const userId = req.user?.lark_user_id;
    const clientId = req.user?.client_id;
    Logger.info('[MCP][Request]', {
      method: req.method,
      path: req.path,
      userId,
      clientId,
      sessionId,
      userAgent: req.get('User-Agent')
    });
    let status = 200;
    try {
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
    } catch (error) {
      status = 500;
      Logger.error('[MCP][Error]', error as Error, { method: req.method, path: req.path, userId, clientId, sessionId });
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
    } finally {
      const durationMs = Date.now() - startTime;
      Logger.info('[MCP][Response]', {
        method: req.method,
        path: req.path,
        userId,
        clientId,
        sessionId,
        status: res.statusCode || status,
        durationMs
      });
    }
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