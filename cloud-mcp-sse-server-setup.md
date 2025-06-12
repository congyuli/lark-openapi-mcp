Cloud MCP SSE Server Connection Guide:

# 1. Prerequisites
Ensure you have access to the cloud-deployed MCP SSE server URL and necessary credentials.

# 2. MCP Server Config on MCP Host
Use Visual Studio Code as Example
``` json
{
  "mcpServers": {
    "mcp-lark-cloud": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://your-cloud-server.com/sse",
        "4321",
      ],
      "env": {
        "MCP_REMOTE_CONFIG_DIR": "/Users/your-username/.mcp-auth/mcp-lark-cloud"
      }
    }
  }
}
```

#### Configuration Parameters

| Parameter | Description |
|-----------|-------------|
| `type` | Communication type, use `stdio` |
| `command` | Execution command, use `npx` |
| `args[0]` | `-y` Auto-confirm installation |
| `args[1]` | `mcp-remote` Remote MCP client tool |
| `args[2]` | Cloud SSE endpoint URL (replace with your actual cloud server URL) |
| `args[3]` | Local proxy port (customizable) |
| `MCP_REMOTE_CONFIG_DIR` | Authentication configuration storage directory |

**Note**: Remove `--allow-http` flag when connecting to HTTPS cloud servers for better security.

# 3. Cloud Server URL Configuration
Replace `https://your-cloud-server.com/sse` with your actual cloud server URL. Common formats:
- `https://your-domain.com/sse`
- `https://your-server-ip:3000/sse`
- `https://your-app.herokuapp.com/sse` (for Heroku deployments)
- `https://your-app.vercel.app/sse` (for Vercel deployments)

# 4. Initial Authentication Setup
When running the MCP Server, it will create a folder in the configured directory to store tokens. The default path is `~/.mcp-auth`.

## Start Visual Studio Code
When starting for the first time, `mcp-remote` will automatically guide through the OAuth authentication process:

1. Open browser to authentication page (hosted on your cloud server)
2. Complete Lark authorization login
3. Automatically save authentication information to configuration directory

## Authentication File Structure
```
~/.mcp-auth/mcp-lark-cloud/
    └── mcp-remote-0.1.9
        ├── [hash]_client_info.json
        ├── [hash]_code_verifier.txt
        ├── [hash]_lock.json
        └── [hash]_tokens.json # File that stores tokens
```

# 5. Network and Security Considerations

## HTTPS Requirements
- Ensure your cloud server supports HTTPS
- Remove `--allow-http` flag from the configuration for production use
- Use proper SSL certificates

## Firewall and Port Configuration
- Ensure the SSE endpoint port is accessible from your client
- Configure proper firewall rules on your cloud server
- The local proxy port (4321 in example) should be available on your local machine

## Authentication Flow
- The OAuth flow will redirect to your cloud server's authentication endpoints
- Ensure all OAuth redirect URLs are properly configured on your cloud server
- The cloud server should handle token refresh automatically

# 6. Troubleshooting

## Connection Issues
1. **Cannot connect to server**: Verify the cloud server URL and ensure it's accessible
2. **SSL certificate errors**: Ensure proper HTTPS setup on your cloud server
3. **Authentication failures**: Check OAuth configuration on the cloud server

## Debug Mode
Enable debug logging by adding `--debug` to the args array to see detailed connection information.

## Log Locations
- Client-side logs: Check Visual Studio Code's output panel
- Server-side logs: Check your cloud server deployment logs

# 7. Environment-Specific Configurations

## Development Environment
```json
{
  "mcpServers": {
    "mcp-lark-dev": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://dev-server.your-domain.com/sse",
        "4321",
        "--debug"
      ],
      "env": {
        "MCP_REMOTE_CONFIG_DIR": "/Users/your-username/.mcp-auth/mcp-lark-dev"
      }
    }
  }
}
```

## Production Environment
```json
{
  "mcpServers": {
    "mcp-lark-prod": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://prod-server.your-domain.com/sse",
        "4321"
      ],
      "env": {
        "MCP_REMOTE_CONFIG_DIR": "/Users/your-username/.mcp-auth/mcp-lark-prod"
      }
    }
  }
}
```

# 8. Important Notes

1. **Server Availability**: Ensure your cloud server is running and accessible before starting the MCP client.

2. **Token Management**: Auth tokens will be refreshed automatically when receiving a 401 response and a refresh token exists.

3. **Multiple Environments**: You can configure multiple cloud servers by using different configuration names and directories.

4. **Security Best Practices**:
   - Use HTTPS in production
   - Regularly rotate authentication tokens
   - Monitor server access logs
   - Keep the `mcp-remote` client updated

5. **Backup Configuration**: Keep a backup of your authentication configuration directory in case of client machine issues. 