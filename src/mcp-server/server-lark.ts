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

  // 创建UserManager实例，改进LarkClient创建逻辑
  const userManager = new UserManager(async (accessToken: string) => {
    console.log(`[SERVER] Creating user-specific LarkClient for token: ${accessToken.substring(0, 20)}...`);
    
    if (larkClient && typeof larkClient.createUserClient === 'function') {
      // 使用LarkMcpTool的createUserClient方法创建用户专属实例
      try {
        const userLarkClient = await larkClient.createUserClient(accessToken);
        console.log(`[SERVER] ✅ Created user-specific LarkClient using createUserClient method`);
        return userLarkClient;
      } catch (error) {
        console.error(`[SERVER] ❌ Failed to create user-specific LarkClient:`, error);
        throw error;
      }
    } else {
      console.log(`[SERVER] ⚠️ LarkClient does not support createUserClient, using fallback method`);
      
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
            console.log(`[SERVER] 🔄 Recreating LarkClient with options for user isolation`);
            
            // 动态导入LarkMcpTool并创建新实例
            const { LarkMcpTool } = await import('../mcp-tool');
            const newUserClient = new LarkMcpTool({
              ...clientOptions,
              client: undefined, // 强制创建新的Client实例
            });
            
            newUserClient.updateUserAccessToken(accessToken);
            console.log(`[SERVER] ✅ Created isolated LarkClient using recreation method`);
            return newUserClient;
          }
          
          // 最后的fallback：更新token
          if (userLarkClient.updateUserAccessToken) {
            userLarkClient.updateUserAccessToken(accessToken);
            console.log(`[SERVER] ⚠️ Using token update fallback (not fully isolated)`);
          }
          
          return userLarkClient;
        } catch (error) {
          console.error(`[SERVER] ❌ Failed to create user LarkClient copy:`, error);
          throw error;
        }
      } else {
        console.error(`[SERVER] ❌ No LarkClient provided, cannot create user-specific instance`);
        throw new Error('No LarkClient available for user session creation');
      }
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
    
    // 设置全局 UserManager 引用，让工具执行时能获取用户专属的 LarkClient
    console.log(`[SERVER] 🔧 Setting global UserManager reference for tool execution...`);
    setGlobalUserManager(userManager);
  });
}
