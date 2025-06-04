import { Express, Request, Response } from 'express';
import { OAuthServer } from '../oauth/oauth-server';
import { AuthMiddleware } from '../middleware/auth-middleware';
import { SSEHandler } from '../handlers/sse-handler';
import { HealthRoutes } from './health-routes';
import { UserManager } from '../user-manager';
import { Logger, LogContext } from '../shared/logger';

export class ServerRoutes {
  private healthRoutes?: HealthRoutes;

  constructor(
    private app: Express,
    private oauthServer: OAuthServer,
    private authMiddleware: AuthMiddleware,
    private sseHandler: SSEHandler,
    private port: number,
    private userManager?: UserManager
  ) {
    // 创建健康检查路由实例
    if (userManager) {
      this.healthRoutes = new HealthRoutes(userManager);
    } else {
      Logger.warn('UserManager not provided, health routes will have limited functionality', {
        component: 'ServerRoutes',
        operation: 'constructor'
      });
    }
  }

  setupRoutes(): void {
    const context: LogContext = {
      component: 'ServerRoutes',
      operation: 'setupRoutes',
      port: this.port
    };

    Logger.info('Setting up server routes', context);

    // 集成健康检查和监控路由
    if (this.healthRoutes) {
      this.app.use('/api', this.healthRoutes.getRouter());
      Logger.debug('Health and monitoring routes configured', context);
    }

    // 简单的根健康检查端点（向后兼容）
    this.app.get('/health', (req: Request, res: Response) => {
      const healthContext: LogContext = {
        component: 'ServerRoutes',
        operation: 'simpleHealthCheck',
        ip: req.ip
      };

      Logger.debug('Simple health check requested', healthContext);
      res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        port: this.port,
        message: 'Server is running!',
      });
    });

    // OAuth Server Metadata Discovery (RFC 8414)
    this.app.get('/.well-known/oauth-authorization-server', (req: Request, res: Response) => {
      const oauthContext: LogContext = {
        component: 'ServerRoutes',
        operation: 'oauthMetadata',
        ip: req.ip
      };

      Logger.debug('OAuth server metadata requested', oauthContext);
      res.json(this.oauthServer.getServerMetadata(req));
    });

    // OAuth 客户端注册端点 (Dynamic Client Registration - RFC 7591)
    this.app.post('/register', (req: Request, res: Response) => {
      const registerContext: LogContext = {
        component: 'ServerRoutes',
        operation: 'oauthClientRegister',
        ip: req.ip
      };

      Logger.info('OAuth client registration requested', registerContext);
      this.oauthServer.registerClient(req, res);
    });

    // OAuth 授权端点
    this.app.get('/authorize', (req: Request, res: Response) => {
      const authorizeContext: LogContext = {
        component: 'ServerRoutes',
        operation: 'oauthAuthorize',
        ip: req.ip,
        clientId: req.query.client_id as string
      };

      Logger.info('OAuth authorization requested', authorizeContext);
      this.oauthServer.handleAuthorize(req, res);
    });

    // OAuth 用户令牌端点 (获取 u- 格式的用户令牌)
    this.app.post('/token', (req: Request, res: Response) => {
      const tokenContext: LogContext = {
        component: 'ServerRoutes',
        operation: 'oauthToken',
        ip: req.ip,
        grantType: req.body.grant_type
      };

      Logger.info('OAuth token requested', tokenContext);
      this.oauthServer.handleToken(req, res);
    });

    // Handle CORS preflight requests for SSE endpoint
    this.app.options('/sse', (req: Request, res: Response) => {
      const corsContext: LogContext = {
        component: 'ServerRoutes',
        operation: 'corsPreflightSSE',
        ip: req.ip
      };

      Logger.debug('CORS preflight for SSE endpoint', corsContext);
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
      const errorContext: LogContext = {
        component: 'ServerRoutes',
        operation: 'incorrectSSEPost',
        ip: req.ip
      };

      Logger.warn('Incorrect POST request to SSE endpoint', errorContext);
      this.sseHandler.handleIncorrectSSEPost(req, res);
    });

    // MCP Messages 端点 - 只支持 POST 用于发送消息
    // 使用轻量级会话验证，避免每次都调用 Lark API
    this.app.post('/messages', 
      this.authMiddleware.authenticateSession.bind(this.authMiddleware), 
      this.sseHandler.handlePostMessage.bind(this.sseHandler)
    );

    Logger.info('All server routes configured successfully', {
      ...context,
      routes: [
        'health', 'oauth-metadata', 'oauth-register', 'oauth-authorize', 
        'oauth-token', 'sse', 'messages', 'health-monitoring'
      ]
    });
  }

  logEndpoints(host: string): void {
    const context: LogContext = {
      component: 'ServerRoutes',
      operation: 'logEndpoints',
      host,
      port: this.port
    };

    Logger.info('Server endpoints ready', {
      ...context,
      endpoints: {
        oauth: [
          `http://${host}:${this.port}/.well-known/oauth-authorization-server`,
          `http://${host}:${this.port}/register`,
          `http://${host}:${this.port}/authorize`,
          `http://${host}:${this.port}/token`
        ],
        mcp: [
          `http://${host}:${this.port}/sse`,
          `http://${host}:${this.port}/messages`
        ],
        monitoring: [
          `http://${host}:${this.port}/health`,
          `http://${host}:${this.port}/api/health`,
          `http://${host}:${this.port}/api/status`,
          `http://${host}:${this.port}/api/metrics`,
          `http://${host}:${this.port}/api/stats/users`,
          `http://${host}:${this.port}/api/info`
        ]
      }
    });

    // 保留控制台输出用于开发环境的快速查看
    console.log(`[SERVER] Starting MCP SSE Server with OAuth on ${host}:${this.port}`);
    console.log(`OAuth endpoints:`);
    console.log(`  - Metadata: GET http://${host}:${this.port}/.well-known/oauth-authorization-server`);
    console.log(`  - Register: POST http://${host}:${this.port}/register`);
    console.log(`  - Authorize: GET http://${host}:${this.port}/authorize`);
    console.log(`  - Token: POST http://${host}:${this.port}/token`);
    console.log(`MCP endpoints:`);
    console.log(`  - SSE Connection: GET http://${host}:${this.port}/sse`);
    console.log(`  - Messages: POST http://${host}:${this.port}/messages`);
    console.log(`Health & Monitoring endpoints:`);
    console.log(`  - Health: GET http://${host}:${this.port}/health`);
    console.log(`  - Status: GET http://${host}:${this.port}/api/status`);
    console.log(`  - Metrics: GET http://${host}:${this.port}/api/metrics`);
    console.log(`  - User Stats: GET http://${host}:${this.port}/api/stats/users`);
    console.log(`  - System Info: GET http://${host}:${this.port}/api/info`);
  }
} 