import { HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { ChatOpenAI } from '@langchain/openai';
import chalk from 'chalk';

import { saveMessages, stringifyToolResult } from './messages.js';

export type RunAgentOptions = {
  maxIterations?: number;
  saveRuns?: boolean;
};

const systemPrompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    '你是一个自动化稳定性月报 Agent。你可以读写允许目录内的本地文件，也可以执行必要的终端脚本。当用户提供 Kibana 链接和微服务名称并要求获取错误数据时，优先调用 crawl_kibana_errors 工具。执行有风险的命令前，需要先说明风险并选择更保守的方式。',
  ],
]);

/**
 * 使用 LangChain 提示词模版创建系统消息，便于后续集中维护 Agent 行为约束。
 */
async function createSystemMessages() {
  const promptValue = await systemPrompt.invoke({});
  return promptValue.toChatMessages();
}

/**
 * 运行支持工具调用的 Agent 循环，直到模型给出最终回答或达到最大迭代次数。
 */
export async function runAgentWithTools(
  model: ChatOpenAI,
  query: string,
  tools: StructuredToolInterface[],
  options: RunAgentOptions = {},
) {
  const { maxIterations = 50, saveRuns = false } = options;
  const modelWithTools = model.bindTools(tools);
  const messages: BaseMessage[] = [
    ...(await createSystemMessages()),
    new HumanMessage(query),
  ];

  for (let i = 0; i < maxIterations; i += 1) {
    console.log(chalk.bgGreen(`⏳ 正在等待 AI 思考... 第 ${i + 1}/${maxIterations} 轮`));
    const response = await modelWithTools.invoke(messages);
    messages.push(response);

    if (!response.tool_calls || response.tool_calls.length === 0) {
      console.log(`\n✨ AI 最终回复:\n${response.content}\n`);
      if (saveRuns) {
        await saveMessages(query, messages);
      }
      return response.content;
    }

    console.log(chalk.bgBlue(`🔍 检测到 ${response.tool_calls.length} 个工具调用`));
    console.log(chalk.bgBlue(`🔍 工具调用: ${response.tool_calls.map((toolCall) => toolCall.name).join(', ')}`));

    for (const toolCall of response.tool_calls) {
      const foundTool = tools.find((tool) => tool.name === toolCall.name);

      if (!foundTool) {
        messages.push(new ToolMessage({
          content: `未找到工具: ${toolCall.name}`,
          tool_call_id: toolCall.id || toolCall.name,
        }));
        continue;
      }

      try {
        const toolResult = await foundTool.invoke(toolCall.args);
        messages.push(new ToolMessage({
          content: stringifyToolResult(toolResult),
          tool_call_id: toolCall.id || toolCall.name,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        messages.push(new ToolMessage({
          content: `工具调用失败: ${message}`,
          tool_call_id: toolCall.id || toolCall.name,
        }));
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  if (saveRuns) {
    await saveMessages(query, messages);
  }
  return messages[messages.length - 1].content;
}
