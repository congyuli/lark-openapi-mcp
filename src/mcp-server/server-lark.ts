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

// Check environment variables on startup
const envCheck = checkRequiredEnvVars();
if (!envCheck.isValid) {
  console.error('Missing required environment variables:', envCheck.missingVars);
  console.error('Please create a .env file with the required variables. See env.example for reference.');
  process.exit(1);
}

// 导出初始化函数，用于替代 sse.ts
export function initSSEServer(mcpServer: McpServer, options: McpServerOptions, larkClient?: any): void {
  const app = express();
  const PORT = options.port || 3000;
  const host = options.host || 'localhost';

  // 创建UserManager实例
  const userManager = new UserManager(async (accessToken: string) => {
    // 创建用户专属的LarkClient实例
    if (larkClient && typeof larkClient.createUserClient === 'function') {
      return await larkClient.createUserClient(accessToken);
    } else {
      // 简化的LarkClient创建，如果原始larkClient不支持createUserClient
      const userLarkClient = { ...larkClient };
      if (userLarkClient.updateUserAccessToken) {
        userLarkClient.updateUserAccessToken(accessToken);
      }
      return userLarkClient;
    }
  });

  // 创建各个模块实例
  const oauthServer = new OAuthServer();
  const authMiddleware = new AuthMiddleware(userManager);
  const sseHandler = new SSEHandler(mcpServer, userManager, PORT);
  const serverRoutes = new ServerRoutes(app, oauthServer, authMiddleware, sseHandler, PORT);

  // 优雅关闭处理
  process.on('SIGTERM', async () => {
    console.log('[SERVER] Received SIGTERM, starting graceful shutdown...');
    await userManager.shutdown();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('[SERVER] Received SIGINT, starting graceful shutdown...');
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
    console.log(`[REQUEST] ${new Date().toISOString()} - ${req.method} ${req.path}`);
    if (Object.keys(req.query).length > 0) {
      console.log(`[REQUEST] Query parameters:`, req.query);
    }
    next();
  });

  // 设置所有路由
  serverRoutes.setupRoutes();

  // 调试信息
  console.log(`[DEBUG] Server initialization:`);
  console.log(`  - MCP Server: ${mcpServer ? 'Available' : 'Not Available'}`);
  console.log(`  - Lark Client: ${larkClient ? 'Available' : 'Not Available'}`);
  if (larkClient && larkClient.updateUserAccessToken) {
    console.log(`  - LarkClient updateUserAccessToken method: Available`);
  } else {
    console.log(`  - LarkClient updateUserAccessToken method: Not Available`);
  }

  // 尝试获取 MCP server 的内部状态（如果可能）
  if (mcpServer) {
    try {
      // 检查 server 的注册状态
      const serverInternal = mcpServer as any;
      const toolCount = Object.keys(serverInternal._registeredTools || {}).length;
      const resourceCount = Object.keys(serverInternal._registeredResources || {}).length;
      console.log(`[DEBUG] MCP Server status:`);
      console.log(`  - Registered tools: ${toolCount}`);
      console.log(`  - Registered resources: ${resourceCount}`);

      if (toolCount > 0) {
        console.log(`  - Tool names:`, Object.keys(serverInternal._registeredTools || {}));
      }
    } catch (error) {
      console.log(`[DEBUG] Could not inspect MCP server internals:`, error);
    }
  }

  // 启动服务器
  app.listen(PORT, host, () => {
    console.log(`MCP SSE Server with OAuth running on ${host}:${PORT}`);
    serverRoutes.logEndpoints(host);
  });
}
