Local MCP SSE Server Guide:
# 1. Git clone repo & switch branch
```sh
git clone https://github.com/storehubnet/lark-openapi-mcp.git
# switch branch
git checkout mcp-remote-integration
```
# 2. Create `.env`
```sh
cp example.env .env
```
Then fill up your configurations.

# 3. Run Local MCP SSE Server
```sh
yarn install
yarn build
yarn start mcp --mode sse --token-mode user_access_token
# or you can choose tools
# yarn start mcp --mode sse --token-mode user_access_token --host 0.0.0.0 -t preset.calendar.default,calendar.v4.calendarAcl.list
```

# 4. MCP Server Config on MCP Host
Use Visual Studio Code as Example
``` json
{
  "mcpServers": {
    "mcp-lark": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "http://localhost:3000/sse",
        "4321",
        "--allow-http",
        "--debug"
      ],
      "env": {
        "MCP_REMOTE_CONFIG_DIR": "/Users/your-username/.mcp-auth/mcp-lark"
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
| `args[2]` | OAuth server SSE endpoint URL |
| `args[3]` | Local proxy port (customizable) |
| `args[4]` | `--allow-http` Allow HTTP connections (development environment) |
| `args[5]` | `--debug` Enable debug logging |
| `MCP_REMOTE_CONFIG_DIR` | Authentication configuration storage directory |



# 5. Initial Authentication Setup
When running the MCP Server, it will create a folder in the configured directory to store tokens. The default path is `~/.mcp-auth`.

## Start Visual Studio Code
When starting for the first time, `mcp-remote` will automatically guide through the OAuth authentication process:

1. Open browser to authentication page
2. Complete Lark authorization login
3. Automatically save authentication information to configuration directory

## Authentication File Structure
```
~/.mcp-auth/mcp-lark/
    └── mcp-remote-0.1.9
        ├── 4b9d084fd6f09574c74c9e57f04c73cc_client_info.json
        ├── 4b9d084fd6f09574c74c9e57f04c73cc_code_verifier.txt
        ├── 4b9d084fd6f09574c74c9e57f04c73cc_lock.json
        └── 4b9d084fd6f09574c74c9e57f04c73cc_tokens.json # File that stores tokens
```

# 6. Attentions
1. Tools and scopes must match:
For example, if you need calendar tools, you must add both the tool definitions in the start command AND the related scopes (e.g. calendar:calendar:readonly) in the `.env` file.

2. Auth Token will only be refreshed when receiving a 401 response and a refresh token exists.




