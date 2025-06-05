/**
 * Task 3: Core Functionality Unit Tests (Phase 7.1)
 * 
 * Comprehensive tests for:
 * 1. UserManager core functionality
 * 2. Authentication middleware 
 * 3. Error handling and performance scenarios
 */

import { UserManager } from '../../src/mcp-server/user-manager';
import { AuthMiddleware } from '../../src/mcp-server/middleware/auth-middleware';
import { 
  UserSession, 
  ConnectionInfo, 
  UserNotFoundError, 
  MaxUsersExceededError, 
  MaxConnectionsExceededError 
} from '../../src/mcp-server/types';

// Mock external dependencies
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
  PerformanceMonitor: {
    getInstance: jest.fn(() => ({
      getMetrics: jest.fn(() => ({
        timestamp: Date.now(),
        activeUsers: 1,
        totalConnections: 1,
        memoryUsage: { rss: 1000000 },
        cpuUsage: { user: 100, system: 200 },
        uptime: 1000
      }))
    }))
  }
}));

jest.mock('../../src/mcp-server/config/env', () => ({
  larkConfig: {
    baseUrl: 'https://open.feishu.cn'
  }
}));

jest.mock('../../src/mcp-server/user-manager', () => {
  const originalModule = jest.requireActual('../../src/mcp-server/user-manager');
  return {
    ...originalModule,
    addUserSessionMethods: jest.fn()
  };
});

// Mock fetch globally
global.fetch = jest.fn();

