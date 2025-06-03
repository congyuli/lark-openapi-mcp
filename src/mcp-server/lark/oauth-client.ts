import express, { Request, Response } from 'express';
import { createServer, Server } from 'http';
import crypto from 'crypto';
import { LarkOAuthConfig, LarkTokenResponse, LarkUserInfo, OAuthResult } from './types.js';

export class LarkOAuthClient {
  private config: LarkOAuthConfig;
  private server?: Server;

  constructor(config: LarkOAuthConfig) {
    this.config = {
      ...config,
    };
  }

  /**
   * 获取授权URL (公共方法，用于外部调用)
   */
  public getAuthorizationUrl(options: { redirect_uri: string; state: string; scope?: string }): string {
    const params = new URLSearchParams({
      client_id: this.config.appId,
      redirect_uri: options.redirect_uri,
      response_type: 'code',
      state: options.state,
    });

    // 添加scope参数
    if (options.scope) {
      params.set('scope', options.scope);
    } else if (this.config.scopes && this.config.scopes.length > 0) {
      params.set('scope', this.config.scopes.join(' '));
    }

    return `${this.config.baseUrl}/open-apis/authen/v1/authorize?${params.toString()}`;
  }

  /**
   * 获取用户信息
   */
  private async getUserInfo(accessToken: string): Promise<LarkUserInfo> {
    const response = await fetch(`${this.config.baseUrl}/open-apis/authen/v1/user_info`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Get user info failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();

    if (data.code !== 0) {
      throw new Error(`Get user info failed: ${data.msg || 'Unknown error'}`);
    }

    return data.data;
  }

  /**
   * 使用访问令牌调用Lark API
   */
  async callApi(
    endpoint: string,
    accessToken: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
      data?: any;
      headers?: Record<string, string>;
    } = {},
  ): Promise<any> {
    const { method = 'GET', data, headers = {} } = options;

    const response = await fetch(`${this.config.baseUrl}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...headers,
      },
      body: data ? JSON.stringify(data) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API call failed: ${response.status} ${errorText}`);
    }

    return response.json();
  }

  /**
   * 获取应用访问令牌
   */
  private async getAppAccessToken(): Promise<string> {
    const requestBody = {
      app_id: this.config.appId,
      app_secret: this.config.appSecret,
    };

    console.log('🔄 Getting app access token...');
    console.log('  - URL:', `${this.config.baseUrl}/open-apis/auth/v3/app_access_token/internal`);

    const response = await fetch(`${this.config.baseUrl}/open-apis/auth/v3/app_access_token/internal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ App token request failed:', errorText);
      throw new Error(`App access token request failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    console.log('📋 App token response:', JSON.stringify(data, null, 2));

    if (data.code !== 0) {
      console.error('❌ App token API Error:', data);
      throw new Error(`App access token failed: Code ${data.code}, Message: ${data.msg || 'Unknown error'}`);
    }

    return data.app_access_token;
  }

  /**
   * 使用刷新令牌获取新的访问令牌 (公共方法，用于外部调用)
   */
  public async refreshTokens(refreshToken: string): Promise<LarkTokenResponse> {
    const requestBody = {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.config.appId,
      client_secret: this.config.appSecret,
    };

    console.log('🔄 Token refresh request:');
    console.log('  - URL:', `${this.config.baseUrl}/open-apis/authen/v1/oidc/refresh_access_token`);
    console.log('  - App ID:', this.config.appId);
    console.log('  - Refresh token length:', refreshToken.length);
    const appAccessToken = await this.getAppAccessToken();
    console.log('🔄 App access token:', appAccessToken);
    const response = await fetch(`${this.config.baseUrl}/open-apis/authen/v1/oidc/refresh_access_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${appAccessToken}`,
      },
      body: JSON.stringify(requestBody),
    });

    console.log('📥 Token refresh response:');
    console.log('  - Status:', response.status);
    console.log('  - Status Text:', response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ HTTP Error Response:', errorText);
      throw new Error(`Token refresh failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    console.log('📋 Refresh response data:', JSON.stringify(data, null, 2));

    if (data.code !== 0) {
      console.error('❌ Lark API Error:', data);
      throw new Error(`Token refresh failed: Code ${data.code}, Message: ${data.msg || 'Unknown error'}`);
    }

    return data;
  }

  /**
   * 交换授权码获取用户令牌 (u- 格式) - 公共方法
   */
  public async exchangeCodeForUserTokens(code: string): Promise<any> {
    // 首先获取应用访问令牌
    const appAccessToken = await this.getAppAccessToken();

    const requestBody = {
      grant_type: 'authorization_code',
      code: code,
      client_id: this.config.appId,
      client_secret: this.config.appSecret,
    };

    console.log('🔄 Public user token exchange request:');
    console.log('  - URL:', `${this.config.baseUrl}/open-apis/authen/v1/oidc/access_token`);
    console.log('  - App ID:', this.config.appId);
    console.log('  - Code length:', code.length);

    const response = await fetch(`${this.config.baseUrl}/open-apis/authen/v1/oidc/access_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${appAccessToken}`,
      },
      body: JSON.stringify(requestBody),
    });

    console.log('📥 User token exchange response:');
    console.log('  - Status:', response.status);
    console.log('  - Status Text:', response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ HTTP Error Response:', errorText);
      throw new Error(`User token exchange failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    console.log('📋 User token response data:', JSON.stringify(data, null, 2));

    if (data.code !== 0) {
      console.error('❌ Lark API Error:', data);
      throw new Error(`User token exchange failed: Code ${data.code}, Message: ${data.msg || 'Unknown error'}`);
    }

    // 返回完整的data对象，包含所有token信息
    return data.data;
  }
}
