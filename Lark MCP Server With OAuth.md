# Lark MCP OAuth 服务器

基于Lark开放平台的 MCP (Model Context Protocol) SSE 服务器，集成 OAuth 2.0 认证流程。

## 功能特性

### 🔐 OAuth 2.0 认证
- **完整的 OAuth 2.0 流程**: 支持授权码模式和刷新令牌
- **Lark平台集成**: 与Lark开放平台无缝集成，获取用户访问令牌
- **动态客户端注册**: 支持 RFC 7591 动态客户端注册协议
- **安全令牌验证**: 实时验证Lark用户令牌的有效性
- **自动令牌刷新**: 支持访问令牌的自动刷新机制

### 🌐 MCP SSE 服务器
- **Server-Sent Events**: 基于 SSE 的长连接通信
- **会话管理**: 支持多客户端并发连接和会话隔离
- **实时消息处理**: 双向消息传递（GET建立连接，POST发送消息）
- **连接监控**: 心跳检测和连接状态管理
- **错误处理**: 优雅的错误处理和连接恢复

### 🛡️ 安全特性
- **Bearer Token 认证**: 基于Lark用户令牌的API访问控制
- **重定向URI验证**: 严格的重定向URI格式验证
- **CORS支持**: 跨域资源共享配置
- **请求日志**: 详细的请求和认证日志记录

## 快速开始

### 环境配置

创建 `.env` 文件并配置Lark应用信息：`cp env.example .env`

```env
LARK_APP_ID=your_app_id
LARK_APP_SECRET=your_app_secret
LARK_BASE_URL=https://open.feishu.cn
LARK_SCOPES=contact:user.id:readonly
```

### 启动服务器

```bash
# 或使用配置文件
npm run start mcp --config config.json --mode sse

# 开发环境启动（用户令牌模式）
yarn dev mcp --mode sse --token-mode user_access_token

# 生产环境启动
yarn build
yarn start mcp --mode sse --token-mode user_access_token
```

## OAuth 2.0 端点

### 服务发现
```
GET /.well-known/oauth-authorization-server
```
返回 OAuth 服务器元数据信息。

### 客户端注册 (Optional)
```
POST /register
Content-Type: application/json

{
  "client_name": "My MCP Client",
  "redirect_uris": ["http://localhost:3334/callback"]
}
```

### 授权端点
```
GET /authorize?client_id={id}&redirect_uri={uri}&response_type=code&state={state}&code_challenge={challenge}
```
重定向到Lark授权页面进行用户授权。

### 令牌端点
```
POST /token
Content-Type: application/x-www-form-urlencoded

# 授权码模式
grant_type=authorization_code&code={auth_code}&client_id={id}&code_verifier={verifier}

# 刷新令牌模式  
grant_type=refresh_token&refresh_token={refresh_token}&client_id={id}
```

## MCP SSE 端点

### 建立SSE连接
```
GET /sse
Authorization: Bearer {user_access_token}
```
建立SSE长连接，返回会话ID和消息端点。

### 发送消息
```
POST /messages?sessionId={session_id}
Authorization: Bearer {user_access_token}
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "method": "tool/call",
  "params": { ... }
}
```

### 健康检查
```
GET /health
```
返回服务器状态信息。

## 认证流程

### 1. 用户授权
```javascript
const authUrl = `http://localhost:3000/authorize?` +
  `client_id=${client_id}&` +
  `redirect_uri=${encodeURIComponent(redirect_uri)}&` +
  `response_type=code&` +
  `state=${state}&` +
  `code_challenge=${code_challenge}`;

open(authUrl)
```

### 2. 获取访问令牌
```javascript
const tokenResponse = await fetch('http://localhost:3000/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code: authorization_code,
    client_id: client_id,
    code_verifier: code_verifier
  })
});
const { access_token, refresh_token } = await tokenResponse.json();
```

### 4. 建立MCP连接
```javascript
const eventSource = new EventSource('http://localhost:3000/sse', {
  headers: { 'Authorization': `Bearer ${access_token}` }
});

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('MCP Message:', data);
};
```

## 安全注意事项

### 重定向URI验证
服务器只允许以下格式的重定向URI：
- `http://localhost:[port]/oauth/callback`
- `http://localhost:[port]/auth`
- `https://[domain]/oauth/callback` (生产环境)

