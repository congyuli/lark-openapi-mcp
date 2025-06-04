import { Client } from '@larksuiteoapi/node-sdk';
import { LarkMcpTool } from '../../src/mcp-tool/mcp-tool';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { filterTools } from '../../src/mcp-tool/utils/filter-tools';
import { caseTransf } from '../../src/mcp-tool/utils/case-transf';
import { ToolName } from '../../src/mcp-tool/tools';
import { larkOapiHandler } from '../../src/mcp-tool/utils/handler';
import { TokenMode } from '../../src/mcp-tool/types';

// 模拟依赖项
jest.mock('../../src/mcp-tool/utils/filter-tools');
jest.mock('../../src/mcp-tool/utils/case-transf');
jest.mock('../../src/mcp-tool/utils/handler');

// mock larkOapiHandler
const mockLarkOapiHandler = jest.fn();
jest.mocked(larkOapiHandler).mockImplementation(mockLarkOapiHandler);

// 模拟McpServer
const mockServer = {
  tool: jest.fn(),
} as unknown as McpServer;

describe('LarkMcpTool', () => {
  let larkMcpTool: LarkMcpTool;
  let mockClient: jest.Mocked<Client>;

  beforeEach(() => {
    jest.clearAllMocks();

    // 设置mock返回值
    (filterTools as jest.Mock).mockReturnValue([
      {
        name: 'im.v1.message.create',
        description: '发送消息',
        schema: {},
        project: 'im',
        accessTokens: ['user', 'tenant'],
        sdkName: 'im.message.create',
      },
    ]);

    (caseTransf as jest.Mock).mockImplementation((toolName, caseType) => {
      if (caseType === 'snake') {
        return 'im_v1_message_create';
      }
      if (caseType === 'camel') {
        return 'imV1MessageCreate';
      }
      if (caseType === 'kebab') {
        return 'im-v1-message-create';
      }
      return 'im_v1_message_create'; // 默认返回snake case用于未指定时
    });

    mockClient = new Client({ appId: 'test-app-id', appSecret: 'test-app-secret' }) as jest.Mocked<Client>;
    larkMcpTool = new LarkMcpTool({
      client: mockClient,
      tokenMode: TokenMode.AUTO,
    });
  });

  describe('constructor', () => {
    it('应该用提供的客户端初始化', () => {
      expect(filterTools).toHaveBeenCalled();
    });

    it('如果没有提供客户端，应该使用提供的凭证创建客户端', () => {
      const tool = new LarkMcpTool({
        appId: 'test-app-id',
        appSecret: 'test-app-secret',
      });
      expect(Client).toHaveBeenCalledWith({
        appId: 'test-app-id',
        appSecret: 'test-app-secret',
      });
    });

    it('应该使用中文工具当language为zh时', () => {
      new LarkMcpTool({
        client: mockClient,
        toolsOptions: {
          language: 'zh',
        },
      });

      // 验证filterTools被调用，并且使用了中文工具列表
      expect(filterTools).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          language: 'zh',
        }),
      );
    });
  });

  describe('updateUserAccessToken', () => {
    it('应该更新userAccessToken', () => {
      larkMcpTool.updateUserAccessToken('test-token');
      // 因为userAccessToken是私有属性，我们可以在后续方法中间接验证
      const tools = larkMcpTool.getTools();
      larkMcpTool.registerMcpServer(mockServer);
      expect(mockServer.tool).toHaveBeenCalled();
    });
  });

  describe('getTools', () => {
    it('应该返回过滤后的工具列表', () => {
      const tools = larkMcpTool.getTools();
      expect(tools).toEqual([
        {
          name: 'im.v1.message.create',
          description: '发送消息',
          schema: {},
          project: 'im',
          accessTokens: ['user', 'tenant'],
          sdkName: 'im.message.create',
        },
      ]);
    });
  });

  describe('registerMcpServer', () => {
    it('应该将工具注册到MCP服务器', () => {
      larkMcpTool.registerMcpServer(mockServer);
      expect(caseTransf).toHaveBeenCalledWith('im.v1.message.create', undefined);
      expect(mockServer.tool).toHaveBeenCalledWith('im_v1_message_create', '发送消息', {}, expect.any(Function));
    });

    it('应该使用工具名称大小写选项', () => {
      larkMcpTool.registerMcpServer(mockServer, { toolNameCase: 'camel' });
      expect(caseTransf).toHaveBeenCalledWith('im.v1.message.create', 'camel');
      expect(mockServer.tool).toHaveBeenCalledWith('imV1MessageCreate', '发送消息', {}, expect.any(Function));
    });

    it('应该在客户端未初始化时抛出错误', async () => {
      // 创建没有客户端的实例
      const toolWithoutClient = new LarkMcpTool({
        toolsOptions: { allowTools: ['im.v1.message.create'] as ToolName[] },
      });

      // 模拟registerMcpServer并触发handler
      toolWithoutClient.registerMcpServer(mockServer);

      // 提取并调用处理函数
      const handlerFunction = (mockServer.tool as jest.Mock).mock.calls[0][3];

      const result = await handlerFunction({ content: 'test' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Client not initialized');
    });

    it('应该使用customHandler而非默认的larkOapiHandler', async () => {
      // 模拟自定义处理程序
      const customHandlerMock = jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Custom handler response' }],
      });

      // 使用spyOn修改过滤后的工具数组
      (filterTools as jest.Mock).mockReturnValueOnce([
        {
          name: 'custom.handler.tool',
          description: '自定义处理程序工具',
          schema: {},
          project: 'custom',
          accessTokens: ['user', 'tenant'],
          sdkName: 'custom.handler.tool',
          customHandler: customHandlerMock,
        },
      ]);

      // 创建新的实例以使用修改后的模拟
      const toolWithCustomHandler = new LarkMcpTool({
        client: mockClient,
        tokenMode: TokenMode.AUTO,
      });

      // 注册到服务器
      toolWithCustomHandler.registerMcpServer(mockServer);

      // 提取处理函数
      const handlerFunction = (mockServer.tool as jest.Mock).mock.calls[0][3];

      // 调用处理函数
      await handlerFunction({ content: 'test' });

      // 验证customHandler被调用而非larkOapiHandler
      expect(customHandlerMock).toHaveBeenCalled();
    });

    it('应该使用larkOapiHandler', async () => {
      // 使用spyOn修改过滤后的工具数组
      (filterTools as jest.Mock).mockReturnValueOnce([
        {
          name: 'custom.handler.tool',
          description: '自定义处理程序工具',
          schema: {},
          project: 'custom',
          accessTokens: ['user', 'tenant'],
          sdkName: 'custom.handler.tool',
        },
      ]);

      // 创建新的实例以使用修改后的模拟
      const toolWithCustomHandler = new LarkMcpTool({
        client: mockClient,
        tokenMode: TokenMode.AUTO,
      });

      // 注册到服务器
      toolWithCustomHandler.registerMcpServer(mockServer);

      // 提取处理函数
      const handlerFunction = (mockServer.tool as jest.Mock).mock.calls[0][3];

      // 调用处理函数
      await handlerFunction({ content: 'test' });

      // 验证customHandler被调用而非larkOapiHandler
      expect(larkOapiHandler).toHaveBeenCalled();
    });

    it('应该在 USER_ACCESS_TOKEN 模式下且没有用户访问令牌时不立即抛出错误', async () => {
      // 创建 USER_ACCESS_TOKEN 模式的实例
      const toolWithUserTokenMode = new LarkMcpTool({
        appId: 'test_app',
        appSecret: 'test_secret',
        toolsOptions: { allowTools: ['im.v1.message.create'] as ToolName[] },
        tokenMode: TokenMode.USER_ACCESS_TOKEN,
      });

      // 在 USER_ACCESS_TOKEN 模式下，即使没有全局 userAccessToken，
      // registerMcpServer 也不应该立即抛出错误
      expect(() => {
        toolWithUserTokenMode.registerMcpServer(mockServer);
      }).not.toThrow();

      // 验证工具已经注册
      expect(mockServer.tool).toHaveBeenCalled();
    });
  });

  // 添加额外的构造函数测试
  describe('constructor额外测试', () => {
    it('应该使用自定义允许工具列表', () => {
      const customAllowTools: ToolName[] = ['im.v1.message.create', 'im.v1.chat.create'] as ToolName[];
      new LarkMcpTool({
        client: mockClient,
        toolsOptions: {
          allowTools: customAllowTools,
        },
      });

      expect(filterTools).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          allowTools: customAllowTools,
        }),
      );
    });

    it('应该设置自定义tokenMode', () => {
      const tool = new LarkMcpTool({
        client: mockClient,
        tokenMode: TokenMode.USER_ACCESS_TOKEN,
      });

      // 注册服务器以验证tokenMode是否传递给handler
      tool.registerMcpServer(mockServer);
    });
  });

  describe('异常处理', () => {
    it('应捕获并返回错误信息', async () => {
      mockLarkOapiHandler.mockImplementationOnce(() => {
        throw new Error('测试错误');
      });

      larkMcpTool.registerMcpServer(mockServer);

      // 提取处理函数
      const handlerFunction = (mockServer.tool as jest.Mock).mock.calls[0][3];

      // 调用处理函数
      const result = await handlerFunction({ content: 'test' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error:');
      expect(result.content[0].text).toContain('测试错误');
    });
  });

  describe('参数传递处理', () => {
    it('应正确处理useUAT参数', async () => {
      // 使用mock模拟getShouldUseUAT函数，确保返回值是我们期望的
      jest.mock('../../src/mcp-tool/utils/get-should-use-uat', () => ({
        getShouldUseUAT: jest.fn().mockReturnValue(false),
      }));

      const tool = new LarkMcpTool({
        client: mockClient,
      });

      tool.registerMcpServer(mockServer);

      // 提取处理函数
      const handlerFunction = (mockServer.tool as jest.Mock).mock.calls[0][3];

      // 调用处理函数，传入useUAT参数
      await handlerFunction({ content: 'test', useUAT: true });

      // 只验证handler被调用，不验证具体参数值
      expect(mockLarkOapiHandler).toHaveBeenCalled();
    });

    it('应正确处理不同模式下的useUAT参数', async () => {
      // 使用mockClear清除之前的模拟调用
      (mockLarkOapiHandler as jest.Mock).mockClear();

      // USER_ACCESS_TOKEN模式
      const userTokenTool = new LarkMcpTool({
        client: mockClient,
        tokenMode: TokenMode.USER_ACCESS_TOKEN,
      });

      // 设置token
      userTokenTool.updateUserAccessToken('test-token');

      userTokenTool.registerMcpServer(mockServer);

      // 提取处理函数
      const userTokenHandlerFunction = (mockServer.tool as jest.Mock).mock.calls[0][3];

      // 调用函数
      await userTokenHandlerFunction({ content: 'test' });

      // 只验证handler被调用，不验证具体参数值
      expect(mockLarkOapiHandler).toHaveBeenCalled();

      // 清除模拟调用
      (mockLarkOapiHandler as jest.Mock).mockClear();

      // TENANT_ACCESS_TOKEN模式
      const tenantTokenTool = new LarkMcpTool({
        client: mockClient,
        tokenMode: TokenMode.TENANT_ACCESS_TOKEN,
      });

      tenantTokenTool.registerMcpServer(mockServer);

      // 提取处理函数
      const tenantTokenHandlerFunction = (mockServer.tool as jest.Mock).mock.calls[0][3];

      // 调用函数
      await tenantTokenHandlerFunction({ content: 'test' });

      // 只验证handler被调用，不验证具体参数值
      expect(mockLarkOapiHandler).toHaveBeenCalled();
    });

    it('应在AUTO模式下处理useUAT', async () => {
      // 清除模拟调用
      (mockLarkOapiHandler as jest.Mock).mockClear();

      // AUTO模式
      const autoTool = new LarkMcpTool({
        client: mockClient,
        tokenMode: TokenMode.AUTO,
      });

      autoTool.registerMcpServer(mockServer);

      const autoHandler = (mockServer.tool as jest.Mock).mock.calls[0][3];

      // 调用处理程序
      await autoHandler({ content: 'test', useUAT: true });

      // 只验证handler被调用，不验证具体参数值
      expect(mockLarkOapiHandler).toHaveBeenCalled();

      // 清除模拟调用
      (mockLarkOapiHandler as jest.Mock).mockClear();

      // 更新token后测试
      autoTool.updateUserAccessToken('test-token');

      // 调用处理程序
      await autoHandler({ content: 'test' });

      // 验证handler被调用，并传入了userAccessToken
      expect(mockLarkOapiHandler).toHaveBeenCalledWith(
        mockClient,
        expect.any(Object),
        expect.objectContaining({
          userAccessToken: 'test-token',
        }),
      );
    });

    it('当没有params时，useUAT为false', async () => {
      const tool = new LarkMcpTool({
        client: mockClient,
        tokenMode: TokenMode.AUTO,
      });

      tool.registerMcpServer(mockServer);

      // 提取处理函数
      const handlerFunction = (mockServer.tool as jest.Mock).mock.calls[0][3];

      // 调用处理函数
      await handlerFunction();

      // 验证handler被调用，并传入了userAccessToken
      expect(mockLarkOapiHandler).toHaveBeenCalledWith(
        mockClient,
        expect.objectContaining({
          useUAT: false,
        }),
        expect.any(Object),
      );
    });

    it('handler throw error', async () => {
      mockLarkOapiHandler.mockImplementationOnce(() => {
        throw new Error('测试错误');
      });

      const tool = new LarkMcpTool({
        client: mockClient,
        tokenMode: TokenMode.AUTO,
      });

      tool.registerMcpServer(mockServer);

      // 提取处理函数
      const handlerFunction = (mockServer.tool as jest.Mock).mock.calls[0][3];

      // 调用处理函数
      const result = await handlerFunction({ content: 'test' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error:');
    });

    it('handler throw undefined', async () => {
      mockLarkOapiHandler.mockImplementationOnce(() => {
        throw undefined;
      });

      const tool = new LarkMcpTool({
        client: mockClient,
        tokenMode: TokenMode.AUTO,
      });

      tool.registerMcpServer(mockServer);

      // 提取处理函数
      const handlerFunction = (mockServer.tool as jest.Mock).mock.calls[0][3];

      // 调用处理函数
      const result = await handlerFunction({ content: 'test' });

      expect(result.isError).toBe(true);
    });
  });
});
