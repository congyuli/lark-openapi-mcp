#!/usr/bin/env node

import fs from 'fs';
import dotenv from 'dotenv';
import { Command } from 'commander';
import { currentVersion } from './utils/version';
import { initStdioServer, initMcpServer } from './mcp-server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RecallTool } from './mcp-tool/document-tool/recall';
import { OAPI_MCP_DEFAULT_ARGS, OAPI_MCP_ENV_ARGS } from './utils/constants';

dotenv.config();

const program = new Command();

program.name('lark-mcp').description('Feishu/Lark MCP Tool').version(currentVersion);

program
  .command('mcp')
  .description('Start Feishu/Lark MCP Service')
  .option('-a, --app-id <appId>', 'Feishu/Lark App ID')
  .option('-s, --app-secret <appSecret>', 'Feishu/Lark App Secret')
  .option('-d, --domain <domain>', 'Feishu/Lark Domain (default: "https://open.feishu.cn")')
  .option('-t, --tools <tools>', 'Allowed Tools List, separated by commas')
  .option('-c, --tool-name-case <toolNameCase>', 'Tool Name Case, snake or camel or kebab or dot (default: "snake")')
  .option('-l, --language <language>', 'Tools Language, zh or en (default: "en")')
  .option('-u, --user-access-token <userAccessToken>', 'User Access Token (beta)')
  .option('--token-mode <tokenMode>', 'Token Mode, auto or user_access_token or tenant_access_token (default: "auto")')
  .option('-m, --mode <mode>', 'Transport Mode, stdio or streamable (default: "stdio")')
  .option('--host <host>', 'Host to listen (default: "localhost")')
  .option('-p, --port <port>', 'Port to listen in sse mode (default: "3000")')
  .option('--config <configPath>', 'Config file path (JSON)')
  .action(async (options) => {
    let fileOptions = {};
    if (options.config) {
      try {
        const configContent = fs.readFileSync(options.config, 'utf-8');
        fileOptions = JSON.parse(configContent);
      } catch (err) {
        console.error('Failed to read config file:', err);
        process.exit(1);
      }
    }
    const mergedOptions = { ...OAPI_MCP_DEFAULT_ARGS, ...OAPI_MCP_ENV_ARGS, ...fileOptions, ...options };
    
    // 导入并合并 larkConfig 的值
    const { larkConfig } = await import('./mcp-server/config/env');
    const mergedPort = typeof mergedOptions.port === 'string' ? parseInt(mergedOptions.port) : mergedOptions.port;
    // 将 larkConfig 的值合并到 mergedOptions 中
    const finalOptions = {
      ...mergedOptions,
      // 将 larkConfig 的字段映射到 mergedOptions 的字段
      domain: mergedOptions.domain || larkConfig.baseUrl,
      appId: mergedOptions.appId || larkConfig.appId,
      appSecret: mergedOptions.appSecret || larkConfig.appSecret,
      port: mergedPort || larkConfig.port
    };
    
    console.log('mergedOptions', { ...mergedOptions, ...(mergedOptions.appSecret ? { appSecret: '[HIDDEN]' } : {}) });
    console.log('finalOptions', { ...finalOptions, ...(finalOptions.appSecret ? { appSecret: '[HIDDEN]' } : {}) });
    
    const { mcpServer, larkClient } = initMcpServer(finalOptions);
    if (finalOptions.mode === 'stdio') {
      initStdioServer(mcpServer);
    } else if (finalOptions.mode === 'streamable') {
      // 传递 larkClient 到 server-lark.ts，以便动态更新用户 token
      const mod = await import('./mcp-server/server-lark');
      (mod.initStreamableServer || mod.default)(mcpServer, finalOptions, larkClient);
    } else {
      console.error('Invalid mode:', finalOptions.mode);
      process.exit(1);
    }
  });

program
  .command('recall-developer-documents')
  .description('Start Feishu/Lark Open Platform Recall MCP Service')
  .option('-d, --domain <domain>', 'Feishu Open Platform Domain', 'https://open.feishu.cn')
  .option('-m, --mode <mode>', 'Transport Mode, stdio or streamable', 'stdio')
  .option('--host <host>', 'Host to listen', 'localhost')
  .option('-p, --port <port>', 'Port to listen in sse mode', '3001')
  .action(async (options) => {
    const server = new McpServer({
      id: 'lark-recall-mcp-server',
      name: 'Lark Recall MCP Service',
      version: currentVersion,
    });
    server.tool(RecallTool.name, RecallTool.description, RecallTool.schema, (params) =>
      RecallTool.handler(params, options),
    );
    if (options.mode === 'stdio') {
      initStdioServer(server);
    } else if (options.mode === 'streamable') {
      const mod = await import('./mcp-server/server-lark');
      (mod.initStreamableServer || mod.default)(server, options);
    } else {
      console.error('Invalid mode:', options.mode);
      process.exit(1);
    }
  });

if (process.argv.length === 2) {
  program.help();
}

program.parse(process.argv);

export { program };
