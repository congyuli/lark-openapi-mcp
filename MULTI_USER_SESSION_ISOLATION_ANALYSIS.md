# 多用户 MCP SSE Server Session 隔离分析

## 问题回答

**是的，每个用户都有独立的session，并且它们是完全相互隔离的。**

## 架构概览

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           MCP SSE Server                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌───────────────────┐                    ┌─────────────────────────────────┐   │
│  │   SSE Handler     │                    │        User Manager             │   │
│  │                   │                    │                                 │   │
│  │ - handleSSEConn() │◄─────────────────▶ │ users: Map<userId, UserSession> │   │
│  │ - handlePostMsg() │                    │                                 │   │
│  └───────────────────┘                    └─────────────────────────────────┘   │
│           │                                                │                    │
│           │                                                │                    │
│    ┌──────▼──────┐                                ┌─────────▼─────────┐           │
│    │ Global MCP  │                                │   UserSession     │           │
│    │   Server    │                                │                   │           │
│    │ (Shared)    │                                │ - userId          │           │
│    └─────────────┘                                │ - accessToken     │           │
│                                                   │ - larkClient      │           │
│                                                   │ - connections: Map│           │
│                                                   │ - lastActiveTime  │           │
│                                                   └───────────────────┘           │
└─────────────────────────────────────────────────────────────────────────────────┘

每个用户的多个连接:
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              User A Session                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│ userId: "user_a"                                                               │
│ accessToken: "user_a_token_abc123..."                                         │
│ larkClient: LarkMcpTool(独立实例)                                             │
│ connections: Map {                                                             │
│   "session_1" → ConnectionInfo { sessionId, transport, response, ... }         │
│   "session_2" → ConnectionInfo { sessionId, transport, response, ... }         │
│   "session_3" → ConnectionInfo { sessionId, transport, response, ... }         │
│ }                                                                              │
└─────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────┐
│                              User B Session                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│ userId: "user_b"                                                               │
│ accessToken: "user_b_token_xyz789..."                                         │
│ larkClient: LarkMcpTool(独立实例)                                             │
│ connections: Map {                                                             │
│   "session_4" → ConnectionInfo { sessionId, transport, response, ... }         │
│   "session_5" → ConnectionInfo { sessionId, transport, response, ... }         │
│ }                                                                              │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## 隔离机制详解

### 1. **用户级别隔离**

```typescript
// UserManager.ts
private users = new Map<string, UserSession>();

// 每个用户都有独立的UserSession
interface UserSession {
  userId: string;           // 唯一用户标识
  userName?: string;        
  accessToken: string;      // 用户专属的访问令牌
  larkClient: any;          // 用户专属的LarkMcpTool实例
  connections: Map<string, ConnectionInfo>; // 该用户的所有SSE连接
  lastActiveTime: number;
  createdAt: number;
}
```

**关键隔离点：**
- ✅ **独立的访问令牌** - 每个用户有自己的 `accessToken`
- ✅ **独立的LarkClient实例** - 每个用户有自己的 `larkClient`
- ✅ **独立的连接池** - 每个用户有自己的 `connections` Map

### 2. **Session级别隔离**

```typescript
// SSEHandler.ts - 每个SSE连接创建独立session
async handleSSEConnection(req: Request, res: Response): Promise<void> {
  const sessionId = crypto.randomUUID(); // 每个连接都有唯一的UUID
  const userId = requireUserId(req);     // 从JWT token中获取用户ID
  
  const connectionInfo: ConnectionInfo = {
    sessionId,      // 唯一会话标识
    transport,      // 独立的SSE传输通道
    response: res,  // 独立的HTTP响应对象
    userId,         // 关联到特定用户
    clientId: req.user?.client_id,
    createdAt: Date.now(),
  };
  
  // 将连接添加到用户专属的连接池中
  this.userManager.addConnection(userId, connectionInfo);
}
```

**关键隔离点：**
- ✅ **独立的SessionID** - 每个连接都有唯一的UUID
- ✅ **独立的SSE传输通道** - 每个连接都有自己的 `SSEServerTransport`
- ✅ **独立的HTTP响应流** - 每个连接都有自己的 `Response` 对象

### 3. **工具执行隔离**

