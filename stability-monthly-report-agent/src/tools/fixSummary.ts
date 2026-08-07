export type FixSummary = {
  errorName: string;
  rootCause: string;
  fixSummary: string;
  branch: string;
};

export type BatchFixSummary = FixSummary & {
  status: 'fixed' | 'already-covered' | 'unresolved';
};

/**
 * 将模型消息内容转换成可解析文本。
 */
export function stringifyAgentResult(result: unknown) {
  if (typeof result === 'string') {
    return result;
  }

  if (Array.isArray(result)) {
    return result
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }
        if (item && typeof item === 'object' && 'text' in item && typeof item.text === 'string') {
          return item.text;
        }
        return JSON.stringify(item);
      })
      .join('\n');
  }

  return String(result ?? '');
}

/**
 * 从批量修复 Agent 的最终回复中解析当前错误组的处理结果。
 */
export function parseBatchFixSummary(result: unknown): BatchFixSummary {
  const content = stringifyAgentResult(result);
  const match = content.match(/<batch-fix-summary>\s*([\s\S]*?)\s*<\/batch-fix-summary>/i);

  if (!match) {
    throw new Error('Agent 最终回复缺少 <batch-fix-summary> 结构化摘要');
  }

  const summary = JSON.parse(match[1]) as Partial<BatchFixSummary>;
  const missingFields = ['errorName', 'rootCause', 'fixSummary', 'branch', 'status']
    .filter((field) => typeof summary[field as keyof BatchFixSummary] !== 'string'
      || !summary[field as keyof BatchFixSummary]);

  if (missingFields.length > 0) {
    throw new Error(`批量修复摘要缺少字段: ${missingFields.join(', ')}`);
  }

  if (!['fixed', 'already-covered', 'unresolved'].includes(summary.status as string)) {
    throw new Error(`批量修复摘要 status 非法: ${summary.status}`);
  }

  return summary as BatchFixSummary;
}

/**
 * 从 Agent 最终回复的 fix-summary 标记中解析结构化修复摘要。
 */
export function parseFixSummary(result: unknown): FixSummary {
  const content = stringifyAgentResult(result);
  const match = content.match(/<fix-summary>\s*([\s\S]*?)\s*<\/fix-summary>/i);

  if (!match) {
    throw new Error('Agent 最终回复缺少 <fix-summary> 结构化修复摘要，无法回写稳定性错误 JSON');
  }

  const summary = JSON.parse(match[1]) as Partial<FixSummary>;
  const missingFields = ['errorName', 'rootCause', 'fixSummary', 'branch']
    .filter((field) => typeof summary[field as keyof FixSummary] !== 'string' || !summary[field as keyof FixSummary]);

  if (missingFields.length > 0) {
    throw new Error(`修复摘要缺少字段: ${missingFields.join(', ')}`);
  }

  return summary as FixSummary;
}
