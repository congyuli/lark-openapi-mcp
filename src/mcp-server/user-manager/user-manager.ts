import {
  UserSession,
  ConnectionInfo,
  IUserManager,
  LIFECYCLE_CONFIG,
  UserNotFoundError,
  MaxUsersExceededError,
  MaxConnectionsExceededError,
  LarkClientCreationError,
  ConnectionNotFoundError,
} from '../types';
import { Logger, UserSessionEvent, PerformanceMonitor, LogContext } from '../shared/logger';

export class UserManager implements IUserManager {
  private users = new Map<string, UserSession>();
  private cleanupInterval?: NodeJS.Timeout;
  private performanceMonitor = PerformanceMonitor.getInstance();

  constructor(
    private createLarkClient: (accessToken: string) => Promise<any>,
    private readonly config = LIFECYCLE_CONFIG
  ) {
    this.startCleanupTimer();
    this.startPerformanceMonitoring();
    
    Logger.info('UserManager initialized', { 
      component: 'UserManager',
      config: {
        maxUsers: this.config.MAX_CONCURRENT_USERS,
        maxConnectionsPerUser: this.config.MAX_CONNECTIONS_PER_USER,
        sessionTimeoutMs: this.config.USER_SESSION_TIMEOUT_MS,
        cleanupIntervalMs: this.config.CLEANUP_INTERVAL_MS
      }
    });
  }

  // 用户操作
  async getOrCreateUserSession(userId: string, accessToken: string, userName?: string): Promise<UserSession> {
    const context: LogContext = { userId, userName, operation: 'getOrCreateUserSession' };
    
    const existing = this.users.get(userId);
    if (existing) {
      // 更新现有会话的token和活跃时间
      await this.updateUserToken(userId, accessToken);
      existing.lastActiveTime = Date.now();
      if (userName) existing.userName = userName;
      
      Logger.userSession(UserSessionEvent.UPDATED, {
        ...context,
        connectionsCount: existing.connections.size,
        lastActiveTime: existing.lastActiveTime
      }, 'Updated existing user session');
      
      return existing;
    }

    // 检查用户数量限制
    if (this.users.size >= this.config.MAX_CONCURRENT_USERS) {
      Logger.error('Maximum concurrent users limit exceeded', new MaxUsersExceededError(`Maximum concurrent users limit (${this.config.MAX_CONCURRENT_USERS}) exceeded`), context);
      throw new MaxUsersExceededError(`Maximum concurrent users limit (${this.config.MAX_CONCURRENT_USERS}) exceeded`);
    }

    // 创建新用户会话
    const larkClient = await this.createUserLarkClient(accessToken);
    const userSession: UserSession = {
      userId,
      userName,
      accessToken,
      larkClient,
      connections: new Map<string, ConnectionInfo>(),
      lastActiveTime: Date.now(),
      createdAt: Date.now(),
    };

    this.users.set(userId, userSession);
    
    Logger.userSession(UserSessionEvent.CREATED, {
      ...context,
      totalUsers: this.users.size,
      createdAt: userSession.createdAt
    }, 'Created new user session');
    
    Logger.larkClient('created', context, 'LarkClient instance created for user');
    Logger.memory(context);
    
    return userSession;
  }

  getUserSession(userId: string): UserSession | null {
    const userSession = this.users.get(userId) || null;
    
    if (userSession) {
      Logger.debug('Retrieved user session', { userId, connectionsCount: userSession.connections.size });
    } else {
      Logger.debug('User session not found', { userId });
    }
    
    return userSession;
  }

  async updateUserToken(userId: string, accessToken: string): Promise<void> {
    const context: LogContext = { userId, operation: 'updateUserToken' };
    
    const userSession = this.users.get(userId);
    if (!userSession) {
      Logger.error('User session not found for token update', new UserNotFoundError(`User session not found: ${userId}`), context);
      throw new UserNotFoundError(`User session not found: ${userId}`);
    }

    userSession.accessToken = accessToken;
    userSession.lastActiveTime = Date.now();

    // 更新LarkClient的token
    if (userSession.larkClient && userSession.larkClient.updateUserAccessToken) {
      userSession.larkClient.updateUserAccessToken(accessToken);
      
      Logger.userSession(UserSessionEvent.TOKEN_UPDATED, {
        ...context,
        lastActiveTime: userSession.lastActiveTime
      }, 'Updated user access token');
    }
  }

  // 连接管理
  addConnection(userId: string, connectionInfo: ConnectionInfo): void {
    const context: LogContext = { 
      userId, 
      sessionId: connectionInfo.sessionId,
      operation: 'addConnection' 
    };
    
    const userSession = this.users.get(userId);
    if (!userSession) {
      Logger.error('User session not found when adding connection', new UserNotFoundError(`User session not found: ${userId}`), context);
      throw new UserNotFoundError(`User session not found: ${userId}`);
    }

    // 检查连接数量限制
    if (userSession.connections.size >= this.config.MAX_CONNECTIONS_PER_USER) {
      const error = new MaxConnectionsExceededError(
        `Maximum connections per user limit (${this.config.MAX_CONNECTIONS_PER_USER}) exceeded for user: ${userId}`
      );
      Logger.error('Maximum connections per user limit exceeded', error, context);
      throw error;
    }

    userSession.connections.set(connectionInfo.sessionId, connectionInfo);
    userSession.lastActiveTime = Date.now();
    
    Logger.userSession(UserSessionEvent.CONNECTION_ADDED, {
      ...context,
      connectionsCount: userSession.connections.size,
      maxConnections: this.config.MAX_CONNECTIONS_PER_USER,
      connectionCreatedAt: connectionInfo.createdAt
    }, 'Added new connection to user session');
    
    Logger.connection('added', context);
  }

