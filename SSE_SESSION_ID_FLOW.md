# SSE SessionID 生成和传递流程详解

## 问题回答

`req.query.sessionId` 来自于**SSE连接建立时服务器生成的UUID，然后发送给客户端，客户端在后续POST请求中作为查询参数回传**。

## 完整流程图

```
客户端                           服务器 (SSE Handler)
  │                                    │
  │  1. GET /sse (建立SSE连接)          │
  ├────────────────────────────────────►│
  │                                    │ 2. 生成 sessionId = crypto.randomUUID()
  │                                    │    例如: "123e4567-e89b-12d3-a456-426614174000"
  │                                    │
  │                                    │ 3. 发送 endpoint 事件给客户端
  │◄────────────────────────────────────┤    event: endpoint
  │  data: http://localhost:3000/       │    data: http://localhost:3000/messages?sessionId=123e4567...
  │        messages?sessionId=123e4567...│
  │                                    │
  │                                    │ 4. 发送初始化消息
  │◄────────────────────────────────────┤    event: message  
  │  data: {"jsonrpc":"2.0",...}        │    data: {"jsonrpc":"2.0","method":"notifications/initialized"}
  │                                    │
  │                                    │ 5. 保持SSE连接活跃
  │◄────────────────────────────────────┤    event: ping (每30秒)
  │  data: 1703123456789                │    data: timestamp
  │                                    │
  │  6. POST /messages?sessionId=123e4567... │
  │     (发送MCP消息)                    │
  ├────────────────────────────────────►│ 7. 从 req.query.sessionId 获取会话ID
  │                                    │    验证session归属权
  │                                    │    处理MCP消息
  │                                    │
  │◄────────────────────────────────────┤ 8. 通过SSE连接返回响应
  │  event: message                    │
  │  data: {"jsonrpc":"2.0",...}        │
```

## 详细步骤解析

### 步骤1-3：SSE连接建立和SessionID生成

```typescript
// src/mcp-server/handlers/sse-handler.ts
async handleSSEConnection(req: Request, res: Response): Promise<void> {
  // 🎯 步骤2：服务器生成唯一的会话ID
  const sessionId = crypto.randomUUID(); // 例如: "123e4567-e89b-12d3-a456-426614174000"
  
  const userId = requireUserId(req);
  console.log(`[DEBUG] Creating SSE session: ${sessionId} for user: ${userId}`);

  // ... 创建连接信息和注册到UserManager ...

  // 🚀 步骤3：将sessionId发送给客户端
  // 发送端点信息给客户端，告诉客户端后续POST请求的URL
  res.write(`event: endpoint\n`);
  res.write(`data: http://${req.get('host') || 'localhost:' + this.port}/messages?sessionId=${sessionId}\n\n`);
  //                                                                                    ^^^^^^^^^^^^^^^^
  //                                                                                    关键！sessionId作为查询参数

  // 发送初始化成功消息
  res.write(`event: message\n`);
  res.write(`data: ${JSON.stringify({
    jsonrpc: '2.0',
    method: 'notifications/initialized',
    params: {},
  })}\n\n`);
}
```

### 步骤6-7：客户端使用SessionID发送POST请求

```typescript
// 客户端收到endpoint事件后，知道应该向这个URL发送POST请求：
// http://localhost:3000/messages?sessionId=123e4567-e89b-12d3-a456-426614174000

// 服务器处理POST请求时：
async handlePostMessage(req: Request, res: Response): Promise<void> {
  // 🔍 步骤7：从查询参数中提取sessionId
  const sessionId = req.query.sessionId as string; // "123e4567-e89b-12d3-a456-426614174000"
  const userId = requireUserId(req);
  
  console.log(`[DEBUG] Received POST message for session: ${sessionId}, user: ${userId}`);

  if (!sessionId) {
    res.status(400).json({ error: 'Missing sessionId parameter' });
    return;
  }

  // 🔒 验证session归属权：只能访问属于自己的session
  const userConnections = this.userManager.getActiveConnections(userId);
  const connection = userConnections.find(conn => conn.sessionId === sessionId);
  
  if (!connection) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  // ✅ 验证通过，处理消息
  await connection.transport.handlePostMessage(req, res, req.body);
}
```

## 安全验证机制

### SessionID归属权验证

```typescript
// 🔒 关键安全检查：确保用户只能访问自己的session
const userConnections = this.userManager.getActiveConnections(userId);
//    ^^^^^^^^^^^^^^^ 只获取当前用户的连接

const connection = userConnections.find(conn => conn.sessionId === sessionId);
//                                              ^^^^^^^^^^^^^^^^^^^^^^^^
//                                              在用户自己的连接中查找

