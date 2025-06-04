import { UserManager } from '../../src/mcp-server/user-manager';
import { LarkMcpTool } from '../../src/mcp-tool/mcp-tool';

describe('UserManager 弹性和错误处理', () => {
  let userManager: UserManager;
  let mockLarkClient: any;

  beforeEach(() => {
    // 创建模拟的LarkClient
    mockLarkClient = {
      getClient: jest.fn().mockReturnValue({}),
      updateUserAccessToken: jest.fn(),
      destroy: jest.fn().mockResolvedValue(undefined),
    };

    // 创建UserManager
    userManager = new UserManager(async (accessToken: string) => {
      return mockLarkClient;
    });
  });

  afterEach(async () => {
    await userManager.shutdown();
  });

  describe('removeConnection 幂等性测试', () => {
    test('重复移除同一个连接不应该抛出错误', async () => {
      const userId = 'test_user';
      const sessionId = 'test_session';
      const accessToken = 'test_token_123456789';

      // 创建用户会话
      const userSession = await userManager.getOrCreateUserSession(userId, accessToken);
      expect(userSession).toBeDefined();

      // 添加连接
      const connectionInfo = {
        sessionId,
        transport: {} as any,
        response: { 
          end: jest.fn(),
          destroyed: false 
        } as any,
        userId,
        clientId: 'test_client',
        createdAt: Date.now(),
      };
      
      userManager.addConnection(userId, connectionInfo);

      // 第一次移除连接 - 应该成功
      expect(() => {
        userManager.removeConnection(userId, sessionId);
      }).not.toThrow();

      // 第二次移除同一个连接 - 应该不抛出错误
      expect(() => {
        userManager.removeConnection(userId, sessionId);
      }).not.toThrow();

      // 第三次移除同一个连接 - 仍然应该不抛出错误
      expect(() => {
        userManager.removeConnection(userId, sessionId);
      }).not.toThrow();
    });

    test('移除不存在用户的连接不应该抛出错误', () => {
      const nonExistentUserId = 'non_existent_user';
      const sessionId = 'test_session';

      // 尝试移除不存在用户的连接 - 应该不抛出错误
      expect(() => {
        userManager.removeConnection(nonExistentUserId, sessionId);
      }).not.toThrow();
    });

    test('移除用户不存在的连接不应该抛出错误', async () => {
      const userId = 'test_user';
      const nonExistentSessionId = 'non_existent_session';
      const accessToken = 'test_token_123456789';

      // 创建用户会话（但不添加任何连接）
      const userSession = await userManager.getOrCreateUserSession(userId, accessToken);
      expect(userSession).toBeDefined();

      // 尝试移除不存在的连接 - 应该不抛出错误
      expect(() => {
        userManager.removeConnection(userId, nonExistentSessionId);
      }).not.toThrow();
    });
  });

  describe('连接生命周期压力测试', () => {
    test('快速添加和移除多个连接应该是安全的', async () => {
      const userId = 'stress_test_user';
      const accessToken = 'stress_test_token_123456789';

      // 创建用户会话
      const userSession = await userManager.getOrCreateUserSession(userId, accessToken);
      expect(userSession).toBeDefined();

      const sessionIds: string[] = [];

      // 快速添加5个连接（不超过默认限制）
      for (let i = 0; i < 5; i++) {
        const sessionId = `session_${i}`;
        sessionIds.push(sessionId);
        
        const connectionInfo = {
          sessionId,
          transport: {} as any,
          response: { 
            end: jest.fn(),
            destroyed: false 
          } as any,
          userId,
          clientId: `client_${i}`,
          createdAt: Date.now(),
        };
        
        expect(() => {
          userManager.addConnection(userId, connectionInfo);
        }).not.toThrow();
      }

      // 验证所有连接都被添加了
      const connections = userManager.getActiveConnections(userId);
      expect(connections).toHaveLength(5);

      // 快速移除所有连接
      sessionIds.forEach(sessionId => {
        expect(() => {
          userManager.removeConnection(userId, sessionId);
        }).not.toThrow();
      });

      // 验证所有连接都被移除了
      const connectionsAfterRemoval = userManager.getActiveConnections(userId);
      expect(connectionsAfterRemoval).toHaveLength(0);

      // 尝试再次移除已经移除的连接（幂等性测试）
      sessionIds.forEach(sessionId => {
        expect(() => {
          userManager.removeConnection(userId, sessionId);
        }).not.toThrow();
      });
    });
  });

  describe('并发操作安全测试', () => {
    test('并发移除连接应该是安全的', async () => {
      const userId = 'concurrent_test_user';
      const sessionId = 'concurrent_session';
      const accessToken = 'concurrent_test_token_123456789';

      // 创建用户会话
      const userSession = await userManager.getOrCreateUserSession(userId, accessToken);
      expect(userSession).toBeDefined();

      // 添加连接
      const connectionInfo = {
        sessionId,
        transport: {} as any,
        response: { 
          end: jest.fn(),
          destroyed: false 
        } as any,
        userId,
        clientId: 'concurrent_client',
        createdAt: Date.now(),
      };
      
      userManager.addConnection(userId, connectionInfo);

      // 模拟多个并发的removeConnection调用
      const concurrentRemovals = Array.from({ length: 5 }, () => 
        Promise.resolve().then(() => {
          try {
            userManager.removeConnection(userId, sessionId);
            return 'success';
          } catch (error: any) {
            return `error: ${error.message}`;
          }
        })
      );

      const results = await Promise.all(concurrentRemovals);
      
      // 所有操作都应该成功（不抛出异常）
      results.forEach(result => {
        expect(result).toBe('success');
      });

      // 验证连接已被移除
      const connections = userManager.getActiveConnections(userId);
      expect(connections).toHaveLength(0);
    });
  });

  describe('系统状态一致性测试', () => {
    test('在各种错误情况下系统状态应该保持一致', async () => {
      const userId = 'consistency_test_user';
      const accessToken = 'consistency_test_token_123456789';

      // 创建用户会话
      const userSession = await userManager.getOrCreateUserSession(userId, accessToken);
      expect(userSession).toBeDefined();

      // 验证初始状态
      expect(userManager.getActiveUserCount()).toBe(1);
      expect(userManager.getTotalConnectionCount()).toBe(0);

      // 添加一些连接
      const sessionIds = ['session1', 'session2', 'session3'];
      sessionIds.forEach((sessionId, index) => {
        const connectionInfo = {
          sessionId,
          transport: {} as any,
          response: { 
            end: jest.fn(),
            destroyed: false 
          } as any,
          userId,
          clientId: `client_${index}`,
          createdAt: Date.now(),
        };
        userManager.addConnection(userId, connectionInfo);
      });

      // 验证连接被正确添加
      expect(userManager.getTotalConnectionCount()).toBe(3);

      // 执行各种可能出错的操作
      const errorOperations = [
        () => userManager.removeConnection('non_existent_user', 'session1'),
        () => userManager.removeConnection(userId, 'non_existent_session'),
        () => userManager.removeConnection(userId, 'session1'), // 移除存在的连接
        () => userManager.removeConnection(userId, 'session1'), // 重复移除
      ];

      // 所有操作都不应该抛出错误
      errorOperations.forEach((operation, index) => {
        expect(() => {
          operation();
        }).not.toThrow();
      });

      // 验证系统状态仍然一致
      expect(userManager.getActiveUserCount()).toBe(1);
      expect(userManager.getTotalConnectionCount()).toBe(2); // session1被移除，剩下session2和session3

      // 移除剩余连接
      userManager.removeConnection(userId, 'session2');
      userManager.removeConnection(userId, 'session3');

      // 验证最终状态
      expect(userManager.getTotalConnectionCount()).toBe(0);
    });
  });
}); 