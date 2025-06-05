import request from 'supertest';
import express from 'express';
import { HealthRoutes } from '../../../src/mcp-server/routes/health-routes';
import { UserManager } from '../../../src/mcp-server/user-manager';
import { Logger } from '../../../src/mcp-server/shared/logger';

// Mock Logger to avoid file system operations during tests
jest.mock('../../../src/mcp-server/shared/logger', () => ({
  Logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  },
  PerformanceMonitor: {
    getInstance: jest.fn(() => ({
      getMetrics: jest.fn(() => ({
        timestamp: Date.now(),
        activeUsers: 3,
        totalConnections: 8,
        memoryUsage: {
          rss: 42618880,
          heapTotal: 171827200,
          heapUsed: 167306328,
          external: 3006169,
          arrayBuffers: 92775
        },
        cpuUsage: {
          user: 9258,
          system: 9526
        },
        uptime: 737.184297549
      }))
    }))
  }
}));

describe('HealthRoutes', () => {
  let app: express.Application;
  let mockUserManager: jest.Mocked<UserManager>;
  let healthRoutes: HealthRoutes;

  beforeEach(() => {
    app = express();
    
    // Mock UserManager
    mockUserManager = {
      getActiveUserCount: jest.fn().mockReturnValue(5),
      getTotalConnectionCount: jest.fn().mockReturnValue(15),
    } as any;

    healthRoutes = new HealthRoutes(mockUserManager);
    app.use('/api', healthRoutes.getRouter());
  });

  describe('GET /api/health', () => {
    test('should return basic health status', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'healthy',
        timestamp: expect.any(String),
        uptime: expect.any(Number),
        version: expect.any(String)
      });

      expect(new Date(response.body.timestamp)).toBeInstanceOf(Date);
      expect(response.body.uptime).toBeGreaterThan(0);
    });

    test('should handle errors gracefully', async () => {
      // Mock a scenario where getActiveUserCount throws an error
      mockUserManager.getActiveUserCount.mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      // Since healthCheck doesn't use UserManager, it should still work
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.body.status).toBe('healthy');
    });
  });

  describe('GET /api/status', () => {
    test('should return detailed status information', async () => {
      const response = await request(app)
        .get('/api/status')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'healthy',
        timestamp: expect.any(String),
        uptime: expect.any(Number),
        system: {
          nodeVersion: expect.any(String),
          platform: expect.any(String),
          arch: expect.any(String),
          pid: expect.any(Number)
        },
        memory: {
          rss: expect.any(String),
          heapTotal: expect.any(String),
          heapUsed: expect.any(String),
          external: expect.any(String),
          arrayBuffers: expect.any(String)
        },
        cpu: {
          user: expect.any(Number),
          system: expect.any(Number)
        },
        users: {
          activeUsers: 5,
          totalConnections: 15
        }
      });

      // Verify memory values are formatted correctly
      expect(response.body.memory.rss).toMatch(/^\d+MB$/);
      expect(response.body.memory.heapTotal).toMatch(/^\d+MB$/);
      expect(response.body.memory.heapUsed).toMatch(/^\d+MB$/);
    });

    test('should handle UserManager errors gracefully', async () => {
      mockUserManager.getActiveUserCount.mockImplementation(() => {
        throw new Error('UserManager error');
      });

      const response = await request(app)
        .get('/api/status')
        .expect(500);

      expect(response.body).toMatchObject({
        status: 'error',
        error: 'UserManager error',
        timestamp: expect.any(String)
      });
    });
  });

  describe('GET /api/metrics', () => {
    test('should return performance metrics', async () => {
      const response = await request(app)
        .get('/api/metrics')
        .expect(200);

      expect(response.body).toMatchObject({
        timestamp: expect.any(Number),
        activeUsers: 3,
        totalConnections: 8,
        memoryUsage: {
          rss: expect.any(Number),
          heapTotal: expect.any(Number),
          heapUsed: expect.any(Number),
          external: expect.any(Number),
          arrayBuffers: expect.any(Number)
        },
        cpuUsage: {
          user: expect.any(Number),
          system: expect.any(Number)
        },
        uptime: expect.any(Number)
      });
    });

    test('should handle performance monitor errors', async () => {
      // Create a new HealthRoutes instance with a mocked performance monitor that throws errors
      const errorHealthRoutes = new HealthRoutes(mockUserManager);
      
      // Replace the performanceMonitor instance with one that throws errors
      (errorHealthRoutes as any).performanceMonitor = {
        getMetrics: jest.fn(() => {
          throw new Error('Performance metrics unavailable');
        })
      };

      const errorApp = express();
      errorApp.use('/api', errorHealthRoutes.getRouter());

      const response = await request(errorApp)
        .get('/api/metrics')
        .expect(500);

      expect(response.body).toMatchObject({
        error: 'Failed to retrieve performance metrics',
        message: 'Performance metrics unavailable',
        timestamp: expect.any(String)
      });
    });
  });

  describe('GET /api/stats/users', () => {
    test('should return user statistics', async () => {
      const response = await request(app)
        .get('/api/stats/users')
        .expect(200);

      expect(response.body).toMatchObject({
        timestamp: expect.any(String),
        users: {
          activeUsers: 5,
          totalConnections: 15,
          avgConnectionsPerUser: 3
        },
        limits: {
          maxConcurrentUsers: 100,
          maxConnectionsPerUser: 10
        },
        utilization: {
          userCapacityUsed: expect.any(String),
          connectionCapacityUsed: expect.any(String)
        }
      });

      // Verify utilization calculations
      expect(response.body.utilization.userCapacityUsed).toBe('5.0%');
      expect(response.body.utilization.connectionCapacityUsed).toBe('1.5%');
    });

    test('should handle zero users correctly', async () => {
      mockUserManager.getActiveUserCount.mockReturnValue(0);
      mockUserManager.getTotalConnectionCount.mockReturnValue(0);

      const response = await request(app)
        .get('/api/stats/users')
        .expect(200);

      expect(response.body.users).toMatchObject({
        activeUsers: 0,
        totalConnections: 0,
        avgConnectionsPerUser: 0
      });

      expect(response.body.utilization.userCapacityUsed).toBe('0.0%');
      expect(response.body.utilization.connectionCapacityUsed).toBe('0.0%');
    });

    test('should handle UserManager errors', async () => {
      mockUserManager.getActiveUserCount.mockImplementation(() => {
        throw new Error('Failed to get user count');
      });

      const response = await request(app)
        .get('/api/stats/users')
        .expect(500);

      expect(response.body).toMatchObject({
        error: 'Failed to retrieve user statistics',
        message: 'Failed to get user count',
        timestamp: expect.any(String)
      });
    });
  });

  describe('GET /api/info', () => {
    test('should return system information', async () => {
      const originalEnv = process.env.npm_package_version;
      process.env.npm_package_version = '1.2.3';

      const response = await request(app)
        .get('/api/info')
        .expect(200);

      expect(response.body).toMatchObject({
        timestamp: expect.any(String),
        application: {
          name: 'Lark MCP Server',
          version: '1.2.3',
          environment: expect.any(String),
          startTime: expect.any(String),
          uptime: {
            seconds: expect.any(Number),
            human: expect.any(String)
          }
        },
        runtime: {
          nodeVersion: expect.any(String),
          platform: expect.any(String),
          architecture: expect.any(String),
          processId: expect.any(Number)
        },
        features: {
          oauth: true,
          userIsolation: true,
          sseTransport: true,
          performanceMonitoring: true,
          structuredLogging: true
        },
        configuration: {
          logLevel: expect.any(String),
          userSessionTimeout: '30 minutes',
          cleanupInterval: '5 minutes',
          maxConcurrentUsers: 100,
          maxConnectionsPerUser: 10
        }
      });

      // Verify uptime formatting
      expect(response.body.application.uptime.human).toMatch(/\d+[dhms]/);

      // Restore original environment
      if (originalEnv) {
        process.env.npm_package_version = originalEnv;
      } else {
        delete process.env.npm_package_version;
      }
    });

    test('should format uptime correctly', async () => {
      const response = await request(app)
        .get('/api/info')
        .expect(200);

      const uptimeHuman = response.body.application.uptime.human;
      
      // Should contain time units
      expect(uptimeHuman).toMatch(/\d+[dhms]/);
      
      // Should be a reasonable format (not empty or just "0s")
      expect(uptimeHuman.length).toBeGreaterThan(0);
    });
  });

  describe('Router Integration', () => {
    test('should return router instance', () => {
      const router = healthRoutes.getRouter();
      expect(router).toBeDefined();
      expect(typeof router).toBe('function'); // Express Router is a function
    });

    test('should handle unknown endpoints', async () => {
      await request(app)
        .get('/api/unknown')
        .expect(404);
    });
  });

  describe('Logging Integration', () => {
    test('should log health check requests', async () => {
      await request(app)
        .get('/api/health')
        .expect(200);

      expect(Logger.debug).toHaveBeenCalledWith(
        'Health check requested',
        expect.objectContaining({
          component: 'HealthRoutes',
          operation: 'healthCheck'
        })
      );
    });

    test('should log detailed status requests', async () => {
      await request(app)
        .get('/api/status')
        .expect(200);

      expect(Logger.debug).toHaveBeenCalledWith(
        'Detailed status requested',
        expect.objectContaining({
          component: 'HealthRoutes',
          operation: 'detailedStatus',
          activeUsers: 5,
          totalConnections: 15
        })
      );
    });

    test('should log performance metrics requests', async () => {
      await request(app)
        .get('/api/metrics')
        .expect(200);

      expect(Logger.debug).toHaveBeenCalledWith(
        'Performance metrics requested',
        expect.objectContaining({
          component: 'HealthRoutes',
          operation: 'performanceMetrics'
        })
      );
    });

    test('should log user statistics requests', async () => {
      await request(app)
        .get('/api/stats/users')
        .expect(200);

      expect(Logger.debug).toHaveBeenCalledWith(
        'User statistics requested',
        expect.objectContaining({
          component: 'HealthRoutes',
          operation: 'userStatistics',
          stats: {
            activeUsers: 5,
            totalConnections: 15,
            avgConnectionsPerUser: 3
          }
        })
      );
    });

    test('should log errors appropriately', async () => {
      mockUserManager.getActiveUserCount.mockImplementation(() => {
        throw new Error('Mock error for testing');
      });

      await request(app)
        .get('/api/status')
        .expect(500);

      expect(Logger.error).toHaveBeenCalledWith(
        'Detailed status check failed',
        expect.any(Error),
        expect.objectContaining({
          component: 'HealthRoutes',
          operation: 'detailedStatus'
        })
      );
    });
  });
}); 