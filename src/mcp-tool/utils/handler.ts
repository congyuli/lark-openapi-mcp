import * as lark from '@larksuiteoapi/node-sdk';
import { McpHandler, McpHandlerOptions } from '../types';

// 全局用户会话管理器引用，在服务器启动时设置
let globalUserManager: any = null;

// 全局请求上下文存储（线程安全的Map）
const requestContextMap = new Map<string, any>();

/**
 * 设置全局用户管理器引用
 * 这样工具执行时可以获取到当前用户的专属 LarkClient
 */
export function setGlobalUserManager(userManager: any): void {
  globalUserManager = userManager;
  console.log('[LarkHandler] Global UserManager reference set');
}

/**
 * 设置当前请求的上下文信息
 * 在工具执行前调用，将HTTP请求的认证信息存储起来
 * @param sessionId 会话ID
 * @param requestContext 请求上下文，包含用户信息和访问令牌
 */
export function setRequestContext(sessionId: string, requestContext: any): void {
  requestContextMap.set(sessionId, {
    ...requestContext,
    timestamp: Date.now(),
  });
  
  // 清理超过5分钟的旧上下文
  const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
  for (const [id, context] of requestContextMap.entries()) {
    if (context.timestamp < fiveMinutesAgo) {
      requestContextMap.delete(id);
    }
  }
  
  console.log(`[LarkHandler] Set request context for session: ${sessionId}, user: ${requestContext.userId}, token: ${requestContext.accessToken?.substring(0, 20)}...`);
}

/**
 * 获取当前请求的上下文信息
 * @param sessionId 会话ID
 * @returns 请求上下文或null
 */
export function getRequestContext(sessionId: string): any | null {
  return requestContextMap.get(sessionId) || null;
}

/**
 * 清理请求上下文
 * @param sessionId 会话ID
 */
export function clearRequestContext(sessionId: string): void {
  requestContextMap.delete(sessionId);
  console.log(`[LarkHandler] Cleared request context for session: ${sessionId}`);
}

/**
 * 尝试获取当前执行上下文中的用户专属 LarkClient和访问令牌
 * @param fallbackClient 备用的全局 client
 * @param options 工具选项，可能包含用户信息
 * @returns 用户专属的 LarkClient、LarkMcpTool实例 和访问令牌
 */