if (!connection) {
  // 如果在用户的连接中找不到这个sessionId，说明：
  // 1. sessionId不存在（可能已过期）
  // 2. sessionId属于其他用户（安全违规）
  // 3. sessionId格式错误
  res.status(404).json({ error: 'Session not found' });
  return;
}
```

## 实际的客户端实现示例

### JavaScript客户端示例

```javascript
class MCPClient {
  constructor(sseEndpoint) {
    this.sseEndpoint = sseEndpoint; // "http://localhost:3000/sse"
    this.postEndpoint = null;       // 将从SSE事件中获取
    this.eventSource = null;
  }

  async connect() {
    // 1. 建立SSE连接
    this.eventSource = new EventSource(this.sseEndpoint);
    
    // 2. 监听endpoint事件，获取POST URL
    this.eventSource.addEventListener('endpoint', (event) => {
      this.postEndpoint = event.data; 
      // 例如: "http://localhost:3000/messages?sessionId=123e4567-e89b-12d3-a456-426614174000"
      console.log('POST endpoint received:', this.postEndpoint);
    });

    // 3. 监听message事件
    this.eventSource.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      this.handleMessage(message);
    });
  }

  // 4. 发送MCP消息
  async sendMessage(mcpMessage) {
    if (!this.postEndpoint) {
      throw new Error('POST endpoint not available yet');
    }

    // 使用从SSE事件获取的URL（已包含sessionId）
    const response = await fetch(this.postEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.accessToken}` // JWT token
      },
      body: JSON.stringify(mcpMessage)
    });

    return response;
  }
}

// 使用示例
const client = new MCPClient('http://localhost:3000/sse');
await client.connect();

// 等待endpoint事件后再发送消息
setTimeout(() => {
  client.sendMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'im.v1.message.create',
      arguments: { /* ... */ }
    }
  });
}, 1000);
```

## 关键设计原理

### 1. **为什么需要SessionID？**

- ✅ **连接标识**：区分同一用户的多个SSE连接
- ✅ **消息路由**：POST请求需要知道发送到哪个SSE连接
- ✅ **安全隔离**：防止用户访问其他用户的连接
- ✅ **状态管理**：跟踪连接的生命周期

### 2. **为什么使用查询参数？**

```typescript
// 方案对比：
// ❌ 放在请求体中：GET请求无法在URL中体现，不利于调试
// ❌ 放在Headers中：不直观，调试困难
// ✅ 放在查询参数中：直观、易调试、RESTful

// 最终URL形式：
// http://localhost:3000/messages?sessionId=123e4567-e89b-12d3-a456-426614174000
```

### 3. **UUID的优势**

```typescript
const sessionId = crypto.randomUUID();
// 生成类似：123e4567-e89b-12d3-a456-426614174000

// 优势：
// ✅ 全局唯一性：理论上不会冲突
// ✅ 不可预测性：防止暴力猜测攻击
// ✅ 标准化：RFC 4122标准
// ✅ 调试友好：可读性较好
```

## 多用户多连接场景

### 用户A的多个连接

```
用户A (userId: "user_123")
├── 浏览器Tab1: sessionId = "uuid-1"
├── 浏览器Tab2: sessionId = "uuid-2"  
└── 移动应用:    sessionId = "uuid-3"

每个连接的POST URL:
- http://localhost:3000/messages?sessionId=uuid-1
- http://localhost:3000/messages?sessionId=uuid-2  
- http://localhost:3000/messages?sessionId=uuid-3
```

### 多用户隔离

```
UserManager.users = Map {
  "user_123" => UserSession {
    connections: Map {
      "uuid-1" => ConnectionInfo { ... },
      "uuid-2" => ConnectionInfo { ... },
      "uuid-3" => ConnectionInfo { ... }
    }
  },
  "user_456" => UserSession {
    connections: Map {
      "uuid-4" => ConnectionInfo { ... },
      "uuid-5" => ConnectionInfo { ... }
    }
  }
}

// 🔒 安全保证：
// 用户123无法访问 uuid-4 或 uuid-5
// 用户456无法访问 uuid-1, uuid-2, uuid-3
```

## 总结

**`req.query.sessionId` 的来源和作用：**

1. **生成**：服务器在SSE连接建立时用 `crypto.randomUUID()` 生成
2. **发送**：通过SSE的 `endpoint` 事件发送给客户端
3. **使用**：客户端在后续POST请求中作为查询参数回传
4. **验证**：服务器验证sessionId属于当前用户
5. **路由**：根据sessionId找到对应的SSE连接进行消息传递

这种设计确保了：
- ✅ **唯一性**：每个连接都有唯一标识
- ✅ **安全性**：用户只能访问自己的session
- ✅ **可扩展性**：支持单用户多连接
- ✅ **调试性**：URL中直接显示sessionId，便于调试 