import express, { Request, Response } from 'express';
import { createServer, Server } from 'http';
import crypto from 'crypto';
import { LarkOAuthConfig, LarkTokenResponse, LarkUserInfo, OAuthResult } from './types.js';

export class LarkOAuthClient {
  private config: LarkOAuthConfig;
  private server?: Server;
  // private pendingAuth?: {
  //   state: string;
  //   resolve: (result: OAuthResult) => void;
  //   reject: (error: Error) => void;
  // };

  constructor(config: LarkOAuthConfig) {
    this.config = {
      ...config
    };
  }

  /**
   * 启动OAuth流程，弹出浏览器获取用户授权
   */
  // async authenticate(): Promise<OAuthResult> {
  //   return new Promise((resolve, reject) => {
  //     const state = crypto.randomBytes(16).toString('hex');
      
  //     this.pendingAuth = {
  //       state,
  //       resolve,
  //       reject
  //     };

  //     this.startCallbackServer()
  //       .then(() => {
  //         const authUrl = this.buildAuthUrl(state);
  //         console.log('Opening browser for Lark OAuth...');
  //         console.log('Auth URL:', authUrl);
  //         return import('open').then(({ default: open }) => open(authUrl));
  //       })
  //       .catch(reject);
  //   });
  // }

  /**
   * 构建授权URL
   */
  // private buildAuthUrl(state: string): string {
  //   const params = new URLSearchParams({
  //     client_id: this.config.appId,
  //     redirect_uri: this.config.redirectUri,
  //     response_type: 'code',
  //     state: state
  //   });

  //   // 只有在有指定scopes时才添加scope参数
  //   if (this.config.scopes && this.config.scopes.length > 0) {
  //     params.set('scope', this.config.scopes.join(' '));
  //   }

  //   return `${this.config.baseUrl}/open-apis/authen/v1/authorize?${params.toString()}`;
  // }

