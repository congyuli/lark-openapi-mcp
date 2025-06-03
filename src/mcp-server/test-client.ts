import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { 
  ListToolsRequestSchema, 
  CallToolRequestSchema,
  LoggingMessageNotificationSchema,
  ToolListChangedNotificationSchema,
  CallToolResult,
  TextContent
} from '@modelcontextprotocol/sdk/types.js';

interface TokenData {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  expires_at: string;
  scope?: string;
}

interface MCPTestClientOptions {
  serverBaseUrl: string;
  clientName: string;
  clientVersion: string;
  // OAuth配置
  oauthConfig?: {
    clientId: string;
    redirectUri: string;
    scope: string;
  };
  // 可选的预设token
  initialToken?: TokenData;
}

export class MCPSSETestClient {
  private client: Client;
  private transport: SSEClientTransport | null = null;
  private serverBaseUrl: string;
  private oauthConfig?: MCPTestClientOptions['oauthConfig'];
  
  // Token管理
  private currentToken: TokenData | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private isConnected = false;
  
  constructor(private options: MCPTestClientOptions) {
    this.client = new Client({
      name: options.clientName,
      version: options.clientVersion
    });
    this.serverBaseUrl = options.serverBaseUrl;
    this.oauthConfig = options.oauthConfig;
    this.currentToken = options.initialToken || null;
  }

  /**
   * 启动完整的测试流程
   */
  async start(): Promise<void> {
    try {
      console.log('[CLIENT] 🚀 启动MCP SSE测试客户端...');
      
      // 1. 获取或刷新token
      await this.ensureValidToken();
      
      // 2. 连接到MCP服务器
      await this.connectToMCPServer();
      
      // 3. 测试MCP功能
      await this.testMCPFunctionality();
      
      // 4. 设置token自动刷新
      this.setupTokenAutoRefresh();
      
      console.log('[CLIENT] ✅ 测试客户端启动完成');
      
    } catch (error) {
      console.error('[CLIENT] ❌ 启动失败:', error);
      throw error;
    }
  }

  /**
   * 注册新的OAuth客户端
   */
  async registerOAuthClient(): Promise<void> {
    if (!this.oauthConfig) {
      throw new Error('OAuth配置未提供');
    }

    console.log('[CLIENT] 📝 注册OAuth客户端...');
    
    const response = await fetch(`${this.serverBaseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: `${this.options.clientName} Test Client`,
        redirect_uris: [this.oauthConfig.redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none'
      })
    });

    if (!response.ok) {
      throw new Error(`客户端注册失败: ${response.status} ${response.statusText}`);
    }

    const clientInfo = await response.json();
    console.log('[CLIENT] ✅ OAuth客户端注册成功:', clientInfo);
  }

  /**
   * 执行OAuth授权流程（模拟）
   */
  async performOAuthFlow(): Promise<TokenData> {
    if (!this.oauthConfig) {
      throw new Error('OAuth配置未提供');
    }

    console.log('[CLIENT] 🔐 开始OAuth授权流程...');
    
    // 注册客户端
    await this.registerOAuthClient();
    
    // 构建授权URL
    const authUrl = new URL(`${this.serverBaseUrl}/authorize`);
    authUrl.searchParams.set('client_id', this.oauthConfig.clientId);
    authUrl.searchParams.set('redirect_uri', this.oauthConfig.redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', this.oauthConfig.scope);
    authUrl.searchParams.set('state', 'test-state-' + Date.now());

    console.log('[CLIENT] 📋 授权URL:', authUrl.toString());
    console.log('[CLIENT] ⚠️  在真实环境中，用户需要访问此URL并授权');
    
    // 模拟用户授权后的回调（在真实环境中这会是一个重定向）
    console.log('[CLIENT] 🎭 模拟授权回调...');
    
    // 模拟授权码（在真实环境中这来自回调参数）
    const mockAuthCode = 'mock_auth_code_' + Date.now();
    
    // 交换授权码为访问令牌
    const tokenResponse = await fetch(`${this.serverBaseUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: mockAuthCode,
        client_id: this.oauthConfig.clientId,
        redirect_uri: this.oauthConfig.redirectUri
      })
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw new Error(`Token交换失败: ${tokenResponse.status} ${errorText}`);
    }

