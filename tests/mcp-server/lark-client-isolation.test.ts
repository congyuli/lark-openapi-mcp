import { LarkMcpTool } from '../../src/mcp-tool/mcp-tool';
import { UserManager } from '../../src/mcp-server/user-manager';

describe('LarkClient User Isolation', () => {
  let originalLarkClient: LarkMcpTool;
  let userManager: UserManager;

  beforeEach(() => {
    // 创建原始的LarkClient
    originalLarkClient = new LarkMcpTool({
      appId: 'test_app_id',
      appSecret: 'test_app_secret',
      toolsOptions: { allowTools: ['im.v1.message.create'] }
    });

    // 创建UserManager
    userManager = new UserManager(async (accessToken: string) => {
      return await originalLarkClient.createUserClient(accessToken);
    });
  });

  afterEach(async () => {
    // 清理资源
    await userManager.shutdown();
    await originalLarkClient.destroy();
  });

  describe('createUserClient method', () => {
    test('should create separate client instances for different users', async () => {
      const token1 = 'user1_token_abcdefghijklmnopqrstuvwxyz123456';
      const token2 = 'user2_token_zyxwvutsrqponmlkjihgfedcba654321';

      // 创建两个用户专属的客户端
      const userClient1 = await originalLarkClient.createUserClient(token1);
      const userClient2 = await originalLarkClient.createUserClient(token2);

      // 验证它们是不同的实例
      expect(userClient1).not.toBe(userClient2);
      expect(userClient1).not.toBe(originalLarkClient);
      expect(userClient2).not.toBe(originalLarkClient);

      // 验证它们有不同的Client实例
      const originalClient = originalLarkClient.getClient();
      const client1 = userClient1.getClient();
      const client2 = userClient2.getClient();

      expect(client1).not.toBe(originalClient);
      expect(client2).not.toBe(originalClient);
      expect(client1).not.toBe(client2);

      // 验证访问令牌是正确的
      expect(userClient1.getUserAccessToken()).toBe(token1);
      expect(userClient2.getUserAccessToken()).toBe(token2);
      expect(originalLarkClient.getUserAccessToken()).not.toBe(token1);
      expect(originalLarkClient.getUserAccessToken()).not.toBe(token2);

      // 清理
      await userClient1.destroy();
      await userClient2.destroy();
    });

    test('should preserve original client state when creating user clients', async () => {
      const originalToken = 'original_token_123456789';
      const userToken = 'user_token_987654321';

      // 设置原始客户端的token
      originalLarkClient.updateUserAccessToken(originalToken);
      const originalTokenBefore = originalLarkClient.getUserAccessToken();

      // 创建用户专属客户端
      const userClient = await originalLarkClient.createUserClient(userToken);

      // 验证原始客户端的token没有被修改
      const originalTokenAfter = originalLarkClient.getUserAccessToken();
      expect(originalTokenAfter).toBe(originalTokenBefore);
      expect(originalTokenAfter).toBe(originalToken);
      expect(originalTokenAfter).not.toBe(userToken);

      // 验证用户客户端有正确的token
      expect(userClient.getUserAccessToken()).toBe(userToken);

      // 清理
      await userClient.destroy();
    });

    test('should provide user isolation information', async () => {
      const userToken = 'user_token_for_isolation_info';
      const userClient = await originalLarkClient.createUserClient(userToken);

      const isolationInfo = userClient.getUserIsolationInfo();

      expect(isolationInfo).toBeDefined();
      expect(isolationInfo.hasClient).toBe(true);
      expect(isolationInfo.hasUserToken).toBe(true);
      expect(isolationInfo.tokenPrefix).toContain('user_token_for_isola...');
      expect(isolationInfo.clientInstanceId).toContain('client_');
      expect(typeof isolationInfo.createdAt).toBe('number');

      // 清理
      await userClient.destroy();
    });
  });

  describe('UserManager integration', () => {
    test('should create isolated user sessions', async () => {
      const userId1 = 'user_1';
      const userId2 = 'user_2';
      const token1 = 'token_for_user_1_abcdefghijklmnop';
      const token2 = 'token_for_user_2_zyxwvutsrqponmlk';

      // 创建两个用户会话
      const session1 = await userManager.getOrCreateUserSession(userId1, token1);
      const session2 = await userManager.getOrCreateUserSession(userId2, token2);

      // 验证会话是独立的
      expect(session1).not.toBe(session2);
      expect(session1.userId).toBe(userId1);
      expect(session2.userId).toBe(userId2);

      // 验证LarkClient是独立的
      expect(session1.larkClient).not.toBe(session2.larkClient);
      expect(session1.larkClient).not.toBe(originalLarkClient);

      // 验证访问令牌是正确的
      expect(session1.accessToken).toBe(token1);
      expect(session2.accessToken).toBe(token2);

      // 验证用户可以独立更新token
      const newToken1 = 'new_token_for_user_1_updated';
      await userManager.updateUserToken(userId1, newToken1);

      const updatedSession1 = userManager.getUserSession(userId1);
      const unchangedSession2 = userManager.getUserSession(userId2);

      expect(updatedSession1?.accessToken).toBe(newToken1);
      expect(unchangedSession2?.accessToken).toBe(token2); // 应该保持不变
    });

    test('should handle user session cleanup', async () => {
      const userId = 'cleanup_test_user';
      const token = 'cleanup_test_token_abcdefghijk';

      // 创建用户会话
      const session = await userManager.getOrCreateUserSession(userId, token);
      expect(userManager.getUserSession(userId)).toBe(session);

      // 移除用户
      await userManager.removeUser(userId);
      expect(userManager.getUserSession(userId)).toBeNull();
    });

    test('should provide correct statistics', async () => {
      const initialUserCount = userManager.getActiveUserCount();
      const initialConnectionCount = userManager.getTotalConnectionCount();

      // 添加用户
      await userManager.getOrCreateUserSession('stats_user_1', 'token1');
      await userManager.getOrCreateUserSession('stats_user_2', 'token2');

      expect(userManager.getActiveUserCount()).toBe(initialUserCount + 2);
      expect(userManager.getTotalConnectionCount()).toBe(initialConnectionCount); // 没有连接

      // 清理
      await userManager.removeUser('stats_user_1');
      await userManager.removeUser('stats_user_2');

      expect(userManager.getActiveUserCount()).toBe(initialUserCount);
    });
  });

  describe('Error handling', () => {
    test('should handle createUserClient errors gracefully', async () => {
      // 创建一个会抛出错误的模拟LarkClient
      const brokenLarkClient = new LarkMcpTool({
        appId: 'broken_app_id',
        appSecret: 'broken_app_secret',
      });

      // 模拟一个会失败的场景
      const invalidToken = '';

      await expect(async () => {
        await brokenLarkClient.createUserClient(invalidToken);
      }).not.toThrow(); // 应该不会抛出异常，而是处理错误

      await brokenLarkClient.destroy();
    });

    test('should handle UserManager creation errors', async () => {
      const faultyUserManager = new UserManager(async (accessToken: string) => {
        throw new Error('Simulated LarkClient creation failure');
      });

      await expect(async () => {
        await faultyUserManager.getOrCreateUserSession('error_user', 'error_token');
      }).rejects.toThrow('Failed to create LarkClient instance');

      await faultyUserManager.shutdown();
    });
  });
}); 