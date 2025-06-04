import { Request, Response, NextFunction } from 'express';
import { larkConfig } from '../config/env';
import { UserManager } from '../user-manager';
import { addUserSessionMethods } from '../user-manager';
import { LarkApiResponse, LarkUserInfo } from '../shared/types';

export class AuthMiddleware {
  constructor(private userManager: UserManager) {}

  // 完整的 Lark API 认证中间件（用于 SSE 连接建立）
  async authenticateToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    // 打印所有请求头
    console.log(`[DEBUG] === Full Auth: Request Headers Debug ===`);
    console.log(`[DEBUG] Request URL: ${req.method} ${req.url}`);
    console.log(`[DEBUG] Request Headers:`, JSON.stringify(req.headers, null, 2));
    
    // 提取和打印Authorization头
    const authHeader = req.headers.authorization;
    console.log(`[DEBUG] Authorization Header: ${authHeader || 'NOT_FOUND'}`);
    
    if (authHeader) {
      if (authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        console.log(`[DEBUG] Extracted Bearer Token: ${token.substring(0, 20)}...${token.substring(token.length - 10)}`);
      } else {
        console.log(`[DEBUG] Authorization header does not start with 'Bearer '`);
      }
    }
    
    console.log(`[DEBUG] === End Full Auth Headers Debug ===`);

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log(`[DEBUG] Authentication failed: Missing or invalid Authorization header`);
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
        console.log(`[DEBUG] ❌ No user ID found in Lark response (tried multiple fields)`);
        console.log(`[DEBUG] Available fields in data:`, Object.keys(userData || {}));
        console.log(`[DEBUG] Full response data structure:`, JSON.stringify(data, null, 2));
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

        console.log(`[DEBUG] ✅ User authenticated via Full Auth: ${userId}`);
        console.log(`[DEBUG] Active users: ${this.userManager.getActiveUserCount()}, Total connections: ${this.userManager.getTotalConnectionCount()}`);

        next();
      } catch (userError) {
        console.error('[ERROR] UserManager error:', userError);
        res.status(500).json({ 
          error: 'user_session_error', 
          error_description: userError instanceof Error ? userError.message : 'Failed to create user session' 
        });
      }
    } catch (error) {
      console.error('[ERROR] Token validation error:', error);
      res.status(401).json({ error: 'invalid_token', error_description: 'Token validation failed' });
    }
  }

  // 轻量级会话验证中间件（用于消息请求）
  async authenticateSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    console.log(`[DEBUG] === Session Auth: Lightweight validation ===`);
    console.log(`[DEBUG] Request URL: ${req.method} ${req.url}`);
    
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log(`[DEBUG] Session auth failed: Missing or invalid Authorization header`);
      res.status(401).json({ error: 'unauthorized', error_description: 'Bearer token required' });
      return;
    }

    const token = authHeader.substring(7);
    console.log(`[DEBUG] Session auth token: ${token.substring(0, 20)}...${token.substring(token.length - 10)}`);

    // 尝试从请求中获取sessionId
    const sessionId = req.query.sessionId as string;
    console.log(`[DEBUG] Session ID from query: ${sessionId || 'NOT_FOUND'}`);

    try {
      let foundUser = null;
      
      // 策略1: 优先通过sessionId快速查找（最快最准确）
      if (sessionId) {
        foundUser = this.userManager.findUserBySessionId(sessionId);
        if (foundUser) {
          console.log(`[DEBUG] 🎯 Found user by sessionId: ${foundUser.userId}`);
          
          // 验证token是否匹配（防止token被替换）
          if (foundUser.userSession.accessToken === token) {
            console.log(`[DEBUG] ✅ Token matches cached session - using lightweight auth`);
          } else {
            console.log(`[DEBUG] ⚠️ Token mismatch! Cached: ${foundUser.userSession.accessToken.substring(0, 20)}..., Provided: ${token.substring(0, 20)}...`);
            console.log(`[DEBUG] 🔄 Token may have been refreshed, falling back to full auth`);
            foundUser = null; // token不匹配，需要重新认证
          }
        }
      }
      
      // 策略2: 通过完整token查找
      if (!foundUser) {
        foundUser = this.userManager.findUserByToken(token);
        if (foundUser) {
          console.log(`[DEBUG] 🎯 Found user by exact token: ${foundUser.userId}`);
        }
      }
      
      // 策略3: 通过token前缀查找（适用于token轻微变化的情况）
      if (!foundUser) {
        const tokenPrefix = token.substring(0, 30); // 取前30个字符作为前缀
        foundUser = this.userManager.findUserByTokenPrefix(tokenPrefix);
        if (foundUser) {
          console.log(`[DEBUG] 🎯 Found user by token prefix: ${foundUser.userId}`);
          console.log(`[DEBUG] 🔄 Token prefix match, but will verify with full auth for security`);
          foundUser = null; // 前缀匹配不够安全，降级到完整认证
        }
      }

      if (foundUser) {
        // 找到缓存的用户会话，直接使用
        req.user = {
          client_id: 'lark_user',
          scope: 'mcp',
          accessToken: token,
          lark_user_id: foundUser.userId,
          lark_user_name: foundUser.userSession.userName,
          userSession: foundUser.userSession,
        };

        // 添加用户会话辅助方法
        addUserSessionMethods(req);

        // 更新最后活跃时间
        foundUser.userSession.lastActiveTime = Date.now();

        console.log(`[DEBUG] ✅ Lightweight session auth success: ${foundUser.userId} (SKIPPED Lark API call)`);
        console.log(`[DEBUG] 📊 Active users: ${this.userManager.getActiveUserCount()}, Total connections: ${this.userManager.getTotalConnectionCount()}`);
        
        next();
      } else {
        // 没有找到缓存会话，降级到完整认证
        console.log(`[DEBUG] 🔄 No cached session found, falling back to full authentication`);
        
        // 调试信息：显示当前所有活跃token（仅显示前缀）
        const activeTokens = this.userManager.getAllActiveUserTokens();
        console.log(`[DEBUG] 📋 Active tokens in system: ${activeTokens.map(t => t.substring(0, 20) + '...').join(', ')}`);
        
        return this.authenticateToken(req, res, next);
      }
      
    } catch (error) {
      console.error('[ERROR] Session validation error:', error);
      console.log(`[DEBUG] ⚠️ Session auth error, falling back to full auth`);
      return this.authenticateToken(req, res, next);
    }
  }
} 