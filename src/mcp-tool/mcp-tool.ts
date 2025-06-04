import { Client } from '@larksuiteoapi/node-sdk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LarkMcpToolOptions, McpTool, ToolNameCase, TokenMode } from './types';
import { AllTools, AllToolsZh } from './tools';
import { filterTools } from './utils/filter-tools';
import { defaultToolNames } from './constants';
import { larkOapiHandler, setGlobalUserManager, getUserLarkClientAndToken } from './utils/handler';
import { caseTransf } from './utils/case-transf';
import { getShouldUseUAT } from './utils/get-should-use-uat';

/**
 * Feishu/Lark MCP
 */
export class LarkMcpTool {
  // Lark Client
  private client: Client | null = null;

  // User Access Token
  private userAccessToken: string | undefined;

  // Token Mode
  private tokenMode: TokenMode = TokenMode.AUTO;

  // All Tools
  private allTools: McpTool[] = [];

  // Client creation options (保存用于创建用户专属客户端)
  private clientOptions: LarkMcpToolOptions;

  /**
   * Feishu/Lark MCP
   * @param options Feishu/Lark Client Options
   */
  constructor(options: LarkMcpToolOptions) {
    // 保存客户端创建选项
    this.clientOptions = { ...options };

    if (options.client) {
      this.client = options.client;
    } else if (options.appId && options.appSecret) {
      this.client = new Client({
        appId: options.appId,
        appSecret: options.appSecret,
        ...options,
      });
    }
    this.tokenMode = options.tokenMode || TokenMode.AUTO;
    const isZH = options.toolsOptions?.language === 'zh';

    const filterOptions = {
      allowTools: defaultToolNames,
      tokenMode: this.tokenMode,
      ...options.toolsOptions,
    };
    this.allTools = filterTools(isZH ? AllToolsZh : AllTools, filterOptions);
  }

  /**
   * Create User-specific LarkMcpTool instance
   * 为用户创建专属的LarkMcpTool实例，确保用户隔离
   * @param userAccessToken User Access Token
   * @returns New LarkMcpTool instance for the user
   */
  async createUserClient(userAccessToken: string): Promise<LarkMcpTool> {
    console.log(`[LarkMcpTool] Creating user-specific client instance`);
    
    // 创建用户专属的LarkMcpTool实例
    const userClient = new LarkMcpTool({
      ...this.clientOptions,
      // 确保每个用户有独立的Client实例
      client: undefined, // 强制创建新的Client实例
    });

    // 设置用户访问令牌
    userClient.updateUserAccessToken(userAccessToken);
    
    // 验证用户隔离
    userClient.validateUserIsolation(this, userAccessToken);
    
    console.log(`[LarkMcpTool] Created user-specific client with token: ${userAccessToken.substring(0, 20)}...`);
    return userClient;
  }

  /**
   * Update User Access Token
   * @param userAccessToken User Access Token
   */
  updateUserAccessToken(userAccessToken: string) {
    this.userAccessToken = userAccessToken;
    console.log(`[LarkMcpTool] Updated user access token: ${userAccessToken.substring(0, 20)}...`);
  }

  /**
   * Get current Client instance
   * @returns Current Client instance
   */
  getClient(): Client | null {
    return this.client;
  }

  /**
   * Get current User Access Token
   * @returns Current User Access Token
   */
  getUserAccessToken(): string | undefined {
    return this.userAccessToken;
  }

  /**
   * Get Client Options used for creating this instance
   * @returns Client Options
   */
  getClientOptions(): LarkMcpToolOptions {
    return { ...this.clientOptions };
  }

  /**
   * Get MCP Tools
   * @returns MCP Tool Definition Array
   */
  getTools(): McpTool[] {
    return this.allTools;
  }

