import { LarkMcpTool } from '../../src/mcp-tool/mcp-tool';
import { UserManager } from '../../src/mcp-server/user-manager';
import { setGlobalUserManager, larkOapiHandler } from '../../src/mcp-tool/utils/handler';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

describe('Tool Execution User Isolation', () => {
  let globalLarkClient: LarkMcpTool;
  let userManager: UserManager;
  let mcpServer: McpServer;

  beforeEach(() => {
    // 创建全局的LarkClient和MCP Server
    globalLarkClient = new LarkMcpTool({
      appId: 'test_app_id',
      appSecret: 'test_app_secret',
      toolsOptions: { allowTools: ['im.v1.message.create'] }
    });

    mcpServer = new McpServer({
      name: 'test-server',
      version: '1.0.0',
    });

    // 创建UserManager
    userManager = new UserManager(async (accessToken: string) => {
      return await globalLarkClient.createUserClient(accessToken);
    });

    // 设置全局UserManager引用
    setGlobalUserManager(userManager);

    // 注册工具到MCP Server
    globalLarkClient.registerMcpServer(mcpServer);
  });

  afterEach(async () => {
    // 清理资源
    await userManager.shutdown();
    await globalLarkClient.destroy();
    setGlobalUserManager(null);
  });

  describe('Tool execution with user isolation', () => {
    test('should use user-specific LarkClient when user token is available', async () => {
      const userId = 'test_user_1';
      const userToken = 'user_token_abcdefghijklmnopqrstuvwxyz123456';

      // 创建用户会话
      const userSession = await userManager.getOrCreateUserSession(userId, userToken);
      expect(userSession).toBeDefined();
      expect(userSession.larkClient).toBeDefined();

      // 模拟工具执行
      const mockOptions = {
        userAccessToken: userToken,
        tool: {
          name: 'im.v1.message.create',
          sdkName: 'im.v1.message.create',
          project: 'im',
        }
      };

      // 创建一个模拟的Lark Client，用于测试
      const mockGlobalClient = {
        request: jest.fn().mockResolvedValue({ data: { message: 'global client used' } }),
        im: {
          v1: {
            message: {
              create: jest.fn().mockResolvedValue({ data: { message: 'global im.v1.message.create used' } })
            }
          }
        }
      };

      const mockUserClient = {
        request: jest.fn().mockResolvedValue({ data: { message: 'user im.v1.message.create used' } }),
        im: {
          v1: {
            message: {
              create: jest.fn().mockResolvedValue({ data: { message: 'user im.v1.message.create used' } })
            }
          }
        }
      };

      // 模拟用户专属的 LarkClient 的 getClient() 方法
      jest.spyOn(userSession.larkClient, 'getClient').mockReturnValue(mockUserClient as any);

      // 调用 larkOapiHandler
      const result = await larkOapiHandler(
        mockGlobalClient as any,
        { receive_id: 'test_receiver', msg_type: 'text', content: '{"text":"test"}' },
        mockOptions as any
      );

      // 验证结果
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('user im.v1.message.create used');
      
      // 验证用户专属的client被调用，而不是全局client
      expect(mockUserClient.im.v1.message.create).toHaveBeenCalled();
      expect(mockGlobalClient.im.v1.message.create).not.toHaveBeenCalled();
    });

    test('should fallback to global LarkClient when no user context is found', async () => {
      // 模拟工具执行，但没有用户上下文
      const mockOptions = {
        tool: {
          name: 'im.v1.message.create',
          sdkName: 'im.v1.message.create',
          project: 'im',
        }
      };

      const mockGlobalClient = {
        request: jest.fn().mockResolvedValue({ data: { message: 'global im.v1.message.create used' } }),
        im: {
          v1: {
            message: {
              create: jest.fn().mockResolvedValue({ data: { message: 'global im.v1.message.create used' } })
            }
          }
        }
      };

      // 调用 larkOapiHandler
      const result = await larkOapiHandler(
        mockGlobalClient as any,
        { receive_id: 'test_receiver', msg_type: 'text', content: '{"text":"test"}' },
        mockOptions as any
      );

      // 验证结果
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('global im.v1.message.create used');
      
      // 验证全局client被调用
      expect(mockGlobalClient.im.v1.message.create).toHaveBeenCalled();
    });

    test('should handle multiple users with different LarkClients', async () => {
      const user1Id = 'user_1';
      const user1Token = 'user1_token_abcdefghijklmnopqrstuvwxyz123456';
      const user2Id = 'user_2';
      const user2Token = 'user2_token_zyxwvutsrqponmlkjihgfedcba654321';

      // 创建两个用户会话
      const user1Session = await userManager.getOrCreateUserSession(user1Id, user1Token);
      const user2Session = await userManager.getOrCreateUserSession(user2Id, user2Token);

      // 模拟不同的用户专属客户端
      const mockUser1Client = {
        request: jest.fn().mockResolvedValue({ data: { message: 'user1 client' } }),
        im: { v1: { message: { create: jest.fn().mockResolvedValue({ data: { message: 'user1 client' } }) } } }
      };
      const mockUser2Client = {
        request: jest.fn().mockResolvedValue({ data: { message: 'user2 client' } }),
        im: { v1: { message: { create: jest.fn().mockResolvedValue({ data: { message: 'user2 client' } }) } } }
      };

      jest.spyOn(user1Session.larkClient, 'getClient').mockReturnValue(mockUser1Client as any);
      jest.spyOn(user2Session.larkClient, 'getClient').mockReturnValue(mockUser2Client as any);

      // 用户1的工具执行
      const result1 = await larkOapiHandler(
        {} as any,
        { receive_id: 'test_receiver', msg_type: 'text', content: '{"text":"test"}' },
        {
          userAccessToken: user1Token,
          tool: { name: 'im.v1.message.create', sdkName: 'im.v1.message.create', project: 'im' }
        } as any
      );

      // 用户2的工具执行
      const result2 = await larkOapiHandler(
        {} as any,
        { receive_id: 'test_receiver', msg_type: 'text', content: '{"text":"test"}' },
        {
          userAccessToken: user2Token,
          tool: { name: 'im.v1.message.create', sdkName: 'im.v1.message.create', project: 'im' }
        } as any
      );

      // 验证结果
      expect(result1.content[0].text).toContain('user1 client');
      expect(result2.content[0].text).toContain('user2 client');
      
      // 验证各自的客户端被正确调用
      expect(mockUser1Client.im.v1.message.create).toHaveBeenCalled();
      expect(mockUser2Client.im.v1.message.create).toHaveBeenCalled();
    });

    test('should handle error when user LarkClient is not available', async () => {
      const invalidToken = 'invalid_token_123456789';

      const mockOptions = {
        userAccessToken: invalidToken,
        tool: {
          name: 'im.v1.message.create',
          sdkName: 'im.v1.message.create',
          project: 'im',
        }
      };

      const mockGlobalClient = {
        request: jest.fn().mockResolvedValue({ data: { message: 'fallback to global' } }),
        im: {
          v1: {
            message: {
              create: jest.fn().mockResolvedValue({ data: { message: 'fallback to global' } })
            }
          }
        }
      };

      // 调用 larkOapiHandler，应该回退到全局客户端
      const result = await larkOapiHandler(
        mockGlobalClient as any,
        { receive_id: 'test_receiver', msg_type: 'text', content: '{"text":"test"}' },
        mockOptions as any
      );

      // 验证结果 - 应该回退到全局客户端
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('fallback to global');
      expect(mockGlobalClient.im.v1.message.create).toHaveBeenCalled();
    });
  });
}); 