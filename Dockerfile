# 使用多阶段构建来优化镜像大小
FROM node:18-alpine AS builder

# 设置工作目录
WORKDIR /app

# 复制package.json和yarn.lock
COPY package.json yarn.lock ./

# 安装依赖
RUN yarn install --frozen-lockfile

# 复制源代码
COPY src ./src
COPY tsconfig.json ./

# 构建应用
RUN yarn build

# 生产环境镜像
FROM node:18-alpine AS production

# 安装dumb-init来处理信号
RUN apk add --no-cache dumb-init

# 创建非root用户
RUN addgroup -g 1001 -S nodejs
RUN adduser -S lark-mcp -u 1001

# 设置工作目录
WORKDIR /app

# 复制package.json和yarn.lock
COPY package.json yarn.lock ./

# 只安装生产依赖
RUN yarn install --frozen-lockfile --production && yarn cache clean

# 从构建阶段复制编译后的代码
COPY --from=builder /app/dist ./dist

# 复制其他必要文件
COPY docs ./docs
COPY CHANGELOG.md README.md README_ZH.md README_RECALL.md README_RECALL_ZH.md LICENSE ./

# 更改文件所有者
RUN chown -R lark-mcp:nodejs /app
USER lark-mcp

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const http = require('http'); const options = { host: 'localhost', port: 3000, path: '/health', timeout: 2000 }; const req = http.request(options, (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }); req.on('error', () => process.exit(1)); req.end();"

# 使用dumb-init作为PID 1来处理信号
ENTRYPOINT ["dumb-init", "--"]

# 启动命令 - 默认使用SSE模式，监听所有接口
CMD ["node", "dist/cli.js", "mcp", "--mode", "sse", "--host", "0.0.0.0", "--port", "3000"] 