  /**
   * Register Tools to MCP Server
   * @param server MCP Server Instance
   */
  registerMcpServer(server: McpServer, options?: { toolNameCase?: ToolNameCase }): void {
    for (const tool of this.allTools) {
      server.tool(caseTransf(tool.name, options?.toolNameCase), tool.description, tool.schema, async (params: any) => {
        try {
          if (!this.client) {
            return {
              isError: true,
              content: [{ type: 'text' as const, text: 'Client not initialized' }],
            };
          }
          
          const handler = tool.customHandler || larkOapiHandler;
          
          // 🔄 改进：不在全局实例层面检查 userAccessToken
          // 而是将检查逻辑委托给 handler，让 handler 动态查找用户专属的 LarkMcpTool 实例
          
          // 对于 USER_ACCESS_TOKEN 模式，我们需要动态获取用户token
          // 这个检查现在移到了 handler 层面进行
          
          // 🔄 新增：对于只支持用户访问令牌的工具，强制设置 shouldUseUAT
          let shouldUseUAT = getShouldUseUAT(this.tokenMode, this.userAccessToken, params?.useUAT);
          
          // 如果工具的 accessTokens 只包含 'user'，则强制使用用户访问令牌
          if (tool.accessTokens && tool.accessTokens.length === 1 && tool.accessTokens[0] === 'user') {
            shouldUseUAT = true;
            console.log(`[LarkMcpTool] 🔐 Tool ${tool.name} only supports user access token, forcing shouldUseUAT = true`);
          }
          
          console.log(`[LarkMcpTool] 🎯 Tool execution: ${tool.name}, TokenMode: ${this.tokenMode}, Global UAT: ${this.userAccessToken ? 'available' : 'none'}, shouldUseUAT: ${shouldUseUAT}`);
          
          // 🔄 新增：对于 customHandler，需要提供动态获取用户访问令牌的能力
          let effectiveUserAccessToken = this.userAccessToken;
          
          // 如果是 customHandler，且需要用户访问令牌，尝试动态获取
          if (tool.customHandler && shouldUseUAT && !effectiveUserAccessToken) {
            // 使用 handler 中的逻辑来获取用户访问令牌
            try {
              const { userAccessToken: dynamicToken } = getUserLarkClientAndToken(this.client, {
                userAccessToken: this.userAccessToken,
                tool,
                tokenMode: this.tokenMode,
              });
              if (dynamicToken) {
                effectiveUserAccessToken = dynamicToken;
                console.log(`[LarkMcpTool] 🔑 Found dynamic user access token for customHandler: ${dynamicToken.substring(0, 20)}...`);
              }
            } catch (error) {
              console.warn(`[LarkMcpTool] ⚠️ Failed to get dynamic user access token for customHandler:`, error);
            }
          }
          
          return await handler(
            this.client,
            { ...params, useUAT: shouldUseUAT },
            { userAccessToken: effectiveUserAccessToken, tool, tokenMode: this.tokenMode },
          );
        } catch (error) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `Error: ${JSON.stringify((error as Error)?.message)}` }],
          };
        }
      });
    }
  }

  /**
   * Destroy the client and clean up resources
   * 销毁客户端并清理资源
   */
  async destroy(): Promise<void> {
    console.log(`[LarkMcpTool] Destroying client instance`);
    
    // 清理用户访问令牌
    this.userAccessToken = undefined;
    
    // 如果需要的话，可以在这里添加更多的清理逻辑
    // 例如：关闭连接、清理缓存等
    
    console.log(`[LarkMcpTool] Client instance destroyed`);
  }

  /**
   * 验证用户隔离是否正确工作
   * @param originalClient 原始的LarkMcpTool实例
   * @param userAccessToken 用户访问令牌
   */
  private validateUserIsolation(originalClient: LarkMcpTool, userAccessToken: string): void {
    try {
      console.log(`[LarkMcpTool] 🔍 Validating user isolation...`);
      
      // 检查是否有独立的Client实例
      const originalClientInstance = originalClient.getClient();
      const userClientInstance = this.getClient();
      
      if (originalClientInstance === userClientInstance) {
        console.warn(`[LarkMcpTool] ⚠️ WARNING: User client is sharing the same Client instance as original! This breaks user isolation.`);
      } else {
        console.log(`[LarkMcpTool] ✅ User isolation verified: Client instances are separate`);
      }
      
      // 检查访问令牌是否正确设置
      if (this.userAccessToken === userAccessToken) {
        console.log(`[LarkMcpTool] ✅ User access token correctly set for user instance`);
      } else {
        console.warn(`[LarkMcpTool] ⚠️ WARNING: User access token mismatch! Expected: ${userAccessToken.substring(0, 20)}..., Got: ${this.userAccessToken?.substring(0, 20) || 'undefined'}...`);
      }
      
      // 检查原始客户端的token是否受到影响
      const originalToken = originalClient.getUserAccessToken();
      if (originalToken === userAccessToken) {
        console.warn(`[LarkMcpTool] ⚠️ WARNING: Original client token was modified! This indicates token leakage between users.`);
      } else {
        console.log(`[LarkMcpTool] ✅ Original client token unchanged, no cross-user contamination`);
      }
      
    } catch (error) {
      console.error(`[LarkMcpTool] ❌ Error during user isolation validation:`, error);
    }
  }

  /**
   * Get user isolation information for debugging
   * @returns User isolation status information
   */
  getUserIsolationInfo(): {
    hasClient: boolean;
    hasUserToken: boolean;
    clientInstanceId: string;
    tokenPrefix: string;
    createdAt: number;
  } {
    return {
      hasClient: !!this.client,
      hasUserToken: !!this.userAccessToken,
      clientInstanceId: this.client ? `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}` : 'no_client',
      tokenPrefix: this.userAccessToken ? this.userAccessToken.substring(0, 20) + '...' : 'no_token',
      createdAt: Date.now(),
    };
  }
}
