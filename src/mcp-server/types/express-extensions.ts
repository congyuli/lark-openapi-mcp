import { UserSession, AuthenticatedUser } from './user-session';

// 扩展Express Request类型，保持与现有定义兼容
declare global {
  namespace Express {
    interface Request {
      // 扩展现有的user属性
      user?: AuthenticatedUser;
      
      // 添加用户会话管理方法
      getUserSession(): UserSession | null;
      requireUserSession(): UserSession;
    }
  }
}

// 用户上下文辅助函数类型
export interface UserContextHelpers {
  getUserSession(req: Express.Request): UserSession | null;
  requireUserSession(req: Express.Request): UserSession;
  getLarkClient(req: Express.Request): any | null;
  updateLastActiveTime(req: Express.Request): void;
} 