describe('Task 3: Core Functionality Unit Tests', () => {
  
  describe('UserManager Core Functionality', () => {
    let userManager: UserManager;
    let mockCreateLarkClient: jest.Mock;
    let mockLarkClient: any;

    beforeEach(() => {
      jest.clearAllMocks();
      
      mockLarkClient = {
        updateUserAccessToken: jest.fn(),
        destroy: jest.fn().mockResolvedValue(undefined),
        getClient: jest.fn(),
        getUserAccessToken: jest.fn(),
        instanceId: 'mock-client-instance-id'
      };

      mockCreateLarkClient = jest.fn().mockResolvedValue(mockLarkClient);

      userManager = new UserManager(mockCreateLarkClient, {
        MAX_CONCURRENT_USERS: 3 as any,
        MAX_CONNECTIONS_PER_USER: 2 as any,
        USER_SESSION_TIMEOUT_MS: 2000, // 2 seconds for faster tests
        CLEANUP_INTERVAL_MS: 500, // 0.5 second for faster tests
        CONNECTION_IDLE_TIMEOUT_MS: 5000
      });
    });

    afterEach(async () => {
      await userManager.shutdown();
    });

    describe('User Session Lifecycle Management', () => {
      test('should create and manage user sessions correctly', async () => {
        const userId = 'test_user_123';
        const accessToken = 'test_token_abc';
        const userName = 'Test User';

        // Test user session creation
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

        // Verify LarkClient creation
        expect(mockCreateLarkClient).toHaveBeenCalledWith(accessToken);
        expect(mockCreateLarkClient).toHaveBeenCalledTimes(1);

        // Test user session retrieval
        const retrievedSession = userManager.getUserSession(userId);
        expect(retrievedSession).toBe(userSession);

        // Test user session update
        const newToken = 'updated_token_xyz';
        await userManager.updateUserToken(userId, newToken);
        expect(userSession.accessToken).toBe(newToken);
        expect(mockLarkClient.updateUserAccessToken).toHaveBeenCalledWith(newToken);
      });

      test('should handle user session limits and errors', async () => {
        // Test maximum user limit
        await userManager.getOrCreateUserSession('user1', 'token1');
        await userManager.getOrCreateUserSession('user2', 'token2');
        await userManager.getOrCreateUserSession('user3', 'token3');

        await expect(
          userManager.getOrCreateUserSession('user4', 'token4')
        ).rejects.toThrow(MaxUsersExceededError);

        // Test LarkClient creation failure
        mockCreateLarkClient.mockRejectedValueOnce(new Error('LarkClient failed'));
        await expect(
          userManager.getOrCreateUserSession('failing_user', 'failing_token')
        ).rejects.toThrow('LarkClient failed');

        // Test updating non-existent user
        await expect(
          userManager.updateUserToken('non_existent', 'some_token')
        ).rejects.toThrow(UserNotFoundError);
      });
    });

    describe('Connection Management', () => {
      let userId: string;
      let userSession: UserSession;

      beforeEach(async () => {
        userId = 'connection_user';
        userSession = await userManager.getOrCreateUserSession(userId, 'test_token');
      });

      const createMockConnection = (sessionId: string): ConnectionInfo => ({
        sessionId,
        transport: {} as any,
        response: { destroyed: false, end: jest.fn() } as any,
        userId,
        createdAt: Date.now()
      });

      test('should manage connections correctly', () => {
        // Test adding connections
        const connection1 = createMockConnection('session_1');
        const connection2 = createMockConnection('session_2');

        userManager.addConnection(userId, connection1);
        userManager.addConnection(userId, connection2);

        expect(userSession.connections.size).toBe(2);
        expect(userManager.getTotalConnectionCount()).toBe(2);

        // Test getting active connections
        const activeConnections = userManager.getActiveConnections(userId);
        expect(activeConnections).toHaveLength(2);
        expect(activeConnections).toContain(connection1);
        expect(activeConnections).toContain(connection2);

        // Test removing connections
        userManager.removeConnection(userId, 'session_1');
        expect(userSession.connections.size).toBe(1);
        expect(userManager.getTotalConnectionCount()).toBe(1);
      });

      test('should handle connection limits and errors', () => {
        // Test maximum connections per user
        const connection1 = createMockConnection('session_1');
        const connection2 = createMockConnection('session_2');
        const connection3 = createMockConnection('session_3');

        userManager.addConnection(userId, connection1);
        userManager.addConnection(userId, connection2);

        expect(() => {
          userManager.addConnection(userId, connection3);
        }).toThrow(MaxConnectionsExceededError);

        // Test adding connection to non-existent user
        expect(() => {
          userManager.addConnection('non_existent_user', connection1);
        }).toThrow(UserNotFoundError);

        // Test graceful handling of removing non-existent connections
        expect(() => {
          userManager.removeConnection(userId, 'non_existent_session');
        }).not.toThrow();

        expect(() => {
          userManager.removeConnection('non_existent_user', 'session_1');
        }).not.toThrow();
      });
    });

    describe('Resource Cleanup and Management', () => {
      test('should cleanup inactive users', async () => {
        const user1 = 'inactive_user_1';
        const user2 = 'inactive_user_2';

        // Create users
        await userManager.getOrCreateUserSession(user1, 'token1');
        await userManager.getOrCreateUserSession(user2, 'token2');
        expect(userManager.getActiveUserCount()).toBe(2);

        // Wait for timeout
        await new Promise(resolve => setTimeout(resolve, 2500)); // > 2 second timeout

        // Run cleanup
        await userManager.cleanupInactiveUsers();
        expect(userManager.getActiveUserCount()).toBe(0);
        expect(mockLarkClient.destroy).toHaveBeenCalledTimes(2);
      });

      test('should not cleanup users with active connections', async () => {
        const userId = 'active_user';
        await userManager.getOrCreateUserSession(userId, 'token');

        // Add connection
        const connection: ConnectionInfo = {
          sessionId: 'active_session',
          transport: {} as any,
          response: {} as any,
          userId,
          createdAt: Date.now()
        };
        userManager.addConnection(userId, connection);

        // Run cleanup
        await userManager.cleanupInactiveUsers(0);
        expect(userManager.getActiveUserCount()).toBe(1);
        expect(mockLarkClient.destroy).not.toHaveBeenCalled();
      });

      test('should handle complete user removal', async () => {
        const userId = 'user_to_remove';
        await userManager.getOrCreateUserSession(userId, 'token');

        // Add connections
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

        // Remove user
        await userManager.removeUser(userId);

        // Verify complete cleanup
        expect(userManager.getActiveUserCount()).toBe(0);
        expect(userManager.getTotalConnectionCount()).toBe(0);
        expect(userManager.getUserSession(userId)).toBeNull();
        expect(mockResponse1.end).toHaveBeenCalled();
        expect(mockResponse2.end).toHaveBeenCalled();
        expect(mockLarkClient.destroy).toHaveBeenCalledTimes(1);
      });
    });

    describe('Query and Statistics Methods', () => {
      test('should provide accurate statistics', async () => {
        // Test initial state
        expect(userManager.getActiveUserCount()).toBe(0);
        expect(userManager.getTotalConnectionCount()).toBe(0);

        // Create users and connections
        await userManager.getOrCreateUserSession('user1', 'token1');
        await userManager.getOrCreateUserSession('user2', 'token2');

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
          userId: 'user2',
          createdAt: Date.now()
        };

        userManager.addConnection('user1', connection1);
        userManager.addConnection('user2', connection2);

        expect(userManager.getActiveUserCount()).toBe(2);
        expect(userManager.getTotalConnectionCount()).toBe(2);
      });

      test('should find users by various methods', async () => {
        const userId = 'findable_user';
        const accessToken = 'findable_token_xyz123';
        
        await userManager.getOrCreateUserSession(userId, accessToken);

        // Add connection for session-based finding
        const connection: ConnectionInfo = {
          sessionId: 'findable_session',
          transport: {} as any,
          response: {} as any,
          userId,
          createdAt: Date.now()
        };
        userManager.addConnection(userId, connection);

        // Test finding by session ID
        const foundBySession = userManager.findUserBySessionId('findable_session');
        expect(foundBySession).toBeDefined();
        expect(foundBySession?.userId).toBe(userId);

        // Test finding by access token
        const foundByToken = userManager.findUserByToken(accessToken);
        expect(foundByToken).toBeDefined();
        expect(foundByToken?.userId).toBe(userId);

        // Test finding by token prefix
        const foundByPrefix = userManager.findUserByTokenPrefix('findable_token');
        expect(foundByPrefix).toBeDefined();
        expect(foundByPrefix?.userId).toBe(userId);

        // Test not found cases
        expect(userManager.findUserBySessionId('non_existent_session')).toBeNull();
        expect(userManager.findUserByToken('non_existent_token')).toBeNull();
        expect(userManager.findUserByTokenPrefix('non_matching_prefix')).toBeNull();

        // Test getting all active tokens
        const activeTokens = userManager.getAllActiveUserTokens();
        expect(activeTokens).toContain(accessToken);
      });
    });

    describe('Error Handling and Edge Cases', () => {
      test('should handle concurrent operations', async () => {
        const userId = 'concurrent_user';
        const accessToken = 'concurrent_token';

        // Simulate concurrent user creation
        const promises = [
          userManager.getOrCreateUserSession(userId, accessToken),
          userManager.getOrCreateUserSession(userId, accessToken),
          userManager.getOrCreateUserSession(userId, accessToken)
        ];

        const sessions = await Promise.all(promises);

        // All should return the same session
        expect(sessions[0]).toBe(sessions[1]);
        expect(sessions[1]).toBe(sessions[2]);
        expect(userManager.getActiveUserCount()).toBe(1);
        expect(mockCreateLarkClient).toHaveBeenCalledTimes(1);
      });

      test('should handle cleanup errors gracefully', async () => {
        const userId = 'error_user';
        mockLarkClient.destroy.mockRejectedValueOnce(new Error('Cleanup error'));

        await userManager.getOrCreateUserSession(userId, 'token');
        
        // Should not throw even if cleanup fails
        await expect(userManager.removeUser(userId)).resolves.not.toThrow();
        expect(userManager.getUserSession(userId)).toBeNull();
      });

      test('should handle invalid data gracefully', () => {
        // Test with empty or invalid inputs
        expect(() => userManager.getUserSession('')).not.toThrow();
        expect(() => userManager.removeConnection('', 'session')).not.toThrow();
        expect(() => userManager.getActiveConnections('')).not.toThrow();
        
        expect(userManager.getUserSession('')).toBeNull();
        expect(userManager.getActiveConnections('')).toEqual([]);
      });

      test('should shutdown gracefully', async () => {
        // Create users with connections
        await userManager.getOrCreateUserSession('user1', 'token1');
        await userManager.getOrCreateUserSession('user2', 'token2');

        const connection: ConnectionInfo = {
          sessionId: 'session_1',
          transport: {} as any,
          response: { destroyed: false, end: jest.fn() } as any,
          userId: 'user1',
          createdAt: Date.now()
        };
        userManager.addConnection('user1', connection);

        expect(userManager.getActiveUserCount()).toBe(2);
        expect(userManager.getTotalConnectionCount()).toBe(1);

        // Shutdown should clean everything
        await userManager.shutdown();
        expect(userManager.getActiveUserCount()).toBe(0);
        expect(userManager.getTotalConnectionCount()).toBe(0);
        expect(mockLarkClient.destroy).toHaveBeenCalledTimes(2);

        // Multiple shutdowns should not error
        await userManager.shutdown();
        await userManager.shutdown();
      });
    });
  });

  describe('Authentication Middleware Core Functionality', () => {
    let authMiddleware: AuthMiddleware;
    let mockUserManager: any;
    let mockFetch: jest.MockedFunction<typeof fetch>;

    beforeEach(() => {
      jest.clearAllMocks();
      
      mockUserManager = {
        getOrCreateUserSession: jest.fn(),
        findUserBySessionId: jest.fn(),
        findUserByToken: jest.fn(),
        findUserByTokenPrefix: jest.fn(),
        getAllActiveUserTokens: jest.fn(),
        getActiveUserCount: jest.fn().mockReturnValue(1),
        getTotalConnectionCount: jest.fn().mockReturnValue(1)
      };

      authMiddleware = new AuthMiddleware(mockUserManager);
      mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
    });

    describe('Full Authentication (authenticateToken)', () => {
      test('should authenticate valid token successfully', async () => {
        const validToken = 'valid_token_123';
        const mockRequest = {
          headers: { authorization: `Bearer ${validToken}` },
          method: 'GET',
          url: '/test'
        };
        const mockResponse = {
          status: jest.fn().mockReturnThis(),
          json: jest.fn()
        };
        const mockNext = jest.fn();

        // Mock successful Lark API response
        const mockLarkResponse = {
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({
            code: 0,
            data: { sub: 'user123', name: 'Test User' }
          })
        };
        mockFetch.mockResolvedValueOnce(mockLarkResponse as any);

        // Mock UserManager response
        const mockUserSession: UserSession = {
          userId: 'user123',
          userName: 'Test User',
          accessToken: validToken,
          larkClient: {},
          connections: new Map(),
          lastActiveTime: Date.now(),
          createdAt: Date.now()
        };
        mockUserManager.getOrCreateUserSession.mockResolvedValueOnce(mockUserSession);

        await authMiddleware.authenticateToken(
          mockRequest as any,
          mockResponse as any,
          mockNext
        );

        // Verify Lark API was called
        expect(mockFetch).toHaveBeenCalledWith(
          'https://open.feishu.cn/open-apis/authen/v1/user_info',
          expect.objectContaining({
            method: 'GET',
            headers: expect.objectContaining({
              Authorization: `Bearer ${validToken}`
            })
          })
        );

        // Verify UserManager was called
        expect(mockUserManager.getOrCreateUserSession).toHaveBeenCalledWith(
          'user123',
          validToken,
          'Test User'
        );

        // Verify next was called (success)
        expect(mockNext).toHaveBeenCalled();
        expect(mockResponse.status).not.toHaveBeenCalled();
      });

      test('should handle authentication errors', async () => {
        const testCases = [
          {
            name: 'missing authorization header',
            request: { headers: {}, method: 'GET', url: '/test' },
            expectedStatus: 401,
            expectedError: 'unauthorized'
          },
          {
            name: 'invalid authorization format',
            request: { headers: { authorization: 'Basic invalid' }, method: 'GET', url: '/test' },
            expectedStatus: 401,
            expectedError: 'unauthorized'
          }
        ];

        for (const testCase of testCases) {
          jest.clearAllMocks();
          
          const mockResponse = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
          };
          const mockNext = jest.fn();

          await authMiddleware.authenticateToken(
            testCase.request as any,
            mockResponse as any,
            mockNext
          );

          expect(mockResponse.status).toHaveBeenCalledWith(testCase.expectedStatus);
          expect(mockResponse.json).toHaveBeenCalledWith(
            expect.objectContaining({ error: testCase.expectedError })
          );
          expect(mockNext).not.toHaveBeenCalled();
        }
      });

      test('should handle Lark API errors', async () => {
        const mockRequest = {
          headers: { authorization: 'Bearer invalid_token' },
          method: 'GET',
          url: '/test'
        };
        const mockResponse = {
          status: jest.fn().mockReturnThis(),
          json: jest.fn()
        };
        const mockNext = jest.fn();

        // Mock failed Lark API response
        const mockLarkResponse = {
          ok: false,
          status: 401,
          text: jest.fn().mockResolvedValue('{"error": "invalid_token"}')
        };
        mockFetch.mockResolvedValueOnce(mockLarkResponse as any);

        await authMiddleware.authenticateToken(
          mockRequest as any,
          mockResponse as any,
          mockNext
        );

        expect(mockResponse.status).toHaveBeenCalledWith(401);
        expect(mockResponse.json).toHaveBeenCalledWith(
          expect.objectContaining({ error: 'invalid_token' })
        );
        expect(mockNext).not.toHaveBeenCalled();
      });

      test('should handle UserManager errors', async () => {
        const mockRequest = {
          headers: { authorization: 'Bearer valid_token' },
          method: 'GET',
          url: '/test'
        };
        const mockResponse = {
          status: jest.fn().mockReturnThis(),
          json: jest.fn()
        };
        const mockNext = jest.fn();

        // Mock successful Lark response but UserManager failure
        const mockLarkResponse = {
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({
            code: 0,
            data: { sub: 'user123', name: 'Test User' }
          })
        };
        mockFetch.mockResolvedValueOnce(mockLarkResponse as any);
        mockUserManager.getOrCreateUserSession.mockRejectedValueOnce(
          new Error('UserManager error')
        );

        await authMiddleware.authenticateToken(
          mockRequest as any,
          mockResponse as any,
          mockNext
        );

        expect(mockResponse.status).toHaveBeenCalledWith(500);
        expect(mockResponse.json).toHaveBeenCalledWith(
          expect.objectContaining({ error: 'user_session_error' })
        );
        expect(mockNext).not.toHaveBeenCalled();
      });
    });

    describe('Lightweight Authentication (authenticateSession)', () => {
      test('should use cached session when available', async () => {
        const validToken = 'cached_token_123';
        const sessionId = 'session_123';
        const mockRequest = {
          headers: { authorization: `Bearer ${validToken}` },
          query: { sessionId },
          method: 'GET',
          url: '/test'
        };
        const mockResponse = {
          status: jest.fn().mockReturnThis(),
          json: jest.fn()
        };
        const mockNext = jest.fn();

        // Mock cached session found
        const mockUserSession: UserSession = {
          userId: 'cached_user',
          userName: 'Cached User',
          accessToken: validToken,
          larkClient: {},
          connections: new Map(),
          lastActiveTime: Date.now() - 1000,
          createdAt: Date.now() - 5000
        };

        mockUserManager.findUserBySessionId.mockReturnValueOnce({
          userId: 'cached_user',
          userSession: mockUserSession
        });

        await authMiddleware.authenticateSession(
          mockRequest as any,
          mockResponse as any,
          mockNext
        );

        // Should not call Lark API
        expect(mockFetch).not.toHaveBeenCalled();
        
        // Should use cached session
        expect(mockUserManager.findUserBySessionId).toHaveBeenCalledWith(sessionId);
        expect(mockNext).toHaveBeenCalled();
        expect(mockResponse.status).not.toHaveBeenCalled();
      });

      test('should fallback to full auth when no cached session found', async () => {
        const validToken = 'fallback_token_123';
        const mockRequest = {
          headers: { authorization: `Bearer ${validToken}` },
          query: { sessionId: 'unknown_session' },
          method: 'GET',
          url: '/test'
        };
        const mockResponse = {
          status: jest.fn().mockReturnThis(),
          json: jest.fn()
        };
        const mockNext = jest.fn();

        // Mock no cached session found
        mockUserManager.findUserBySessionId.mockReturnValueOnce(null);
        mockUserManager.findUserByToken.mockReturnValueOnce(null);
        mockUserManager.findUserByTokenPrefix.mockReturnValueOnce(null);
        mockUserManager.getAllActiveUserTokens.mockReturnValueOnce([]);

        // Mock successful full auth fallback
        const mockLarkResponse = {
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({
            code: 0,
            data: { sub: 'fallback_user', name: 'Fallback User' }
          })
        };
        mockFetch.mockResolvedValueOnce(mockLarkResponse as any);

        const mockUserSession: UserSession = {
          userId: 'fallback_user',
          userName: 'Fallback User',
          accessToken: validToken,
          larkClient: {},
          connections: new Map(),
          lastActiveTime: Date.now(),
          createdAt: Date.now()
        };
        mockUserManager.getOrCreateUserSession.mockResolvedValueOnce(mockUserSession);

        await authMiddleware.authenticateSession(
          mockRequest as any,
          mockResponse as any,
          mockNext
        );

        // Should fallback to full authentication
        expect(mockUserManager.findUserBySessionId).toHaveBeenCalled();
        expect(mockFetch).toHaveBeenCalled();
        expect(mockUserManager.getOrCreateUserSession).toHaveBeenCalled();
        expect(mockNext).toHaveBeenCalled();
      });

      test('should handle session validation errors', async () => {
        const mockRequest = {
          headers: { authorization: 'Bearer token_with_error' },
          query: { sessionId: 'error_session' },
          method: 'GET',
          url: '/test'
        };
        const mockResponse = {
          status: jest.fn().mockReturnThis(),
          json: jest.fn()
        };
        const mockNext = jest.fn();

        // Mock session lookup error
        mockUserManager.findUserBySessionId.mockImplementationOnce(() => {
          throw new Error('Session lookup error');
        });

        // Mock successful fallback
        const mockLarkResponse = {
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({
            code: 0,
            data: { sub: 'recovery_user', name: 'Recovery User' }
          })
        };
        mockFetch.mockResolvedValueOnce(mockLarkResponse as any);

        const mockUserSession: UserSession = {
          userId: 'recovery_user',
          userName: 'Recovery User',
          accessToken: 'token_with_error',
          larkClient: {},
          connections: new Map(),
          lastActiveTime: Date.now(),
          createdAt: Date.now()
        };
        mockUserManager.getOrCreateUserSession.mockResolvedValueOnce(mockUserSession);

        await authMiddleware.authenticateSession(
          mockRequest as any,
          mockResponse as any,
          mockNext
        );

        // Should fall back to full auth gracefully
        expect(mockFetch).toHaveBeenCalled();
        expect(mockNext).toHaveBeenCalled();
      });
    });

    describe('Performance and Integration', () => {
      test('should handle user context setup correctly', async () => {
        const validToken = 'context_test_token';
        const mockRequest = {
          headers: { authorization: `Bearer ${validToken}` },
          method: 'GET',
          url: '/test',
          user: undefined
        };
        const mockResponse = {
          status: jest.fn().mockReturnThis(),
          json: jest.fn()
        };
        const mockNext = jest.fn();

        // Mock successful authentication
        const mockLarkResponse = {
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({
            code: 0,
            data: { sub: 'context_user', name: 'Context User' }
          })
        };
        mockFetch.mockResolvedValueOnce(mockLarkResponse as any);

        const mockUserSession: UserSession = {
          userId: 'context_user',
          userName: 'Context User',
          accessToken: validToken,
          larkClient: { mockMethod: jest.fn() },
          connections: new Map(),
          lastActiveTime: Date.now(),
          createdAt: Date.now()
        };
        mockUserManager.getOrCreateUserSession.mockResolvedValueOnce(mockUserSession);

        await authMiddleware.authenticateToken(
          mockRequest as any,
          mockResponse as any,
          mockNext
        );

        // Verify user context was properly set
        expect(mockRequest.user).toEqual({
          client_id: 'lark_user',
          scope: 'mcp',
          accessToken: validToken,
          lark_user_id: 'context_user',
          lark_user_name: 'Context User',
          userSession: mockUserSession
        });

        expect(mockNext).toHaveBeenCalled();
      });

      test('should handle multiple user ID field formats', async () => {
        const testFields = [
          { field: 'sub', value: 'sub_user_123' },
          { field: 'user_id', value: 'userid_456' },
          { field: 'open_id', value: 'openid_789' },
          { field: 'union_id', value: 'unionid_abc' }
        ];

        for (const testField of testFields) {
          jest.clearAllMocks();
          
          const mockRequest = {
            headers: { authorization: 'Bearer test_token' },
            method: 'GET',
            url: '/test'
          };
          const mockResponse = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
          };
          const mockNext = jest.fn();

          const mockUserData = {
            [testField.field]: testField.value,
            name: 'Test User'
          };

          const mockLarkResponse = {
            ok: true,
            status: 200,
            json: jest.fn().mockResolvedValue({
              code: 0,
              data: mockUserData
            })
          };
          mockFetch.mockResolvedValueOnce(mockLarkResponse as any);

          const mockUserSession: UserSession = {
            userId: testField.value,
            userName: 'Test User',
            accessToken: 'test_token',
            larkClient: {},
            connections: new Map(),
            lastActiveTime: Date.now(),
            createdAt: Date.now()
          };
          mockUserManager.getOrCreateUserSession.mockResolvedValueOnce(mockUserSession);

          await authMiddleware.authenticateToken(
            mockRequest as any,
            mockResponse as any,
            mockNext
          );

          expect(mockUserManager.getOrCreateUserSession).toHaveBeenCalledWith(
            testField.value,
            'test_token',
            'Test User'
          );
          expect(mockNext).toHaveBeenCalled();
        }
      });
    });
  });

  describe('Integration and Performance Tests', () => {
    test('should handle high concurrent load', async () => {
      // Test concurrent authentication requests
      const authMiddleware = new AuthMiddleware({
        getOrCreateUserSession: jest.fn().mockResolvedValue({
          userId: 'concurrent_user',
          accessToken: 'concurrent_token',
          larkClient: {},
          connections: new Map(),
          lastActiveTime: Date.now(),
          createdAt: Date.now()
        }),
        findUserBySessionId: jest.fn().mockReturnValue(null),
        findUserByToken: jest.fn().mockReturnValue(null),
        findUserByTokenPrefix: jest.fn().mockReturnValue(null)
      } as any);

      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          code: 0,
          data: { sub: 'concurrent_user', name: 'Concurrent User' }
        })
      } as any);

      // Simulate 10 concurrent requests
      const promises = Array.from({ length: 10 }, () => {
        const mockRequest = {
          headers: { authorization: 'Bearer concurrent_token' },
          method: 'GET',
          url: '/test'
        };
        const mockResponse = {
          status: jest.fn().mockReturnThis(),
          json: jest.fn()
        };
        const mockNext = jest.fn();

        return authMiddleware.authenticateToken(
          mockRequest as any,
          mockResponse as any,
          mockNext
        ).then(() => ({ next: mockNext, response: mockResponse }));
      });

      const results = await Promise.all(promises);

      // All requests should succeed
      results.forEach(({ next, response }) => {
        expect(next).toHaveBeenCalled();
        expect(response.status).not.toHaveBeenCalled();
      });
    });

    test('should maintain performance under load', async () => {
      const startTime = Date.now();
      
      // Test UserManager performance with multiple operations
      const userManager = new UserManager(
        jest.fn().mockResolvedValue({ destroy: jest.fn() }),
        {
          MAX_CONCURRENT_USERS: 50 as any,
          MAX_CONNECTIONS_PER_USER: 10 as any,
          USER_SESSION_TIMEOUT_MS: 30000,
          CLEANUP_INTERVAL_MS: 5000,
          CONNECTION_IDLE_TIMEOUT_MS: 15000
        }
      );

      try {
        // Create multiple users rapidly
        const userPromises = Array.from({ length: 20 }, (_, i) =>
          userManager.getOrCreateUserSession(`user_${i}`, `token_${i}`)
        );

        await Promise.all(userPromises);

        const endTime = Date.now();
        const duration = endTime - startTime;

        // Should complete within reasonable time (< 1 second for 20 users)
        expect(duration).toBeLessThan(1000);
        expect(userManager.getActiveUserCount()).toBe(20);
      } finally {
        await userManager.shutdown();
      }
    });
  });
}); 