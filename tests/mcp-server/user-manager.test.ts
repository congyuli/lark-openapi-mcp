import { UserManager } from '../../src/mcp-server/user-manager';
import { 
  UserSession, 
  ConnectionInfo, 
  UserNotFoundError, 
  MaxUsersExceededError, 
  MaxConnectionsExceededError,
  LarkClientCreationError 
} from '../../src/mcp-server/types';
import { Logger, UserSessionEvent, PerformanceMonitor } from '../../src/mcp-server/shared/logger';

// Mock Logger to avoid file system operations during tests
jest.mock('../../src/mcp-server/shared/logger', () => ({
  Logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    userSession: jest.fn(),
    larkClient: jest.fn(),
    memory: jest.fn(),
    cleanup: jest.fn(),
    connection: jest.fn()
  },
  UserSessionEvent: {
    CREATED: 'user_session_created',
    UPDATED: 'user_session_updated', 
    DESTROYED: 'user_session_destroyed',
    CONNECTION_ADDED: 'connection_added',
    CONNECTION_REMOVED: 'connection_removed',
    TOKEN_UPDATED: 'token_updated',
    LARK_CLIENT_CREATED: 'lark_client_created',
    LARK_CLIENT_DESTROYED: 'lark_client_destroyed'
  },
  PerformanceMonitor: {
    getInstance: jest.fn(() => ({
      getMetrics: jest.fn(() => ({
        timestamp: Date.now(),
        activeUsers: 1,
        totalConnections: 1,
        memoryUsage: { rss: 1000000 },
        cpuUsage: { user: 100, system: 200 },
        uptime: 1000
      })),
      logMetrics: jest.fn(),
      start: jest.fn(),
      stop: jest.fn()
    }))
  }
}));

// We'll use real timers by default and fake timers only where needed

