import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { BaseMessage } from '@langchain/core/messages';
import chalk from 'chalk';

/**
 * 将工具或 MCP 返回值标准化成 ToolMessage 可接受的字符串。
 */
export function stringifyToolResult(result: unknown) {
  if (typeof result === 'string') {
    return result;
  }

  if (result && typeof result === 'object' && 'text' in result && typeof result.text === 'string') {
    return result.text;
  }

  return JSON.stringify(result, null, 2);
}

/**
 * 按需保存 Agent 本次运行的完整消息链路，方便排查工具调用过程。
 */
export async function saveMessages(query: string, messages: BaseMessage[]) {
  const outputDir = path.join(process.cwd(), 'output', 'agent-runs');
  await mkdir(outputDir, { recursive: true });

  const fileName = `${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const filePath = path.join(outputDir, fileName);
  const payload = {
    query,
    messages: messages.map((message) => message.toDict()),
  };

  await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(chalk.gray(`对话记录已保存: ${filePath}`));
}