```typescript
// SSEHandler.ts - POST消息处理
async handlePostMessage(req: Request, res: Response): Promise<void> {
  const sessionId = req.query.sessionId as string;
  const userId = requireUserId(req);
  const currentAccessToken = getUserAccessToken(req);
  
  // 🔑 关键：设置请求上下文，确保工具执行时使用正确的用户身份
  if (currentAccessToken) {
    const requestContext = {
      userId,
      accessToken: currentAccessToken,
      userName: getUserName(req),
      sessionId,
      clientId: req.user?.client_id,
    };
    
    setRequestContext(sessionId, requestContext);
  }
  
  // 工具执行时会从requestContext中获取用户专属的LarkClient和Token
  await connection.transport.handlePostMessage(req, res, req.body);
  
  // 🧹 执行完成后清理上下文
  setTimeout(() => {
    clearRequestContext(sessionId);
  }, 1000);
}
```

**关键隔离点：**
- ✅ **Session级别的请求上下文** - 每个session有独立的请求上下文
- ✅ **动态用户路由** - 工具执行时动态获取用户专属的LarkClient
- ✅ **Token隔离** - 每个请求使用对应用户的访问令牌

### 4. **连接管理隔离**

```typescript
// UserManager.ts
addConnection(userId: string, connectionInfo: ConnectionInfo): void {
  const userSession = this.users.get(userId);
  if (!userSession) {
    throw new UserNotFoundError(`User session not found: ${userId}`);
  }

  // 🔒 连接数量限制（每个用户独立计算）
  if (userSession.connections.size >= this.config.MAX_CONNECTIONS_PER_USER) {
    throw new MaxConnectionsExceededError(
      `Maximum connections per user limit (${this.config.MAX_CONNECTIONS_PER_USER}) exceeded for user: ${userId}`
    );
  }

  userSession.connections.set(connectionInfo.sessionId, connectionInfo);
}

removeConnection(userId: string, sessionId: string): void {
  const userSession = this.users.get(userId);
  if (!userSession) return;
  
  userSession.connections.delete(sessionId);
  
  // 🧹 如果用户没有活跃连接，标记为可清理
  if (userSession.connections.size === 0) {
    console.log(`[UserManager] User ${userId} has no active connections, eligible for cleanup`);
  }
}
```

**关键隔离点：**
- ✅ **每用户连接限制** - 每个用户独立计算连接数量限制
- ✅ **独立连接清理** - 删除连接时只影响该用户的连接池
- ✅ **用户资源回收** - 用户无连接时自动标记为可清理

## 并发支持能力

### 多用户并发支持

```typescript
// lifecycle-strategy.ts 中的配置
export const LIFECYCLE_CONFIG = {
  MAX_CONCURRENT_USERS: 100,        // 最大并发用户数
  MAX_CONNECTIONS_PER_USER: 10,     // 每个用户最大连接数
  USER_SESSION_TIMEOUT_MS: 30 * 60 * 1000,  // 30分钟无活动后清理
  CLEANUP_INTERVAL_MS: 5 * 60 * 1000,       // 每5分钟清理一次
};
```

**理论最大并发：**
- 🎯 **100个并发用户**
- 🎯 **1000个并发连接** (100用户 × 10连接/用户)
- 🎯 **自动资源清理** - 30分钟无活动用户自动清理

### 单用户多连接支持

一个用户可以同时建立多个SSE连接，例如：
- **多个浏览器标签页**
- **多个设备登录**
- **多个应用程序实例**

每个连接都有独立的：
- ✅ SessionID
- ✅ SSE传输通道  
- ✅ HTTP响应流
- ✅ 请求上下文

但共享相同的：
- ✅ 用户身份 (userId)
- ✅ 访问令牌 (accessToken)
- ✅ LarkClient实例 (larkClient)

## 安全隔离保证

### 1. **身份验证隔离**

```typescript
// 每个请求都要求有效的JWT token
const userId = requireUserId(req);  // 从JWT中提取用户ID
const currentAccessToken = getUserAccessToken(req); // 从JWT中提取访问令牌
```

- ✅ **JWT Token验证** - 每个请求都验证用户身份
- ✅ **用户ID绑定** - Session严格绑定到特定用户
- ✅ **Token隔离** - 每个用户只能访问自己的资源

### 2. **数据访问隔离**

