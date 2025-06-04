# 服务端关闭Session和客户端重连流程分析

## 问题回答

当服务端单方面关闭session时，客户端会收到**连接断开事件**，然后需要重新进行**完整的OAuth认证和连接建立流程**来恢复服务。

## 1. 服务端关闭Session的场景

### 1.1 自动清理触发的关闭

```typescript
// 定时清理：每5分钟检查一次
private startCleanupTimer(): void {
  this.cleanupInterval = setInterval(() => {
    this.cleanupInactiveUsers().catch(error => {
      console.error('[UserManager] Cleanup timer error:', error);
    });
  }, this.config.CLEANUP_INTERVAL_MS); // 5分钟
}

// 清理条件
async cleanupInactiveUsers(inactiveThresholdMs: number = 30 * 60 * 1000): Promise<void> {
  const now = Date.now();
  const usersToRemove: string[] = [];

  this.users.forEach((userSession, userId) => {
    const isInactive = (now - userSession.lastActiveTime) > inactiveThresholdMs;
    const hasNoConnections = userSession.connections.size === 0;

    if (isInactive || hasNoConnections) {
      usersToRemove.push(userId); // 🔥 30分钟无活动 OR 无连接 → 清理
    }
  });

  for (const userId of usersToRemove) {
    await this.removeUser(userId); // 强制关闭所有连接
  }
}
```

**触发条件：**
- ✅ **30分钟无活动**：用户session超过30分钟没有任何请求
- ✅ **连接数为0**：用户没有任何活跃的SSE连接
- ✅ **服务器重启**：服务器维护或异常重启
- ✅ **内存压力**：系统资源不足时强制清理

### 1.2 强制关闭用户Session

```typescript
async removeUser(userId: string): Promise<void> {
  const userSession = this.users.get(userId);
  if (!userSession) return;

  // 🔥 强制关闭所有SSE连接
  userSession.connections.forEach((connection, sessionId) => {
    try {
      if (connection.response && !connection.response.destroyed) {
        connection.response.end(); // 直接关闭HTTP响应流
      }
    } catch (error) {
      console.error(`[UserManager] Error closing connection ${sessionId}:`, error);
    }
  });
  
  userSession.connections.clear();
  this.users.delete(userId);
  
  console.log(`[UserManager] 🔥 Forcefully removed user session: ${userId}`);
}
```

## 2. 客户端收到连接断开的表现

### 2.1 SSE连接断开事件

```javascript
// 客户端SSE连接监听
class MCPClient {
  connect() {
    this.eventSource = new EventSource('http://localhost:3000/sse');
    
    // 🚨 连接关闭事件
    this.eventSource.onerror = (event) => {
      console.error('🚨 SSE Connection Error:', event);
      console.log('ReadyState:', this.eventSource.readyState);
      
      if (this.eventSource.readyState === EventSource.CLOSED) {
        console.log('🔴 Connection closed by server');
        this.handleConnectionClosed();
      }
    };
    
    // 🚨 连接意外关闭
    this.eventSource.onclose = () => {
      console.log('🔴 SSE Connection closed');
      this.handleConnectionClosed();
    };
  }
}
```

### 2.2 POST请求失败表现

```javascript
// 当服务端关闭session后，客户端发送POST请求会失败
async sendMessage(mcpMessage) {
  try {
    const response = await fetch(this.postEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.accessToken}`
      },
      body: JSON.stringify(mcpMessage)
    });
    
    if (!response.ok) {
      // 🚨 服务端返回404：Session not found
      if (response.status === 404) {
        const error = await response.json();
        console.error('🚨 Session not found:', error.message);
        throw new Error('Session expired, need to reconnect');
      }
    }
  } catch (error) {
    console.error('🚨 POST request failed:', error);
    throw error;
  }
}
```

**客户端表现：**
- 🔴 **SSE连接断开**：`EventSource.readyState === CLOSED`
- 🔴 **POST请求失败**：返回`404 Session not found`
- 🔴 **无法收到ping**：30秒一次的心跳停止
- 🔴 **工具调用失败**：所有MCP工具调用都会失败

## 3. 客户端重连流程详解

### 3.1 检测连接断开

```javascript
class MCPClient {
  constructor() {
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000; // 1秒
  }
  
