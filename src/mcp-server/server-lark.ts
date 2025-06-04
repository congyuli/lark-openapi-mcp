import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import cors from 'cors';
import { LarkOAuthClient } from './lark/oauth-client';
import { larkConfig, checkRequiredEnvVars } from './config/env';
import { McpServerOptions } from './shared';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { UserManager } from './user-manager';
import { 
  requireUserId, 
  requireUserAccessToken, 
  addUserSessionMethods,
  getUserName 
} from './user-manager';

// Check environment variables on startup
const envCheck = checkRequiredEnvVars();
if (!envCheck.isValid) {
  console.error('Missing required environment variables:', envCheck.missingVars);
  console.error('Please create a .env file with the required variables. See env.example for reference.');
  process.exit(1);
}

// Initialize Lark OAuth client
const larkOAuthClient = new LarkOAuthClient(larkConfig);

// Extend Express Request type to include user
declare module 'express-serve-static-core' {
  interface Request {
    user?: {
      client_id: string;
      scope?: string;
    };
  }
}

// 导出初始化函数，用于替代 sse.ts
export function initSSEServer(mcpServer: McpServer, options: McpServerOptions, larkClient?: any): void {
  const app = express();
  const PORT = options.port || 3000;

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

  // OAuth 存储 (生产环境请使用数据库)
  const clients = new Map();

  // 添加健康检查端点
  app.get('/health', (req, res) => {
    console.log(`[HEALTH] 🟢 Health check requested from ${req.ip}`);
    res.json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      port: PORT,
      message: 'Server is running!',
    });
  });

  // OAuth Server Metadata Discovery (RFC 8414)
  app.get('/.well-known/oauth-authorization-server', (req, res) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    res.json({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/authorize`,
      token_endpoint: `${baseUrl}/token`,
      registration_endpoint: `${baseUrl}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_basic'],
      scopes_supported: ['mcp'],
      subject_types_supported: ['public'],
    });
  });

  // OAuth 客户端注册端点 (Dynamic Client Registration - RFC 7591)
  app.post('/register', (req, res) => {
    const clientId = crypto.randomUUID();
    const clientInfo = {
      client_id: clientId,
      client_name: req.body.client_name || 'MCP Client',
      redirect_uris: req.body.redirect_uris || ['http://localhost:3334/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none', // Public client
      ...req.body,
    };

    clients.set(clientId, clientInfo);
    console.log(`[DEBUG] Registered client: ${clientId}, total clients: ${clients.size}`);
    res.json(clientInfo);
  });

  // OAuth 授权端点
  app.get('/authorize', (req: Request, res: Response): void => {
    // 打印OAuth授权请求的头部信息
    console.log(`[DEBUG] === OAuth Authorize Headers ===`);
    console.log(`[DEBUG] OAuth Request URL: ${req.method} ${req.url}`);
    console.log(`[DEBUG] OAuth Request Headers:`, JSON.stringify(req.headers, null, 2));
    console.log(`[DEBUG] OAuth Query Parameters:`, req.query);
    console.log(`[DEBUG] === End OAuth Authorize Headers ===`);
    
    const { client_id, redirect_uri, code_challenge, response_type, state, scope } = req.query;

    console.log(`[DEBUG] Authorization request from mcp-remote:`);
    console.log(`  - client_id: ${client_id}`);
    console.log(`  - redirect_uri: ${redirect_uri}`);
    console.log(`  - state: ${state}`);

    // Validate redirect_uri format before processing
    const decodedRedirectUri = decodeURIComponent(redirect_uri as string);
    console.log(`[DEBUG] Decoded redirect_uri: ${decodedRedirectUri}`);

    // Predefined allowed redirect_uri patterns
    const allowedRedirectPatterns = [
      /^http:\/\/localhost:\d+\/oauth\/callback$/, // localhost with any port, /oauth/callback path
      /^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/, // 127.0.0.1 with any port, /oauth/callback path
      /^http:\/\/localhost:\d+\/callback$/, // localhost with any port, /callback path
      /^https:\/\/[\w\-\.]+\.[\w]+\/oauth\/callback$/, // HTTPS domains for production (optional)
    ];

    // Check if redirect_uri matches any allowed pattern
    const isValidRedirectUri = allowedRedirectPatterns.some((pattern) => pattern.test(decodedRedirectUri));

    if (!isValidRedirectUri) {
      console.error(`[ERROR] Invalid redirect_uri format: ${decodedRedirectUri}`);
      console.error(`[ERROR] Allowed patterns:`);
      console.error(`  - http://localhost:[port]/oauth/callback`);
      console.error(`  - http://127.0.0.1:[port]/oauth/callback`);
      console.error(`  - http://localhost:[port]/callback`);
      res.status(400).json({
        error: 'invalid_redirect_uri',
        error_description: 'Redirect URI does not match allowed patterns',
      });
      return;
    }

    console.log(`[DEBUG] ✅ redirect_uri format validation passed`);

    if (!clients.has(client_id)) {
      console.log(`[WARNING] Client not found: ${client_id}, auto-registering for development`);

      // Auto-register the client for development/testing purposes
      const clientInfo = {
        client_id: client_id as string,
        client_name: 'Auto-registered MCP Client',
        redirect_uris: [
          'http://localhost:3334/callback',
          decodedRedirectUri, // Use already decoded redirect_uri
        ],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none', // Public client
      };

      clients.set(client_id as string, clientInfo);
      console.log(`[INFO] Auto-registered client: ${client_id}`);
    }

    // Use mcp-remote's redirect_uri (this is where Lark should redirect after authorization)
    const mcpRedirectUri = decodedRedirectUri;

    // Validate that the mcp-remote's redirect_uri is allowed
    const client = clients.get(client_id as string);
    if (!client.redirect_uris.includes(mcpRedirectUri)) {
      console.log(`[ERROR] Invalid redirect_uri: ${mcpRedirectUri} for client: ${client_id}`);
      console.log(`[DEBUG] Allowed redirect_uris:`, client.redirect_uris);
      res.status(400).json({ error: 'invalid_redirect_uri' });
      return;
    }

    // Ensure state is not undefined
    const authState = (state as string) || crypto.randomUUID();

    console.log(`[DEBUG] Constructing Lark authorization URL...`);
    console.log(`[DEBUG] Using mcp-remote redirect_uri: ${mcpRedirectUri}`);
    console.log(`[DEBUG] Using state: ${authState}`);

    try {
      const larkScopes = larkConfig.scopes.length > 0 ? larkConfig.scopes.join(' ') : 'contact:user.id:readonly'; // Use minimal scope for testing

      // Construct Lark's actual authorization URL
      // Use mcp-remote's redirect_uri so Lark redirects directly to mcp-remote
      const larkAuthUrl = larkOAuthClient.getAuthorizationUrl({
        redirect_uri: mcpRedirectUri, // Use mcp-remote's redirect URI
        state: authState, // Ensure state is not undefined
        scope: larkScopes, // Use scope from config
      });

      console.log(`[DEBUG] Redirecting to Lark authorization URL:`);
      console.log(`  - URL: ${larkAuthUrl}`);
      console.log(`  - This will redirect user to Lark for actual authorization`);
      console.log(`  - After user approval, Lark will redirect to: ${mcpRedirectUri}`);

      // Redirect user's browser to Lark's authorization page
      res.redirect(larkAuthUrl);
    } catch (error) {
      console.error('[ERROR] Failed to construct Lark authorization URL:', error);
      res
        .status(500)
        .json({ error: 'internal_server_error', error_description: 'Failed to construct authorization URL' });
    }
  });

  // OAuth 用户令牌端点 (获取 u- 格式的用户令牌)
  app.post('/token', async (req: Request, res: Response): Promise<void> => {
    // 打印OAuth令牌请求的头部信息
    console.log(`[DEBUG] === OAuth Token Headers ===`);
    console.log(`[DEBUG] Token Request URL: ${req.method} ${req.url}`);
    console.log(`[DEBUG] Token Request Headers:`, JSON.stringify(req.headers, null, 2));
    console.log(`[DEBUG] Token Authorization: ${req.headers.authorization || 'NOT_FOUND'}`);
    console.log(`[DEBUG] Token Request Body:`, req.body);
    console.log(`[DEBUG] === End OAuth Token Headers ===`);
    
    console.log(`[DEBUG] User token request body:`, req.body);

    const { grant_type, code, client_id, code_verifier, refresh_token } = req.body;

    console.log(`[DEBUG] User token request from mcp-remote:`);
    console.log(`  - grant_type: ${grant_type}`);
    console.log(`  - client_id: ${client_id}`);

    if (grant_type === 'authorization_code') {
      console.log(`  - code: ${code ? code.substring(0, 20) + '...' : 'undefined'}`);
      console.log(`[DEBUG] Exchanging Lark authorization code for user token (u- format)...`);

      try {
        // Use LarkOAuthClient to exchange the Lark authorization code for user token (u- format)
        const tokenData = await larkOAuthClient.exchangeCodeForUserTokens(code);
        // Calculate expires_at based on expires_in
        const now = Math.floor(Date.now() / 1000); // Current time in seconds
        const expires_at = now + (tokenData.expires_in || 7200); // Default to 7200 if expires_in not provided
        // Convert expires_at to ISO string format for consistent date handling
        tokenData.expires_at = new Date(expires_at * 1000).toISOString();

        // Return the complete token data to mcp-remote
        const responseToMcpRemote = {
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          token_type: tokenData.token_type || 'Bearer',
          expires_in: tokenData.expires_in || 7200,
          expires_at: tokenData.expires_at,
          scope: tokenData.scope,
        };

        console.log('[DEBUG] Sending complete token data to mcp-remote:', {
          access_token: responseToMcpRemote.access_token?.substring(0, 20) + '...',
          refresh_token: responseToMcpRemote.refresh_token?.substring(0, 20) + '...',
          token_type: responseToMcpRemote.token_type,
          expires_in: responseToMcpRemote.expires_in,
          expires_at: responseToMcpRemote.expires_at,
          scope: responseToMcpRemote.scope,
        });

        res.json(responseToMcpRemote);
      } catch (error) {
        console.error('[ERROR] Failed to exchange Lark authorization code for user token:', error);
        res.status(400).json({
          error: 'invalid_grant',
          error_description: error instanceof Error ? error.message : 'User token exchange failed',
        });
      }
    } else if (grant_type === 'refresh_token') {
      console.log(`  - refresh_token: ${refresh_token ? refresh_token.substring(0, 20) + '...' : 'undefined'}`);
      console.log(`[DEBUG] Refreshing Lark user token (u- format)...`);

      if (!refresh_token) {
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'refresh_token parameter is required',
        });
        return;
      }

      try {
        // Use LarkOAuthClient to refresh the user token
        const refreshedTokenData = await larkOAuthClient.refreshTokens(refresh_token);

        // Calculate expires_at for refreshed token
        const now = Math.floor(Date.now() / 1000);
        const expires_at = now + (refreshedTokenData.data.expires_in || 7200);

        // Return the refreshed token data to mcp-remote
        const responseToMcpRemote = {
          access_token: refreshedTokenData.data.access_token,
          refresh_token: refreshedTokenData.data.refresh_token,
          token_type: refreshedTokenData.data.token_type || 'Bearer',
          expires_in: refreshedTokenData.data.expires_in || 7200,
          expires_at: new Date(expires_at * 1000).toISOString(),
          scope: refreshedTokenData.data.scope,
        };

        console.log('[DEBUG] Sending refreshed token data to mcp-remote:', {
          access_token: responseToMcpRemote.access_token?.substring(0, 20) + '...',
          refresh_token: responseToMcpRemote.refresh_token?.substring(0, 20) + '...',
          token_type: responseToMcpRemote.token_type,
          expires_in: responseToMcpRemote.expires_in,
          expires_at: responseToMcpRemote.expires_at,
          scope: responseToMcpRemote.scope,
        });

        res.json(responseToMcpRemote);
      } catch (error) {
        console.error('[ERROR] Failed to refresh Lark user token:', error);
        res.status(400).json({
          error: 'invalid_grant',
          error_description: error instanceof Error ? error.message : 'Token refresh failed',
        });
      }
    } else {
      res.status(400).json({ error: 'unsupported_grant_type' });
    }
  });

  // 验证 Lark Bearer Token 的中间件
  async function authenticateToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    // 打印所有请求头
    console.log(`[DEBUG] === Request Headers Debug ===`);
    console.log(`[DEBUG] Request URL: ${req.method} ${req.url}`);
    console.log(`[DEBUG] Request Headers:`, JSON.stringify(req.headers, null, 2));
    
    // 提取和打印Authorization头
    const authHeader = req.headers.authorization;
    console.log(`[DEBUG] Authorization Header: ${authHeader || 'NOT_FOUND'}`);
    
    if (authHeader) {
      if (authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        console.log(`[DEBUG] Extracted Bearer Token: ${token.substring(0, 20)}...${token.substring(token.length - 10)}`);
      } else {
        console.log(`[DEBUG] Authorization header does not start with 'Bearer '`);
      }
    }
    
    // 打印其他可能相关的头
    console.log(`[DEBUG] Content-Type: ${req.headers['content-type'] || 'NOT_SET'}`);
    console.log(`[DEBUG] User-Agent: ${req.headers['user-agent'] || 'NOT_SET'}`);
    console.log(`[DEBUG] MCP-Protocol-Version: ${req.headers['mcp-protocol-version'] || 'NOT_SET'}`);
    console.log(`[DEBUG] === End Headers Debug ===`);

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log(`[DEBUG] Authentication failed: Missing or invalid Authorization header`);
      res.status(401).json({ error: 'unauthorized', error_description: 'Bearer token required' });
      return;
    }

    const token = authHeader.substring(7);

    try {
      const response = await fetch(`${larkConfig.baseUrl}/open-apis/authen/v1/user_info`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        console.log(`[DEBUG] Lark token validation failed: ${response.status} ${response.statusText}`);
        res.status(401).json({ error: 'invalid_token', error_description: 'Token validation failed' });
        return;
      }

      const data = await response.json();

      if (data.code !== 0) {
        console.log(`[DEBUG] Lark API error during token validation:`, data);
        res.status(401).json({ error: 'invalid_token', error_description: 'Invalid token' });
        return;
      }

      // 获取用户信息
      const userId = data.data?.sub;
      const userName = data.data?.name;

      if (!userId) {
        console.log(`[DEBUG] No user ID found in Lark response`);
        res.status(401).json({ error: 'invalid_token', error_description: 'User ID not found' });
        return;
      }

      try {
        // 使用UserManager获取或创建用户会话
        const userSession = await userManager.getOrCreateUserSession(userId, token, userName);
        
        // 设置用户信息到请求对象
        req.user = {
          client_id: 'lark_user',
          scope: 'mcp',
          accessToken: token,
          lark_user_id: userId,
          lark_user_name: userName,
          userSession: userSession,
        } as any;

        // 添加用户会话辅助方法
        addUserSessionMethods(req);

        console.log(`[DEBUG] ✅ User authenticated and session created/updated: ${userId}`);
        console.log(`[DEBUG] Active users: ${userManager.getActiveUserCount()}, Total connections: ${userManager.getTotalConnectionCount()}`);

        next();
      } catch (userError) {
        console.error('[ERROR] UserManager error:', userError);
        res.status(500).json({ 
          error: 'user_session_error', 
          error_description: userError instanceof Error ? userError.message : 'Failed to create user session' 
        });
      }
    } catch (error) {
      console.error('[ERROR] Token validation error:', error);
      res.status(401).json({ error: 'invalid_token', error_description: 'Token validation failed' });
    }
  }

  // 存储外部传入的 MCP 服务器实例
  let externalMcpServer: McpServer | null = null;

  // 存储外部传入的 LarkClient 实例
  let globalLarkClient: any = null;

  // Handle SSE endpoint for POST - 建立长连接
  async function handleSSEConnection(req: Request, res: Response): Promise<void> {
    const sessionId = crypto.randomUUID();
    
    // 获取用户信息
    const userId = requireUserId(req);
    const userSession = (req.user as any)?.userSession;
    
    console.log(`[DEBUG] Creating SSE session: ${sessionId} for user: ${userId}`);
    console.log(`[DEBUG] User Info: userId=${userId}, userName=${getUserName(req)}`);

    try {
      // 使用传入的 mcpServer 而不是创建新的 Server 实例
      if (!externalMcpServer) {
        console.error('[ERROR] No MCP server instance available');
        res.status(500).json({ error: 'No MCP server available' });
        return;
      }

      // 创建 SSE Transport
      const transport = new SSEServerTransport('/messages', res);

      // 创建连接信息
      const connectionInfo = {
        sessionId,
        transport,
        response: res,
        userId,
        clientId: req.user?.client_id,
        createdAt: Date.now(),
      };

      // 使用UserManager添加连接
      try {
        userManager.addConnection(userId, connectionInfo);
        console.log(`[DEBUG] Added connection to UserManager for user ${userId} (session: ${sessionId})`);
      } catch (error) {
        console.error('[ERROR] Failed to add connection to UserManager:', error);
        res.status(500).json({ error: 'Failed to register connection' });
        return;
      }

      // 连接 server 和 transport
      await externalMcpServer.connect(transport);
      console.log(`[DEBUG] MCP server connected to SSE transport successfully for session: ${sessionId}`);
      console.log(`[DEBUG] User manager stats - Active users: ${userManager.getActiveUserCount()}, Total connections: ${userManager.getTotalConnectionCount()}`);

      // 发送端点信息给客户端
      res.write(`event: endpoint\n`);
      res.write(`data: http://${req.get('host') || 'localhost:' + PORT}/messages?sessionId=${sessionId}\n\n`);

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
        userManager.removeConnection(userId, sessionId);
      });

      req.on('error', (error: any) => {
        if (error.code === 'ECONNRESET' || error.code === 'ECONNABORTED') {
          console.log(`[INFO] SSE connection closed by client for session ${sessionId} (${error.code})`);
        } else {
          console.error(`[ERROR] SSE connection error for session ${sessionId}:`, error);
        }
        userManager.removeConnection(userId, sessionId);
      });

      res.on('error', (error: any) => {
        if (error.code === 'ECONNRESET' || error.code === 'ECONNABORTED') {
          console.log(`[INFO] SSE response connection closed by client for session ${sessionId} (${error.code})`);
        } else {
          console.error(`[ERROR] SSE response error for session ${sessionId}:`, error);
        }
        userManager.removeConnection(userId, sessionId);
      });

      // 保持连接活跃
      const keepAlive = setInterval(() => {
        if (res.writable) {
          res.write(`event: ping\n`);
          res.write(`data: ${Date.now()}\n\n`);
        } else {
          clearInterval(keepAlive);
          userManager.removeConnection(userId, sessionId);
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
  async function handlePostMessage(req: Request, res: Response): Promise<void> {
    const sessionId = req.query.sessionId as string;
    const userId = requireUserId(req);
    
    console.log(`[DEBUG] Received POST message for session: ${sessionId}, user: ${userId}`);

    if (!sessionId) {
      res.status(400).json({ error: 'Missing sessionId parameter' });
      return;
    }

    try {
      // 使用UserManager查找连接
      const userConnections = userManager.getActiveConnections(userId);
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

  // MCP SSE 端点 - 只支持 GET 用于建立SSE连接
  // 注意：SSE连接必须使用GET方法，POST用于/messages端点

  // MCP Messages 端点 - 只支持 POST 用于发送消息
  app.post('/messages', authenticateToken, handlePostMessage);

  // Handle CORS preflight requests for SSE endpoint
  app.options('/sse', (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, MCP-Protocol-Version');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.sendStatus(200);
  });

  // 存储外部传入的 MCP 服务器实例
  externalMcpServer = mcpServer;

  // 存储外部传入的 LarkClient 实例
  globalLarkClient = larkClient;
  
  console.log(`[DEBUG] Server initialization:`);
  console.log(`  - MCP Server: ${externalMcpServer ? 'Available' : 'Not Available'}`);
  console.log(`  - Lark Client: ${globalLarkClient ? 'Available' : 'Not Available'}`);
  if (globalLarkClient && globalLarkClient.updateUserAccessToken) {
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

// MCP SSE 端点 - 只支持 GET 用于建立SSE连接
app.get('/sse', authenticateToken, handleSSEConnection);

// 处理错误的 POST /sse 请求，返回有用的错误信息
app.post('/sse', (req, res) => {
  console.log(`[WARNING] Received incorrect POST request to /sse endpoint`);
  res.status(405).json({
    error: 'Method Not Allowed',
    message: 'SSE endpoint only supports GET method for establishing connections',
    correct_usage: {
      sse_connection: 'GET /sse',
      send_messages: 'POST /messages?sessionId=<session_id>'
    }
  });
});

  // 启动服务器
  const host = options.host || 'localhost';

  console.log(`[DEBUG] Starting MCP SSE Server with OAuth on ${host}:${PORT}`);
  app.listen(PORT, host, () => {
    console.log(`MCP SSE Server with OAuth running on ${host}:${PORT}`);
    console.log(`OAuth endpoints:`);
    console.log(`  - Metadata: GET http://${host}:${PORT}/.well-known/oauth-authorization-server`);
    console.log(`  - Register: POST http://${host}:${PORT}/register`);
    console.log(`  - Authorize: GET http://${host}:${PORT}/authorize`);
    console.log(`  - Token: POST http://${host}:${PORT}/token`);
    console.log(`MCP endpoints:`);
    console.log(`  - SSE Connection: GET http://${host}:${PORT}/sse`);
    console.log(`  - Messages: POST http://${host}:${PORT}/messages`);
  });
}