```typescript
// 工具执行时的隔离机制
const { client: actualClient, userAccessToken, userLarkMcpTool, source } = 
  getUserLarkClientAndToken(client, options);

// 只使用用户专属的LarkClient和Token
if (params?.useUAT) {
  return await func(params, lark.withUserAccessToken(effectiveUserAccessToken));
}
```

- ✅ **Client实例隔离** - 每个用户使用独立的LarkClient
- ✅ **API调用隔离** - 使用用户专属的访问令牌调用API
- ✅ **数据访问控制** - 用户只能访问自己有权限的数据

### 3. **连接资源隔离**

```typescript
// 连接查找时的用户验证
const userConnections = this.userManager.getActiveConnections(userId);
const connection = userConnections.find(conn => conn.sessionId === sessionId);

if (!connection) {
  res.status(404).json({ error: 'Session not found' });
  return;
}
```

- ✅ **连接所有权验证** - 只能访问属于自己的连接
- ✅ **Session权限控制** - 不能访问其他用户的Session
- ✅ **资源访问控制** - 严格的权限边界检查

## 生命周期管理

### 用户Session生命周期

```
用户登录 → 创建UserSession → 建立SSE连接 → 工具执行 → 连接关闭 → 清理资源

┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  用户登录    │───▶│ 创建Session │───▶│  建立连接    │───▶│  工具执行    │
│ (OAuth)     │    │(UserManager)│    │(SSEHandler) │    │(LarkClient) │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
                                              │                   │
                                              ▼                   ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  清理资源    │◄───│  用户清理    │◄───│  连接关闭    │◄───│  请求完成    │
│(destroy())  │    │(removeUser) │    │(disconnect) │    │(response)   │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
```

### 自动清理机制

```typescript
// 定时清理不活跃用户
private startCleanupTimer(): void {
  this.cleanupInterval = setInterval(() => {
    this.cleanupInactiveUsers().catch(error => {
      console.error('[UserManager] Cleanup timer error:', error);
    });
  }, this.config.CLEANUP_INTERVAL_MS); // 每5分钟
}

async cleanupInactiveUsers(inactiveThresholdMs: number = this.config.USER_SESSION_TIMEOUT_MS): Promise<void> {
  const now = Date.now();
  const usersToRemove: string[] = [];

  this.users.forEach((userSession, userId) => {
    const isInactive = (now - userSession.lastActiveTime) > inactiveThresholdMs; // 30分钟
    const hasNoConnections = userSession.connections.size === 0;

    if (isInactive || hasNoConnections) {
      usersToRemove.push(userId);
    }
  });
}
```

## 测试验证

从我们的测试代码可以看到，系统确实实现了完整的用户隔离：

### 测试用例覆盖

1. **多用户并发测试** ✅
```typescript
test('should handle multiple users with different LarkClients', async () => {
  const user1Session = await userManager.getOrCreateUserSession(user1Id, user1Token);
  const user2Session = await userManager.getOrCreateUserSession(user2Id, user2Token);
  
  // 验证每个用户使用自己的客户端
  expect(result1.content[0].text).toContain('user1 client');
  expect(result2.content[0].text).toContain('user2 client');
});
```

2. **Session隔离测试** ✅  
```typescript
test('should use current HTTP request access token through request context', async () => {
  // 测试HTTP请求级别的token隔离
  setRequestContext(sessionId, requestContext);
  // 验证使用了正确的用户身份
});
```

3. **Token隔离测试** ✅
```typescript
test('should demonstrate token priority: request context vs stored token', async () => {
  // 测试不同token来源的优先级
  // 验证使用了正确的token
});
```

## 结论

**多用户 MCP SSE Server 具有完整的Session隔离机制：**

✅ **用户级别隔离**：每个用户有独立的UserSession、LarkClient实例和访问令牌

✅ **连接级别隔离**：每个SSE连接有独立的SessionID、传输通道和HTTP响应流

✅ **执行级别隔离**：工具执行时使用用户专属的身份和权限

✅ **资源级别隔离**：独立的连接池、请求上下文和生命周期管理

✅ **安全级别隔离**：严格的身份验证、权限控制和数据访问隔离

**支持的并发能力：**
- 🎯 最多100个并发用户
- 🎯 每个用户最多10个并发连接  
- 🎯 总计最多1000个并发连接
- 🎯 自动资源清理和生命周期管理

这个架构确保了多用户环境下的完全隔离和安全性，每个用户的操作都不会影响到其他用户。 