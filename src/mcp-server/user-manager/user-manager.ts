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

export class UserManager implements IUserManager {
  private users = new Map<string, UserSession>();
  private cleanupInterval?: NodeJS.Timeout;

  constructor(
    private createLarkClient: (accessToken: string) => Promise<any>,
    private readonly config = LIFECYCLE_CONFIG
  ) {
    this.startCleanupTimer();
  }

  // 用户操作
  async getOrCreateUserSession(userId: string, accessToken: string, userName?: string): Promise<UserSession> {
    const existing = this.users.get(userId);
    if (existing) {
      // 更新现有会话的token和活跃时间
      await this.updateUserToken(userId, accessToken);
      existing.lastActiveTime = Date.now();
      if (userName) existing.userName = userName;
      return existing;
    }

    // 检查用户数量限制
    if (this.users.size >= this.config.MAX_CONCURRENT_USERS) {
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
    console.log(`[UserManager] Created user session: ${userId} (total users: ${this.users.size})`);
    return userSession;
  }

  getUserSession(userId: string): UserSession | null {
    return this.users.get(userId) || null;
  }

  async updateUserToken(userId: string, accessToken: string): Promise<void> {
    const userSession = this.users.get(userId);
    if (!userSession) {
      throw new UserNotFoundError(`User session not found: ${userId}`);
    }

    userSession.accessToken = accessToken;
    userSession.lastActiveTime = Date.now();

    // 更新LarkClient的token
    if (userSession.larkClient && userSession.larkClient.updateUserAccessToken) {
      userSession.larkClient.updateUserAccessToken(accessToken);
      console.log(`[UserManager] Updated token for user: ${userId}`);
    }
  }

  // 连接管理
  addConnection(userId: string, connectionInfo: ConnectionInfo): void {
    const userSession = this.users.get(userId);
    if (!userSession) {
      throw new UserNotFoundError(`User session not found: ${userId}`);
    }

    // 检查连接数量限制
    if (userSession.connections.size >= this.config.MAX_CONNECTIONS_PER_USER) {
      throw new MaxConnectionsExceededError(
        `Maximum connections per user limit (${this.config.MAX_CONNECTIONS_PER_USER}) exceeded for user: ${userId}`
      );
    }

    userSession.connections.set(connectionInfo.sessionId, connectionInfo);
    userSession.lastActiveTime = Date.now();
    
    console.log(`[UserManager] Added connection ${connectionInfo.sessionId} for user ${userId} (connections: ${userSession.connections.size})`);
  }

  removeConnection(userId: string, sessionId: string): void {
    const userSession = this.users.get(userId);
    if (!userSession) {
      throw new UserNotFoundError(`User session not found: ${userId}`);
    }

    const removed = userSession.connections.delete(sessionId);
    if (!removed) {
      throw new ConnectionNotFoundError(`Connection not found: ${sessionId} for user: ${userId}`);
    }

    userSession.lastActiveTime = Date.now();
    console.log(`[UserManager] Removed connection ${sessionId} for user ${userId} (remaining: ${userSession.connections.size})`);

    // 如果用户没有活跃连接，标记为可清理
    if (userSession.connections.size === 0) {
      console.log(`[UserManager] User ${userId} has no active connections, eligible for cleanup`);
    }
  }

  getActiveConnections(userId: string): ConnectionInfo[] {
    const userSession = this.users.get(userId);
    if (!userSession) {
      return [];
    }
    return Array.from(userSession.connections.values());
  }

  // 资源清理
  async cleanupInactiveUsers(inactiveThresholdMs: number = this.config.USER_SESSION_TIMEOUT_MS): Promise<void> {
    const now = Date.now();
    const usersToRemove: string[] = [];

    // 使用兼容的Map迭代语法
    this.users.forEach((userSession, userId) => {
      const isInactive = (now - userSession.lastActiveTime) > inactiveThresholdMs;
      const hasNoConnections = userSession.connections.size === 0;

      if (isInactive || hasNoConnections) {
        usersToRemove.push(userId);
      }
    });

    for (const userId of usersToRemove) {
      await this.removeUser(userId);
    }

    if (usersToRemove.length > 0) {
      console.log(`[UserManager] Cleaned up ${usersToRemove.length} inactive users`);
    }
  }

  async removeUser(userId: string): Promise<void> {
    const userSession = this.users.get(userId);
    if (!userSession) {
      return; // 用户不存在，直接返回
    }

    // 清理所有连接 - 使用兼容的Map迭代语法
    userSession.connections.forEach((connection, sessionId) => {
      try {
        if (connection.response && !connection.response.destroyed) {
          connection.response.end();
        }
      } catch (error) {
        console.error(`[UserManager] Error closing connection ${sessionId}:`, error);
      }
    });
    userSession.connections.clear();

    // 清理LarkClient资源
    if (userSession.larkClient && typeof userSession.larkClient.destroy === 'function') {
      try {
        await userSession.larkClient.destroy();
      } catch (error) {
        console.error(`[UserManager] Error destroying LarkClient for user ${userId}:`, error);
      }
    }

    this.users.delete(userId);
    console.log(`[UserManager] Removed user session: ${userId} (remaining users: ${this.users.size})`);
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
        return { userId, userSession };
      }
    }
    return null;
  }

  findUserByToken(token: string): { userId: string; userSession: UserSession } | null {
    // 通过完整token查找用户
    for (const [userId, userSession] of this.users) {
      if (userSession.accessToken === token) {
        return { userId, userSession };
      }
    }
    return null;
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

  getAllActiveUserTokens(): string[] {
    // 获取所有活跃用户的token列表（用于调试）
    const tokens: string[] = [];
    this.users.forEach((userSession) => {
      tokens.push(userSession.accessToken);
    });
    return tokens;
  }

  // 私有方法
  private async createUserLarkClient(accessToken: string): Promise<any> {
    try {
      const larkClient = await this.createLarkClient(accessToken);
      console.log(`[UserManager] Created LarkClient instance`);
      return larkClient;
    } catch (error) {
      console.error(`[UserManager] Failed to create LarkClient:`, error);
      throw new LarkClientCreationError('Failed to create LarkClient instance', error as Error);
    }
  }

  private startCleanupTimer(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveUsers().catch(error => {
        console.error('[UserManager] Cleanup timer error:', error);
      });
    }, this.config.CLEANUP_INTERVAL_MS);
  }

  // 优雅关闭
  async shutdown(): Promise<void> {
    console.log('[UserManager] Starting graceful shutdown...');
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    // 清理所有用户
    const userIds = Array.from(this.users.keys());
    for (const userId of userIds) {
      await this.removeUser(userId);
    }

    console.log('[UserManager] Graceful shutdown completed');
  }
} 