import 'dotenv/config';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { ChatOpenAI } from '@langchain/openai';
import chalk from 'chalk';
import { HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';

//使用高德mcp
const model = new ChatOpenAI({
  modelName: "deepseek-v4-pro",
  apiKey: process.env.OPENAI_API_KEY,
  temperature: 0,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});

const mcpClient = new MultiServerMCPClient({
  mcpServers: {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        ...(process.env.ALLOWED_PATHS.split(',') || '')
      ]
    },
    "amap-maps-streamableHTTP": {
      "url": "https://mcp.amap.com/mcp?key=" + process.env.AMAP_MAPS_API_KEY
    },
  }
});

const tools = await mcpClient.getTools();
const modelWithTools = model.bindTools(tools);

async function runAgentWithTools(query, maxIterations = 30) {
  const messages = [
    new HumanMessage(query)
  ];

  for (let i = 0; i < maxIterations; i++) {
    console.log(chalk.bgGreen(`⏳ 正在等待 AI 思考...`));
    const response = await modelWithTools.invoke(messages);
    messages.push(response);

    // 检查是否有工具调用
    if (!response.tool_calls || response.tool_calls.length === 0) {
      console.log(`\n✨ AI 最终回复:\n${response.content}\n`);
      return response.content;
    }

    console.log(chalk.bgBlue(`🔍 检测到 ${response.tool_calls.length} 个工具调用`));
    console.log(chalk.bgBlue(`🔍 工具调用: ${response.tool_calls.map(t => t.name).join(', ')}`));
    // 执行工具调用
    for (const toolCall of response.tool_calls) {
      const foundTool = tools.find(t => t.name === toolCall.name);
      if (foundTool) {
        try {
          const toolResult = await foundTool.invoke(toolCall.args);
          // 确保 content 是字符串类型 filemcp返回的可能是对象 所以要处理一下
          let contentStr;
          if (typeof toolResult === 'string') {
            contentStr = toolResult;
          } else if (toolResult && toolResult.text) {
            // 如果返回对象有 text 字段，优先使用
            contentStr = toolResult.text;
          }
          messages.push(new ToolMessage({
            content: contentStr,
            tool_call_id: toolCall.id,
          }));
        } catch (error) {
          messages.push(new ToolMessage({
            content: `工具调用失败: ${error.message}`,
            tool_call_id: toolCall.id,
          }));
        }
        await new Promise(r => setTimeout(r, 200));
      }
    }
  }

  return messages[messages.length - 1].content;
}


await runAgentWithTools("请你找出福州站附近的五家饭店，保存下来放在当前目录下的一个文档里");

await mcpClient.close();