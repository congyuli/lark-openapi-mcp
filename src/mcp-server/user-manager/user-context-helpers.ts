import { UserSession, UserNotFoundError } from '../types';

// 便捷的工具函数，使用 any 类型简化Express Request处理
export function getUserSession(req: any): UserSession | null {
  return req.user?.userSession || null;
}

export function requireUserSession(req: any): UserSession {
  const userSession = req.user?.userSession;
  if (!userSession) {
    throw new UserNotFoundError('User session is required but not found in request context');
  }
  return userSession;
}

export function getLarkClient(req: any): any | null {
  const userSession = req.user?.userSession;
  return userSession?.larkClient || null;
}

export function updateLastActiveTime(req: any): void {
  const userSession = req.user?.userSession;
  if (userSession) {
    userSession.lastActiveTime = Date.now();
  }
}

export function getUserId(req: any): string | null {
  return req.user?.lark_user_id || null;
}

export function requireUserId(req: any): string {
  const userId = getUserId(req);
  if (!userId) {
    throw new UserNotFoundError('User ID is required but not found in request context');
  }
  return userId;
}

export function getUserAccessToken(req: any): string | null {
  return req.user?.accessToken || null;
}

export function requireUserAccessToken(req: any): string {
  const token = getUserAccessToken(req);
  if (!token) {
    throw new UserNotFoundError('User access token is required but not found in request context');
  }
  return token;
}

export function getUserName(req: any): string | null {
  return req.user?.lark_user_name || null;
}

// 扩展Express Request的方法实现
export function addUserSessionMethods(req: any): void {
  req.getUserSession = () => getUserSession(req);
  req.requireUserSession = () => requireUserSession(req);
} 