  /**
   * 获取授权URL (公共方法，用于外部调用)
   */
  public getAuthorizationUrl(options: {
    redirect_uri: string;
    state: string;
    scope?: string;
  }): string {
    const params = new URLSearchParams({
      client_id: this.config.appId,
      redirect_uri: options.redirect_uri,
      response_type: 'code',
      state: options.state
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
   * 启动本地回调服务器
   */
  // private async startCallbackServer(): Promise<void> {
  //   const app = express();
    
  //   app.get('/auth', async (req: Request, res: Response) => {
  //     try {
  //       const { code, state, error } = req.query;

  //       if (error) {
  //         throw new Error(`OAuth error: ${error}`);
  //       }

  //       if (!this.pendingAuth) {
  //         throw new Error('No pending authentication');
  //       }

  //       if (state !== this.pendingAuth.state) {
  //         throw new Error('Invalid state parameter');
  //       }

  //       if (!code || typeof code !== 'string') {
  //         throw new Error('No authorization code received');
  //       }
  //       console.log('🔄 Authorization code received:', code);
  //       // 交换授权码获取token
  //       const tokens = await this.exchangeCodeForToken(code);
  //       console.log('🔄 Token exchange response:', tokens);
  //       console.log('🔄 Access token:', tokens.data.access_token);
  //       // 获取用户信息
  //       const userInfo = await this.getUserInfo(tokens.data.access_token);

  //       res.send(`
  //         <html>
  //           <body>
  //             <h1>Authorization Successful!</h1>
  //             <p>You can close this window now.</p>
  //             <script>window.close();</script>
  //           </body>
  //         </html>
  //       `);

  //       this.pendingAuth.resolve({
  //         success: true,
  //         tokens,
  //         userInfo
  //       });

  //     } catch (error) {
  //       const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
  //       res.send(`
  //         <html>
  //           <body>
  //             <h1>Authorization Failed</h1>
  //             <p>Error: ${errorMessage}</p>
  //             <script>window.close();</script>
  //           </body>
  //         </html>
  //       `);

  //       if (this.pendingAuth) {
  //         this.pendingAuth.resolve({
  //           success: false,
  //           error: errorMessage
  //         });
  //       }
  //     } finally {
  //       this.stopCallbackServer();
  //       this.pendingAuth = undefined;
  //     }
  //   });

  //   return new Promise((resolve, reject) => {
  //     const url = new URL(this.config.redirectUri);
  //     const port = parseInt(url.port) || 3000;
      
  //     this.server = createServer(app);
      
  //     this.server.listen(port, () => {
  //       console.log(`Callback server listening on port ${port}`);
  //       resolve();
  //     });

  //     this.server.on('error', reject);
  //   });
  // }

  /**
   * 停止回调服务器
   */
  // private stopCallbackServer(): void {
  //   if (this.server) {
  //     this.server.close();
  //     this.server = undefined;
  //   }
  // }

  /**
   * 交换授权码获取访问令牌
   */
  // private async exchangeCodeForToken(code: string): Promise<LarkTokenResponse> {
  //   const requestBody = {
  //     grant_type: 'authorization_code',
  //     code: code,
  //     redirect_uri: this.config.redirectUri,
  //     client_id: this.config.appId,
  //     client_secret: this.config.appSecret
  //   };

  //   // console.log('🔄 Token exchange request:');
  //   // console.log('  - URL:', `${this.config.baseUrl}/open-apis/authen/v2/oauth/token`);
  //   // console.log('  - App ID:', this.config.appId);
  //   // console.log('  - App Secret:', this.config.appSecret.substring(0, 8) + '...');
  //   // console.log('  - Redirect URI:', this.config.redirectUri);
  //   // console.log('  - Code length:', code.length);

  //   const response = await fetch(`${this.config.baseUrl}/open-apis/authen/v2/oauth/token`, {
  //     method: 'POST',
  //     headers: {
  //       'Content-Type': 'application/json',
  //       'Accept': 'application/json'
  //     },
  //     body: JSON.stringify(requestBody)
  //   });

  //   console.log('📥 Token exchange response:');
  //   console.log('  - Status:', response.status);
  //   console.log('  - Status Text:', response.statusText);

  //   if (!response.ok) {
  //     const errorText = await response.text();
  //     console.error('❌ HTTP Error Response:', errorText);
  //     throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
  //   }

  //   const data = await response.json();
  //   console.log('📋 Response data:', JSON.stringify(data, null, 2));
    
  //   // For OAuth token endpoint, Lark returns token data directly (not wrapped in code/msg/data)
  //   // Check if this is a direct token response or an error response
  //   if (data.access_token) {
  //     // Direct token response - wrap it in the expected format
  //     return {
  //       code: 0,
  //       msg: 'success',
  //       data: data
  //     };
  //   } else if (data.code !== undefined && data.code !== 0) {
  //     // Standard Lark API error response
  //     console.error('❌ Lark API Error:', data);
  //     throw new Error(`Token exchange failed: Code ${data.code}, Message: ${data.msg || 'Unknown error'}`);
  //   }

  //   return data;
  // }

  /**
   * 交换授权码获取访问令牌 (公共方法，用于外部调用)
   */
  // public async exchangeCodeForTokens(code: string, redirectUri?: string): Promise<LarkTokenResponse> {
  //   const requestBody = {
  //     grant_type: 'authorization_code',
  //     code: code,
  //     redirect_uri: redirectUri,
  //     client_id: this.config.appId,
  //     client_secret: this.config.appSecret
  //   };

  //   console.log('🔄 Public token exchange request:');
  //   console.log('  - URL:', `${this.config.baseUrl}/open-apis/authen/v2/oauth/token`);
  //   console.log('  - App ID:', this.config.appId);
  //   console.log('  - Redirect URI:', redirectUri || this.config.redirectUri);
  //   console.log('  - Code length:', code.length);

  //   const response = await fetch(`${this.config.baseUrl}/open-apis/authen/v2/oauth/token`, {
  //     method: 'POST',
  //     headers: {
  //       'Content-Type': 'application/json',
  //       'Accept': 'application/json'
  //     },
  //     body: JSON.stringify(requestBody)
  //   });

  //   console.log('📥 Token exchange response:');
  //   console.log('  - Status:', response.status);
  //   console.log('  - Status Text:', response.statusText);

  //   if (!response.ok) {
  //     const errorText = await response.text();
  //     console.error('❌ HTTP Error Response:', errorText);
  //     throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
  //   }

  //   const data = await response.json();
  //   console.log('📋 Response data:', JSON.stringify(data, null, 2));
    
  //   // For OAuth token endpoint, Lark returns token data directly (not wrapped in code/msg/data)
  //   // Check if this is a direct token response or an error response
  //   if (data.access_token) {
  //     // Direct token response - wrap it in the expected format
  //     return {
  //       code: 0,
  //       msg: 'success',
  //       data: data
  //     };
  //   } else if (data.code !== undefined && data.code !== 0) {
  //     // Standard Lark API error response
  //     console.error('❌ Lark API Error:', data);
  //     throw new Error(`Token exchange failed: Code ${data.code}, Message: ${data.msg || 'Unknown error'}`);
  //   }

  //   return data;
  // }

  /**
   * 获取用户信息
   */
  private async getUserInfo(accessToken: string): Promise<LarkUserInfo> {
    const response = await fetch(`${this.config.baseUrl}/open-apis/authen/v1/user_info`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
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
  async callApi(endpoint: string, accessToken: string, options: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    data?: any;
    headers?: Record<string, string>;
  } = {}): Promise<any> {
    const { method = 'GET', data, headers = {} } = options;
    
    const response = await fetch(`${this.config.baseUrl}${endpoint}`, {
      method,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...headers
      },
      body: data ? JSON.stringify(data) : undefined
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
      app_secret: this.config.appSecret
    };

    console.log('🔄 Getting app access token...');
    console.log('  - URL:', `${this.config.baseUrl}/open-apis/auth/v3/app_access_token/internal`);

    const response = await fetch(`${this.config.baseUrl}/open-apis/auth/v3/app_access_token/internal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(requestBody)
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
   * 交换授权码获取用户令牌 (u- 格式)
   */
  // private async exchangeCodeForUserToken(code: string): Promise<string> {
  //   // 首先获取应用访问令牌
  //   const appAccessToken = await this.getAppAccessToken();

  //   const requestBody = {
  //     grant_type: 'authorization_code',
  //     code: code,
  //     redirect_uri: this.config.redirectUri,
  //     client_id: this.config.appId,
  //     client_secret: this.config.appSecret
  //   };

  //   console.log('🔄 User token exchange request:');
  //   console.log('  - URL:', `${this.config.baseUrl}/open-apis/authen/v1/oidc/access_token`);

  //   const response = await fetch(`${this.config.baseUrl}/open-apis/authen/v1/oidc/access_token`, {
  //     method: 'POST',
  //     headers: {
  //       'Content-Type': 'application/json',
  //       'Accept': 'application/json',
  //       'Authorization': `Bearer ${appAccessToken}`
  //     },
  //     body: JSON.stringify(requestBody)
  //   });

  //   console.log('📥 User token exchange response:');
  //   console.log('  - Status:', response.status);
  //   console.log('  - Status Text:', response.statusText);

  //   if (!response.ok) {
  //     const errorText = await response.text();
  //     console.error('❌ HTTP Error Response:', errorText);
  //     throw new Error(`User token exchange failed: ${response.status} ${errorText}`);
  //   }

  //   const data = await response.json();
  //   console.log('📋 User token response data:', JSON.stringify(data, null, 2));
    
  //   if (data.code !== 0) {
  //     console.error('❌ Lark API Error:', data);
  //     throw new Error(`User token exchange failed: Code ${data.code}, Message: ${data.msg || 'Unknown error'}`);
  //   }

  //   return data.data.access_token;
  // }

  /**
   * 启动OAuth流程，获取用户令牌 (u- 格式)
   */
  // async authenticateForUserToken(): Promise<{ success: boolean; userToken?: string; userInfo?: LarkUserInfo; error?: string }> {
  //   return new Promise((resolve, reject) => {
  //     const state = crypto.randomBytes(16).toString('hex');
      
  //     this.pendingAuth = {
  //       state,
  //       resolve: (result: OAuthResult) => {
  //         // Convert OAuthResult to user token result
  //         if (result.success && result.tokens) {
  //           resolve({
  //             success: true,
  //             userToken: result.tokens.data.access_token,
  //             userInfo: result.userInfo
  //           });
  //         } else {
  //           resolve({
  //             success: false,
  //             error: result.error
  //           });
  //         }
  //       },
  //       reject
  //     };

  //     this.startUserTokenCallbackServer()
  //       .then(() => {
  //         const authUrl = this.buildAuthUrl(state);
  //         console.log('Opening browser for Lark OAuth (User Token)...');
  //         console.log('Auth URL:', authUrl);
  //         return import('open').then(({ default: open }) => open(authUrl));
  //       })
  //       .catch(reject);
  //   });
  // }

  /**
   * 启动本地回调服务器 (用户令牌版本)
   */
  // private async startUserTokenCallbackServer(): Promise<void> {
  //   const app = express();
    
  //   app.get('/auth', async (req: Request, res: Response) => {
  //     try {
  //       const { code, state, error } = req.query;

  //       if (error) {
  //         throw new Error(`OAuth error: ${error}`);
  //       }

  //       if (!this.pendingAuth) {
  //         throw new Error('No pending authentication');
  //       }

  //       if (state !== this.pendingAuth.state) {
  //         throw new Error('Invalid state parameter');
  //       }

  //       if (!code || typeof code !== 'string') {
  //         throw new Error('No authorization code received');
  //       }
  //       console.log('🔄 Authorization code received:', code);
        
  //       // 交换授权码获取用户令牌 (u- 格式)
  //       const userToken = await this.exchangeCodeForUserToken(code);
  //       console.log('🔄 User token received:', userToken);
        
  //       // 使用用户令牌获取用户信息
  //       const userInfo = await this.getUserInfo(userToken);

  //       res.send(`
  //         <html>
  //           <body>
  //             <h1>Authorization Successful!</h1>
  //             <p>User token obtained (u- format)</p>
  //             <p>You can close this window now.</p>
  //             <script>window.close();</script>
  //           </body>
  //         </html>
  //       `);

  //       this.pendingAuth.resolve({
  //         success: true,
  //         tokens: {
  //           code: 0,
  //           msg: 'success',
  //           data: {
  //             access_token: userToken,
  //             token_type: 'Bearer',
  //             expires_in: 7200,
  //             scope: 'user'
  //           }
  //         },
  //         userInfo
  //       });

  //     } catch (error) {
  //       const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
  //       res.send(`
  //         <html>
  //           <body>
  //             <h1>Authorization Failed</h1>
  //             <p>Error: ${errorMessage}</p>
  //             <script>window.close();</script>
  //           </body>
  //         </html>
  //       `);

  //       if (this.pendingAuth) {
  //         this.pendingAuth.resolve({
  //           success: false,
  //           error: errorMessage
  //         });
  //       }
  //     } finally {
  //       this.stopCallbackServer();
  //       this.pendingAuth = undefined;
  //     }
  //   });

  //   return new Promise((resolve, reject) => {
  //     const url = new URL(this.config.redirectUri);
  //     const port = parseInt(url.port) || 3000;
      
  //     this.server = createServer(app);
      
  //     this.server.listen(port, () => {
  //       console.log(`User token callback server listening on port ${port}`);
  //       resolve();
  //     });

  //     this.server.on('error', reject);
  //   });
  // }

  /**
   * 使用刷新令牌获取新的访问令牌 (公共方法，用于外部调用)
   */
  public async refreshTokens(refreshToken: string): Promise<LarkTokenResponse> {
    const requestBody = {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.config.appId,
      client_secret: this.config.appSecret
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
        'Accept': 'application/json',
        'Authorization': `Bearer ${appAccessToken}`
      },
      body: JSON.stringify(requestBody)
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
      client_secret: this.config.appSecret
    };

    console.log('🔄 Public user token exchange request:');
    console.log('  - URL:', `${this.config.baseUrl}/open-apis/authen/v1/oidc/access_token`);
    console.log('  - App ID:', this.config.appId);
    console.log('  - Code length:', code.length);

    const response = await fetch(`${this.config.baseUrl}/open-apis/authen/v1/oidc/access_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${appAccessToken}`
      },
      body: JSON.stringify(requestBody)
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