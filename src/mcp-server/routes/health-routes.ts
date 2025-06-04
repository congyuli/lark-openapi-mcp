import { Request, Response, Router } from 'express';
import { UserManager } from '../user-manager';
import { Logger, LogContext, PerformanceMonitor } from '../shared/logger';

export class HealthRoutes {
  private router: Router;
  private performanceMonitor = PerformanceMonitor.getInstance();

  constructor(private userManager: UserManager) {
    this.router = Router();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // 基础健康检查
    this.router.get('/health', this.healthCheck.bind(this));
    
    // 详细状态检查
    this.router.get('/status', this.detailedStatus.bind(this));
    
    // 性能指标
    this.router.get('/metrics', this.performanceMetrics.bind(this));
    
    // 用户统计
    this.router.get('/stats/users', this.userStatistics.bind(this));
    
    // 系统信息
    this.router.get('/info', this.systemInfo.bind(this));
  }

  // 基础健康检查
  private async healthCheck(req: Request, res: Response): Promise<void> {
    const context: LogContext = {
      component: 'HealthRoutes',
      operation: 'healthCheck',
      ip: req.ip
    };

    try {
      const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0'
      };

      Logger.debug('Health check requested', context);
      res.json(health);
    } catch (error) {
      Logger.error('Health check failed', error as Error, context);
      res.status(500).json({
        status: 'unhealthy',
        error: (error as Error).message,
        timestamp: new Date().toISOString()
      });
    }
  }

  // 详细状态检查
  private async detailedStatus(req: Request, res: Response): Promise<void> {
    const context: LogContext = {
      component: 'HealthRoutes',
      operation: 'detailedStatus',
      ip: req.ip
    };

    try {
      const memoryUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();
      
      const status = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        system: {
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
          pid: process.pid
        },
        memory: {
          rss: `${Math.round(memoryUsage.rss / 1024 / 1024)}MB`,
          heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`,
          heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
          external: `${Math.round(memoryUsage.external / 1024 / 1024)}MB`,
          arrayBuffers: `${Math.round(memoryUsage.arrayBuffers / 1024 / 1024)}MB`
        },
        cpu: {
          user: cpuUsage.user,
          system: cpuUsage.system
        },
        users: {
          activeUsers: this.userManager.getActiveUserCount(),
          totalConnections: this.userManager.getTotalConnectionCount()
        }
      };

      Logger.debug('Detailed status requested', {
        ...context,
        activeUsers: status.users.activeUsers,
        totalConnections: status.users.totalConnections
      });

      res.json(status);
    } catch (error) {
      Logger.error('Detailed status check failed', error as Error, context);
      res.status(500).json({
        status: 'error',
        error: (error as Error).message,
        timestamp: new Date().toISOString()
      });
    }
  }

  // 性能指标
  private async performanceMetrics(req: Request, res: Response): Promise<void> {
    const context: LogContext = {
      component: 'HealthRoutes',
      operation: 'performanceMetrics',
      ip: req.ip
    };

    try {
      const metrics = this.performanceMonitor.getMetrics(this.userManager);
      
      Logger.debug('Performance metrics requested', context);
      res.json(metrics);
    } catch (error) {
      Logger.error('Performance metrics retrieval failed', error as Error, context);
      res.status(500).json({
        error: 'Failed to retrieve performance metrics',
        message: (error as Error).message,
        timestamp: new Date().toISOString()
      });
    }
  }

  // 用户统计
  private async userStatistics(req: Request, res: Response): Promise<void> {
    const context: LogContext = {
      component: 'HealthRoutes',
      operation: 'userStatistics',
      ip: req.ip
    };

    try {
      // 获取用户统计信息
      const activeUsers = this.userManager.getActiveUserCount();
      const totalConnections = this.userManager.getTotalConnectionCount();
      
      // 计算平均每用户连接数
      const avgConnectionsPerUser = activeUsers > 0 ? (totalConnections / activeUsers).toFixed(2) : '0';
      
      const stats = {
        timestamp: new Date().toISOString(),
        users: {
          activeUsers,
          totalConnections,
          avgConnectionsPerUser: parseFloat(avgConnectionsPerUser)
        },
        limits: {
          maxConcurrentUsers: 100, // 从config获取
          maxConnectionsPerUser: 10  // 从config获取
        },
        utilization: {
          userCapacityUsed: `${((activeUsers / 100) * 100).toFixed(1)}%`,
          connectionCapacityUsed: `${((totalConnections / 1000) * 100).toFixed(1)}%`
        }
      };

      Logger.debug('User statistics requested', {
        ...context,
        stats: stats.users
      });

      res.json(stats);
    } catch (error) {
      Logger.error('User statistics retrieval failed', error as Error, context);
      res.status(500).json({
        error: 'Failed to retrieve user statistics',
        message: (error as Error).message,
        timestamp: new Date().toISOString()
      });
    }
  }

  // 系统信息
  private async systemInfo(req: Request, res: Response): Promise<void> {
    const context: LogContext = {
      component: 'HealthRoutes',
      operation: 'systemInfo',
      ip: req.ip
    };

    try {
      const info = {
        timestamp: new Date().toISOString(),
        application: {
          name: 'Lark MCP Server',
          version: process.env.npm_package_version || '1.0.0',
          environment: process.env.NODE_ENV || 'development',
          startTime: new Date(Date.now() - process.uptime() * 1000).toISOString(),
          uptime: {
            seconds: Math.floor(process.uptime()),
            human: this.formatUptime(process.uptime())
          }
        },
        runtime: {
          nodeVersion: process.version,
          platform: process.platform,
          architecture: process.arch,
          processId: process.pid
        },
        features: {
          oauth: true,
          userIsolation: true,
          sseTransport: true,
          performanceMonitoring: true,
          structuredLogging: true
        },
        configuration: {
          logLevel: process.env.LOG_LEVEL || 'info',
          userSessionTimeout: '30 minutes',
          cleanupInterval: '5 minutes',
          maxConcurrentUsers: 100,
          maxConnectionsPerUser: 10
        }
      };

      Logger.debug('System information requested', context);
      res.json(info);
    } catch (error) {
      Logger.error('System information retrieval failed', error as Error, context);
      res.status(500).json({
        error: 'Failed to retrieve system information',
        message: (error as Error).message,
        timestamp: new Date().toISOString()
      });
    }
  }

  // 格式化运行时间
  private formatUptime(uptimeSeconds: number): string {
    const days = Math.floor(uptimeSeconds / 86400);
    const hours = Math.floor((uptimeSeconds % 86400) / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = Math.floor(uptimeSeconds % 60);

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0) parts.push(`${seconds}s`);

    return parts.join(' ') || '0s';
  }

  // 获取路由器实例
  getRouter(): Router {
    return this.router;
  }
} 