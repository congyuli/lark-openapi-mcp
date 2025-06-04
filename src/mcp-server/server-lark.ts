import express from 'express';
import cors from 'cors';
import { checkRequiredEnvVars } from './config/env';
import { McpServerOptions } from './shared';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { UserManager } from './user-manager';
import { OAuthServer } from './oauth/oauth-server';
import { AuthMiddleware } from './middleware/auth-middleware';
import { SSEHandler } from './handlers/sse-handler';
import { ServerRoutes } from './routes/server-routes';
import { setGlobalUserManager } from '../mcp-tool/utils/handler';
import { Logger, LogContext, PerformanceMonitor } from './shared/logger';

// Check environment variables on startup
const envCheck = checkRequiredEnvVars();
if (!envCheck.isValid) {
  Logger.error('Missing required environment variables', new Error('Environment validation failed'), {
    component: 'ServerInit',
    missingVars: envCheck.missingVars
  });
  console.error('Missing required environment variables:', envCheck.missingVars);
  console.error('Please create a .env file with the required variables. See env.example for reference.');
  process.exit(1);
}

// 导出初始化函数，用于替代 sse.ts
export function initSSEServer(mcpServer: McpServer, options: McpServerOptions, larkClient?: any): void {
  const context: LogContext = {
    component: 'SSEServer',
    operation: 'initSSEServer',
    port: options.port || 3000,
    host: options.host || 'localhost'
  };

  Logger.info('Initializing SSE Server', context);

  const app = express();
  const PORT = options.port || 3000;
  const host = options.host || 'localhost';

  // 创建UserManager实例，改进LarkClient创建逻辑
  const userManager = new UserManager(async (accessToken: string) => {
    const userContext: LogContext = {
      component: 'SSEServer',
      operation: 'createUserLarkClient',
      userAccessTokenPrefix: accessToken.substring(0, 20)
    };

    Logger.info('Creating user-specific LarkClient', userContext);
    
    if (larkClient && typeof larkClient.createUserClient === 'function') {
      // 使用LarkMcpTool的createUserClient方法创建用户专属实例
      try {
        const userLarkClient = await larkClient.createUserClient(accessToken);
        Logger.info('Successfully created user-specific LarkClient using createUserClient method', userContext);
        return userLarkClient;
      } catch (error) {
        Logger.error('Failed to create user-specific LarkClient', error as Error, userContext);
        throw error;
      }
    } else {
      Logger.warn('LarkClient does not support createUserClient, using fallback method', userContext);
      
      // 兼容性处理：如果原始larkClient不支持createUserClient
      // 创建一个用户专属的 LarkClient 副本
      if (larkClient) {
        try {
          // 尝试创建一个深拷贝而不是浅拷贝
          const userLarkClient = Object.create(Object.getPrototypeOf(larkClient));
          
          // 复制所有属性
          Object.assign(userLarkClient, larkClient);
          
          // 如果有getClientOptions方法，使用它来重新创建Client
          if (typeof larkClient.getClientOptions === 'function') {
            const clientOptions = larkClient.getClientOptions();
            Logger.debug('Recreating LarkClient with options for user isolation', userContext);
            
            // 动态导入LarkMcpTool并创建新实例
            const { LarkMcpTool } = await import('../mcp-tool');
            const newUserClient = new LarkMcpTool({
              ...clientOptions,
              client: undefined, // 强制创建新的Client实例
            });
            
            newUserClient.updateUserAccessToken(accessToken);
            Logger.info('Created isolated LarkClient using recreation method', userContext);
            return newUserClient;
          }
          
          // 最后的fallback：更新token
          if (userLarkClient.updateUserAccessToken) {
            userLarkClient.updateUserAccessToken(accessToken);
            Logger.warn('Using token update fallback (not fully isolated)', userContext);
          }
          
          return userLarkClient;
        } catch (error) {
          Logger.error('Failed to create user LarkClient copy', error as Error, userContext);
          throw error;
        }
      } else {
        const error = new Error('No LarkClient available for user session creation');
        Logger.error('No LarkClient provided, cannot create user-specific instance', error, userContext);
        throw error;
      }
    }
  });

  // 创建各个模块实例
  const oauthServer = new OAuthServer();
  const authMiddleware = new AuthMiddleware(userManager);
  const sseHandler = new SSEHandler(mcpServer, userManager, PORT);
  const serverRoutes = new ServerRoutes(app, oauthServer, authMiddleware, sseHandler, PORT, userManager);

  Logger.info('Server modules initialized', {
    ...context,
    modules: ['UserManager', 'OAuthServer', 'AuthMiddleware', 'SSEHandler', 'ServerRoutes']
  });

  // 优雅关闭处理
  process.on('SIGTERM', async () => {
    Logger.info('Received SIGTERM, starting graceful shutdown', {
      component: 'SSEServer',
      signal: 'SIGTERM'
    });
    await userManager.shutdown();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    Logger.info('Received SIGINT, starting graceful shutdown', {
      component: 'SSEServer', 
      signal: 'SIGINT'
    });
    await userManager.shutdown();
    process.exit(0);
  });

  // Enable CORS for all routes
  app.use(
    cors({
      origin: '*',
      credentials: true,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'MCP-Protocol-Version'],
    }),
  );

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // 添加请求日志中间件
  app.use((req, res, next) => {
    const requestContext: LogContext = {
      component: 'SSEServer',
      operation: 'httpRequest',
      method: req.method,
      path: req.path,
      userAgent: req.get('User-Agent'),
      ip: req.ip
    };

    Logger.info(`HTTP ${req.method} ${req.path}`, requestContext);
    
    if (Object.keys(req.query).length > 0) {
      Logger.debug('Request query parameters', {
        ...requestContext,
        query: req.query
      });
    }
    
    next();
  });

  // 设置所有路由
  serverRoutes.setupRoutes();

  // 初始化性能监控
  const performanceMonitor = PerformanceMonitor.getInstance();

  // 调试信息
  Logger.debug('Server initialization complete', {
    ...context,
    mcpServerAvailable: !!mcpServer,
    larkClientAvailable: !!larkClient,
    hasUpdateUserAccessToken: !!(larkClient && larkClient.updateUserAccessToken)
  });

  // 尝试获取 MCP server 的内部状态（如果可能）
  if (mcpServer) {
    try {
      // 检查 server 的注册状态
      const serverInternal = mcpServer as any;
      const toolCount = Object.keys(serverInternal._registeredTools || {}).length;
      const resourceCount = Object.keys(serverInternal._registeredResources || {}).length;
      
      Logger.info('MCP Server status inspection', {
        component: 'SSEServer',
        mcpServer: {
          registeredTools: toolCount,
          registeredResources: resourceCount,
          toolNames: Object.keys(serverInternal._registeredTools || {})
        }
      });
    } catch (error) {
      Logger.debug('Could not inspect MCP server internals', {
        component: 'SSEServer',
        error: (error as Error).message
      });
    }
  }

  // 启动服务器
  app.listen(PORT, host, () => {
    Logger.info('SSE Server started successfully', {
      ...context,
      url: `${host}:${PORT}`,
      environment: process.env.NODE_ENV || 'development'
    });
    
    serverRoutes.logEndpoints(host);
    
    // 设置全局 UserManager 引用，让工具执行时能获取用户专属的 LarkClient
    Logger.debug('Setting global UserManager reference for tool execution', {
      component: 'SSEServer',
      operation: 'setGlobalUserManager'
    });
    setGlobalUserManager(userManager);

    // 开始性能监控
    Logger.info('Performance monitoring started', {
      component: 'SSEServer',
      operation: 'startPerformanceMonitoring'
    });
  });
}