  handleConnectionClosed() {
    this.isConnected = false;
    this.postEndpoint = null;
    
    console.log('🔴 Connection lost, attempting to reconnect...');
    this.scheduleReconnect();
  }
  
  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('🚨 Max reconnection attempts reached');
      this.notifyReconnectionFailed();
      return;
    }
    
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // 指数退避
    
    console.log(`🔄 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    setTimeout(() => {
      this.attemptReconnect();
    }, delay);
  }
}
```

### 3.2 重新认证流程

```javascript
async attemptReconnect() {
  try {
    console.log('🔄 Starting reconnection process...');
    
    // 步骤1：检查现有token是否有效
    if (await this.validateCurrentToken()) {
      console.log('✅ Current token is valid, attempting direct reconnection');
      await this.connectWithExistingToken();
    } else {
      console.log('❌ Token expired, starting OAuth flow');
      await this.startOAuthFlow();
    }
  } catch (error) {
    console.error('🚨 Reconnection failed:', error);
    this.scheduleReconnect(); // 重试
  }
}

async validateCurrentToken() {
  try {
    const response = await fetch('http://localhost:3000/auth/validate', {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`
      }
    });
    return response.ok;
  } catch (error) {
    return false;
  }
}
```

### 3.3 完整重连流程

```javascript
// 情况1：Token仍然有效 - 直接重连
async connectWithExistingToken() {
  console.log('🔗 Reconnecting with existing token...');
  
  // 关闭旧连接
  if (this.eventSource) {
    this.eventSource.close();
  }
  
  // 建立新SSE连接
  await this.connect();
  console.log('✅ Reconnected successfully with existing token');
}

// 情况2：Token已过期 - 重新OAuth
async startOAuthFlow() {
  console.log('🔐 Starting OAuth re-authentication...');
  
  // 1. 获取新的授权URL
  const authResponse = await fetch('http://localhost:3000/auth/url');
  const { authUrl } = await authResponse.json();
  
  // 2. 打开认证页面
  console.log('🌐 Please complete authentication:', authUrl);
  window.open(authUrl, '_blank');
  
  // 3. 轮询检查认证状态
  await this.pollForAuthentication();
}

