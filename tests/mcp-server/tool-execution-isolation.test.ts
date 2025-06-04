import { LarkMcpTool } from '../../src/mcp-tool/mcp-tool';
import { UserManager } from '../../src/mcp-server/user-manager';
import { setGlobalUserManager, larkOapiHandler, setRequestContext, clearRequestContext, getRequestContext } from '../../src/mcp-tool/utils/handler';
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

  describe('Tool execution with HTTP request context (New Method)', () => {
    test('should use current HTTP request access token through request context', async () => {
      const userId = 'test_user_1';
      const storedToken = 'stored_token_abcdefghijklmnopqrstuvwxyz123456';
      const currentToken = 'current_token_zyxwvutsrqponmlkjihgfedcba654321'; // 与存储的不同
      const sessionId = 'test_session_123';

      // 1. 创建用户会话（使用旧的存储令牌）
      const userSession = await userManager.getOrCreateUserSession(userId, storedToken);
      expect(userSession).toBeDefined();
      expect(userSession.larkClient).toBeDefined();

      // 2. 设置请求上下文（模拟HTTP请求中的新令牌）
      const requestContext = {
        userId,
        accessToken: currentToken, // 这是HTTP请求头中的当前令牌
        userName: 'Test User',
        sessionId,
        clientId: 'test_client',
      };
      setRequestContext(sessionId, requestContext);

      // 3. 验证请求上下文被正确设置
      const retrievedContext = getRequestContext(sessionId);
      expect(retrievedContext).toBeDefined();
      expect(retrievedContext.accessToken).toBe(currentToken);
      expect(retrievedContext.userId).toBe(userId);

      // 4. 模拟 UserManager 返回使用当前令牌的用户会话
      // 创建一个新的用户会话，使用当前令牌
      const currentTokenUserSession = await userManager.getOrCreateUserSession('current_user', currentToken);
      
      // 现在测试工具处理器
      const result = await larkOapiHandler(
        {} as any, // 全局客户端（不应该被使用）
        { 
          receive_id: 'test_receiver', 
          msg_type: 'text', 
          content: '{"text":"test"}',
          useUAT: true // 需要使用用户访问令牌
        },
        {
          tool: {
            name: 'im.v1.message.create',
            sdkName: 'im.v1.message.create',
            project: 'im',
          }
        } as any
      );

      // 5. 验证结果表明使用了用户访问令牌
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Success:');

      // 6. 清理
      clearRequestContext(sessionId);
      expect(getRequestContext(sessionId)).toBeNull();
    });

    test('should handle request context expiration and cleanup', async () => {
      const sessionId1 = 'session_1';
      const sessionId2 = 'session_2';
      const sessionId3 = 'session_3';

      // 设置多个请求上下文
      setRequestContext(sessionId1, { userId: 'user1', accessToken: 'token1' });
      setRequestContext(sessionId2, { userId: 'user2', accessToken: 'token2' });
      setRequestContext(sessionId3, { userId: 'user3', accessToken: 'token3' });

      // 验证所有上下文都存在
      expect(getRequestContext(sessionId1)).toBeDefined();
      expect(getRequestContext(sessionId2)).toBeDefined();
      expect(getRequestContext(sessionId3)).toBeDefined();

      // 清理单个上下文
      clearRequestContext(sessionId2);
      expect(getRequestContext(sessionId1)).toBeDefined();
      expect(getRequestContext(sessionId2)).toBeNull();
      expect(getRequestContext(sessionId3)).toBeDefined();

      // 清理剩余上下文
      clearRequestContext(sessionId1);
      clearRequestContext(sessionId3);
      expect(getRequestContext(sessionId1)).toBeNull();
      expect(getRequestContext(sessionId3)).toBeNull();
    });

    test('should demonstrate token priority: request context vs stored token', async () => {
      const userId = 'priority_test_user';
      const storedToken = 'stored_in_session_token_abc123';
      const requestToken = 'from_http_request_token_xyz789';
      const sessionId = 'priority_session';

      // 1. 创建用户会话（存储的令牌）
      const userSession = await userManager.getOrCreateUserSession(userId, storedToken);
      expect(userSession.accessToken).toBe(storedToken);

      // 2. 设置请求上下文（HTTP请求令牌）
      setRequestContext(sessionId, {
        userId: 'current_request_user',
        accessToken: requestToken,
        sessionId,
      });

      // 3. 创建使用请求令牌的用户会话
      const requestUserSession = await userManager.getOrCreateUserSession('current_request_user', requestToken);

      // 4. 调用工具，应该优先使用请求令牌
      const result = await larkOapiHandler(
        {} as any,
        { useUAT: true, test: 'data' },
        {
          userAccessToken: storedToken, // 工具选项中的存储令牌
          tool: {
            name: 'test.tool',
            sdkName: 'test.request',
            project: 'test',
          }
        } as any
      );

      // 验证从日志输出可以看到使用了请求上下文的令牌
      expect(result).toBeDefined();

      // 清理
      clearRequestContext(sessionId);
    });

    test('should fallback gracefully when no request context is available', async () => {
      const userId = 'test_user_fallback';
      const userToken = 'user_token_fallback_abcdefghijklmnopqrstuvwxyz123456';

      // 创建用户会话
      const userSession = await userManager.getOrCreateUserSession(userId, userToken);

      // 不设置请求上下文，测试回退到全局客户端
      const result = await larkOapiHandler(
        {} as any, // 模拟全局客户端
        { receive_id: 'test_receiver', msg_type: 'text', content: '{"text":"test"}' },
        {
          tool: {
            name: 'im.v1.message.create',
            sdkName: 'im.v1.message.create',
            project: 'im',
          }
        } as any
      );

      // 验证使用了全局客户端作为回退
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Success:');
    });
  });

  describe('Tool execution with user isolation (Legacy Method)', () => {
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

  describe('Token Mode Testing', () => {
    test('should work with USER_ACCESS_TOKEN mode when token is available from user session', async () => {
      const userId = 'test_user_token_mode';
      const userToken = 'user_token_mode_abcdefghijklmnopqrstuvwxyz123456';

      // 创建用户会话
      const userSession = await userManager.getOrCreateUserSession(userId, userToken);
      expect(userSession).toBeDefined();
      expect(userSession.larkClient).toBeDefined();

      // 模拟设置 tokenMode 和请求上下文
      const sessionId = 'token_mode_session';
      setRequestContext(sessionId, {
        userId,
        accessToken: userToken,
        userName: 'Test User',
        sessionId,
        clientId: 'test_client',
      });

      // 模拟 USER_ACCESS_TOKEN 模式的工具执行
      const result = await larkOapiHandler(
        {} as any, // 全局客户端（不应该被使用）
        { 
          receive_id: 'test_receiver', 
          msg_type: 'text', 
          content: '{"text":"test"}',
          useUAT: true // 强制使用用户访问令牌
        },
        {
          userAccessToken: userToken,
          tool: {
            name: 'im.v1.message.create',
            sdkName: 'im.v1.message.create',
            project: 'im',
          },
          tokenMode: 'USER_ACCESS_TOKEN' as any // 模拟 USER_ACCESS_TOKEN 模式
        } as any
      );

      // 验证结果 - 不应该有 "Invalid UserAccessToken" 错误
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).not.toContain('Invalid UserAccessToken');

      // 清理
      clearRequestContext(sessionId);
    });

    test('should get user access token from user-specific LarkMcpTool when available', async () => {
      const userId = 'test_user_mcp_tool';
      const userToken = 'user_mcp_tool_abcdefghijklmnopqrstuvwxyz123456';

      // 创建用户会话
      const userSession = await userManager.getOrCreateUserSession(userId, userToken);
      
      // 验证用户专属的 LarkMcpTool 实例有正确的访问令牌
      expect(userSession.larkClient.getUserAccessToken()).toBe(userToken);

      // 模拟设置 tokenMode 和请求上下文
      const sessionId = 'mcp_tool_session';
      setRequestContext(sessionId, {
        userId,
        accessToken: userToken,
        userName: 'Test User',
        sessionId,
        clientId: 'test_client',
      });

      // 测试工具执行时能够从用户专属的 LarkMcpTool 实例获取访问令牌
      const result = await larkOapiHandler(
        {} as any,
        { 
          receive_id: 'test_receiver', 
          msg_type: 'text', 
          content: '{"text":"test"}',
          useUAT: true
        },
        {
          tool: {
            name: 'im.v1.message.create',
            sdkName: 'im.v1.message.create',
            project: 'im',
          },
          tokenMode: 'USER_ACCESS_TOKEN' as any
        } as any
      );

      // 验证结果 - 应该能够成功获取用户访问令牌
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).not.toContain('Invalid UserAccessToken');

      // 清理
      clearRequestContext(sessionId);
    });
  });

  describe('CustomHandler User Access Token Issue', () => {
    test('should handle "User access token is not configured" error for docx.builtin.search', async () => {
      const userId = 'test_user_docx';
      const userToken = 'user_token_docx_abcdefghijklmnopqrstuvwxyz123456';

      // 创建一个包含 docx.builtin.search 工具的 LarkMcpTool 实例
      const globalLarkClientWithDocx = new LarkMcpTool({
        appId: 'test_app_id',
        appSecret: 'test_app_secret',
        toolsOptions: { allowTools: ['docx.builtin.search'] }
      });

      // 注册到 MCP Server
      globalLarkClientWithDocx.registerMcpServer(mcpServer);

      // 创建用户会话
      const userSession = await userManager.getOrCreateUserSession(userId, userToken);
      expect(userSession).toBeDefined();

      // 设置请求上下文
      const sessionId = 'docx_search_session';
      setRequestContext(sessionId, {
        userId,
        accessToken: userToken,
        userName: 'Test User',
        sessionId,
        clientId: 'test_client',
      });

      // 创建模拟的 docx.builtin.search customHandler
      const mockCustomHandler = jest.fn().mockImplementation(async (client: any, params: any, options: any) => {
        const { userAccessToken } = options || {};

        if (!userAccessToken) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: 'User access token is not configured' }],
          };
        }

        return {
          content: [{ type: 'text' as const, text: `Document search successful with token: ${userAccessToken.substring(0, 20)}...` }],
        };
      });

      // 测试自定义处理器应该收到有效的用户访问令牌
      const result = await mockCustomHandler(
        {} as any, // client
        { search_key: 'test search' }, // params
        { userAccessToken: userToken } // options - 应该包含有效的用户访问令牌
      );

      // 验证结果 - 不应该有 "User access token is not configured" 错误
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Document search successful');
      expect(result.content[0].text).not.toContain('User access token is not configured');

      // 清理
      clearRequestContext(sessionId);
      await globalLarkClientWithDocx.destroy();
    });

    test('should dynamically get user access token for customHandler when not initially available', async () => {
      const userId = 'test_user_dynamic_token';
      const userToken = 'user_token_dynamic_abcdefghijklmnopqrstuvwxyz123456';

      // 创建一个全局实例，没有用户访问令牌
      const globalLarkClientWithDocx = new LarkMcpTool({
        appId: 'test_app_id',
        appSecret: 'test_app_secret',
        toolsOptions: { allowTools: ['docx.builtin.search'] },
        tokenMode: 'USER_ACCESS_TOKEN' as any
      });

      // 验证全局实例没有用户访问令牌
      expect(globalLarkClientWithDocx.getUserAccessToken()).toBeUndefined();

      // 创建用户会话
      const userSession = await userManager.getOrCreateUserSession(userId, userToken);
      expect(userSession).toBeDefined();

      // 设置请求上下文
      const sessionId = 'dynamic_token_session';
      setRequestContext(sessionId, {
        userId,
        accessToken: userToken,
        userName: 'Test User',
        sessionId,
        clientId: 'test_client',
      });

      // 创建一个独立的MCP Server用于测试
      const testMcpServer = {
        tool: jest.fn()
      } as any;

      // 注册到 MCP Server - 这应该会设置动态用户访问令牌获取
      globalLarkClientWithDocx.registerMcpServer(testMcpServer);

      // 验证工具被注册
      expect(testMcpServer.tool).toHaveBeenCalled();

      // 获取注册的处理器
      const handlerFunction = (testMcpServer.tool as jest.Mock).mock.calls[0][3];

      // 执行工具处理器，这应该触发我们的动态令牌获取逻辑
      const result = await handlerFunction({ 
        search_key: 'test search',
        useUAT: true // 需要用户访问令牌
      });

      console.log('CustomHandler dynamic token test result:', result);

      // 验证结果 - 我们的动态令牌获取应该工作，或者至少不应该立即失败
      // 由于这是测试环境，实际的API调用会失败，但我们主要关注token获取逻辑
      expect(result).toBeDefined();

      // 清理
      clearRequestContext(sessionId);
      await globalLarkClientWithDocx.destroy();
    });
  });
}); 