import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type ErrorReport = {
  project?: string;
  errors?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

export type ErrorGroup = {
  id: string;
  fingerprint: string;
  representativeIndex: number;
  errorIndexes: number[];
  errors: Array<Record<string, unknown>>;
};

export type BatchFixWriteInput = {
  status: 'fixed' | 'already-covered' | 'failed';
  rootCause?: string;
  fixSummary?: string;
  failureReason?: string;
};

/**
 * 解析本地 JSON 路径，支持相对当前 Agent 项目的路径。
 */
export function resolveJsonFilePath(jsonFile: string) {
  return path.isAbsolute(jsonFile) ? jsonFile : path.resolve(process.cwd(), jsonFile);
}

/**
 * 读取本地稳定性错误 JSON 报告。
 */
export async function readErrorReport(jsonFile: string) {
  const filePath = resolveJsonFilePath(jsonFile);
  const content = await readFile(filePath, 'utf8');
  return JSON.parse(content) as ErrorReport;
}

/**
 * 按 errors 下标获取单条错误记录，并校验数组结构。
 */
export function getErrorByIndex(report: ErrorReport, errorIndex: number) {
  if (!Array.isArray(report.errors)) {
    throw new Error('本地 JSON 中不存在 errors 数组');
  }

  const error = report.errors[errorIndex];
  if (!error) {
    throw new Error(`本地 JSON 中不存在 errors[${errorIndex}]`);
  }

  return error;
}

/**
 * 获取完整错误数组，并统一校验本地报告结构。
 */
export function getErrors(report: ErrorReport) {
  if (!Array.isArray(report.errors)) {
    throw new Error('本地 JSON 中不存在 errors 数组');
  }

  if (report.errors.length === 0) {
    throw new Error('本地 JSON 中 errors 数组为空');
  }

  return report.errors;
}

/**
 * 把错误记录中的任意字段安全转成字符串，缺失时返回空字符串。
 */
export function readStringField(record: Record<string, unknown>, fieldName: string) {
  const value = record[fieldName];
  return typeof value === 'string' ? value : '';
}

/**
 * 对 URL、动态 ID、时间和堆栈行列号做保守归一化，避免同一错误因运行时数据不同而被重复修复。
 */
function normalizeErrorText(value: string) {
  return value
    .toLowerCase()
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '<uuid>')
    .replace(/\b[0-9a-f]{16,}\b/gi, '<token>')
    .replace(/\b\d{4}-\d{2}-\d{2}[t\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?z?\b/gi, '<time>')
    .replace(/\b\d{6,}\b/g, '<id>')
    .replace(/:\d+:\d+(?=\)?(?:\s|$))/g, ':<line>:<column>')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeRequestUrl(value: string) {
  if (!value) {
    return '';
  }

  try {
    const url = new URL(value, 'http://local.invalid');
    return url.pathname
      .replace(/\/\d{6,}(?=\/|$)/g, '/<id>')
      .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}(?=\/|$)/gi, '/<uuid>')
      .replace(/\/+/g, '/')
      .toLowerCase();
  } catch {
    return normalizeErrorText(value);
  }
}

function normalizeStack(value: string) {
  return value
    .split('\n')
    .map((line) => normalizeErrorText(line))
    .filter(Boolean)
    .slice(0, 5)
    .join('\n');
}

/**
 * 使用确定性字段生成错误指纹。指纹相同的记录才会自动归为同一修复组。
 */
export function createErrorFingerprint(error: Record<string, unknown>) {
  return JSON.stringify({
    category: normalizeErrorText(readStringField(error, 'context.exception.exception_type_1')),
    type: normalizeErrorText(readStringField(error, 'context.exception.exception_type_2')),
    url: normalizeRequestUrl(readStringField(error, 'context.request.url')),
    message: normalizeErrorText(readStringField(error, 'context.exception.exception_type_3')),
    stack: normalizeStack(readStringField(error, '错误堆栈')),
  });
}

/**
 * 按错误指纹稳定分组，保留原 JSON 下标，便于一次修复后回写全部同类记录。
 */
export function groupErrors(report: ErrorReport): ErrorGroup[] {
  const groups = new Map<string, ErrorGroup>();

  getErrors(report).forEach((error, errorIndex) => {
    const baseFingerprint = createErrorFingerprint(error);
    const hasFingerprintEvidence = [
      'context.exception.exception_type_1',
      'context.exception.exception_type_2',
      'context.exception.exception_type_3',
      'context.request.url',
      '错误堆栈',
    ].some((field) => readStringField(error, field).trim());
    // 缺少全部关键字段时不能证明两条记录相同，强制保持为独立错误组。
    const fingerprint = hasFingerprintEvidence ? baseFingerprint : `${baseFingerprint}:${errorIndex}`;
    const existing = groups.get(fingerprint);

    if (existing) {
      existing.errorIndexes.push(errorIndex);
      existing.errors.push(error);
      return;
    }

    const digest = createHash('sha256').update(fingerprint).digest('hex').slice(0, 12);
    groups.set(fingerprint, {
      id: `error-group-${digest}`,
      fingerprint,
      representativeIndex: errorIndex,
      errorIndexes: [errorIndex],
      errors: [error],
    });
  });

  return [...groups.values()];
}

/**
 * 把修复原因和简化操作写回稳定性错误 JSON 的指定错误记录。
 */
export async function writeFixSummaryToErrorReport(
  jsonFile: string,
  errorIndex: number,
  rootCause: string,
  fixSummary: string,
) {
  const filePath = resolveJsonFilePath(jsonFile);
  const report = await readErrorReport(filePath);
  const error = getErrorByIndex(report, errorIndex);

  error['错误原因'] = rootCause;
  error['修复操作（简化）'] = fixSummary;

  await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return error;
}

/**
 * 把一个错误组的处理结果回写到组内所有原始记录。
 */
export async function writeBatchFixResultToErrorReport(
  jsonFile: string,
  group: ErrorGroup,
  input: BatchFixWriteInput,
) {
  const filePath = resolveJsonFilePath(jsonFile);
  const report = await readErrorReport(filePath);
  const errors = getErrors(report);

  for (const errorIndex of group.errorIndexes) {
    const error = errors[errorIndex];
    if (!error) {
      throw new Error(`批量回写时不存在 errors[${errorIndex}]`);
    }

    error['批量修复状态'] = input.status;
    error['错误分组ID'] = group.id;
    error['同类错误数量'] = group.errorIndexes.length;
    error['代表错误下标'] = group.representativeIndex;

    if (input.rootCause) {
      error['错误原因'] = input.rootCause;
    }
    if (input.fixSummary) {
      error['修复操作（简化）'] = input.fixSummary;
    }
    if (input.failureReason) {
      error['批量修复失败原因'] = input.failureReason;
    } else {
      delete error['批量修复失败原因'];
    }
  }

  await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