### 令牌安全
- 访问令牌具有有效期限制
  - user access token is 2 hours
  - refresh token is 30 days
- 支持令牌自动刷新机制
- 实时验证令牌有效性
- 安全的Bearer Token传输

### CORS配置
```javascript
// 允许的跨域配置
origin: '*',
credentials: true,
methods: ['GET', 'POST', 'OPTIONS'],
allowedHeaders: ['Authorization', 'Content-Type', 'MCP-Protocol-Version']
```

## 错误处理

### OAuth错误
- `invalid_client`: 客户端ID无效
- `invalid_grant`: 授权码或刷新令牌无效
- `invalid_redirect_uri`: 重定向URI格式错误
- `unsupported_grant_type`: 不支持的授权类型

### MCP错误
- `unauthorized`: 缺少或无效的Bearer Token
- `invalid_token`: Lark令牌验证失败
- `session_not_found`: SSE会话不存在

## 调试和监控

### 日志级别
服务器提供详细的调试日志：
- `[REQUEST]`: HTTP请求日志
- `[DEBUG]`: 调试信息和状态
- `[INFO]`: 一般信息
- `[WARNING]`: 警告信息  
- `[ERROR]`: 错误信息

### 连接监控
- 实时SSE连接数统计
- 会话生命周期跟踪
- 心跳检测和超时处理
- 优雅的连接关闭处理

## 集成示例

### 与 mcp-remote 集成
本服务器专为与 `mcp-remote` 客户端集成而设计，支持完整的OAuth认证流程和MCP协议通信。



## 技术架构

- **框架**: Express.js + TypeScript
- **协议**: OAuth 2.0 + Server-Sent Events  
- **认证**: Lark开放平台用户令牌
- **通信**: JSON-RPC 2.0 over SSE
- **安全**: Bearer Token + CORS + URI验证

## MCP 客户端配置

### Claude Desktop 配置

在 Claude Desktop 中使用Lark MCP OAuth 服务器，需要在配置文件中添加以下配置：

#### 配置文件位置
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/claude/claude_desktop_config.json`

#### 配置示例

```json
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

#### 配置参数说明

| 参数 | 说明 |
|------|------|
| `type` | 通信类型，使用 `stdio` |
| `command` | 执行命令，使用 `npx` |
| `args[0]` | `-y` 自动确认安装 |
| `args[1]` | `mcp-remote` 远程MCP客户端工具 |
| `args[2]` | OAuth服务器SSE端点URL |
| `args[3]` | 本地代理端口 (可自定义) |
| `args[4]` | `--allow-http` 允许HTTP连接（开发环境） |
| `args[5]` | `--debug` 启用调试日志 |
| `MCP_REMOTE_CONFIG_DIR` | 认证配置存储目录 |

### 1. 首次认证配置
运行MCP Server，会在配置的目录下创建文件夹存放tokens，默认路径是`~/.mcp-auth`。

#### 2. 启动 Visual Studio Code
首次启动时，`mcp-remote` 会自动引导 OAuth 认证流程：

1. 打开浏览器到认证页面
2. 完成Lark授权登录
3. 自动保存认证信息到配置目录

#### 3. 认证文件结构
```
~/.mcp-auth/mcp-lark/
    └── mcp-remote-0.1.9
        ├── 4b9d084fd6f09574c74c9e57f04c73cc_client_info.json
        ├── 4b9d084fd6f09574c74c9e57f04c73cc_code_verifier.txt
        ├── 4b9d084fd6f09574c74c9e57f04c73cc_lock.json
        └── 4b9d084fd6f09574c74c9e57f04c73cc_tokens.json # 存放token的文件
```

### 生产环境配置

#### HTTPS 配置
生产环境建议使用HTTPS：

```json
{
  "mcpServers": {
    "mcp-lark-prod": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://your-domain.com/sse",
        "4321"
      ],
      "env": {
        "MCP_REMOTE_CONFIG_DIR": "/Users/your-username/.mcp-auth/mcp-lark-prod"
      }
    }
  }
}
```


### 故障排除

#### 常见问题

