import { Request, Response } from 'express';
import crypto from 'crypto';
import { LarkOAuthClient } from '../lark/oauth-client';
import { larkConfig } from '../config/env';
import { OAuthClientInfo, TokenResponse } from '../shared/types';

export class OAuthServer {
  private clients = new Map<string, OAuthClientInfo>();
  private larkOAuthClient: LarkOAuthClient;

  constructor() {
    this.larkOAuthClient = new LarkOAuthClient(larkConfig);
  }

  // OAuth Server Metadata Discovery (RFC 8414)
  getServerMetadata(req: Request): any {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    
    return {
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/authorize`,
      token_endpoint: `${baseUrl}/token`,
      registration_endpoint: `${baseUrl}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_basic'],
      scopes_supported: ['mcp'],
      subject_types_supported: ['public'],
    };
  }

  // OAuth 客户端注册端点 (Dynamic Client Registration - RFC 7591)
  registerClient(req: Request, res: Response): void {
    const clientId = crypto.randomUUID();
    const clientInfo: OAuthClientInfo = {
      client_id: clientId,
      client_name: req.body.client_name || 'MCP Client',
      redirect_uris: req.body.redirect_uris || ['http://localhost:3334/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none', // Public client
      ...req.body,
    };

    this.clients.set(clientId, clientInfo);
    console.log(`[DEBUG] Registered client: ${clientId}, total clients: ${this.clients.size}`);
    res.json(clientInfo);
  }

  // OAuth 授权端点
  async handleAuthorize(req: Request, res: Response): Promise<void> {
    // 打印OAuth授权请求的头部信息
    console.log(`[DEBUG] === OAuth Authorize Headers ===`);
    console.log(`[DEBUG] OAuth Request URL: ${req.method} ${req.url}`);
    console.log(`[DEBUG] OAuth Request Headers:`, JSON.stringify(req.headers, null, 2));
    console.log(`[DEBUG] OAuth Query Parameters:`, req.query);
    console.log(`[DEBUG] === End OAuth Authorize Headers ===`);
    
    const { client_id, redirect_uri, code_challenge, response_type, state, scope } = req.query;

    // 1. 打印客户端传递的redirect_uri
    console.log(`[DEBUG] Client provided redirect_uri (raw):`, redirect_uri);
    const decodedRedirectUri = decodeURIComponent(redirect_uri as string);
    console.log(`[DEBUG] Client provided redirect_uri (decoded):`, decodedRedirectUri);

    console.log(`[DEBUG] Authorization request from mcp-remote:`);
    console.log(`  - client_id: ${client_id}`);
    console.log(`  - redirect_uri: ${redirect_uri}`);
    console.log(`  - state: ${state}`);

    if (!redirect_uri) {
      res.status(400).json({
        error: 'invalid_redirect_uri',
        error_description: 'Missing redirect_uri',
      });
      return;
    }

    if (!this.clients.has(client_id as string)) {
      console.log(`[WARNING] Client not found: ${client_id}, auto-registering for development`);
      const clientInfo: OAuthClientInfo = {
        client_id: client_id as string,
        client_name: 'Auto-registered MCP Client',
        redirect_uris: [
          'http://localhost:3334/callback',
          decodedRedirectUri,
        ],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      };
      this.clients.set(client_id as string, clientInfo);
      console.log(`[INFO] Auto-registered client: ${client_id}`);
    }

    // 2. Lark Server的redirect_uri固定为MCP Server自己的/auth/callback
    const mcpCallbackBase = `${req.protocol}://${req.get('host')}/auth/callback`;
    console.log(`[DEBUG] MCP Server callback redirect_uri for Lark:`, mcpCallbackBase);

    // 3. 客户端redirect_uri通过state传递
    const stateObj = {
      client_state: state,
      client_redirect_uri: decodedRedirectUri
    };
    const encodedState = Buffer.from(JSON.stringify(stateObj)).toString('base64');

    try {
      const larkScopes = larkConfig.scopes.length > 0 ? larkConfig.scopes.join(' ') : 'contact:user.id:readonly';
      const larkAuthUrl = this.larkOAuthClient.getAuthorizationUrl({
        redirect_uri: mcpCallbackBase,
        state: encodedState,
        scope: larkScopes,
      });
      console.log(`[DEBUG] Redirecting to Lark authorization URL:`);
      console.log(`  - URL: ${larkAuthUrl}`);
      console.log(`  - After user approval, Lark will redirect to: ${mcpCallbackBase}`);
      res.redirect(larkAuthUrl);
    } catch (error) {
      console.error('[ERROR] Failed to construct Lark authorization URL:', error);
      res.status(500).json({ error: 'internal_server_error', error_description: 'Failed to construct authorization URL' });
    }
  }

  // OAuth 用户令牌端点 (获取 u- 格式的用户令牌)
  async handleToken(req: Request, res: Response): Promise<void> {
    // 打印OAuth令牌请求的头部信息
    console.log(`[DEBUG] === OAuth Token Headers ===`);
    console.log(`[DEBUG] Token Request URL: ${req.method} ${req.url}`);
    console.log(`[DEBUG] Token Request Headers:`, JSON.stringify(req.headers, null, 2));
    console.log(`[DEBUG] Token Authorization: ${req.headers.authorization || 'NOT_FOUND'}`);
    console.log(`[DEBUG] Token Request Body:`, req.body);
    console.log(`[DEBUG] === End OAuth Token Headers ===`);
    
    console.log(`[DEBUG] User token request body:`, req.body);

    const { grant_type, code, client_id, code_verifier, refresh_token } = req.body;

    console.log(`[DEBUG] User token request from mcp-remote:`);
    console.log(`  - grant_type: ${grant_type}`);
    console.log(`  - client_id: ${client_id}`);

    if (grant_type === 'authorization_code') {
      console.log(`  - code: ${code ? code.substring(0, 20) + '...' : 'undefined'}`);
      console.log(`[DEBUG] Exchanging Lark authorization code for user token (u- format)...`);

      try {
        // Use LarkOAuthClient to exchange the Lark authorization code for user token (u- format)
        const tokenData = await this.larkOAuthClient.exchangeCodeForUserTokens(code);
        // Calculate expires_at based on expires_in
        const now = Math.floor(Date.now() / 1000); // Current time in seconds
        const expires_at = now + (tokenData.expires_in || 7200); // Default to 7200 if expires_in not provided
        // Convert expires_at to ISO string format for consistent date handling
        tokenData.expires_at = new Date(expires_at * 1000).toISOString();

        // Return the complete token data to mcp-remote
        const responseToMcpRemote: TokenResponse = {
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          token_type: tokenData.token_type || 'Bearer',
          expires_in: tokenData.expires_in || 7200,
          expires_at: tokenData.expires_at,
          scope: tokenData.scope,
        };

        console.log('[DEBUG] Sending complete token data to mcp-remote:', {
          access_token: responseToMcpRemote.access_token?.substring(0, 20) + '...',
          refresh_token: responseToMcpRemote.refresh_token?.substring(0, 20) + '...',
          token_type: responseToMcpRemote.token_type,
          expires_in: responseToMcpRemote.expires_in,
          expires_at: responseToMcpRemote.expires_at,
          scope: responseToMcpRemote.scope,
        });

        res.json(responseToMcpRemote);
      } catch (error) {
        console.error('[ERROR] Failed to exchange Lark authorization code for user token:', error);
        res.status(400).json({
          error: 'invalid_grant',
          error_description: error instanceof Error ? error.message : 'User token exchange failed',
        });
      }
    } else if (grant_type === 'refresh_token') {
      console.log(`  - refresh_token: ${refresh_token ? refresh_token.substring(0, 20) + '...' : 'undefined'}`);
      console.log(`[DEBUG] Refreshing Lark user token (u- format)...`);

      if (!refresh_token) {
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'refresh_token parameter is required',
        });
        return;
      }

      try {
        // Use LarkOAuthClient to refresh the user token
        const refreshedTokenData = await this.larkOAuthClient.refreshTokens(refresh_token);

        // Calculate expires_at for refreshed token
        const now = Math.floor(Date.now() / 1000);
        const expires_at = now + (refreshedTokenData.data.expires_in || 7200);

        // Return the refreshed token data to mcp-remote
        const responseToMcpRemote: TokenResponse = {
          access_token: refreshedTokenData.data.access_token,
          refresh_token: refreshedTokenData.data.refresh_token,
          token_type: refreshedTokenData.data.token_type || 'Bearer',
          expires_in: refreshedTokenData.data.expires_in || 7200,
          expires_at: new Date(expires_at * 1000).toISOString(),
          scope: refreshedTokenData.data.scope,
        };

        console.log('[DEBUG] Sending refreshed token data to mcp-remote:', {
          access_token: responseToMcpRemote.access_token?.substring(0, 20) + '...',
          refresh_token: responseToMcpRemote.refresh_token?.substring(0, 20) + '...',
          token_type: responseToMcpRemote.token_type,
          expires_in: responseToMcpRemote.expires_in,
          expires_at: responseToMcpRemote.expires_at,
          scope: responseToMcpRemote.scope,
        });

        res.json(responseToMcpRemote);
      } catch (error) {
        console.error('[ERROR] Failed to refresh Lark user token:', error);
        res.status(400).json({
          error: 'invalid_grant',
          error_description: error instanceof Error ? error.message : 'Token refresh failed',
        });
      }
    } else {
      res.status(400).json({ error: 'unsupported_grant_type' });
    }
  }
} 