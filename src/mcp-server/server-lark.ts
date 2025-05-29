import { Server } from '@modelcontextprotocol/sdk/server/index.js';  
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';  
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';  
import express, { Request, Response, NextFunction } from 'express';  
import crypto from 'crypto';  
import cors from 'cors';  
import { LarkOAuthClient } from './lark/oauth-client.js';
import { larkConfig, checkRequiredEnvVars } from './config/env.js';

// Check environment variables on startup
const envCheck = checkRequiredEnvVars();
if (!envCheck.isValid) {
  console.error('Missing required environment variables:', envCheck.missingVars);
  console.error('Please create a .env file with the required variables. See env.example for reference.');
  process.exit(1);
}


console.log('Lark OAuth configuration loaded:');
console.log('- App ID:', larkConfig.appId);
console.log('- Redirect URI for internal use:', larkConfig.redirectUri);
console.log('- Base URL:', larkConfig.baseUrl);

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

const app = express();  

// Enable CORS for all routes
app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'MCP-Protocol-Version']
}));

app.use(express.json());  
app.use(express.urlencoded({ extended: true }));

// 添加请求日志中间件
app.use((req, res, next) => {
  console.log(`[REQUEST] ${new Date().toISOString()} - ${req.method} ${req.path}`);
  if (Object.keys(req.query).length > 0) {
    console.log(`[REQUEST] Query params:`, req.query);
  }
  next();
});
  
// OAuth 存储 (生产环境请使用数据库)  
const clients = new Map();  
const tokens = new Map();  
const authCodes = new Map();
const authCodeToRedirectUri = new Map(); // 存储授权码和对应的redirect_uri映射
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';  
  
// 添加健康检查端点
app.get('/health', (req, res) => {
  console.log(`[HEALTH] 🟢 Health check requested from ${req.ip}`);
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    port: PORT,
    message: 'Server is running!'
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
    subject_types_supported: ['public']
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
    ...req.body  
  };  
    
  clients.set(clientId, clientInfo);
  console.log(`[DEBUG] Registered client: ${clientId}, total clients: ${clients.size}`);
  res.json(clientInfo);  
});  
  
