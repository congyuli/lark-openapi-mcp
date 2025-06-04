import { Request, Response } from 'express';
import crypto from 'crypto';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { UserManager } from '../user-manager';
import { requireUserId, getUserName } from '../user-manager';
import { ConnectionInfo } from '../shared/types';

export class SSEHandler {
  constructor(
    private mcpServer: McpServer,
    private userManager: UserManager,
    private port: number
  ) {}

  // Handle SSE endpoint for GET - 建立长连接
  async handleSSEConnection(req: Request, res: Response): Promise<void> {
    const sessionId = crypto.randomUUID();
    
    // 获取用户信息
    const userId = requireUserId(req);
    const userSession = (req.user as any)?.userSession;
    
    console.log(`[DEBUG] Creating SSE session: ${sessionId} for user: ${userId}`);
    console.log(`[DEBUG] User Info: userId=${userId}, userName=${getUserName(req)}`);

    try {
      // 使用传入的 mcpServer 而不是创建新的 Server 实例
      if (!this.mcpServer) {
        console.error('[ERROR] No MCP server instance available');
        res.status(500).json({ error: 'No MCP server available' });
        return;
      }

      // 创建 SSE Transport
      const transport = new SSEServerTransport('/messages', res);

      // 创建连接信息
      const connectionInfo: ConnectionInfo = {
        sessionId,
        transport,
        response: res,
        userId,
        clientId: req.user?.client_id,
        createdAt: Date.now(),
      };

      // 使用UserManager添加连接
      try {
        this.userManager.addConnection(userId, connectionInfo);
        console.log(`[DEBUG] Added connection to UserManager for user ${userId} (session: ${sessionId})`);
      } catch (error) {
        console.error('[ERROR] Failed to add connection to UserManager:', error);
        res.status(500).json({ error: 'Failed to register connection' });
        return;
      }

      // 连接 server 和 transport
      await this.mcpServer.connect(transport);
      console.log(`[DEBUG] MCP server connected to SSE transport successfully for session: ${sessionId}`);
      console.log(`[DEBUG] User manager stats - Active users: ${this.userManager.getActiveUserCount()}, Total connections: ${this.userManager.getTotalConnectionCount()}`);

      // 发送端点信息给客户端
      res.write(`event: endpoint\n`);
      res.write(`data: http://${req.get('host') || 'localhost:' + this.port}/messages?sessionId=${sessionId}\n\n`);

      // 发送初始化成功消息
      res.write(`event: message\n`);
      res.write(
        `data: ${JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
          params: {},
        })}\n\n`,
      );

      // 处理连接关闭
      req.on('close', () => {
        console.log(`[DEBUG] SSE connection closed for session: ${sessionId}`);
        this.userManager.removeConnection(userId, sessionId);
      });

      req.on('error', (error: any) => {
        if (error.code === 'ECONNRESET' || error.code === 'ECONNABORTED') {
          console.log(`[INFO] SSE connection closed by client for session ${sessionId} (${error.code})`);
        } else {
          console.error(`[ERROR] SSE connection error for session ${sessionId}:`, error);
        }
        this.userManager.removeConnection(userId, sessionId);
      });

      res.on('error', (error: any) => {
        if (error.code === 'ECONNRESET' || error.code === 'ECONNABORTED') {
          console.log(`[INFO] SSE response connection closed by client for session ${sessionId} (${error.code})`);
        } else {
          console.error(`[ERROR] SSE response error for session ${sessionId}:`, error);
        }
        this.userManager.removeConnection(userId, sessionId);
      });

      // 保持连接活跃
      const keepAlive = setInterval(() => {
        if (res.writable) {
          res.write(`event: ping\n`);
          res.write(`data: ${Date.now()}\n\n`);
        } else {
          clearInterval(keepAlive);
          this.userManager.removeConnection(userId, sessionId);
        }
      }, 30000);
    } catch (error) {
      console.error('[ERROR] Failed to connect MCP server to SSE transport:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to initialize MCP server' });
      }
    }
  }

  // Handle POST messages to /messages endpoint
  async handlePostMessage(req: Request, res: Response): Promise<void> {
    const sessionId = req.query.sessionId as string;
    const userId = requireUserId(req);
    
    console.log(`[DEBUG] Received POST message for session: ${sessionId}, user: ${userId}`);

    if (!sessionId) {
      res.status(400).json({ error: 'Missing sessionId parameter' });
      return;
    }

    try {
      // 使用UserManager查找连接
      const userConnections = this.userManager.getActiveConnections(userId);
      const connection = userConnections.find(conn => conn.sessionId === sessionId);
      
      if (!connection) {
        console.log(`[DEBUG] Session not found: ${sessionId} for user: ${userId}`);
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      // 将消息传递给SSE transport处理
      await connection.transport.handlePostMessage(req, res, req.body);
    } catch (error) {
      console.error('[ERROR] Failed to handle POST message:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to process message' });
      }
    }
  }

  // 处理错误的 POST /sse 请求，返回有用的错误信息
  handleIncorrectSSEPost(req: Request, res: Response): void {
    console.log(`[WARNING] Received incorrect POST request to /sse endpoint`);
    res.status(405).json({
      error: 'Method Not Allowed',
      message: 'SSE endpoint only supports GET method for establishing connections',
      correct_usage: {
        sse_connection: 'GET /sse',
        send_messages: 'POST /messages?sessionId=<session_id>'
      }
    });
  }
} 