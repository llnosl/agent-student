import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { RunnableLambda, RunnableSequence } from '@langchain/core/runnables';

import type { CliOptions } from '../tools/cli.js';
import { appendConfirmedErrorKnowledge } from '../tools/errorKnowledge.js';
import { parseFixSummary, type FixSummary } from '../tools/fixSummary.js';
import { writeFixSummaryToErrorReport } from '../tools/localJson.js';

export type FixKnowledgeRuntime = CliOptions & {
  jsonFilePath?: string;
  result?: unknown;
  fixSummary?: FixSummary;
  knowledgeConfirmed?: boolean;
};

/**
 * 从修复 Agent 的最终回复中提取结构化修复摘要。
 */
function collectFixSummary(runtime: FixKnowledgeRuntime) {
  return {
    ...runtime,
    fixSummary: parseFixSummary(runtime.result),
  };
}

/**
 * 将错误原因和简化修复操作写回原稳定性错误 JSON。
 */
async function writeFixRecord(runtime: FixKnowledgeRuntime) {
  if (!runtime.jsonFilePath || runtime.errorIndex === undefined || !runtime.fixSummary) {
    throw new Error('缺少修复摘要回写所需的运行时数据');
  }

  await writeFixSummaryToErrorReport(
    runtime.jsonFilePath,
    runtime.errorIndex,
    runtime.fixSummary.rootCause,
    runtime.fixSummary.fixSummary,
  );

  console.log(`\n修复摘要已写回: ${runtime.jsonFilePath}`);
  console.log(`错误原因: ${runtime.fixSummary.rootCause}`);
  console.log(`修复操作（简化）: ${runtime.fixSummary.fixSummary}\n`);
  return runtime;
}

/**
 * 在当前链路中等待用户确认修复分支是否符合预期，只接受 y 或 n。
 */
async function confirmFixResult(runtime: FixKnowledgeRuntime) {
  const readline = createInterface({ input, output });

  try {
    while (true) {
      const answer = (await readline.question('修复分支是否符合预期，是否写入错误知识库？(y/n): '))
        .trim()
        .toLowerCase();

      if (answer === 'y') {
        return { ...runtime, knowledgeConfirmed: true };
      }

      if (answer === 'n') {
        console.log('已取消写入错误知识库，链路结束。');
        return { ...runtime, knowledgeConfirmed: false };
      }

      console.log('请输入 y 或 n。');
    }
  } finally {
    readline.close();
  }
}

/**
 * 用户确认后把错误名称、错误原因和简化修复操作追加到本地知识库。
 */
async function appendKnowledgeWhenConfirmed(runtime: FixKnowledgeRuntime) {
  if (!runtime.knowledgeConfirmed) {
    return runtime;
  }

  if (!runtime.jsonFilePath || runtime.errorIndex === undefined || !runtime.fixSummary) {
    throw new Error('缺少错误知识入库所需的运行时数据');
  }

  await appendConfirmedErrorKnowledge({
    errorName: runtime.fixSummary.errorName,
    rootCause: runtime.fixSummary.rootCause,
    fixSummary: runtime.fixSummary.fixSummary,
    jsonFile: runtime.jsonFilePath,
    errorIndex: runtime.errorIndex,
    branch: runtime.fixSummary.branch,
  });

  console.log('已将确认后的修复经验写入 config/error-knowledge-base.json。');
  return runtime;
}

/**
 * 创建链路 2 的后置收集链：解析摘要 -> 回写错误 JSON -> y/n 确认 -> 按需写入知识库。
 */
export function createFixKnowledgeCollectionSequence() {
  return RunnableSequence.from([
    RunnableLambda.from(collectFixSummary),
    RunnableLambda.from(writeFixRecord),
    RunnableLambda.from(confirmFixResult),
    RunnableLambda.from(appendKnowledgeWhenConfirmed),
  ]);
}
