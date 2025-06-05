# Docker 部署指南

本文档介绍如何使用Docker部署Lark MCP服务。

## 前置要求

- Docker (版本 20.10 或更高)
- Docker Compose (版本 2.0 或更高)
- Git

## 快速开始

### 1. 准备环境变量

复制环境变量模板文件：

```bash
cp env.example .env
```

编辑 `.env` 文件，填入您的Lark应用配置：

```bash
# Lark应用配置
LARK_APP_ID=your_app_id_here
LARK_APP_SECRET=your_app_secret_here
LARK_BASE_URL=https://open.larksuite.com
LARK_SCOPES="wiki:wiki,wiki:wiki:readonly,wiki:space:retrieve,wiki:space:read,wiki:node:retrieve,drive:drive:readonly,docx:document,docx:document:readonly"

# 服务器配置
PORT=3000
```

### 2. 使用Docker Compose部署

```bash
# 构建并启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

### 3. 使用Docker命令部署

#### 构建镜像

```bash
docker build -t lark-mcp:latest .
```

#### 运行容器

```bash
docker run -d \
  --name lark-mcp-server \
  -p 3000:3000 \
  --env-file .env \
  --restart unless-stopped \
  lark-mcp:latest
```

## 验证部署

服务启动后，您可以通过以下方式验证：

1. 检查容器状态：
   ```bash
   docker ps
   ```

2. 查看服务日志：
   ```bash
   docker logs lark-mcp-server
   ```

3. 测试服务连接：
   ```bash
   curl http://localhost:3000/health
   ```

## 配置选项

### 日志配置

默认情况下，Docker容器配置为**禁用文件日志**，所有日志只输出到控制台。这样有以下好处：

- **简化容器管理**：无需处理日志文件的持久化和轮转
- **符合Docker最佳实践**：日志输出到stdout/stderr，由Docker处理
- **便于日志收集**：可以使用Docker日志驱动或外部日志收集系统
- **减少存储需求**：不产生本地日志文件

如果您需要启用文件日志，可以设置环境变量：

```bash
# 启用文件日志
DISABLE_FILE_LOGGING=false
```

启用文件日志后，会在容器内的 `/app/logs` 目录下生成以下日志文件：
- `error.log` - 错误日志
- `combined.log` - 所有日志
- `user-sessions.log` - 用户会话日志
- `exceptions.log` - 异常日志
- `rejections.log` - 拒绝处理日志

### 环境变量

| 变量名 | 描述 | 默认值 |
|--------|------|--------|
| `LARK_APP_ID` | Lark应用ID | 必填 |
| `LARK_APP_SECRET` | Lark应用密钥 | 必填 |
| `LARK_BASE_URL` | Lark API基础URL | `https://open.larksuite.com` |
| `LARK_SCOPES` | 应用权限范围 | 见env.example |
| `PORT` | 服务端口 | `3000` |
| `NODE_ENV` | Node.js环境 | `production` |
| `DISABLE_FILE_LOGGING` | 禁用文件日志输出 | Docker: `true`, 本地: `false` |

### 端口映射

- **3000**: HTTP服务端口 (SSE模式)

### 资源限制

默认配置：
- CPU限制: 1.0 core
- 内存限制: 512MB
- CPU预留: 0.25 core
- 内存预留: 128MB

## 运行模式

### SSE模式 (默认)

适用于Web界面访问，支持Server-Sent Events：

```bash
docker run -d \
  --name lark-mcp-server \
  -p 3000:3000 \
  --env-file .env \
  lark-mcp:latest
```

### STDIO模式

适用于命令行集成：

```bash
docker run -it \
  --name lark-mcp-stdio \
  --env-file .env \
  lark-mcp:latest \
  node dist/cli.js mcp --mode stdio
```

## 故障排除

### 常见问题

1. **容器启动失败**
   - 检查环境变量是否正确配置
   - 确认端口3000没有被占用
   - 查看容器日志：`docker logs lark-mcp-server`

2. **无法连接服务**
   - 确认防火墙设置
   - 检查端口映射配置
   - 验证Lark应用配置是否正确

3. **内存不足**
   - 增加Docker内存限制
   - 检查系统可用内存

### 日志管理

#### 查看容器日志

查看实时日志：
```bash
docker-compose logs -f lark-mcp
```

查看特定时间段的日志：
```bash
docker logs lark-mcp-server --since "2024-01-01T00:00:00" --until "2024-01-01T23:59:59"
```

#### 日志级别控制

可以通过环境变量控制日志级别：
```bash
# 设置日志级别为debug（会输出更详细的信息）
LOG_LEVEL=debug

# 设置日志级别为error（只输出错误信息）
LOG_LEVEL=error
```

支持的日志级别：`error`, `warn`, `info`, `debug`

#### 启用文件日志（可选）

如果需要在容器内生成日志文件，可以：

1. 修改 `.env` 文件：
   ```bash
   DISABLE_FILE_LOGGING=false
   ```

2. 添加卷映射来持久化日志文件：
   ```yaml
   # 在docker-compose.yml中添加
   volumes:
     - ./logs:/app/logs
   ```

3. 重新启动容器：
   ```bash
   docker-compose up -d --build
   ```

## 更新部署

### 更新代码

```bash
# 拉取最新代码
git pull

# 重新构建并部署
docker-compose up -d --build
```

### 更新配置

```bash
# 修改.env文件后重启服务
docker-compose restart
```

## 生产环境建议

1. **安全性**
   - 使用专用用户运行容器
   - 定期更新基础镜像
   - 配置适当的网络安全策略

2. **监控**
   - 设置容器健康检查
   - 监控资源使用情况
   - 配置日志收集

3. **备份**
   - 定期备份配置文件
   - 如有数据持久化需求，备份数据卷

4. **负载均衡**
   - 在高流量环境下考虑使用负载均衡器
   - 可以运行多个实例并使用反向代理

## 支持

如果遇到问题，请：

1. 查看项目文档
2. 检查GitHub Issues
3. 提交新的Issue并包含：
   - Docker版本信息
   - 错误日志
   - 配置信息（敏感信息请脱敏） 