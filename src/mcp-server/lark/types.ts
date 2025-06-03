export interface LarkOAuthConfig {
  appId: string;
  appSecret: string;
  // redirectUri?: string;
  scopes?: string[];
  baseUrl?: string;
}

export interface LarkTokenResponse {
  code: number;
  msg: string;
  data: {
    access_token: string;
    token_type: string;
    expires_in: number;
    refresh_token?: string;
    scope: string;
  };
}

export interface LarkUserInfo {
  sub: string;
  name: string;
  picture?: string;
  open_id: string;
  union_id?: string;
  en_name?: string;
  tenant_key: string;
  avatar_url?: string;
  avatar_thumb?: string;
  avatar_middle?: string;
  avatar_big?: string;
  email?: string;
  user_id?: string;
  mobile?: string;
}

export interface OAuthResult {
  success: boolean;
  tokens?: LarkTokenResponse;
  userInfo?: LarkUserInfo;
  error?: string;
} 