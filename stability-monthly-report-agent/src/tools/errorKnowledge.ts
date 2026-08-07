import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type ErrorKnowledgeBase = {
  version: number;
  items: Array<Record<string, unknown>>;
};

/**
 * 读取本地常见错误知识库。当前不做匹配，链路会把完整内容作为上下文传给 Agent。
 */
export async function readErrorKnowledgeBase() {
  const filePath = path.join(process.cwd(), 'config', 'error-knowledge-base.json');
  const content = await readFile(filePath, 'utf8');
  return JSON.parse(content) as ErrorKnowledgeBase;
}

/**
 * 将知识库格式化成稳定的 prompt 文本，避免直接拼接对象得到不可读内容。
 */
export function formatErrorKnowledgeBase(knowledgeBase: ErrorKnowledgeBase) {
  return JSON.stringify(knowledgeBase, null, 2);
}

export type ConfirmedErrorKnowledge = {
  errorName: string;
  rootCause: string;
  fixSummary: string;
  jsonFile: string;
  errorIndex: number;
  branch: string;
};

/**
 * 将用户确认过的修复经验追加到本地错误知识库。
 */
export async function appendConfirmedErrorKnowledge(input: ConfirmedErrorKnowledge) {
  const filePath = path.join(process.cwd(), 'config', 'error-knowledge-base.json');
  const knowledgeBase = await readErrorKnowledgeBase();
  const normalizedId = input.errorName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);

  knowledgeBase.items.push({
    id: `${normalizedId || 'confirmed-error'}-${Date.now()}`,
    errorName: input.errorName,
    reason: input.rootCause,
    solution: [input.fixSummary],
    source: {
      jsonFile: input.jsonFile,
      errorIndex: input.errorIndex,
      branch: input.branch,
      confirmedAt: new Date().toISOString(),
    },
  });

  await writeFile(filePath, `${JSON.stringify(knowledgeBase, null, 2)}\n`, 'utf8');
}