// OAuth 授权端点  
app.get('/authorize', (req: Request, res: Response): void => {  
  console.log('\n============================================');
  console.log(`[AUTHORIZE] 📥 New authorization request received!`);
  console.log(`[AUTHORIZE] ⏰ Timestamp: ${new Date().toISOString()}`);
  console.log(`[AUTHORIZE] 🌐 Full URL: ${req.protocol}://${req.get('host')}${req.originalUrl}`);
  console.log('============================================\n');
  
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
    /^http:\/\/localhost:\d+\/oauth\/callback$/,           // localhost with any port, /oauth/callback path
    /^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/,       // 127.0.0.1 with any port, /oauth/callback path  
    /^http:\/\/localhost:\d+\/callback$/,                 // localhost with any port, /callback path
    /^https:\/\/[\w\-\.]+\.[\w]+\/oauth\/callback$/       // HTTPS domains for production (optional)
  ];
  
  // Check if redirect_uri matches any allowed pattern
  const isValidRedirectUri = allowedRedirectPatterns.some(pattern => 
    pattern.test(decodedRedirectUri)
  );
  
  if (!isValidRedirectUri) {
    console.error(`[ERROR] Invalid redirect_uri format: ${decodedRedirectUri}`);
    console.error(`[ERROR] Allowed patterns:`);
    console.error(`  - http://localhost:[port]/oauth/callback`);
    console.error(`  - http://127.0.0.1:[port]/oauth/callback`);
    console.error(`  - http://localhost:[port]/callback`);
    res.status(400).json({ 
      error: 'invalid_redirect_uri',
      error_description: 'Redirect URI does not match allowed patterns'
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
        decodedRedirectUri // Use already decoded redirect_uri
      ],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none' // Public client
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
  const authState = state as string || crypto.randomUUID();
  
  console.log(`[DEBUG] Constructing Lark authorization URL...`);
  console.log(`[DEBUG] Using mcp-remote redirect_uri: ${mcpRedirectUri}`);
  console.log(`[DEBUG] Using state: ${authState}`);
  
  try {
    // Get scopes from larkConfig, fallback to minimal scope for testing
    console.log(`[DEBUG] Current larkConfig:`, {
      appId: larkConfig.appId,
      baseUrl: larkConfig.baseUrl,
      redirectUri: larkConfig.redirectUri,
      scopes: larkConfig.scopes
    });
    const larkScopes = larkConfig.scopes.length > 0 
      ? larkConfig.scopes.join(' ') 
      : 'contact:user.id:readonly'; // Use minimal scope for testing
    
    console.log(`[DEBUG] Using Lark scope from config: ${larkScopes}`);
    console.log(`[DEBUG] Note: Scope source: ${larkConfig.scopes.length > 0 ? 'larkConfig' : 'default fallback'}`);
    
    // Construct Lark's actual authorization URL
    // Use mcp-remote's redirect_uri so Lark redirects directly to mcp-remote
    const larkAuthUrl = larkOAuthClient.getAuthorizationUrl({
      redirect_uri: mcpRedirectUri, // Use mcp-remote's redirect URI
      state: authState, // Ensure state is not undefined
      scope: larkScopes // Use scope from config
    });
    
    console.log(`[DEBUG] Redirecting to Lark authorization URL:`);
    console.log(`  - URL: ${larkAuthUrl}`);
    console.log(`  - This will redirect user to Lark for actual authorization`);
    console.log(`  - After user approval, Lark will redirect to: ${mcpRedirectUri}`);
    
    // Redirect user's browser to Lark's authorization page
    res.redirect(larkAuthUrl);
  } catch (error) {
    console.error('[ERROR] Failed to construct Lark authorization URL:', error);
    res.status(500).json({ error: 'internal_server_error', error_description: 'Failed to construct authorization URL' });
  }
});  
  
// OAuth 用户令牌端点 (获取 u- 格式的用户令牌)
app.post('/token', async (req: Request, res: Response): Promise<void> => {  
  console.log(`[DEBUG] User token request body:`, req.body);

  const { grant_type, code, client_id, code_verifier } = req.body;  
    
  console.log(`[DEBUG] User token request from mcp-remote:`);
  console.log(`  - grant_type: ${grant_type}`);
  console.log(`  - client_id: ${client_id}`);
  
  if (grant_type === 'authorization_code') {  
    console.log(`  - code: ${code ? code.substring(0, 20) + '...' : 'undefined'}`);
    console.log(`[DEBUG] Exchanging Lark authorization code for user token (u- format)...`);
    
    try {
      // Get the client info to determine the correct redirect_uri used during authorization
      const client = clients.get(client_id as string);
      
      // Use LarkOAuthClient to exchange the Lark authorization code for user token (u- format)
      const tokenData = await larkOAuthClient.exchangeCodeForUserTokens(code);
      
      console.log('[DEBUG] Successfully exchanged Lark code for user token (u- format)');
      console.log(`[DEBUG] Token data:`, {
        access_token: tokenData.access_token?.substring(0, 20) + '...',
        refresh_token: tokenData.refresh_token?.substring(0, 20) + '...',
        token_type: tokenData.token_type,
        expires_in: tokenData.expires_in,
        refresh_expires_in: tokenData.refresh_expires_in,
        scope: tokenData.scope
      });
      
      // Return the complete token data to mcp-remote
      const responseToMcpRemote = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_type: tokenData.token_type || 'Bearer',
        expires_in: tokenData.expires_in || 7200,
        refresh_expires_in: tokenData.refresh_expires_in,
        scope: tokenData.scope
      };
      
      console.log('[DEBUG] Sending complete token data to mcp-remote:', {
        access_token: responseToMcpRemote.access_token?.substring(0, 20) + '...',
        refresh_token: responseToMcpRemote.refresh_token?.substring(0, 20) + '...',
        token_type: responseToMcpRemote.token_type,
        expires_in: responseToMcpRemote.expires_in,
        refresh_expires_in: responseToMcpRemote.refresh_expires_in,
        scope: responseToMcpRemote.scope
      });
      
      res.json(responseToMcpRemote);
    } catch (error) {
      console.error('[ERROR] Failed to exchange Lark authorization code for user token:', error);
      res.status(400).json({ 
        error: 'invalid_grant', 
        error_description: error instanceof Error ? error.message : 'User token exchange failed' 
      });
    }
  } else {  
    res.status(400).json({ error: 'unsupported_grant_type' });  
  }  
});
  
