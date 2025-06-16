import { Request, Response, NextFunction } from 'express';
import { larkConfig } from '../config/env';
import { UserManager } from '../user-manager';
import { addUserSessionMethods } from '../user-manager';
import { LarkApiResponse, LarkUserInfo } from '../shared/types';
import { Logger } from '../shared/logger';

export class AuthMiddleware {
  constructor(private userManager: UserManager) {}

  // 完整的 Lark API 认证中间件（用于 SSE 连接建立）
  async authenticateToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    Logger.info('[MCP][Request] Auth Full', {
      method: req.method,
      path: req.path,
      userAgent: req.get('User-Agent'),
      ip: req.ip
    });
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      Logger.warn('[MCP][Auth] Missing or invalid Authorization header', { method: req.method, path: req.path });
      res.status(401).json({ error: 'unauthorized', error_description: 'Bearer token required' });
      return;
    }
    const token = authHeader.substring(7);
    try {
      console.log(`[DEBUG] 🔍 Calling Lark user info API (Full Auth)...`);
      console.log(`[DEBUG] API URL: ${larkConfig.baseUrl}/open-apis/authen/v1/user_info`);
      
      const response = await fetch(`${larkConfig.baseUrl}/open-apis/authen/v1/user_info`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      console.log(`[DEBUG] 📥 Lark API response status: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        console.log(`[DEBUG] Lark token validation failed: ${response.status} ${response.statusText}`);
        
        // 尝试获取错误详情
        try {
          const errorBody = await response.text();
          console.log(`[DEBUG] Error response body:`, errorBody);
        } catch (e) {
          console.log(`[DEBUG] Could not read error response body`);
        }
        
        res.status(401).json({ error: 'invalid_token', error_description: 'Token validation failed' });
        return;
      }

      const data: LarkApiResponse<any> = await response.json();
      
      console.log(`[DEBUG] 📋 Lark API response data:`, JSON.stringify(data, null, 2));

      if (data.code !== 0) {
        console.log(`[DEBUG] Lark API error during token validation:`, data);
        res.status(401).json({ error: 'invalid_token', error_description: 'Invalid token' });
        return;
      }

      // 尝试从不同的字段中获取用户信息
      const userData = data.data;
      let userId: string | undefined;
      let userName: string | undefined;

      // 尝试不同的用户ID字段名
      if (userData) {
        userId = userData.sub || userData.user_id || userData.id || userData.open_id || userData.union_id;
        userName = userData.name || userData.username || userData.nickname || userData.display_name;
        
        console.log(`[DEBUG] 👤 Extracted user info (trying multiple fields):`);
        console.log(`[DEBUG]   - sub: ${userData.sub || 'NOT_FOUND'}`);
        console.log(`[DEBUG]   - user_id: ${userData.user_id || 'NOT_FOUND'}`);
        console.log(`[DEBUG]   - id: ${userData.id || 'NOT_FOUND'}`);
        console.log(`[DEBUG]   - open_id: ${userData.open_id || 'NOT_FOUND'}`);
        console.log(`[DEBUG]   - union_id: ${userData.union_id || 'NOT_FOUND'}`);
        console.log(`[DEBUG]   - Final userId: ${userId || 'NOT_FOUND'}`);
        console.log(`[DEBUG]   - Final userName: ${userName || 'NOT_FOUND'}`);
      }

      if (!userId) {
        Logger.warn('[MCP][Auth] User ID not found in Lark response', { method: req.method, path: req.path });
        res.status(401).json({ error: 'invalid_token', error_description: 'User ID not found in any expected field' });
        return;
      }

      try {
        // 使用UserManager获取或创建用户会话
        const userSession = await this.userManager.getOrCreateUserSession(userId, token, userName);
        
        // 设置用户信息到请求对象
        req.user = {
          client_id: 'lark_user',
          scope: 'mcp',
          accessToken: token,
          lark_user_id: userId,
          lark_user_name: userName,
          userSession: userSession,
        };

        // 添加用户会话辅助方法
        addUserSessionMethods(req);

        Logger.info('[MCP][Auth] User authenticated', { userId, method: req.method, path: req.path });
        next();
      } catch (userError) {
        Logger.error('[MCP][Auth] UserManager error', userError as Error, { method: req.method, path: req.path });
        res.status(500).json({ 
          error: 'user_session_error', 
          error_description: userError instanceof Error ? userError.message : 'Failed to create user session' 
        });
      }
    } catch (error) {
      Logger.error('[MCP][Auth] Token validation error', error as Error, { method: req.method, path: req.path });
      res.status(401).json({ error: 'invalid_token', error_description: 'Token validation failed' });
    }
  }

  // 轻量级会话验证中间件（用于消息请求）
  async authenticateSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    Logger.info('[MCP][Request] Auth Session', {
      method: req.method,
      path: req.path,
      userAgent: req.get('User-Agent'),
      ip: req.ip
    });
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      Logger.warn('[MCP][Auth] Missing or invalid Authorization header', { method: req.method, path: req.path });
      res.status(401).json({ error: 'unauthorized', error_description: 'Bearer token required' });
      return;
    }
    const token = authHeader.substring(7);
    const sessionId = req.query.sessionId as string;
    try {
      let foundUser = null;
      if (sessionId) {
        foundUser = this.userManager.findUserBySessionId(sessionId);
        if (foundUser && foundUser.userSession.accessToken === token) {
          req.user = {
            client_id: 'lark_user',
            scope: 'mcp',
            accessToken: token,
            lark_user_id: foundUser.userId,
            lark_user_name: foundUser.userSession.userName,
            userSession: foundUser.userSession,
          };
          addUserSessionMethods(req);
          foundUser.userSession.lastActiveTime = Date.now();
          Logger.info('[MCP][Auth] Lightweight session auth success', { userId: foundUser.userId, method: req.method, path: req.path });
          next();
          return;
        }
      }
      if (!foundUser) {
        foundUser = this.userManager.findUserByToken(token);
        if (foundUser) {
          req.user = {
            client_id: 'lark_user',
            scope: 'mcp',
            accessToken: token,
            lark_user_id: foundUser.userId,
            lark_user_name: foundUser.userSession.userName,
            userSession: foundUser.userSession,
          };
          addUserSessionMethods(req);
          foundUser.userSession.lastActiveTime = Date.now();
          Logger.info('[MCP][Auth] Lightweight token auth success', { userId: foundUser.userId, method: req.method, path: req.path });
          next();
          return;
        }
      }
      Logger.info('[MCP][Auth] No cached session found, falling back to full authentication', { method: req.method, path: req.path });
      return this.authenticateToken(req, res, next);
    } catch (error) {
      Logger.error('[MCP][Auth] Session validation error', error as Error, { method: req.method, path: req.path });
      return this.authenticateToken(req, res, next);
    }
  }
} 