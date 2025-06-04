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

    console.log(`[DEBUG] Authorization request from mcp-remote:`);
    console.log(`  - client_id: ${client_id}`);
    console.log(`  - redirect_uri: ${redirect_uri}`);
    console.log(`  - state: ${state}`);

    // Validate redirect_uri format before processing
    const decodedRedirectUri = decodeURIComponent(redirect_uri as string);
    console.log(`[DEBUG] Decoded redirect_uri: ${decodedRedirectUri}`);

    // Predefined allowed redirect_uri patterns
    const allowedRedirectPatterns = [
      /^http:\/\/localhost:\d+\/oauth\/callback$/, // localhost with any port, /oauth/callback path
      /^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/, // 127.0.0.1 with any port, /oauth/callback path
      /^http:\/\/localhost:\d+\/callback$/, // localhost with any port, /callback path
      /^https:\/\/[\w\-\.]+\.[\w]+\/oauth\/callback$/, // HTTPS domains for production (optional)
    ];

    // Check if redirect_uri matches any allowed pattern
    const isValidRedirectUri = allowedRedirectPatterns.some((pattern) => pattern.test(decodedRedirectUri));

    if (!isValidRedirectUri) {
      console.error(`[ERROR] Invalid redirect_uri format: ${decodedRedirectUri}`);
      console.error(`[ERROR] Allowed patterns:`);
      console.error(`  - http://localhost:[port]/oauth/callback`);
      console.error(`  - http://127.0.0.1:[port]/oauth/callback`);
      console.error(`  - http://localhost:[port]/callback`);
      res.status(400).json({
        error: 'invalid_redirect_uri',
        error_description: 'Redirect URI does not match allowed patterns',
      });
      return;
    }

    console.log(`[DEBUG] ✅ redirect_uri format validation passed`);

    if (!this.clients.has(client_id as string)) {
      console.log(`[WARNING] Client not found: ${client_id}, auto-registering for development`);

      // Auto-register the client for development/testing purposes
      const clientInfo: OAuthClientInfo = {
        client_id: client_id as string,
        client_name: 'Auto-registered MCP Client',
        redirect_uris: [
          'http://localhost:3334/callback',
          decodedRedirectUri, // Use already decoded redirect_uri
        ],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none', // Public client
      };

      this.clients.set(client_id as string, clientInfo);
      console.log(`[INFO] Auto-registered client: ${client_id}`);
    }

    // Use mcp-remote's redirect_uri (this is where Lark should redirect after authorization)
    const mcpRedirectUri = decodedRedirectUri;

    // Validate that the mcp-remote's redirect_uri is allowed
    const client = this.clients.get(client_id as string);
    if (!client?.redirect_uris.includes(mcpRedirectUri)) {
      console.log(`[ERROR] Invalid redirect_uri: ${mcpRedirectUri} for client: ${client_id}`);
      console.log(`[DEBUG] Allowed redirect_uris:`, client?.redirect_uris);
      res.status(400).json({ error: 'invalid_redirect_uri' });
      return;
    }

    // Ensure state is not undefined
    const authState = (state as string) || crypto.randomUUID();

    console.log(`[DEBUG] Constructing Lark authorization URL...`);
    console.log(`[DEBUG] Using mcp-remote redirect_uri: ${mcpRedirectUri}`);
    console.log(`[DEBUG] Using state: ${authState}`);

    try {
      const larkScopes = larkConfig.scopes.length > 0 ? larkConfig.scopes.join(' ') : 'contact:user.id:readonly'; // Use minimal scope for testing

      // Construct Lark's actual authorization URL
      // Use mcp-remote's redirect_uri so Lark redirects directly to mcp-remote
      const larkAuthUrl = this.larkOAuthClient.getAuthorizationUrl({
        redirect_uri: mcpRedirectUri, // Use mcp-remote's redirect URI
        state: authState, // Ensure state is not undefined
        scope: larkScopes, // Use scope from config
      });

      console.log(`[DEBUG] Redirecting to Lark authorization URL:`);
      console.log(`  - URL: ${larkAuthUrl}`);
      console.log(`  - This will redirect user to Lark for actual authorization`);
      console.log(`  - After user approval, Lark will redirect to: ${mcpRedirectUri}`);

      // Redirect user's browser to Lark's authorization page
      res.redirect(larkAuthUrl);
    } catch (error) {
      console.error('[ERROR] Failed to construct Lark authorization URL:', error);
      res
        .status(500)
        .json({ error: 'internal_server_error', error_description: 'Failed to construct authorization URL' });
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