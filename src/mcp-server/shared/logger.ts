import winston from 'winston';
import path from 'path';

// 日志级别定义
export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn', 
  INFO = 'info',
  DEBUG = 'debug'
}

// 日志上下文接口
export interface LogContext {
  userId?: string;
  sessionId?: string;
  clientId?: string;
  component?: string;
  operation?: string;
  duration?: number;
  memory?: NodeJS.MemoryUsage;
  [key: string]: any;
}

// 性能监控指标
export interface PerformanceMetrics {
  timestamp: number;
  activeUsers: number;
  totalConnections: number;
  memoryUsage: NodeJS.MemoryUsage;
  cpuUsage: NodeJS.CpuUsage;
  uptime: number;
}

// 用户会话事件类型
export enum UserSessionEvent {
  CREATED = 'user_session_created',
  UPDATED = 'user_session_updated', 
  DESTROYED = 'user_session_destroyed',
  CONNECTION_ADDED = 'connection_added',
  CONNECTION_REMOVED = 'connection_removed',
  TOKEN_UPDATED = 'token_updated',
  LARK_CLIENT_CREATED = 'lark_client_created',
  LARK_CLIENT_DESTROYED = 'lark_client_destroyed'
}

// 自定义日志格式
const customFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss.SSS'
  }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const logEntry: any = {
      timestamp,
      level: level.toUpperCase(),
      message,
      ...meta
    };
    
    // 如果有用户上下文，提取到顶层
    if (meta.context) {
      Object.assign(logEntry, meta.context);
      delete logEntry.context;
    }
    
    return JSON.stringify(logEntry);
  })
);

// 创建日志器实例
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: customFormat,
  transports: [
    // 控制台输出 (开发环境)
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple(),
        winston.format.printf(({ timestamp, level, message, userId, sessionId, component, ...meta }) => {
          let logStr = `${timestamp} [${level}]`;
          
          // 添加上下文标识
          if (component) logStr += ` [${component}]`;
          if (userId) logStr += ` [User:${userId}]`;
          if (sessionId && typeof sessionId === 'string') logStr += ` [Session:${sessionId.substring(0, 8)}...]`;
          
          logStr += ` ${message}`;
          
          // 添加额外元数据
          if (Object.keys(meta).length > 0) {
            logStr += ` ${JSON.stringify(meta)}`;
          }
          
          return logStr;
        })
      )
    }),
    
    // 文件输出 (生产环境)
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 10
    }),
    
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'combined.log'),
      maxsize: 10 * 1024 * 1024, // 10MB  
      maxFiles: 10
    }),
    
    // 用户会话相关日志单独文件
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'user-sessions.log'),
      level: 'info',
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json(),
        winston.format.printf((info) => {
          // 只记录用户会话相关的日志
          if (info.userId || info.event || info.component === 'UserManager') {
            return JSON.stringify(info);
          }
          return '';
        })
      )
    })
  ],
  
  // 异常处理
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'exceptions.log')
    })
  ],
  
  // 拒绝处理
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'rejections.log')
    })
  ]
});

// Logger工具类
export class Logger {
  
  // 用户会话相关日志
  static userSession(event: UserSessionEvent, context: LogContext, message?: string) {
    logger.info(message || `User session ${event}`, {
      event,
      component: 'UserManager',
      context
    });
  }
  
  // 连接相关日志
  static connection(action: string, context: LogContext, message?: string) {
    logger.info(message || `Connection ${action}`, {
      component: 'SSEHandler',
      action,
      context
    });
  }
  
  // LarkClient相关日志
  static larkClient(action: string, context: LogContext, message?: string) {
    logger.info(message || `LarkClient ${action}`, {
      component: 'LarkClient',
      action,
      context
    });
  }
  
  // 工具执行日志
  static toolExecution(toolName: string, context: LogContext, result?: any, error?: Error) {
    if (error) {
      logger.error(`Tool execution failed: ${toolName}`, {
        component: 'ToolExecution',
        toolName,
        error: error.message,
        stack: error.stack,
        context
      });
    } else {
      logger.info(`Tool executed: ${toolName}`, {
        component: 'ToolExecution', 
        toolName,
        result: result ? { success: true } : undefined,
        context
      });
    }
  }
  
  // 性能监控日志
  static performance(metrics: PerformanceMetrics) {
    logger.info('Performance metrics', {
      component: 'Monitor',
      metrics
    });
  }
  
  // 内存使用监控
  static memory(context: LogContext) {
    const memUsage = process.memoryUsage();
    logger.debug('Memory usage', {
      component: 'Monitor',
      memory: {
        rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
        external: `${Math.round(memUsage.external / 1024 / 1024)}MB`
      },
      context
    });
  }
  
  // 清理资源日志
  static cleanup(resourceType: string, context: LogContext, details?: any) {
    logger.info(`Resource cleanup: ${resourceType}`, {
      component: 'Cleanup',
      resourceType,
      details,
      context
    });
  }
  
  // 错误日志
  static error(message: string, error: Error, context?: LogContext) {
    logger.error(message, {
      error: error.message,
      stack: error.stack,
      context
    });
  }
  
  // 警告日志
  static warn(message: string, context?: LogContext) {
    logger.warn(message, { context });
  }
  
  // 信息日志
  static info(message: string, context?: LogContext) {
    logger.info(message, { context });
  }
  
  // 调试日志
  static debug(message: string, context?: LogContext) {
    logger.debug(message, { context });
  }
}

// 性能监控器
export class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  private startTime: number = Date.now();
  private lastCpuUsage: NodeJS.CpuUsage = process.cpuUsage();
  
  static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }
  
  // 获取当前性能指标
  getMetrics(userManager?: any): PerformanceMetrics {
    const currentCpuUsage = process.cpuUsage(this.lastCpuUsage);
    this.lastCpuUsage = process.cpuUsage();
    
    return {
      timestamp: Date.now(),
      activeUsers: userManager?.getActiveUserCount() || 0,
      totalConnections: userManager?.getTotalConnectionCount() || 0,
      memoryUsage: process.memoryUsage(),
      cpuUsage: currentCpuUsage,
      uptime: process.uptime()
    };
  }
  
  // 记录性能指标
  logMetrics(userManager?: any) {
    const metrics = this.getMetrics(userManager);
    Logger.performance(metrics);
  }
}

// 确保日志目录存在
import fs from 'fs';
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// 导出默认logger实例
export default logger; 