  removeConnection(userId: string, sessionId: string): void {
    const context: LogContext = { userId, sessionId, operation: 'removeConnection' };
    
    const userSession = this.users.get(userId);
    if (!userSession) {
      Logger.warn('User session not found when removing connection, ignoring', { 
        ...context,
        reason: 'user_not_found' 
      });
      return; // 优雅处理：用户不存在时直接返回
    }

    const removed = userSession.connections.delete(sessionId);
    if (!removed) {
      Logger.warn('Connection not found when removing, may have been already removed', {
        ...context,
        reason: 'connection_not_found'
      });
      return; // 优雅处理：连接不存在时直接返回
    }

    userSession.lastActiveTime = Date.now();
    
    Logger.userSession(UserSessionEvent.CONNECTION_REMOVED, {
      ...context,
      remainingConnections: userSession.connections.size,
      lastActiveTime: userSession.lastActiveTime
    }, 'Removed connection from user session');
    
    Logger.connection('removed', context);

    // 如果用户没有活跃连接，标记为可清理
    if (userSession.connections.size === 0) {
      Logger.info('User has no active connections, eligible for cleanup', {
        ...context,
        eligibleForCleanup: true
      });
    }
  }

  getActiveConnections(userId: string): ConnectionInfo[] {
    const userSession = this.users.get(userId);
    if (!userSession) {
      Logger.debug('No user session found when getting active connections', { userId });
      return [];
    }
    
    const connections = Array.from(userSession.connections.values());
    Logger.debug('Retrieved active connections', { 
      userId, 
      connectionsCount: connections.length 
    });
    
    return connections;
  }

  // 资源清理
  async cleanupInactiveUsers(inactiveThresholdMs: number = this.config.USER_SESSION_TIMEOUT_MS): Promise<void> {
    const startTime = Date.now();
    const now = Date.now();
    const usersToRemove: string[] = [];

    // 使用兼容的Map迭代语法
    this.users.forEach((userSession, userId) => {
      const isInactive = (now - userSession.lastActiveTime) > inactiveThresholdMs;
      const hasNoConnections = userSession.connections.size === 0;

      if (isInactive || hasNoConnections) {
        usersToRemove.push(userId);
        Logger.debug('User marked for cleanup', {
          userId,
          isInactive,
          hasNoConnections,
          lastActiveTime: userSession.lastActiveTime,
          inactiveFor: now - userSession.lastActiveTime
        });
      }
    });

    for (const userId of usersToRemove) {
      await this.removeUser(userId);
    }

    const duration = Date.now() - startTime;
    
    if (usersToRemove.length > 0) {
      Logger.cleanup('inactive_users', {
        operation: 'cleanupInactiveUsers',
        cleanedUpCount: usersToRemove.length,
        remainingUsers: this.users.size,
        duration,
        inactiveThresholdMs
      }, {
        userIds: usersToRemove
      });
    }
    
    // 记录内存使用情况
    Logger.memory({ 
      operation: 'cleanupInactiveUsers',
      duration,
      activeUsers: this.users.size
    });
  }

  async removeUser(userId: string): Promise<void> {
    const context: LogContext = { userId, operation: 'removeUser' };
    
    const userSession = this.users.get(userId);
    if (!userSession) {
      Logger.debug('User session not found when removing user', context);
      return; // 用户不存在，直接返回
    }

    const connectionsCount = userSession.connections.size;

    // 清理所有连接 - 使用兼容的Map迭代语法
    userSession.connections.forEach((connection, sessionId) => {
      try {
        if (connection.response && !connection.response.destroyed) {
          connection.response.end();
        }
        
        Logger.connection('force_closed', {
          ...context,
          sessionId,
          reason: 'user_removal'
        });
      } catch (error) {
        Logger.error(`Error closing connection ${sessionId}`, error as Error, {
          ...context,
          sessionId
        });
      }
    });
    userSession.connections.clear();

    // 清理LarkClient资源
    if (userSession.larkClient && typeof userSession.larkClient.destroy === 'function') {
      try {
        await userSession.larkClient.destroy();
        Logger.larkClient('destroyed', context, 'LarkClient instance destroyed');
      } catch (error) {
        Logger.error(`Error destroying LarkClient for user ${userId}`, error as Error, context);
      }
    }

    this.users.delete(userId);
    
    Logger.userSession(UserSessionEvent.DESTROYED, {
      ...context,
      connectionsCount,
      remainingUsers: this.users.size,
      sessionDuration: Date.now() - userSession.createdAt
    }, 'Removed user session completely');
  }