// 验证 Lark Bearer Token 的中间件  
async function authenticateToken(req: Request, res: Response, next: NextFunction): Promise<void> {  
  const authHeader = req.headers.authorization;  
    
  if (!authHeader || !authHeader.startsWith('Bearer ')) {  
    res.status(401).json({ error: 'unauthorized', error_description: 'Bearer token required' });
    return;  
  }  
    
  const token = authHeader.substring(7);  
    
  try {  
    console.log(`[DEBUG] Validating Lark access token: ${token.substring(0, 20)}...`);
    
    // For now, we'll do a simple validation by trying to get user info with the token
    // In a production environment, you might want to validate the JWT signature if Lark provides JWKS
    // or cache token validation results to avoid repeated API calls
    
    // Try to get user info to validate the token
    const response = await fetch(`${larkConfig.baseUrl}/open-apis/authen/v1/user_info`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
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

    console.log(`[DEBUG] Lark token validated successfully for user: ${data.data?.name || 'unknown'}`);
    
    // Set user information from Lark response
    req.user = { 
      client_id: 'lark_user', // Since we're proxying Lark, we don't have a traditional client_id
      scope: 'mcp'
    } as any;
    
    // Add Lark-specific properties
    (req.user as any).lark_user_id = data.data?.sub;
    (req.user as any).lark_user_name = data.data?.name;
    
    next();  
  } catch (error) {  
    console.error('[ERROR] Token validation error:', error);
    res.status(401).json({ error: 'invalid_token', error_description: 'Token validation failed' });
  }  
}

// 存储SSE连接的Map
const sseConnections = new Map();

// Handle SSE endpoint for GET - 建立长连接
async function handleSSEConnection(req: Request, res: Response): Promise<void> {
  console.log(`[DEBUG] SSE connection request from client: ${req.user?.client_id}`);
  
  const sessionId = crypto.randomUUID();
  console.log(`[DEBUG] Creating SSE session: ${sessionId}`);

  try {
    // 创建 MCP Server 实例
    const server = new Server(  
      {  
        name: 'oauth-mcp-server',  
        version: '1.0.0',  
      },  
      {  
        capabilities: {  
          tools: {},  
        },  
      }  
    );  
    
    // 注册工具  
    server.setRequestHandler(ListToolsRequestSchema, async () => {  
      console.log('[DEBUG] Received list_tools request');
      return {  
        tools: [  
          {  
            name: 'echo',  
            description: 'Echo back the input',  
            inputSchema: {  
              type: 'object',  
              properties: {  
                message: {  
                  type: 'string',  
                  description: 'Message to echo back',  
                },  
              },  
              required: ['message'],  
            },  
          },  
        ],  
      };  
    });  
    
    server.setRequestHandler(CallToolRequestSchema, async (request) => {  
      console.log('[DEBUG] Received call_tool request:', request.params.name);
      if (request.params.name === 'echo') {  
        return {  
          content: [  
            {  
              type: 'text',  
              text: `Echo: ${request.params.arguments?.message || 'No message provided'}`,  
            },  
          ],  
        };  
      } else {  
        throw new Error(`Unknown tool: ${request.params.name}`);  
      }  
    });  
    
    console.log('[DEBUG] Creating SSE transport');
    
    // 创建 SSE Transport - 让它自己处理响应头
    const transport = new SSEServerTransport('/messages', res);  
    
    // 存储连接信息
    sseConnections.set(sessionId, { transport, server, response: res, clientId: req.user?.client_id });
    
    console.log('[DEBUG] Connecting MCP server to SSE transport');
    
    // 连接 server 和 transport  
    await server.connect(transport);  
    console.log('[DEBUG] MCP server connected to SSE transport successfully');

    // 发送端点信息给客户端
    res.write(`event: endpoint\n`);
    res.write(`data: http://localhost:${PORT}/messages?sessionId=${sessionId}\n\n`);
    
    // 发送初始化成功消息
    res.write(`event: message\n`);
    res.write(`data: ${JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {}
    })}\n\n`);

    // 处理连接关闭  
    req.on('close', () => {  
      console.log(`[DEBUG] SSE connection closed for session: ${sessionId}`);
      sseConnections.delete(sessionId);
      server.close();  
    });

    // Handle server errors
    server.onerror = (error) => {
      console.error('[ERROR] MCP Server error:', error);
    };
    
    // 保持连接活跃
    const keepAlive = setInterval(() => {
      if (res.writable) {
        res.write(`event: ping\n`);
        res.write(`data: ${Date.now()}\n\n`);
      } else {
        clearInterval(keepAlive);
        sseConnections.delete(sessionId);
      }
    }, 15000); // 每15秒发送一次ping
    
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
  console.log(`[DEBUG] Received POST message for session: ${sessionId}`);
  
  if (!sessionId) {
    res.status(400).json({ error: 'Missing sessionId parameter' });
    return;
  }

  const connection = sseConnections.get(sessionId);
  if (!connection) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  try {
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
app.get('/sse', authenticateToken, handleSSEConnection);

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
  
// 启动服务器  
const PORT = process.env.PORT || 3000;  
console.log(`[DEBUG] Starting server on port ${PORT}`);
app.listen(PORT, () => {  
  console.log(`MCP SSE Server with OAuth running on port ${PORT}`);  
  console.log(`OAuth endpoints:`);
  console.log(`  - Metadata: GET http://localhost:${PORT}/.well-known/oauth-authorization-server`);  
  console.log(`  - Register: POST http://localhost:${PORT}/register`);  
  console.log(`  - Authorize: GET http://localhost:${PORT}/authorize`);  
  console.log(`  - Token: POST http://localhost:${PORT}/token`);
  console.log(`  - SSE: GET/POST http://localhost:${PORT}/sse`);  
});