export function getUserLarkClientAndToken(fallbackClient: lark.Client, options: McpHandlerOptions): {
  client: lark.Client;
  userAccessToken: string | undefined;
  userLarkMcpTool: any | undefined;
  source: string;
} {
  try {
    console.log(`[LarkHandler] 🔍 Starting getUserLarkClientAndToken...`);
    console.log(`[LarkHandler] 📊 Request contexts available: ${requestContextMap.size}`);
    console.log(`[LarkHandler] 📊 Tool options userAccessToken: ${options?.userAccessToken ? 'available' : 'none'}`);
    console.log(`[LarkHandler] 📊 Global UserManager: ${globalUserManager ? 'available' : 'none'}`);
    console.log(`[LarkHandler] 📊 TokenMode: ${options?.tokenMode || 'unknown'}`);

    // 1. 优先从当前请求上下文中获取（最高优先级）
    // 这需要在工具执行前设置请求上下文
    const allContexts = Array.from(requestContextMap.values());
    if (allContexts.length > 0) {
      console.log(`[LarkHandler] 🔍 Checking ${allContexts.length} available request contexts...`);
      
      // 获取最新的请求上下文
      const latestContext = allContexts.reduce((latest, current) => 
        current.timestamp > latest.timestamp ? current : latest
      );
      
      console.log(`[LarkHandler] 📋 Latest context: User=${latestContext.userId}, Token=${latestContext.accessToken?.substring(0, 20)}..., Age=${Date.now() - latestContext.timestamp}ms`);
      
      if (latestContext && latestContext.userId && latestContext.accessToken && globalUserManager) {
        console.log(`[LarkHandler] 🔍 Looking up user by token: ${latestContext.accessToken.substring(0, 20)}...`);
        const userInfo = globalUserManager.findUserByToken(latestContext.accessToken);
        
        if (userInfo && userInfo.userSession && userInfo.userSession.larkClient) {
          const userClient = userInfo.userSession.larkClient.getClient();
          if (userClient) {
            console.log(`[LarkHandler] ✅ Using user-specific LarkClient from request context for user: ${latestContext.userId}, token: ${latestContext.accessToken.substring(0, 20)}...`);
            return {
              client: userClient,
              userAccessToken: latestContext.accessToken,
              userLarkMcpTool: userInfo.userSession.larkClient, // 返回完整的 LarkMcpTool 实例
              source: 'request_context'
            };
          } else {
            console.warn(`[LarkHandler] ⚠️ User LarkClient getClient() returned null for user: ${latestContext.userId}`);
          }
        } else {
          console.warn(`[LarkHandler] ⚠️ No user session found for token: ${latestContext.accessToken.substring(0, 20)}...`);
          if (globalUserManager) {
            // 调试：检查所有活跃用户
            const activeTokens = globalUserManager.getAllActiveUserTokens();
            console.log(`[LarkHandler] 📋 Available user tokens: ${activeTokens.map((t: string) => t.substring(0, 20) + '...').join(', ')}`);
          }
        }
      } else {
        console.warn(`[LarkHandler] ⚠️ Latest context incomplete: userId=${!!latestContext.userId}, token=${!!latestContext.accessToken}, userManager=${!!globalUserManager}`);
      }
    } else {
      console.log(`[LarkHandler] ⚠️ No request contexts available`);
    }

    // 2. 次优选择：从工具选项中获取用户信息（用于向后兼容）
    if (options?.userAccessToken && globalUserManager) {
      console.log(`[LarkHandler] 🔍 Falling back to tool options token: ${options.userAccessToken.substring(0, 20)}...`);
      
      // 首先尝试完整token匹配
      let userInfo = globalUserManager.findUserByToken(options.userAccessToken);
      
      // 如果完整token匹配失败，尝试前缀匹配（向后兼容）
      if (!userInfo) {
        userInfo = globalUserManager.findUserByTokenPrefix(options.userAccessToken.substring(0, 25));
      }
      
      if (userInfo && userInfo.userSession && userInfo.userSession.larkClient) {
        const userClient = userInfo.userSession.larkClient.getClient();
        if (userClient) {
          console.log(`[LarkHandler] ✅ Using user-specific LarkClient from options for token: ${options.userAccessToken.substring(0, 20)}...`);
          return {
            client: userClient,
            userAccessToken: options.userAccessToken,
            userLarkMcpTool: userInfo.userSession.larkClient, // 返回完整的 LarkMcpTool 实例
            source: 'tool_options'
          };
        } else {
          console.warn(`[LarkHandler] ⚠️ Tool options: User LarkClient getClient() returned null`);
        }
      } else {
        console.warn(`[LarkHandler] ⚠️ Tool options: No user session found for token (tried exact and prefix match)`);
      }
    } else {
      console.log(`[LarkHandler] ⚠️ Tool options unavailable: userAccessToken=${!!options?.userAccessToken}, userManager=${!!globalUserManager}`);
    }

    // 3. 备用方案：使用全局 client
    console.log(`[LarkHandler] ⚠️ Using fallback global LarkClient`);
    return {
      client: fallbackClient,
      userAccessToken: undefined,
      userLarkMcpTool: undefined,
      source: 'global_fallback'
    };
  } catch (error) {
    console.error(`[LarkHandler] ❌ Error getting user LarkClient and token:`, error);
    return {
      client: fallbackClient,
      userAccessToken: undefined,
      userLarkMcpTool: undefined,
      source: 'error_fallback'
    };
  }
}

