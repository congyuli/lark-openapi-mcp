// 资源生命周期管理策略
export const LIFECYCLE_CONFIG = {
  // 用户会话超时时间 (30分钟)
  USER_SESSION_TIMEOUT_MS: 30 * 60 * 1000,
  
  // 清理检查间隔 (5分钟)
  CLEANUP_INTERVAL_MS: 5 * 60 * 1000,
  
  // 连接空闲超时 (10分钟)
  CONNECTION_IDLE_TIMEOUT_MS: 10 * 60 * 1000,
  
  // 最大用户数限制
  MAX_CONCURRENT_USERS: 100,
  
  // 每用户最大连接数
  MAX_CONNECTIONS_PER_USER: 5,
} as const;

// 资源清理策略
export interface CleanupStrategy {
  // 清理非活跃用户
  cleanupInactiveUsers: boolean;
  
  // 清理空闲连接
  cleanupIdleConnections: boolean;
  
  // 强制清理阈值（内存压力时）
  forceCleanupThreshold: number;
  
  // 优雅关闭等待时间
  gracefulShutdownTimeoutMs: number;
}

export const DEFAULT_CLEANUP_STRATEGY: CleanupStrategy = {
  cleanupInactiveUsers: true,
  cleanupIdleConnections: true,
  forceCleanupThreshold: 0.8, // 80%内存使用率
  gracefulShutdownTimeoutMs: 5000, // 5秒
};