async pollForAuthentication() {
  const pollInterval = 2000; // 2秒检查一次
  const maxPollTime = 300000; // 最多等待5分钟
  let elapsed = 0;
  
  return new Promise((resolve, reject) => {
    const poll = setInterval(async () => {
      try {
        const response = await fetch('http://localhost:3000/auth/status');
        if (response.ok) {
          const { accessToken } = await response.json();
          
          clearInterval(poll);
          this.accessToken = accessToken;
          
          console.log('✅ Re-authentication successful');
          await this.connectWithExistingToken();
          resolve();
        }
        
        elapsed += pollInterval;
        if (elapsed >= maxPollTime) {
          clearInterval(poll);
          reject(new Error('Authentication timeout'));
        }
      } catch (error) {
        clearInterval(poll);
        reject(error);
      }
    }, pollInterval);
  });
}
```

## 4. 新连接建立过程

### 4.1 SSE连接重建

```javascript
async connect() {
  return new Promise((resolve, reject) => {
    // 创建新的SSE连接
    this.eventSource = new EventSource('http://localhost:3000/sse', {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`
      }
    });
    
    // 监听endpoint事件 - 获取新的sessionId
    this.eventSource.addEventListener('endpoint', (event) => {
      this.postEndpoint = event.data;
      console.log('🆔 New session endpoint:', this.postEndpoint);
      // 新sessionId：http://localhost:3000/messages?sessionId=NEW_UUID
    });
    
    // 监听初始化消息
    this.eventSource.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.method === 'notifications/initialized') {
        this.isConnected = true;
        this.reconnectAttempts = 0; // 重置重连计数
        console.log('✅ New connection established successfully');
        resolve();
      }
    });
    
    // 错误处理
    this.eventSource.onerror = (error) => {
      console.error('🚨 Connection failed:', error);
      reject(error);
    };
  });
}
```

### 4.2 服务端新Session创建

```typescript
// 服务端处理新连接
async handleSSEConnection(req: Request, res: Response): Promise<void> {
  const sessionId = crypto.randomUUID(); // 🆔 生成全新的sessionId
  const userId = requireUserId(req);
  
  console.log(`[DEBUG] 🔄 Creating NEW SSE session: ${sessionId} for user: ${userId}`);
  
  // 创建新的连接信息
  const connectionInfo: ConnectionInfo = {
    sessionId,        // 全新的UUID
    transport,        // 新的SSE传输通道
    response: res,    // 新的HTTP响应流
    userId,
    clientId: req.user?.client_id,
    createdAt: Date.now(),
  };
  
  // 添加到用户连接池
  this.userManager.addConnection(userId, connectionInfo);
  
  // 发送新的endpoint给客户端
  res.write(`event: endpoint\n`);
  res.write(`data: http://${req.get('host') || 'localhost:' + this.port}/messages?sessionId=${sessionId}\n\n`);
  //                                                                                        ^^^^^^^^^^^^^^^^
  //                                                                                        全新的sessionId
  
  // 发送初始化消息
  res.write(`event: message\n`);
  res.write(`data: ${JSON.stringify({
    jsonrpc: '2.0',
    method: 'notifications/initialized',
    params: {},
  })}\n\n`);
}
```

## 5. 重连后的状态对比

### 5.1 连接前后对比

```
重连前（旧session）:
┌─────────────────────────────────────────────────────────────┐
│ SessionID: 123e4567-e89b-12d3-a456-426614174000           │
│ POST URL:  /messages?sessionId=123e4567...                │
│ Status:    🔴 CLOSED (服务端强制关闭)                       │
│ UserSession: ❌ REMOVED                                   │
└─────────────────────────────────────────────────────────────┘

重连后（新session）:
┌─────────────────────────────────────────────────────────────┐
│ SessionID: 987fcdeb-a123-45f6-b789-123456789abc           │
│ POST URL:  /messages?sessionId=987fcdeb...                │
│ Status:    ✅ CONNECTED                                   │
│ UserSession: ✅ RECREATED                                 │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 用户状态恢复

```typescript
// 重连后用户状态对比
重连前：
{
  userId: "user_123",
  sessionId: "123e4567-...",
  accessToken: "old_token_if_expired",
  连接状态: "DISCONNECTED"
}

重连后：
{
  userId: "user_123",           // ✅ 相同用户ID
  sessionId: "987fcdeb-...",    // 🆔 全新sessionId
  accessToken: "refreshed_token_if_needed", // 🔑 可能刷新的token
  连接状态: "CONNECTED"          // ✅ 恢复连接
}
```

## 6. 重连过程中的用户体验

### 6.1 客户端状态指示

```javascript
class ConnectionStatusUI {
  showConnectionStatus(status) {
    const statusElement = document.getElementById('connection-status');
    
    switch(status) {
      case 'CONNECTED':
        statusElement.innerHTML = '🟢 Connected';
        statusElement.className = 'status-connected';
        break;
        
      case 'DISCONNECTED':
        statusElement.innerHTML = '🔴 Disconnected';
        statusElement.className = 'status-disconnected';
        break;
        
      case 'RECONNECTING':
        statusElement.innerHTML = '🟡 Reconnecting...';
        statusElement.className = 'status-reconnecting';
        break;
        
      case 'AUTH_REQUIRED':
        statusElement.innerHTML = '🔐 Authentication Required';
        statusElement.className = 'status-auth-required';
        this.showAuthButton();
        break;
    }
  }
  
  showReconnectionProgress(attempt, maxAttempts) {
    const progressElement = document.getElementById('reconnect-progress');
    progressElement.innerHTML = `Reconnection attempt ${attempt}/${maxAttempts}`;
  }
}
```

### 6.2 消息队列处理

```javascript
class MessageQueue {
  constructor() {
    this.pendingMessages = [];
    this.isConnected = false;
  }
  
  // 连接断开时缓存消息
  queueMessage(message) {
    if (!this.isConnected) {
      console.log('📥 Queueing message during reconnection:', message.id);
      this.pendingMessages.push(message);
      return false; // 表示消息被队列化
    }
    return true; // 表示可以直接发送
  }
  
  // 重连成功后重发消息
  async flushPendingMessages(client) {
    console.log(`📤 Flushing ${this.pendingMessages.length} pending messages`);
    
    for (const message of this.pendingMessages) {
      try {
        await client.sendMessage(message);
        console.log('✅ Resent message:', message.id);
      } catch (error) {
        console.error('❌ Failed to resend message:', message.id, error);
      }
    }
    
    this.pendingMessages = [];
  }
}
```

## 7. 最佳实践和注意事项

### 7.1 客户端重连策略

```javascript
const RECONNECTION_CONFIG = {
  maxAttempts: 5,           // 最多重试5次
  initialDelay: 1000,       // 初始延迟1秒
  maxDelay: 30000,          // 最大延迟30秒
  backoffMultiplier: 2,     // 指数退避系数
  jitterRange: 0.1,         // 随机抖动范围
};

function calculateReconnectDelay(attempt) {
  const baseDelay = RECONNECTION_CONFIG.initialDelay * 
    Math.pow(RECONNECTION_CONFIG.backoffMultiplier, attempt - 1);
  
  const cappedDelay = Math.min(baseDelay, RECONNECTION_CONFIG.maxDelay);
  
  // 添加随机抖动，避免大量客户端同时重连
  const jitter = cappedDelay * RECONNECTION_CONFIG.jitterRange * Math.random();
  
  return cappedDelay + jitter;
}
```

### 7.2 服务端优雅处理

```typescript
// 服务端在清理前给客户端发送通知
async gracefulUserRemoval(userId: string): Promise<void> {
  const userSession = this.users.get(userId);
  if (!userSession) return;
  
  // 1. 发送断开通知给所有连接
  userSession.connections.forEach((connection, sessionId) => {
    try {
      if (connection.response && !connection.response.destroyed) {
        // 发送服务端主动断开的通知
        connection.response.write(`event: disconnect\n`);
        connection.response.write(`data: ${JSON.stringify({
          reason: 'session_timeout',
          message: 'Session expired due to inactivity',
          reconnect: true
        })}\n\n`);
        
        // 延迟关闭，给客户端时间处理通知
        setTimeout(() => {
          connection.response.end();
        }, 1000);
      }
    } catch (error) {
      console.error(`[UserManager] Error sending disconnect notification:`, error);
    }
  });
  
  // 2. 延迟删除用户session
  setTimeout(() => {
    this.users.delete(userId);
  }, 2000);
}
```

## 总结

**服务端关闭Session时的完整流程：**

1. **服务端清理** → 强制关闭所有SSE连接和HTTP响应流
2. **客户端检测** → 收到连接断开事件，POST请求开始失败
3. **重连判断** → 检查token有效性，决定直接重连还是重新认证
4. **建立新连接** → 获得全新sessionId，重建完整的通信通道
5. **状态恢复** → 重发队列中的消息，恢复正常服务

**关键要点：**
- ✅ **Session完全重建**：新的sessionId，新的连接，但保持相同用户身份
- ✅ **自动重连机制**：指数退避策略，避免服务器压力
- ✅ **优雅降级**：连接断开期间缓存消息，重连后重发
- ✅ **状态同步**：UI实时显示连接状态，提升用户体验
- ✅ **错误恢复**：多种重连策略，应对不同的断连场景
</rewritten_file> 