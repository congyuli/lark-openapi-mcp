import * as larkmcp from '../../mcp-tool';
import { Request, Response } from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

// 扩展 Express Request 类型以包含用户信息
declare module 'express-serve-static-core' {
  interface Request {
    user?: {
      client_id: string;
      scope?: string;
      accessToken?: string;
      lark_user_id?: string;
      lark_user_name?: string;
      userSession?: any;
    };
  }
}

export interface McpServerOptions {
  appId?: string;
  appSecret?: string;
  domain?: string;
  tools?: string | string[];
  userAccessToken?: string;
  language?: 'zh' | 'en';
  toolNameCase?: larkmcp.ToolNameCase;
  tokenMode?: larkmcp.TokenMode;
  host: string;
  port: number;
}

// OAuth 客户端信息接口
export interface OAuthClientInfo {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
}

// SSE 连接信息接口
export interface ConnectionInfo {
  sessionId: string;
  transport: SSEServerTransport;
  response: Response;
  userId: string;
  clientId?: string;
  createdAt: number;
}

// OAuth 令牌响应接口
export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  expires_at?: string;
  scope?: string;
}

// Lark 用户信息接口
export interface LarkUserInfo {
  sub: string;
  name?: string;
  email?: string;
}

// Lark API 响应接口
export interface LarkApiResponse<T = any> {
  code: number;
  msg?: string;
  data?: T;
}
