import * as lark from '@larksuiteoapi/node-sdk';
import { McpHandler, McpHandlerOptions } from '../types';

// 全局用户会话管理器引用，在服务器启动时设置
let globalUserManager: any = null;

/**
 * 设置全局用户管理器引用
 * 这样工具执行时可以获取到当前用户的专属 LarkClient
 */
export function setGlobalUserManager(userManager: any): void {
  globalUserManager = userManager;
  console.log('[LarkHandler] Global UserManager reference set');
}

/**
 * 尝试获取当前执行上下文中的用户专属 LarkClient
 * @param fallbackClient 备用的全局 client
 * @param options 工具选项，可能包含用户信息
 * @returns 用户专属的 LarkClient 或备用 client
 */
function getUserLarkClient(fallbackClient: lark.Client, options: McpHandlerOptions): lark.Client {
  try {
    // 1. 首先尝试从选项中获取用户信息
    if (options?.userAccessToken && globalUserManager) {
      // 通过 token 查找用户会话
      const userInfo = globalUserManager.findUserByTokenPrefix(options.userAccessToken.substring(0, 25));
      if (userInfo && userInfo.userSession && userInfo.userSession.larkClient) {
        const userClient = userInfo.userSession.larkClient.getClient();
        if (userClient) {
          console.log(`[LarkHandler] ✅ Using user-specific LarkClient for token: ${options.userAccessToken.substring(0, 20)}...`);
          return userClient;
        }
      }
    }

    // 2. 备用方案：使用全局 client
    console.log(`[LarkHandler] ⚠️ Using fallback global LarkClient`);
    return fallbackClient;
  } catch (error) {
    console.error(`[LarkHandler] ❌ Error getting user LarkClient:`, error);
    return fallbackClient;
  }
}

const sdkFuncCall = async (client: lark.Client, params: any, options: McpHandlerOptions) => {
  const { tool, userAccessToken } = options || {};
  const { sdkName, path, httpMethod } = tool || {};

  if (!sdkName) {
    throw new Error('Invalid sdkName');
  }

  // 获取用户专属的 LarkClient（如果可能的话）
  const actualClient = getUserLarkClient(client, options);

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

  if (params?.useUAT) {
    if (!userAccessToken) {
      throw new Error('Invalid UserAccessToken');
    }
    return await func(params, lark.withUserAccessToken(userAccessToken));
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