  // 统计信息
  getActiveUserCount(): number {
    return this.users.size;
  }

  getTotalConnectionCount(): number {
    let totalConnections = 0;
    for (const session of this.users.values()) {
      totalConnections += session.connections.size;
    }
    return totalConnections;
  }

  // 会话查询方法 - 用于轻量级认证
  findUserBySessionId(sessionId: string): { userId: string; userSession: UserSession } | null {
    // 遍历所有用户，查找包含指定sessionId的用户
    for (const [userId, userSession] of this.users) {
      if (userSession.connections.has(sessionId)) {
        Logger.debug('Found user by session ID', {
          userId,
          sessionId,
          operation: 'findUserBySessionId'
        });
        return { userId, userSession };
      }
    }
    
    Logger.debug('User not found by session ID', {
      sessionId,
      operation: 'findUserBySessionId'
    });
    return null;
  }

  /**
   * 通过完整访问令牌查找用户信息
   * 用于工具执行时根据完整 userAccessToken 查找对应的用户会话
   * @param accessToken 完整的访问令牌
   * @returns 用户信息和会话，如果找到的话
   */
  findUserByToken(accessToken: string): { userId: string; userSession: UserSession } | null {
    try {
      for (const [userId, userSession] of this.users.entries()) {
        if (userSession.accessToken === accessToken) {
          console.log(`[UserManager] 🔍 Found user ${userId} by exact token match`);
          return { userId, userSession };
        }
      }
      
      console.log(`[UserManager] ⚠️ No user found for exact token: ${accessToken.substring(0, 20)}...`);
      return null;
    } catch (error) {
      console.error(`[UserManager] ❌ Error finding user by exact token:`, error);
      return null;
    }
  }

  /**
   * 通过访问令牌前缀查找用户信息
   * 用于工具执行时根据 userAccessToken 查找对应的用户会话
   * @param tokenPrefix Token 前缀（通常取前25个字符用于匹配）
   * @returns 用户信息和会话，如果找到的话
   */
  findUserByTokenPrefix(tokenPrefix: string): { userId: string; userSession: UserSession } | null {
    try {
      for (const [userId, userSession] of this.users.entries()) {
        if (userSession.accessToken && userSession.accessToken.startsWith(tokenPrefix)) {
          console.log(`[UserManager] 🔍 Found user ${userId} by token prefix: ${tokenPrefix.substring(0, 20)}...`);
          return { userId, userSession };
        }
      }
      
      console.log(`[UserManager] ⚠️ No user found for token prefix: ${tokenPrefix.substring(0, 20)}...`);
      return null;
    } catch (error) {
      console.error(`[UserManager] ❌ Error finding user by token prefix:`, error);
      return null;
    }
  }

  /**
   * 获取所有活跃用户的访问令牌列表（用于调试）
   * @returns 所有活跃用户的访问令牌数组
   */
  getAllActiveUserTokens(): string[] {
    try {
      const tokens: string[] = [];
      for (const [userId, userSession] of this.users.entries()) {
        if (userSession.accessToken) {
          tokens.push(userSession.accessToken);
        }
      }
      return tokens;
    } catch (error) {
      console.error(`[UserManager] ❌ Error getting active user tokens:`, error);
      return [];
    }
  }

  // 私有方法
  private async createUserLarkClient(accessToken: string): Promise<any> {
    const context: LogContext = { operation: 'createUserLarkClient' };
    
    try {
      const client = await this.createLarkClient(accessToken);
      Logger.larkClient('created', context, 'Successfully created LarkClient instance');
      return client;
    } catch (error) {
      Logger.error('Failed to create LarkClient', error as Error, context);
      throw new LarkClientCreationError(`Failed to create LarkClient: ${(error as Error).message}`);
    }
  }

  private startCleanupTimer(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveUsers().catch(error => {
        Logger.error('Cleanup timer error', error, { 
          component: 'UserManager',
          operation: 'cleanupTimer' 
        });
      });
    }, this.config.CLEANUP_INTERVAL_MS);
    
    Logger.info('Cleanup timer started', {
      component: 'UserManager',
      cleanupIntervalMs: this.config.CLEANUP_INTERVAL_MS
    });
  }

  private startPerformanceMonitoring(): void {
    // 每分钟记录一次性能指标
    setInterval(() => {
      this.performanceMonitor.logMetrics(this);
    }, 60 * 1000); // 60秒
    
    Logger.info('Performance monitoring started', {
      component: 'UserManager',
      monitoringIntervalMs: 60 * 1000
    });
  }

  // 优雅关闭
  async shutdown(): Promise<void> {
    Logger.info('UserManager shutdown initiated', {
      component: 'UserManager',
      activeUsers: this.users.size,
      totalConnections: this.getTotalConnectionCount()
    });
    
    // 停止清理定时器
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    // 清理所有用户会话
    const userIds = Array.from(this.users.keys());
    for (const userId of userIds) {
      await this.removeUser(userId);
    }
    
    Logger.info('UserManager shutdown completed', {
      component: 'UserManager',
      cleanedUpUsers: userIds.length
    });
  }
} 