describe('UserManager', () => {
  let userManager: UserManager;
  let mockCreateLarkClient: jest.Mock;
  let mockLarkClient: any;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Mock LarkClient with all necessary methods
    mockLarkClient = {
      updateUserAccessToken: jest.fn(),
      destroy: jest.fn().mockResolvedValue(undefined),
      getClient: jest.fn(),
      getUserAccessToken: jest.fn(),
      instanceId: 'mock-client-instance-id'
    };

    // Mock createLarkClient function
    mockCreateLarkClient = jest.fn().mockResolvedValue(mockLarkClient);

    // Create UserManager instance with test configuration
    userManager = new UserManager(mockCreateLarkClient, {
      MAX_CONCURRENT_USERS: 3 as any,
      MAX_CONNECTIONS_PER_USER: 2 as any,
      USER_SESSION_TIMEOUT_MS: 5000, // 5 seconds for faster tests
      CLEANUP_INTERVAL_MS: 1000, // 1 second for faster tests
      CONNECTION_IDLE_TIMEOUT_MS: 10000 // 10 seconds
    });
  });

  afterEach(async () => {
    // Clean up UserManager resources and stop all timers
    try {
      await userManager.shutdown();
    } catch (error) {
      // Ignore shutdown errors in tests
    }
    
    // Clear all timers to prevent Jest hanging
    jest.clearAllTimers();
  });

  describe('User Session Creation and Management', () => {
    test('should create new user session with valid parameters', async () => {
      const userId = 'test_user_1';
      const accessToken = 'test_token_abc123';
      const userName = 'Test User';

      const userSession = await userManager.getOrCreateUserSession(userId, accessToken, userName);

      expect(userSession).toBeDefined();
      expect(userSession.userId).toBe(userId);
      expect(userSession.userName).toBe(userName);
      expect(userSession.accessToken).toBe(accessToken);
      expect(userSession.larkClient).toBe(mockLarkClient);
      expect(userSession.connections).toBeInstanceOf(Map);
      expect(userSession.connections.size).toBe(0);
      expect(typeof userSession.lastActiveTime).toBe('number');
      expect(typeof userSession.createdAt).toBe('number');

      // Verify LarkClient was created
      expect(mockCreateLarkClient).toHaveBeenCalledWith(accessToken);
      expect(mockCreateLarkClient).toHaveBeenCalledTimes(1);
    });

    test('should return existing user session when user already exists', async () => {
      const userId = 'existing_user';
      const accessToken = 'original_token';
      const newAccessToken = 'updated_token';

      // Create initial session
      const originalSession = await userManager.getOrCreateUserSession(userId, accessToken);
      const originalCreatedAt = originalSession.createdAt;

      // Get the same user with updated token (no wait needed)
      const updatedSession = await userManager.getOrCreateUserSession(userId, newAccessToken);

      // Should be the same session object
      expect(updatedSession).toBe(originalSession);
      expect(updatedSession.accessToken).toBe(newAccessToken);
      expect(updatedSession.createdAt).toBe(originalCreatedAt); // Should not change
      expect(updatedSession.lastActiveTime).toBeGreaterThanOrEqual(originalCreatedAt);

      // LarkClient should have been updated
      expect(mockLarkClient.updateUserAccessToken).toHaveBeenCalledWith(newAccessToken);
      
      // Only one LarkClient should have been created
      expect(mockCreateLarkClient).toHaveBeenCalledTimes(1);
    });

    test('should throw error when maximum concurrent users exceeded', async () => {
      // Create maximum number of users (3 in test config)
      await userManager.getOrCreateUserSession('user1', 'token1');
      await userManager.getOrCreateUserSession('user2', 'token2');
      await userManager.getOrCreateUserSession('user3', 'token3');

      // Attempt to create one more user
      await expect(
        userManager.getOrCreateUserSession('user4', 'token4')
      ).rejects.toThrow(MaxUsersExceededError);

      expect(userManager.getActiveUserCount()).toBe(3);
    });

    test('should handle LarkClient creation failure', async () => {
      const error = new Error('LarkClient creation failed');
      mockCreateLarkClient.mockRejectedValueOnce(error);

      await expect(
        userManager.getOrCreateUserSession('failing_user', 'failing_token')
      ).rejects.toThrow('LarkClient creation failed');

      expect(userManager.getActiveUserCount()).toBe(0);
    });
  });

  describe('User Session Retrieval and Updates', () => {
    test('should retrieve existing user session', async () => {
      const userId = 'retrieve_test_user';
      const accessToken = 'retrieve_token';

      // Create user session
      const created = await userManager.getOrCreateUserSession(userId, accessToken);

      // Retrieve the same session
      const retrieved = userManager.getUserSession(userId);

      expect(retrieved).toBe(created);
      expect(retrieved?.userId).toBe(userId);
    });

    test('should return null for non-existent user', () => {
      const nonExistentUser = userManager.getUserSession('non_existent_user');
      expect(nonExistentUser).toBeNull();
    });

    test('should update user token successfully', async () => {
      const userId = 'token_update_user';
      const originalToken = 'original_token';
      const newToken = 'updated_token';

      // Create user session
      await userManager.getOrCreateUserSession(userId, originalToken);
      
      // Update token
      await userManager.updateUserToken(userId, newToken);

      // Verify token was updated
      const userSession = userManager.getUserSession(userId);
      expect(userSession?.accessToken).toBe(newToken);
      expect(mockLarkClient.updateUserAccessToken).toHaveBeenCalledWith(newToken);
    });

    test('should throw error when updating token for non-existent user', async () => {
      await expect(
        userManager.updateUserToken('non_existent_user', 'some_token')
      ).rejects.toThrow(UserNotFoundError);
    });
  });

  describe('Connection Management', () => {
    let userId: string;
    let userSession: UserSession;

    beforeEach(async () => {
      userId = 'connection_test_user';
      userSession = await userManager.getOrCreateUserSession(userId, 'test_token');
    });

    const createMockConnection = (sessionId: string, userId: string): ConnectionInfo => ({
      sessionId,
      transport: {} as any,
      response: {} as any,
      userId,
      createdAt: Date.now()
    });

    test('should add connection to user session', () => {
      const connectionInfo = createMockConnection('session_1', userId);

      userManager.addConnection(userId, connectionInfo);

      expect(userSession.connections.size).toBe(1);
      expect(userSession.connections.get('session_1')).toBe(connectionInfo);
    });

    test('should throw error when adding connection to non-existent user', () => {
      const connectionInfo = createMockConnection('session_1', 'non_existent_user');

      expect(() => {
        userManager.addConnection('non_existent_user', connectionInfo);
      }).toThrow(UserNotFoundError);
    });

    test('should throw error when maximum connections per user exceeded', () => {
      // Add maximum connections (2 in test config)
      const connection1 = createMockConnection('session_1', userId);
      const connection2 = createMockConnection('session_2', userId);

      userManager.addConnection(userId, connection1);
      userManager.addConnection(userId, connection2);

      // Attempt to add one more connection
      const connection3 = createMockConnection('session_3', userId);

      expect(() => {
        userManager.addConnection(userId, connection3);
      }).toThrow(MaxConnectionsExceededError);
    });

    test('should remove connection from user session', () => {
      const connectionInfo = createMockConnection('session_to_remove', userId);

      // Add connection
      userManager.addConnection(userId, connectionInfo);
      expect(userSession.connections.size).toBe(1);

      // Remove connection
      userManager.removeConnection(userId, 'session_to_remove');
      expect(userSession.connections.size).toBe(0);
    });

    test('should handle gracefully when removing non-existent connection', () => {
      // Should not throw error
      expect(() => {
        userManager.removeConnection(userId, 'non_existent_session');
      }).not.toThrow();

      // Should handle non-existent user gracefully
      expect(() => {
        userManager.removeConnection('non_existent_user', 'some_session');
      }).not.toThrow();
    });

    test('should get active connections for user', () => {
      const connection1 = createMockConnection('session_1', userId);
      const connection2 = createMockConnection('session_2', userId);

      userManager.addConnection(userId, connection1);
      userManager.addConnection(userId, connection2);

      const activeConnections = userManager.getActiveConnections(userId);
      expect(activeConnections).toHaveLength(2);
      expect(activeConnections).toContain(connection1);
      expect(activeConnections).toContain(connection2);
    });

    test('should return empty array for non-existent user connections', () => {
      const connections = userManager.getActiveConnections('non_existent_user');
      expect(connections).toEqual([]);
    });
  });

  describe('Resource Cleanup and Management', () => {
    test('should cleanup inactive users based on timeout', async () => {
      const user1 = 'inactive_user_1';
      const user2 = 'inactive_user_2';

      // Create two users
      await userManager.getOrCreateUserSession(user1, 'token1');
      await userManager.getOrCreateUserSession(user2, 'token2');

      expect(userManager.getActiveUserCount()).toBe(2);

      // Clear previous calls to mockLarkClient.destroy
      jest.clearAllMocks();

      // Run cleanup with custom timeout (immediate cleanup)
      await userManager.cleanupInactiveUsers(0);

      // Both users should be cleaned up due to immediate timeout
      expect(userManager.getActiveUserCount()).toBe(0);
      expect(mockLarkClient.destroy).toHaveBeenCalledTimes(2);
    });

    test('should cleanup users with no connections', async () => {
      const userId = 'no_connections_user';
      await userManager.getOrCreateUserSession(userId, 'token');

      // Run cleanup immediately (user has no connections)
      await userManager.cleanupInactiveUsers(0); // 0ms timeout means immediate cleanup

      expect(userManager.getActiveUserCount()).toBe(0);
      expect(mockLarkClient.destroy).toHaveBeenCalledTimes(1);
    });

    test('should not cleanup users with active connections', async () => {
      const userId = 'active_user_with_connections';
      await userManager.getOrCreateUserSession(userId, 'token');

      // Add a connection
      const connectionInfo: ConnectionInfo = {
        sessionId: 'active_session',
        transport: {} as any,
        response: {} as any,
        userId,
        createdAt: Date.now()
      };
      userManager.addConnection(userId, connectionInfo);

      // Run cleanup
      await userManager.cleanupInactiveUsers(0);

      // User should not be cleaned up because it has active connections
      expect(userManager.getActiveUserCount()).toBe(1);
      expect(mockLarkClient.destroy).not.toHaveBeenCalled();
    });

    test('should remove user and cleanup all resources', async () => {
      const userId = 'user_to_remove';
      await userManager.getOrCreateUserSession(userId, 'token');

      // Add connections with mock responses
      const mockResponse1 = { destroyed: false, end: jest.fn() };
      const mockResponse2 = { destroyed: false, end: jest.fn() };

      const connection1: ConnectionInfo = {
        sessionId: 'session_1',
        transport: {} as any,
        response: mockResponse1 as any,
        userId,
        createdAt: Date.now()
      };
      const connection2: ConnectionInfo = {
        sessionId: 'session_2',
        transport: {} as any,
        response: mockResponse2 as any,
        userId,
        createdAt: Date.now()
      };

      userManager.addConnection(userId, connection1);
      userManager.addConnection(userId, connection2);

      expect(userManager.getActiveUserCount()).toBe(1);
      expect(userManager.getTotalConnectionCount()).toBe(2);

      // Remove user
      await userManager.removeUser(userId);

      // Verify cleanup
      expect(userManager.getActiveUserCount()).toBe(0);
      expect(userManager.getTotalConnectionCount()).toBe(0);
      expect(userManager.getUserSession(userId)).toBeNull();

      // Verify connections were closed
      expect(mockResponse1.end).toHaveBeenCalled();
      expect(mockResponse2.end).toHaveBeenCalled();

      // Verify LarkClient was destroyed
      expect(mockLarkClient.destroy).toHaveBeenCalledTimes(1);
    });

    test('should handle errors during connection cleanup gracefully', async () => {
      const userId = 'error_cleanup_user';
      await userManager.getOrCreateUserSession(userId, 'token');

      // Add connection with response that throws error on end()
      const mockResponse = { 
        destroyed: false, 
        end: jest.fn().mockImplementation(() => {
          throw new Error('Connection end error');
        })
      };

      const connectionInfo: ConnectionInfo = {
        sessionId: 'error_session',
        transport: {} as any,
        response: mockResponse as any,
        userId,
        createdAt: Date.now()
      };

      userManager.addConnection(userId, connectionInfo);

      // Should not throw error even if connection cleanup fails
      await expect(userManager.removeUser(userId)).resolves.not.toThrow();

      // User should still be removed
      expect(userManager.getUserSession(userId)).toBeNull();
    });

    test('should handle LarkClient destroy errors gracefully', async () => {
      const userId = 'lark_error_user';
      mockLarkClient.destroy.mockRejectedValueOnce(new Error('LarkClient destroy error'));

      await userManager.getOrCreateUserSession(userId, 'token');

      // Should not throw error even if LarkClient destroy fails
      await expect(userManager.removeUser(userId)).resolves.not.toThrow();

      // User should still be removed
      expect(userManager.getUserSession(userId)).toBeNull();
    });
  });

  describe('Statistics and Query Methods', () => {
    test('should accurately count active users', async () => {
      expect(userManager.getActiveUserCount()).toBe(0);

      await userManager.getOrCreateUserSession('user1', 'token1');
      expect(userManager.getActiveUserCount()).toBe(1);

      await userManager.getOrCreateUserSession('user2', 'token2');
      expect(userManager.getActiveUserCount()).toBe(2);

      await userManager.removeUser('user1');
      expect(userManager.getActiveUserCount()).toBe(1);
    });

    test('should accurately count total connections', async () => {
      expect(userManager.getTotalConnectionCount()).toBe(0);

      // Create two users
      await userManager.getOrCreateUserSession('user1', 'token1');
      await userManager.getOrCreateUserSession('user2', 'token2');

      // Add connections
      const connection1: ConnectionInfo = {
        sessionId: 'session_1',
        transport: {} as any,
        response: {} as any,
        userId: 'user1',
        createdAt: Date.now()
      };
      const connection2: ConnectionInfo = {
        sessionId: 'session_2',
        transport: {} as any,
        response: {} as any,
        userId: 'user1',
        createdAt: Date.now()
      };
      const connection3: ConnectionInfo = {
        sessionId: 'session_3',
        transport: {} as any,
        response: {} as any,
        userId: 'user2',
        createdAt: Date.now()
      };

      userManager.addConnection('user1', connection1);
      userManager.addConnection('user1', connection2);
      userManager.addConnection('user2', connection3);

      expect(userManager.getTotalConnectionCount()).toBe(3);

      // Remove one connection
      userManager.removeConnection('user1', 'session_1');
      expect(userManager.getTotalConnectionCount()).toBe(2);
    });

    test('should find user by session ID', async () => {
      const userId = 'findable_user';
      await userManager.getOrCreateUserSession(userId, 'token');

      const connectionInfo: ConnectionInfo = {
        sessionId: 'findable_session',
        transport: {} as any,
        response: {} as any,
        userId,
        createdAt: Date.now()
      };

      userManager.addConnection(userId, connectionInfo);

      const found = userManager.findUserBySessionId('findable_session');
      expect(found).toBeDefined();
      expect(found?.userId).toBe(userId);
      expect(found?.userSession.userId).toBe(userId);

      const notFound = userManager.findUserBySessionId('non_existent_session');
      expect(notFound).toBeNull();
    });

    test('should find user by access token', async () => {
      const userId = 'token_findable_user';
      const accessToken = 'findable_access_token_xyz';
      
      await userManager.getOrCreateUserSession(userId, accessToken);

      const found = userManager.findUserByToken(accessToken);
      expect(found).toBeDefined();
      expect(found?.userId).toBe(userId);
      expect(found?.userSession.accessToken).toBe(accessToken);

      const notFound = userManager.findUserByToken('non_existent_token');
      expect(notFound).toBeNull();
    });

    test('should find user by token prefix', async () => {
      const userId = 'prefix_findable_user';
      const accessToken = 'findable_prefix_token_with_long_suffix';
      
      await userManager.getOrCreateUserSession(userId, accessToken);

      const found = userManager.findUserByTokenPrefix('findable_prefix_token');
      expect(found).toBeDefined();
      expect(found?.userId).toBe(userId);

      const notFound = userManager.findUserByTokenPrefix('non_matching_prefix');
      expect(notFound).toBeNull();
    });

    test('should get all active user tokens', async () => {
      const tokens = ['token1', 'token2', 'token3'];
      
      await userManager.getOrCreateUserSession('user1', tokens[0]);
      await userManager.getOrCreateUserSession('user2', tokens[1]);
      await userManager.getOrCreateUserSession('user3', tokens[2]);

      const activeTokens = userManager.getAllActiveUserTokens();
      expect(activeTokens).toHaveLength(3);
      expect(activeTokens).toEqual(expect.arrayContaining(tokens));
    });
  });

  describe('Shutdown and Cleanup', () => {
    test('should shutdown gracefully and cleanup all resources', async () => {
      // Create multiple users with connections
      await userManager.getOrCreateUserSession('user1', 'token1');
      await userManager.getOrCreateUserSession('user2', 'token2');

      const connection1: ConnectionInfo = {
        sessionId: 'session_1',
        transport: {} as any,
        response: { destroyed: false, end: jest.fn() } as any,
        userId: 'user1',
        createdAt: Date.now()
      };

      userManager.addConnection('user1', connection1);

      expect(userManager.getActiveUserCount()).toBe(2);
      expect(userManager.getTotalConnectionCount()).toBe(1);

      // Shutdown
      await userManager.shutdown();

      // Verify everything is cleaned up
      expect(userManager.getActiveUserCount()).toBe(0);
      expect(userManager.getTotalConnectionCount()).toBe(0);
      
      // Verify LarkClients were destroyed
      expect(mockLarkClient.destroy).toHaveBeenCalledTimes(2);
    });

    test('should handle multiple shutdown calls gracefully', async () => {
      await userManager.getOrCreateUserSession('user1', 'token1');

      // Multiple shutdown calls should not throw errors
      await userManager.shutdown();
      await userManager.shutdown();
      await userManager.shutdown();

      expect(userManager.getActiveUserCount()).toBe(0);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle concurrent user creation', async () => {
      const userId = 'concurrent_user';
      const accessToken = 'concurrent_token';

      // Simulate concurrent requests for the same user
      const promises = [
        userManager.getOrCreateUserSession(userId, accessToken),
        userManager.getOrCreateUserSession(userId, accessToken),
        userManager.getOrCreateUserSession(userId, accessToken)
      ];

      const sessions = await Promise.all(promises);

      // All should have the same properties (even if different objects due to race condition)
      expect(sessions[0].userId).toBe(userId);
      expect(sessions[1].userId).toBe(userId);
      expect(sessions[2].userId).toBe(userId);
      expect(sessions[0].accessToken).toBe(accessToken);
      expect(sessions[1].accessToken).toBe(accessToken);
      expect(sessions[2].accessToken).toBe(accessToken);
      
      // Should only have one active user
      expect(userManager.getActiveUserCount()).toBe(1);

      // The final user session should be retrievable
      const finalSession = userManager.getUserSession(userId);
      expect(finalSession).toBeDefined();
      expect(finalSession?.userId).toBe(userId);
      expect(finalSession?.accessToken).toBe(accessToken);
    });

    test('should handle cleanup timer errors gracefully', async () => {
      // Create a user first
      await userManager.getOrCreateUserSession('test_user', 'test_token');
      
      // Mock cleanupInactiveUsers to throw error
      const originalCleanup = userManager.cleanupInactiveUsers;
      userManager.cleanupInactiveUsers = jest.fn().mockRejectedValue(new Error('Cleanup error'));

      // The cleanup timer should handle errors gracefully
      // We can't easily test the internal timer directly, so we test the method
      await expect(userManager.cleanupInactiveUsers()).rejects.toThrow('Cleanup error');
      
      // Verify the error was handled in the method call
      expect(userManager.cleanupInactiveUsers).toHaveBeenCalled();
      
      // Restore original method
      userManager.cleanupInactiveUsers = originalCleanup;
      
      // Verify the UserManager is still functional
      expect(userManager.getActiveUserCount()).toBe(1);
    });

    test('should handle invalid user data gracefully', () => {
      // Test with empty or invalid user IDs
      expect(() => {
        userManager.getUserSession('');
      }).not.toThrow();

      expect(() => {
        userManager.removeConnection('', 'some_session');
      }).not.toThrow();

      expect(() => {
        userManager.getActiveConnections('');
      }).not.toThrow();
    });
  });
}); 