    const tokenData: TokenData = await tokenResponse.json();
    console.log('[CLIENT] ✅ OAuth流程完成，获得token:', {
      access_token: tokenData.access_token?.substring(0, 20) + '...',
      expires_in: tokenData.expires_in,
      expires_at: tokenData.expires_at
    });

    return tokenData;
  }

  /**
   * 刷新访问令牌
   */
  async refreshToken(): Promise<TokenData> {
    if (!this.currentToken?.refresh_token) {
      throw new Error('没有refresh_token可用于刷新');
    }

    console.log('[CLIENT] 🔄 刷新访问令牌...');

    const response = await fetch(`${this.serverBaseUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: this.currentToken.refresh_token,
        client_id: this.oauthConfig?.clientId
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token刷新失败: ${response.status} ${errorText}`);
    }

    const newTokenData: TokenData = await response.json();
    console.log('[CLIENT] ✅ Token刷新成功:', {
      access_token: newTokenData.access_token?.substring(0, 20) + '...',
      expires_in: newTokenData.expires_in,
      expires_at: newTokenData.expires_at
    });

    return newTokenData;
  }

  /**
   * 确保有有效的token
   */
  async ensureValidToken(): Promise<void> {
    console.log('[CLIENT] 🔍 检查token状态...');

    // 如果没有token，执行OAuth流程
    if (!this.currentToken) {
      if (this.oauthConfig) {
        this.currentToken = await this.performOAuthFlow();
      } else {
        throw new Error('没有token且未提供OAuth配置');
      }
      return;
    }

    // 检查token是否即将过期（提前5分钟刷新）
    const expiresAt = new Date(this.currentToken.expires_at);
    const now = new Date();
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

    if (expiresAt <= fiveMinutesFromNow) {
      console.log('[CLIENT] ⏰ Token即将过期，尝试刷新...');
      try {
        this.currentToken = await this.refreshToken();
      } catch (error) {
        console.log('[CLIENT] ⚠️  Token刷新失败，重新执行OAuth流程...');
        if (this.oauthConfig) {
          this.currentToken = await this.performOAuthFlow();
        } else {
          throw error;
        }
      }
    } else {
      console.log('[CLIENT] ✅ 当前token仍然有效');
    }
  }

  /**
   * 连接到MCP服务器
   */
  async connectToMCPServer(): Promise<void> {
    if (!this.currentToken) {
      throw new Error('需要有效的token才能连接MCP服务器');
    }

    console.log('[CLIENT] 🔌 连接到MCP服务器...');

    // 创建SSE传输，包含认证头
    const sseUrl = new URL(`${this.serverBaseUrl}/sse`);
    this.transport = new SSEClientTransport(sseUrl);

    // 设置认证头
    (this.transport as any).headers = {
      'Authorization': `Bearer ${this.currentToken.access_token}`
    };

    // 设置传输事件处理
    this.setupTransportEventHandlers();

    // 连接客户端
    await this.client.connect(this.transport);
    this.isConnected = true;
    
    console.log('[CLIENT] ✅ MCP连接建立成功');
  }

  /**
   * 设置传输事件处理器
   */
  private setupTransportEventHandlers(): void {
    if (!this.transport) return;

    this.transport.onclose = () => {
      console.log('[CLIENT] 🔌 SSE连接已关闭');
      this.isConnected = false;
    };

    this.transport.onerror = async (error) => {
      console.error('[CLIENT] ❌ SSE传输错误:', error);
      
      // 如果是认证错误，尝试刷新token并重连
      if (error.message.includes('401') || error.message.includes('unauthorized')) {
        console.log('[CLIENT] 🔄 检测到认证错误，尝试刷新token并重连...');
        try {
          await this.ensureValidToken();
          await this.reconnect();
        } catch (reconError) {
          console.error('[CLIENT] ❌ 重连失败:', reconError);
        }
      }
    };

    this.transport.onmessage = (message) => {
      console.log('[CLIENT] 📨 收到服务器消息:', message);
    };
  }

  /**
   * 设置通知处理器
   */
  private setupNotificationHandlers(): void {
    // 设置日志消息通知处理器
    this.client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
      console.log('[CLIENT] 📝 服务器日志:', notification.params);
    });

    // 设置工具变更通知处理器
    this.client.setNotificationHandler(ToolListChangedNotificationSchema, async (notification) => {
      console.log('[CLIENT] 🔧 工具列表已变更');
      try {
        await this.listTools();
      } catch (error) {
        console.error('[CLIENT] ❌ 重新获取工具列表失败:', error);
      }
    });
  }

  /**
   * 测试MCP功能
   */
  async testMCPFunctionality(): Promise<void> {
    console.log('[CLIENT] 🧪 开始测试MCP功能...');

    // 设置通知处理器
    this.setupNotificationHandlers();

    // 测试工具列表
    await this.listTools();

    // 测试工具调用
    await this.callExampleTool();

    console.log('[CLIENT] ✅ MCP功能测试完成');
  }

  /**
   * 列出可用工具
   */
  async listTools(): Promise<void> {
    try {
      console.log('[CLIENT] 📋 获取工具列表...');
      const result = await this.client.listTools();
      
      console.log('[CLIENT] 🔧 可用工具:');
      result.tools.forEach((tool, index) => {
        console.log(`  ${index + 1}. ${tool.name}: ${tool.description || '无描述'}`);
      });

      if (result.tools.length === 0) {
        console.log('[CLIENT] ⚠️  服务器未提供任何工具');
      }
    } catch (error) {
      console.error('[CLIENT] ❌ 获取工具列表失败:', error);
    }
  }

  /**
   * 调用示例工具
   */
  async callExampleTool(): Promise<void> {
    try {
      console.log('[CLIENT] 🛠️  测试工具调用...');
      
      // 首先获取工具列表
      const toolsResult = await this.client.listTools();
      
      if (toolsResult.tools.length === 0) {
        console.log('[CLIENT] ⚠️  没有可用工具进行测试');
        return;
      }

      // 选择第一个工具进行测试
      const firstTool = toolsResult.tools[0];
      console.log(`[CLIENT] 🎯 调用工具: ${firstTool.name}`);

      // 构造测试参数（根据实际工具调整）
      const testArgs = firstTool.name.includes('echo') ? 
        { message: 'Hello from test client!' } :
        { test: 'parameter' };

      const result = await this.client.callTool({
        name: firstTool.name,
        arguments: testArgs
      });

      console.log('[CLIENT] ✅ 工具调用结果:');
      if (result.content && Array.isArray(result.content)) {
        result.content.forEach((content: any, index: number) => {
          if (content.type === 'text') {
            console.log(`  ${index + 1}. ${(content as TextContent).text}`);
          } else {
            console.log(`  ${index + 1}. [${content.type}内容]`);
          }
        });
      }

    } catch (error) {
      console.error('[CLIENT] ❌ 工具调用失败:', error);
    }
  }

  /**
   * 设置token自动刷新
   */
  private setupTokenAutoRefresh(): void {
    if (!this.currentToken) return;

    const expiresAt = new Date(this.currentToken.expires_at);
    const now = new Date();
    
    // 在token过期前10分钟刷新
    const refreshTime = new Date(expiresAt.getTime() - 10 * 60 * 1000);
    const timeUntilRefresh = refreshTime.getTime() - now.getTime();

    if (timeUntilRefresh > 0) {
      console.log(`[CLIENT] ⏱️  设置token自动刷新，将在${Math.round(timeUntilRefresh / 1000 / 60)}分钟后刷新`);
      
      this.refreshTimer = setTimeout(async () => {
        try {
          console.log('[CLIENT] 🔄 执行自动token刷新...');
          await this.ensureValidToken();
          
          // 如果连接着MCP服务器，更新认证头
          if (this.isConnected && this.transport && this.currentToken) {
            (this.transport as any).headers = {
              'Authorization': `Bearer ${this.currentToken.access_token}`
            };
            console.log('[CLIENT] ✅ MCP连接的认证头已更新');
          }
          
          // 设置下次刷新
          this.setupTokenAutoRefresh();
          
        } catch (error) {
          console.error('[CLIENT] ❌ 自动token刷新失败:', error);
        }
      }, timeUntilRefresh);
    }
  }

  /**
   * 重新连接
   */
  async reconnect(): Promise<void> {
    console.log('[CLIENT] 🔄 尝试重新连接...');
    
    try {
      // 关闭当前连接
      if (this.transport) {
        await this.client.close();
        this.isConnected = false;
      }

      // 重新连接
      await this.connectToMCPServer();
      
      console.log('[CLIENT] ✅ 重连成功');
    } catch (error) {
      console.error('[CLIENT] ❌ 重连失败:', error);
      throw error;
    }
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    console.log('[CLIENT] 🧹 清理资源...');

    // 清除刷新定时器
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    // 关闭MCP连接
    if (this.isConnected) {
      await this.client.close();
      this.isConnected = false;
    }

    console.log('[CLIENT] ✅ 资源清理完成');
  }

  /**
   * 获取当前token信息
   */
  getTokenInfo(): { hasToken: boolean; expiresAt?: string; timeUntilExpiry?: number } {
    if (!this.currentToken) {
      return { hasToken: false };
    }

    const expiresAt = new Date(this.currentToken.expires_at);
    const now = new Date();
    const timeUntilExpiry = expiresAt.getTime() - now.getTime();

    return {
      hasToken: true,
      expiresAt: this.currentToken.expires_at,
      timeUntilExpiry: Math.max(0, timeUntilExpiry)
    };
  }

  /**
   * 获取连接状态
   */
  getConnectionStatus(): { isConnected: boolean; hasValidToken: boolean } {
    const tokenInfo = this.getTokenInfo();
    const hasValidToken = tokenInfo.hasToken && (tokenInfo.timeUntilExpiry || 0) > 0;

    return {
      isConnected: this.isConnected,
      hasValidToken
    };
  }
}