1. **认证失败**
   ```bash
   # 清除认证缓存
   rm -rf ~/.mcp-auth/mcp-lark
   # 重启 Claude Desktop 重新认证
   ```

2. **连接超时**
   ```bash
   # 检查服务器状态
   curl http://localhost:3000/health
   ```

3. **端口冲突**
   ```json
   // 修改本地代理端口
   "args": ["...", "4322", "..."]
   ```


## MCP-Remote 调用 Lark MCP SSE Server 时序图

```
mcp-remote客户端                    Lark MCP SSE服务器                     Lark Server                      用户浏览器
      |                                    |                                    |                              |
      |                                    |                                    |                              |
═══════════════════════ OAuth 2.0 授权码流程 ═══════════════════════              |                              |
      | 1. GET /authorize?                 |                                    |                              |
      |    client_id=xxx&                  |                                    |                              |
      |    redirect_uri=xxx&               |                                    |                              |
      |    code_challenge=xxx&             |                                    |                              |
      |    response_type=code              |                                    |                              |
      |---------------------------------->|                                     |                              |
      |                                    |                                    |                              |
      |                                    | 2. 重定向到授权页面                   |                              |
      |                                    |------------------------------------------------------------------>|
      |                                    |                                    |                              |
      |                                    |                                    |                              |
      | 3. 用户同意授权，重定向回调，携带authorization_code                          |                              |
      |<-------------------------------------------------------------------------------------------------------|
      |                                    |                                    |                              |
═══════════════════════ 令牌获取阶段 ═══════════════════════                      |                              |
      |                                    |                                    |                              |
      | 4. POST /token                     |                                    |                              |
      |     grant_type=authorization_code  |                                    |                              |
      |     code=xxx                       |                                    |                              |
      |     code_verifier=xxx              |                                    |                              |
      |----------------------------------->|                                    |                              |
      |                                    |                                    |                              |
      |                                    | 5. 向Lark Server验证授权码并获取token |                              |
      |                                    |     POST /oauth/v2/access_token    |                              |
      |                                    |     code=xxx&                      |                              |
      |                                    |     client_id=xxx&                 |                              |
      |                                    |     client_secret=xxx              |                              |
      |                                    |----------------------------------->|                              |
      |                                    |                                    |                              |
      |                                    | 6. 返回Lark用户access_token         |                              |
      |                                    |     {                              |                              |
      |                                    |       access_token: "u-xxx",       |                              |
      |                                    |       refresh_token: "xxx",        |                              |
      |                                    |       expires_in: 7200             |                              |
      |                                    |     }                              |                              |
      |                                    |<-----------------------------------|                              |
      |                                    |                                    |                              |
      | 7. 返回access_token和refresh_token  |                                    |                              |
      |     {                              |                                    |                              |
      |       access_token: "u-xxx",       |                                    |                              |
      |       refresh_token: "xxx",        |                                    |                              |
      |       expires_in: 7200             |                                    |                              |
      |     }                              |                                    |                              |
      |<---------------------------------- |                                    |                              |
      |                                    |                                    |                              |
      | 8. 保存tokens到本地缓存              |                                    |                              |
      |     (~/.mcp-auth/)                 |                                    |                              |
      |                                    |                                    |                              |
═══════════════════════ MCP SSE 连接阶段 ═══════════════════════                  |                              |
      |                                    |                                    |                              |
      | 9. GET /sse                        |                                    |                              |
      |     Authorization: Bearer <token>  |                                    |                              |
      |----------------------------------->|                                    |                              |
      |                                    |                                    |                              |
      |                                    | 10. 验证token (authenticateToken)  |                              |
      |                                    |     GET /open-apis/authen/v1/user_info                            |
      |                                    |     Authorization: Bearer <token>  |                              |
      |                                    |----------------------------------->|                              |
      |                                    |                                    |                              |
      |                                    | 11. 返回用户信息                     |                              |
      |                                    |     {code: 0, data: {sub: "xxx"}}  |                              |
      |                                    |<-----------------------------------|                              |
      |                                    |                                    |                              |
      |                                    | 12. 创建MCP Server实例              |                              |
      |                                    |     - 注册echo工具                  |                              |
      |                                    |     - 创建SSE Transport             |                              |
      |                                    |                                    |                              |
      | 13. 建立SSE长连接                    |                                    |                              |
      |    Content-Type: text/event-stream |                                    |                              |
      |<---------------------------------- |                                    |                              |
═══════════════════════ MCP 工具调用阶段 ═══════════════════════                                              |
      |                                    |                                    |                              |
      | 14. POST /messages?sessionId=xxx   |                                    |                              |
      |     Authorization: Bearer <token>  |                                    |                              |
      |     {                              |                                    |                              |
      |       jsonrpc: "2.0",              |                                    |                              |
      |       method: "tools/list"         |                                    |                              |
      |     }                              |                                    |                              |
      |----------------------------------> |                                    |                              |
      |                                    |                                    |                              |
      | 15. 返回工具列表                     |                                    |                              |
      |     {                              |                                    |                              |
      |       tools: [{                    |                                    |                              |
      |         name: "echo",              |                                    |                              |
      |         description: "Echo back..."|                                    |                              |
      |       }]                           |                                    |                              |
      |     }                              |                                    |                              |
      |<---------------------------------- |                                    |                              |
      |                                    |                                    |                              |
      | 16. POST /messages?sessionId=xxx   |                                    |                              |
      |     Authorization: Bearer <token>  |                                    |                              |
      |     {                              |                                    |                              |
      |       jsonrpc: "2.0",              |                                    |                              |
      |       method: "tools/call",        |                                    |                              |
      |       params: {                    |                                    |                              |
      |         name: "echo",              |                                    |                              |
      |         arguments: {message: "hi"} |                                    |                              |
      |       }                            |                                    |                              |
      |     }                              |                                    |                              |
      |----------------------------------> |                                    |                              |
      |                                    |                                    |                              |
      | 17. 返回工具执行结果                  |                                    |                              |
      |     {                              |                                    |                              |
      |       content: [{                  |                                    |                              |
      |         type: "text",              |                                    |                              |
      |         text: "Echo: hi"           |                                    |                              |
      |       }]                           |                                    |                              |
      |     }                              |                                    |                              |
      |<---------------------------------- |                                    |                              |
      |                                    |                                    |                              |
═══════════════════════ 保持连接阶段 (可选) ═════════════════════════════                                         |
      |                                    |                                    |                              |
      | 18. 接收ping保活消息 (每15秒)        |                                     |                              |
      |     event: ping                    |                                    |                              |
      |     data: <timestamp>              |                                    |                              |
      |<---------------------------------- |                                    |                              |
      |                                    |                                    |                              |
═══════════════════════ 令牌刷新阶段  ═══════════════════════                                                    |
      |                                    |                                    |                              |
      | 19. 检测到token过期                  |                                    |                              |
      |     POST /token                    |                                    |                              |
      |     grant_type=refresh_token       |                                    |                              |
      |     refresh_token=xxx              |                                    |                              |
      |----------------------------------> |                                    |                              |
      |                                    |                                    |                              |
      |                                    | 20. 向Lark Server刷新token         |                              |
      |                                    |     POST /oauth/v2/refresh_token   |                              |
      |                                    |     refresh_token=xxx&             |                              |
      |                                    |     client_id=xxx&                 |                              |
      |                                    |     client_secret=xxx              |                              |
      |                                    |------------------------------------>|                              |
      |                                    |                                    |                              |
      |                                    | 21. 返回新的access_token            |                              |
      |                                    |     {                              |                              |
      |                                    |       access_token: "u-new...",    |                              |
      |                                    |       expires_in: 7200             |                              |
      |                                    |     }                              |                              |
      |                                    |<------------------------------------|                              |
      |                                    |                                    |                              |
      | 22. 返回新的access_token            |                                    |                              |
      |     {                              |                                    |                              |
      |       access_token: "u-new...",    |                                    |                              |
      |       expires_in: 7200             |                                    |                              |
      |     }                              |                                    |                              |
      |<---------------------------------- |                                    |                              |
      |                                    |                                    |                              |
      | 23. 更新本地token缓存                |                                    |                              |
      |                                    |                                    |                              |
      | 24. 后续请求使用新token              |                                    |                              |
      |     Authorization: Bearer <new_token>                                   |                              |
      |----------------------------------> |                                    |      

```      
