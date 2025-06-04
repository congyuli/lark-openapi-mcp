/**
 * 演示专业日志系统和监控功能
 * 
 * 运行方式: node demo-logging.js
 */

const { Logger, UserSessionEvent, PerformanceMonitor } = require('./dist/mcp-server/shared/logger.js');

async function demonstrateLogging() {
  console.log('🚀 演示专业日志系统和监控功能\n');

  // 1. 基础日志记录
  console.log('1. 基础日志记录:');
  Logger.info('应用程序启动', {
    component: 'DemoApp',
    version: '1.0.0',
    environment: 'demo'
  });

  Logger.debug('调试信息', {
    component: 'DemoApp',
    operation: 'initialization',
    config: { timeout: 5000, retries: 3 }
  });

  Logger.warn('警告信息', {
    component: 'DemoApp',
    operation: 'startup',
    message: '配置文件使用默认值'
  });

  // 2. 用户会话日志
  console.log('\n2. 用户会话日志:');
  const userContext = {
    userId: 'demo-user-001',
    sessionId: 'session-abc123',
    userName: 'Demo User'
  };

  Logger.userSession(UserSessionEvent.CREATED, userContext, '创建用户会话');
  Logger.userSession(UserSessionEvent.CONNECTION_ADDED, {
    ...userContext,
    connectionsCount: 1,
    connectionType: 'SSE'
  }, '添加SSE连接');
  
  Logger.userSession(UserSessionEvent.TOKEN_UPDATED, userContext, '更新用户访问令牌');

  // 3. 工具执行日志
  console.log('\n3. 工具执行日志:');
  Logger.toolExecution('docx.builtin.search', {
    userId: 'demo-user-001',
    duration: 245,
    toolName: 'docx.builtin.search'
  }, { 
    isError: false,
    content: [{ type: 'text', text: 'Search completed successfully' }]
  });

  Logger.toolExecution('im.builtin.send_message', {
    userId: 'demo-user-001',
    duration: 89,
    toolName: 'im.builtin.send_message'
  }, undefined, new Error('Message send failed: Invalid recipient'));

  // 4. 连接管理日志
  console.log('\n4. 连接管理日志:');
  Logger.connection('established', {
    userId: 'demo-user-001',
    sessionId: 'session-abc123',
    clientInfo: 'curl/8.0.1'
  }, 'SSE连接建立');

  Logger.connection('heartbeat', {
    userId: 'demo-user-001',
    sessionId: 'session-abc123',
    lastPing: Date.now()
  }, '连接心跳检查');

  // 5. LarkClient生命周期日志
  console.log('\n5. LarkClient生命周期日志:');
  Logger.larkClient('created', {
    userId: 'demo-user-001',
    clientType: 'user-specific',
    capabilities: ['message', 'document', 'calendar']
  }, '为用户创建专属LarkClient');

  Logger.larkClient('token_refresh', {
    userId: 'demo-user-001',
    tokenType: 'user_access_token'
  }, '刷新用户访问令牌');

  // 6. 内存和性能监控
  console.log('\n6. 内存和性能监控:');
  Logger.memory({
    component: 'DemoApp',
    operation: 'monitoring',
    checkPoint: 'mid-execution'
  });

  const performanceMonitor = PerformanceMonitor.getInstance();
  const mockUserManager = {
    getActiveUserCount: () => 15,
    getTotalConnectionCount: () => 42
  };

  performanceMonitor.logMetrics(mockUserManager);

  // 7. 资源清理日志
  console.log('\n7. 资源清理日志:');
  Logger.cleanup('inactive_sessions', {
    operation: 'scheduled_cleanup',
    trigger: 'timer'
  }, {
    cleanedSessions: 3,
    freedMemoryMB: 12.5,
    duration: 150
  });

  // 8. 错误处理日志
  console.log('\n8. 错误处理日志:');
  try {
    throw new Error('模拟的网络连接错误');
  } catch (error) {
    Logger.error('网络请求失败', error, {
      component: 'NetworkClient',
      operation: 'fetchUserInfo',
      url: 'https://api.example.com/users/123',
      retryCount: 2
    });
  }

  // 9. 用户会话结束
  console.log('\n9. 用户会话结束:');
  Logger.userSession(UserSessionEvent.CONNECTION_REMOVED, {
    ...userContext,
    remainingConnections: 0,
    sessionDuration: 1200000 // 20分钟
  }, '移除用户连接');

  Logger.userSession(UserSessionEvent.DESTROYED, {
    ...userContext,
    totalDuration: 1200000,
    resourcesFreed: ['larkClient', 'sessions', 'connections']
  }, '销毁用户会话');

  console.log('\n✅ 日志系统演示完成！');
  console.log('📁 查看生成的日志文件:');
  console.log('  - logs/combined.log (所有日志)');
  console.log('  - logs/error.log (错误日志)');
  console.log('  - logs/user-sessions.log (用户会话日志)');
  console.log('  - logs/exceptions.log (异常日志)');
  console.log('  - logs/rejections.log (Promise拒绝日志)');
}

// 运行演示
demonstrateLogging().catch(console.error); 