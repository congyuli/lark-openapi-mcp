import { Logger, UserSessionEvent, PerformanceMonitor, LogContext } from '../../../src/mcp-server/shared/logger';

describe('Logger System', () => {
  beforeEach(() => {
    // 清理日志级别
    process.env.LOG_LEVEL = 'debug';
  });

  afterEach(() => {
    delete process.env.LOG_LEVEL;
  });

  describe('Basic Logging', () => {
    test('should log info messages', () => {
      const context: LogContext = {
        userId: 'test-user',
        sessionId: 'test-session',
        component: 'Test'
      };

      expect(() => {
        Logger.info('Test info message', context);
      }).not.toThrow();
    });

    test('should log error messages', () => {
      const error = new Error('Test error');
      const context: LogContext = {
        userId: 'test-user',
        component: 'Test'
      };

      expect(() => {
        Logger.error('Test error message', error, context);
      }).not.toThrow();
    });

    test('should log debug messages', () => {
      const context: LogContext = {
        userId: 'test-user',
        component: 'Test'
      };

      expect(() => {
        Logger.debug('Test debug message', context);
      }).not.toThrow();
    });

    test('should log warning messages', () => {
      const context: LogContext = {
        userId: 'test-user',
        component: 'Test'
      };

      expect(() => {
        Logger.warn('Test warning message', context);
      }).not.toThrow();
    });
  });

  describe('User Session Logging', () => {
    test('should log user session events', () => {
      const context: LogContext = {
        userId: 'test-user',
        sessionId: 'test-session',
        connectionsCount: 1
      };

      expect(() => {
        Logger.userSession(UserSessionEvent.CREATED, context, 'User session created');
      }).not.toThrow();

      expect(() => {
        Logger.userSession(UserSessionEvent.CONNECTION_ADDED, context, 'Connection added');
      }).not.toThrow();

      expect(() => {
        Logger.userSession(UserSessionEvent.DESTROYED, context, 'User session destroyed');
      }).not.toThrow();
    });
  });

  describe('Tool Execution Logging', () => {
    test('should log successful tool execution', () => {
      const context: LogContext = {
        userId: 'test-user',
        toolName: 'test-tool',
        duration: 100
      };

      const result = { success: true, data: 'test' };

      expect(() => {
        Logger.toolExecution('test-tool', context, result);
      }).not.toThrow();
    });

    test('should log failed tool execution', () => {
      const context: LogContext = {
        userId: 'test-user',
        toolName: 'test-tool',
        duration: 50
      };

      const error = new Error('Tool execution failed');

      expect(() => {
        Logger.toolExecution('test-tool', context, undefined, error);
      }).not.toThrow();
    });
  });

  describe('Connection Logging', () => {
    test('should log connection events', () => {
      const context: LogContext = {
        userId: 'test-user',
        sessionId: 'test-session'
      };

      expect(() => {
        Logger.connection('added', context, 'Connection added');
      }).not.toThrow();

      expect(() => {
        Logger.connection('removed', context, 'Connection removed');
      }).not.toThrow();
    });
  });

  describe('LarkClient Logging', () => {
    test('should log LarkClient events', () => {
      const context: LogContext = {
        userId: 'test-user'
      };

      expect(() => {
        Logger.larkClient('created', context, 'LarkClient created');
      }).not.toThrow();

      expect(() => {
        Logger.larkClient('destroyed', context, 'LarkClient destroyed');
      }).not.toThrow();
    });
  });

  describe('Performance Monitoring', () => {
    test('should create performance monitor instance', () => {
      const monitor = PerformanceMonitor.getInstance();
      expect(monitor).toBeDefined();
      expect(monitor).toBeInstanceOf(PerformanceMonitor);
    });

    test('should return same instance on multiple calls', () => {
      const monitor1 = PerformanceMonitor.getInstance();
      const monitor2 = PerformanceMonitor.getInstance();
      expect(monitor1).toBe(monitor2);
    });

    test('should get performance metrics', () => {
      const monitor = PerformanceMonitor.getInstance();
      const mockUserManager = {
        getActiveUserCount: () => 5,
        getTotalConnectionCount: () => 15
      };

      const metrics = monitor.getMetrics(mockUserManager);
      
      expect(metrics).toHaveProperty('timestamp');
      expect(metrics).toHaveProperty('activeUsers', 5);
      expect(metrics).toHaveProperty('totalConnections', 15);
      expect(metrics).toHaveProperty('memoryUsage');
      expect(metrics).toHaveProperty('cpuUsage');
      expect(metrics).toHaveProperty('uptime');
      expect(typeof metrics.timestamp).toBe('number');
      expect(typeof metrics.uptime).toBe('number');
    });

    test('should log performance metrics', () => {
      const monitor = PerformanceMonitor.getInstance();
      const mockUserManager = {
        getActiveUserCount: () => 3,
        getTotalConnectionCount: () => 8
      };

      expect(() => {
        monitor.logMetrics(mockUserManager);
      }).not.toThrow();
    });
  });

  describe('Memory Logging', () => {
    test('should log memory usage', () => {
      const context: LogContext = {
        userId: 'test-user',
        operation: 'test-operation'
      };

      expect(() => {
        Logger.memory(context);
      }).not.toThrow();
    });
  });

  describe('Cleanup Logging', () => {
    test('should log resource cleanup', () => {
      const context: LogContext = {
        userId: 'test-user',
        operation: 'cleanup'
      };

      const details = {
        resourcesCleared: 5,
        timeElapsed: 100
      };

      expect(() => {
        Logger.cleanup('user_sessions', context, details);
      }).not.toThrow();
    });
  });

  describe('Performance Logging', () => {
    test('should log performance metrics', () => {
      const metrics = {
        timestamp: Date.now(),
        activeUsers: 10,
        totalConnections: 25,
        memoryUsage: process.memoryUsage(),
        cpuUsage: process.cpuUsage(),
        uptime: process.uptime()
      };

      expect(() => {
        Logger.performance(metrics);
      }).not.toThrow();
    });
  });
}); 