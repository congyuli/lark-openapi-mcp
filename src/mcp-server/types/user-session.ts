import { Response } from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// 用户会话接口
export interface UserSession {
  userId: string;
  userName?: string;
  accessToken: string;
  larkClient: any; // LarkClient实例，每个用户独享
  connections: Map<string, ConnectionInfo>; // 该用户的所有连接
  lastActiveTime: number;
  createdAt: number;
}

// 连接信息接口
export interface ConnectionInfo {
  sessionId: string;
  transport: SSEServerTransport;
  response: Response;
  userId: string;
  clientId?: string;
  createdAt: number;
}

// 用户管理器接口
export interface IUserManager {
  // 用户操作
  getOrCreateUserSession(userId: string, accessToken: string, userName?: string): Promise<UserSession>;
  getUserSession(userId: string): UserSession | null;
  updateUserToken(userId: string, accessToken: string): Promise<void>;
  
  // 连接管理
  addConnection(userId: string, connectionInfo: ConnectionInfo): void;
  removeConnection(userId: string, sessionId: string): void;
  getActiveConnections(userId: string): ConnectionInfo[];
  
  // 资源清理
  cleanupInactiveUsers(inactiveThresholdMs: number): Promise<void>;
  removeUser(userId: string): Promise<void>;
  
  // 统计信息
  getActiveUserCount(): number;
  getTotalConnectionCount(): number;
}

// 自定义用户信息类型
export interface AuthenticatedUser {
  client_id: string;
  scope?: string;
  accessToken: string;
  lark_user_id: string;
  lark_user_name?: string;
  userSession?: UserSession;
} 