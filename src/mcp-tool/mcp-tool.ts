import { Client } from '@larksuiteoapi/node-sdk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LarkMcpToolOptions, McpTool, ToolNameCase, TokenMode } from './types';
import { AllTools, AllToolsZh } from './tools';
import { filterTools } from './utils/filter-tools';
import { defaultToolNames } from './constants';
import { larkOapiHandler, setGlobalUserManager, getUserLarkClientAndToken } from './utils/handler';
import { caseTransf } from './utils/case-transf';
import { getShouldUseUAT } from './utils/get-should-use-uat';
import { Logger, LogContext } from '../mcp-server/shared/logger';

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

  // Instance tracking
  private readonly instanceId: string = `lark-mcp-${Date.now()}-${Math.random().toString(36).substring(2)}`;
  private readonly createdAt: number = Date.now();

  /**
   * Feishu/Lark MCP
   * @param options Feishu/Lark Client Options
   */
  constructor(options: LarkMcpToolOptions) {
    const context: LogContext = {
      component: 'LarkMcpTool',
      operation: 'constructor',
      instanceId: this.instanceId
    };

    // 保存客户端创建选项
    this.clientOptions = { ...options };

    if (options.client) {
      this.client = options.client;
      Logger.info('Using provided client instance', context);
    } else if (options.appId && options.appSecret) {
      this.client = new Client({
        appId: options.appId,
        appSecret: options.appSecret,
        ...options,
      });
      Logger.info('Created new Lark client instance', {
        ...context,
        appId: options.appId
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
    
    Logger.info('LarkMcpTool instance created', {
      ...context,
      tokenMode: this.tokenMode,
      language: isZH ? 'zh' : 'en',
      toolsCount: this.allTools.length,
      allowedTools: filterOptions.allowTools?.length || 'all'
    });
  }

  /**
   * Create User-specific LarkMcpTool instance
   * 为用户创建专属的LarkMcpTool实例，确保用户隔离
   * @param userAccessToken User Access Token
   * @returns New LarkMcpTool instance for the user
   */
  async createUserClient(userAccessToken: string): Promise<LarkMcpTool> {
    const context: LogContext = {
      component: 'LarkMcpTool',
      operation: 'createUserClient',
      instanceId: this.instanceId,
      userAccessTokenPrefix: userAccessToken.substring(0, 20)
    };

    Logger.info('Creating user-specific client instance', context);
    
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
    
    Logger.info('Successfully created user-specific client instance', {
      ...context,
      userClientInstanceId: userClient.instanceId,
      toolsCount: userClient.allTools.length
    });
    
    return userClient;
  }

  /**
   * Update User Access Token
   * @param userAccessToken User Access Token
   */
  updateUserAccessToken(userAccessToken: string) {
    const context: LogContext = {
      component: 'LarkMcpTool',
      operation: 'updateUserAccessToken',
      instanceId: this.instanceId,
      userAccessTokenPrefix: userAccessToken.substring(0, 20)
    };

    this.userAccessToken = userAccessToken;
    Logger.info('Updated user access token', context);
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
    const context: LogContext = {
      component: 'LarkMcpTool',
      operation: 'registerMcpServer',
      instanceId: this.instanceId,
      toolsCount: this.allTools.length
    };

    Logger.info('Registering tools to MCP server', context);

    for (const tool of this.allTools) {
      server.tool(caseTransf(tool.name, options?.toolNameCase), tool.description, tool.schema, async (params: any) => {
        const executionContext: LogContext = {
          component: 'LarkMcpTool',
          operation: 'toolExecution',
          instanceId: this.instanceId,
          toolName: tool.name,
          customHandler: !!tool.customHandler
        };

        const startTime = Date.now();

        try {
          if (!this.client) {
            Logger.error('Tool execution failed: Client not initialized', new Error('Client not initialized'), executionContext);
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
            Logger.debug('Tool only supports user access token, forcing shouldUseUAT = true', {
              ...executionContext,
              accessTokens: tool.accessTokens
            });
          }
          
          Logger.debug('Tool execution started', {
            ...executionContext,
            tokenMode: this.tokenMode,
            hasGlobalUAT: !!this.userAccessToken,
            shouldUseUAT
          });
          
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
                Logger.debug('Found dynamic user access token for customHandler', {
                  ...executionContext,
                  dynamicTokenPrefix: dynamicToken.substring(0, 20)
                });
              }
            } catch (error) {
              Logger.warn('Failed to get dynamic user access token for customHandler', {
                ...executionContext,
                error: (error as Error).message
              });
            }
          }
          
          const result = await handler(
            this.client,
            { ...params, useUAT: shouldUseUAT },
            { userAccessToken: effectiveUserAccessToken, tool, tokenMode: this.tokenMode },
          );

          const duration = Date.now() - startTime;
          
          Logger.toolExecution(tool.name, {
            ...executionContext,
            duration,
            hasEffectiveToken: !!effectiveUserAccessToken,
            resultType: result.isError ? 'error' : 'success'
          }, result);

          return result;
        } catch (error) {
          const duration = Date.now() - startTime;
          
          Logger.toolExecution(tool.name, {
            ...executionContext,
            duration
          }, undefined, error as Error);
          
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `Error: ${JSON.stringify((error as Error)?.message)}` }],
          };
        }
      });
    }

    Logger.info('Successfully registered all tools to MCP server', {
      ...context,
      registeredTools: this.allTools.map(t => t.name)
    });
  }

  /**
   * Destroy the client and clean up resources
   * 销毁客户端并清理资源
   */
  async destroy(): Promise<void> {
    const context: LogContext = {
      component: 'LarkMcpTool',
      operation: 'destroy',
      instanceId: this.instanceId,
      lifetime: Date.now() - this.createdAt
    };

    Logger.info('Destroying LarkMcpTool instance', context);
    
    // 清理客户端资源
    if (this.client) {
      // 如果客户端有清理方法，调用它
      if (typeof (this.client as any).destroy === 'function') {
        try {
          await (this.client as any).destroy();
          Logger.debug('Client instance destroyed', context);
        } catch (error) {
          Logger.error('Error destroying client instance', error as Error, context);
        }
      }
      this.client = null;
    }
    
    // 清理访问令牌
    this.userAccessToken = undefined;
    
    // 清理工具列表
    this.allTools = [];
    
    Logger.info('LarkMcpTool instance destroyed successfully', context);
  }

  /**
   * 验证用户隔离 - 确保用户专属实例不会共享数据
   * @param originalClient 原始客户端实例
   * @param userAccessToken 用户访问令牌
   */
  private validateUserIsolation(originalClient: LarkMcpTool, userAccessToken: string): void {
    const context: LogContext = {
      component: 'LarkMcpTool',
      operation: 'validateUserIsolation',
      instanceId: this.instanceId,
      originalInstanceId: originalClient.instanceId
    };

    Logger.debug('Validating user isolation', context);

    // 验证1: 实例隔离 - 应该是不同的对象实例
    if (this === originalClient) {
      Logger.error('User isolation validation failed: Same instance', new Error('Same instance detected'), context);
      throw new Error('User isolation validation failed: Same instance');
    }

    // 验证2: Client隔离 - 应该有不同的Client实例
    if (this.client === originalClient.client) {
      Logger.error('User isolation validation failed: Same client', new Error('Same client instance detected'), context);
      throw new Error('User isolation validation failed: Same client instance');
    }

    // 验证3: Token隔离 - 确保token设置正确
    if (this.userAccessToken !== userAccessToken) {
      Logger.error('User isolation validation failed: Token mismatch', new Error('Token mismatch'), {
        ...context,
        expectedTokenPrefix: userAccessToken.substring(0, 20),
        actualTokenPrefix: this.userAccessToken?.substring(0, 20) || 'none'
      });
      throw new Error('User isolation validation failed: Token mismatch');
    }

    // 验证4: 配置隔离 - 工具配置应该相同但实例不同
    if (this.allTools.length !== originalClient.allTools.length) {
      Logger.warn('Tool count differs between instances', {
        ...context,
        userInstanceToolCount: this.allTools.length,
        originalInstanceToolCount: originalClient.allTools.length
      });
    }

    Logger.info('User isolation validation passed', {
      ...context,
      validations: {
        instanceIsolation: true,
        clientIsolation: true,
        tokenIsolation: true,
        configurationConsistency: true
      }
    });
  }

  /**
   * 获取用户隔离信息 - 用于调试和监控
   * @returns 用户隔离相关信息
   */
  getUserIsolationInfo(): {
    hasClient: boolean;
    hasUserToken: boolean;
    clientInstanceId: string;
    tokenPrefix: string;
    createdAt: number;
  } {
    const info = {
      hasClient: !!this.client,
      hasUserToken: !!this.userAccessToken,
      clientInstanceId: this.instanceId,
      tokenPrefix: this.userAccessToken?.substring(0, 20) || 'none',
      createdAt: this.createdAt,
    };

    Logger.debug('Retrieved user isolation info', {
      component: 'LarkMcpTool',
      operation: 'getUserIsolationInfo',
      instanceId: this.instanceId,
      info
    });

    return info;
  }
}