// 示例使用
async function runTestClient() {
  const client = new MCPSSETestClient({
    serverBaseUrl: 'http://localhost:3000',
    clientName: 'Test-Client',
    clientVersion: '1.0.0',
    oauthConfig: {
      clientId: 'test-client-' + Date.now(),
      redirectUri: 'http://localhost:3334/callback',
      scope: 'mcp'
    }
  });

  try {
    // 启动测试客户端
    await client.start();
    
    // 保持运行以测试自动刷新
    console.log('[MAIN] 🎯 测试客户端正在运行，按Ctrl+C退出...');
    
    // 定期显示状态
    const statusInterval = setInterval(() => {
      const tokenInfo = client.getTokenInfo();
      const connectionStatus = client.getConnectionStatus();
      
      console.log('[STATUS] 📊 当前状态:');
      console.log(`  - 连接状态: ${connectionStatus.isConnected ? '✅ 已连接' : '❌ 未连接'}`);
      console.log(`  - Token状态: ${connectionStatus.hasValidToken ? '✅ 有效' : '❌ 无效/过期'}`);
      
      if (tokenInfo.hasToken && tokenInfo.timeUntilExpiry) {
        const minutes = Math.round(tokenInfo.timeUntilExpiry / 1000 / 60);
        console.log(`  - Token剩余时间: ${minutes}分钟`);
      }
      
      console.log('');
    }, 30000); // 每30秒显示一次状态

    // 优雅退出处理
    process.on('SIGINT', async () => {
      console.log('\n[MAIN] 🛑 收到退出信号，正在清理...');
      clearInterval(statusInterval);
      await client.cleanup();
      process.exit(0);
    });

  } catch (error) {
    console.error('[MAIN] ❌ 测试客户端运行失败:', error);
    await client.cleanup();
    process.exit(1);
  }
}

// 如果直接运行此文件，执行测试客户端
if (typeof process !== 'undefined' && process.argv && process.argv[1] && process.argv[1].includes('test-client')) {
  runTestClient();
}
