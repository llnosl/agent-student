import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { ChatOpenAI } from '@langchain/openai';
import chalk from 'chalk';
import { HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logsDir = path.join(__dirname, '..', 'chat-logs');

function saveMessages(query, messages) {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '-');
  const sanitizedQuery = query.slice(0, 30).replace(/[\/\\:*?"<>|\s]/g, '_').trim();
  const filename = `${dateStr}_${timeStr}_${sanitizedQuery}.json`;

  const data = messages.map(msg => ({
    role: msg._getType(),
    content: msg.content,
    ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}),
    ...(msg.tool_call_id ? { tool_call_id: msg.tool_call_id } : {}),
  }));

  fs.writeFileSync(path.join(logsDir, filename), JSON.stringify(data, null, 2), 'utf-8');
  console.log(chalk.green(`\n💾 对话记录已保存: chat-logs/${filename}`));
}

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
    "media-crawler": {
      "command": "node",
      "args": [
        "/Users/pupu/代码/agent学习/agent-student/tool-test/src/media-crawler-mcp-server.mjs"
      ]
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
      saveMessages(query, messages);
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

  saveMessages(query, messages);
  return messages[messages.length - 1].content;
}


await runAgentWithTools("请你用mcp在小红书搜索台江区附近美食 只调用1次无论失败还是成功 将结果保存到当前路径下作为json文件保存");

await mcpClient.close();