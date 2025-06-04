import { Express, Request, Response } from 'express';
import { OAuthServer } from '../oauth/oauth-server';
import { AuthMiddleware } from '../middleware/auth-middleware';
import { SSEHandler } from '../handlers/sse-handler';

export class ServerRoutes {
  constructor(
    private app: Express,
    private oauthServer: OAuthServer,
    private authMiddleware: AuthMiddleware,
    private sseHandler: SSEHandler,
    private port: number
  ) {}

  setupRoutes(): void {
    // 添加健康检查端点
    this.app.get('/health', (req: Request, res: Response) => {
      console.log(`[HEALTH] 🟢 Health check requested from ${req.ip}`);
      res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        port: this.port,
        message: 'Server is running!',
      });
    });

    // OAuth Server Metadata Discovery (RFC 8414)
    this.app.get('/.well-known/oauth-authorization-server', (req: Request, res: Response) => {
      res.json(this.oauthServer.getServerMetadata(req));
    });

    // OAuth 客户端注册端点 (Dynamic Client Registration - RFC 7591)
    this.app.post('/register', (req: Request, res: Response) => {
      this.oauthServer.registerClient(req, res);
    });

    // OAuth 授权端点
    this.app.get('/authorize', (req: Request, res: Response) => {
      this.oauthServer.handleAuthorize(req, res);
    });

    // OAuth 用户令牌端点 (获取 u- 格式的用户令牌)
    this.app.post('/token', (req: Request, res: Response) => {
      this.oauthServer.handleToken(req, res);
    });

    // Handle CORS preflight requests for SSE endpoint
    this.app.options('/sse', (req: Request, res: Response) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, MCP-Protocol-Version');
      res.header('Access-Control-Allow-Credentials', 'true');
      res.sendStatus(200);
    });

    // MCP SSE 端点 - 只支持 GET 用于建立SSE连接
    this.app.get('/sse', 
      this.authMiddleware.authenticateToken.bind(this.authMiddleware), 
      this.sseHandler.handleSSEConnection.bind(this.sseHandler)
    );

    // 处理错误的 POST /sse 请求，返回有用的错误信息
    this.app.post('/sse', (req: Request, res: Response) => {
      this.sseHandler.handleIncorrectSSEPost(req, res);
    });

    // MCP Messages 端点 - 只支持 POST 用于发送消息
    // 使用轻量级会话验证，避免每次都调用 Lark API
    this.app.post('/messages', 
      this.authMiddleware.authenticateSession.bind(this.authMiddleware), 
      this.sseHandler.handlePostMessage.bind(this.sseHandler)
    );
  }

  logEndpoints(host: string): void {
    console.log(`[DEBUG] Starting MCP SSE Server with OAuth on ${host}:${this.port}`);
    console.log(`OAuth endpoints:`);
    console.log(`  - Metadata: GET http://${host}:${this.port}/.well-known/oauth-authorization-server`);
    console.log(`  - Register: POST http://${host}:${this.port}/register`);
    console.log(`  - Authorize: GET http://${host}:${this.port}/authorize`);
    console.log(`  - Token: POST http://${host}:${this.port}/token`);
    console.log(`MCP endpoints:`);
    console.log(`  - SSE Connection: GET http://${host}:${this.port}/sse`);
    console.log(`  - Messages: POST http://${host}:${this.port}/messages`);
  }
} 