const sdkFuncCall = async (client: lark.Client, params: any, options: McpHandlerOptions) => {
  const { tool } = options || {};
  const { sdkName, path, httpMethod } = tool || {};

  if (!sdkName) {
    throw new Error('Invalid sdkName');
  }

  // 获取用户专属的 LarkClient 和当前访问令牌
  const { client: actualClient, userAccessToken, userLarkMcpTool, source } = getUserLarkClientAndToken(client, options);

  console.log(`[LarkHandler] 🎯 Tool execution: ${sdkName}, Client source: ${source}, Token: ${userAccessToken ? userAccessToken.substring(0, 20) + '...' : 'none'}`);
  console.log(`[LarkHandler] 📋 Tool params useUAT: ${params?.useUAT}`);

  const chain = sdkName.split('.');
  let func: any = actualClient;
  for (const element of chain) {
    func = func[element as keyof typeof func];
    if (!func) {
      func = async (params: any, ...args: any) =>
        await actualClient.request({ method: httpMethod, url: path, ...params }, ...args);
      break;
    }
  }
  if (!(func instanceof Function)) {
    func = async (params: any, ...args: any) =>
      await actualClient.request({ method: httpMethod, url: path, ...params }, ...args);
  }

  // 使用当前请求的访问令牌，而不是工具选项中的令牌
  if (params?.useUAT) {
    // 🔄 改进：优先使用从请求上下文或工具选项中获取的用户访问令牌
    // 如果没有，但有用户专属的 LarkMcpTool 实例，则从该实例获取令牌
    let effectiveUserAccessToken = userAccessToken;
    
    if (!effectiveUserAccessToken && userLarkMcpTool) {
      // 尝试从用户专属的 LarkMcpTool 实例获取访问令牌
      if (typeof userLarkMcpTool.getUserAccessToken === 'function') {
        effectiveUserAccessToken = userLarkMcpTool.getUserAccessToken();
        console.log(`[LarkHandler] 🔑 Using user access token from user-specific LarkMcpTool: ${effectiveUserAccessToken?.substring(0, 20)}...`);
      }
    }
    
    if (!effectiveUserAccessToken) {
      console.error(`[LarkHandler] ❌ User access token required but not available!`);
      console.error(`[LarkHandler] 📊 Debug info:`);
      console.error(`  - Request contexts: ${requestContextMap.size}`);
      console.error(`  - Tool options token: ${options?.userAccessToken ? 'available' : 'none'}`);
      console.error(`  - Global UserManager: ${globalUserManager ? 'available' : 'none'}`);
      console.error(`  - Client source: ${source}`);
      console.error(`  - User LarkMcpTool: ${userLarkMcpTool ? 'available' : 'none'}`);
      console.error(`  - TokenMode: ${options?.tokenMode || 'unknown'}`);
      
      // 列出所有可用的请求上下文
      const allContexts = Array.from(requestContextMap.entries());
      if (allContexts.length > 0) {
        console.error(`  - Available contexts:`);
        allContexts.forEach(([sessionId, context]) => {
          console.error(`    * Session ${sessionId}: User=${context.userId}, Token=${context.accessToken?.substring(0, 20)}..., Age=${Date.now() - context.timestamp}ms`);
        });
      }
      
      throw new Error(`Invalid UserAccessToken - no user access token available. Tool "${sdkName}" requires user authentication but no valid user token was found in request context or tool options.`);
    }
    console.log(`[LarkHandler] 🔑 Using user access token for API call: ${effectiveUserAccessToken.substring(0, 20)}...`);
    return await func(params, lark.withUserAccessToken(effectiveUserAccessToken));
  }
  return await func(params);
};

export const larkOapiHandler: McpHandler = async (client, params, options) => {
  try {
    const response = await sdkFuncCall(client, params, options);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Success: ${JSON.stringify(response?.data ?? response)}`,
        },
      ],
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `Error: ${JSON.stringify((error as any)?.response?.data || (error as any)?.message || error)}`,
        },
      ],
    };
  }
};
