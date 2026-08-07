import { RunnableLambda, RunnableSequence } from '@langchain/core/runnables';
import type { StructuredToolInterface } from '@langchain/core/tools';

import { createFixKnowledgeCollectionSequence } from './fixKnowledgeCollectionChain.js';
import { runAgentWithTools } from '../tools/agent.js';
import type { CliOptions } from '../tools/cli.js';
import { formatErrorKnowledgeBase, readErrorKnowledgeBase } from '../tools/errorKnowledge.js';
import { getErrorByIndex, readErrorReport, readStringField, resolveJsonFilePath } from '../tools/localJson.js';
import { createModel } from '../tools/model.js';
import { getServiceProjectPath } from '../tools/serviceProjects.js';

export type FixFromLocalJsonRuntime = CliOptions & {
  tools?: StructuredToolInterface[];
  serviceProjectPath?: string;
  jsonFilePath?: string;
  selectedError?: Record<string, unknown>;
  errorKnowledgeContext?: string;
  result?: unknown;
};

/**
 * 校验本地 JSON 修复链路的必填参数。
 */
function validateFixInput(runtime: FixFromLocalJsonRuntime) {
  const missingFields = [
    ['--service', runtime.serviceName],
    ['--json-file', runtime.jsonFile],
    ['--error-index', runtime.errorIndex === undefined || Number.isNaN(runtime.errorIndex) ? undefined : String(runtime.errorIndex)],
  ]
    .filter(([, value]) => !value)
    .map(([flag]) => flag);

  if (missingFields.length > 0) {
    throw new Error(`缺少本地修复参数: ${missingFields.join(', ')}`);
  }

  if (!runtime.tools) {
    throw new Error('Agent 工具未加载，无法执行本地修复链路');
  }

  return runtime;
}

/**
 * 读取服务对应的本地项目路径。
 */
async function loadServicePath(runtime: FixFromLocalJsonRuntime) {
  const serviceProjectPath = await getServiceProjectPath(runtime.serviceName as string);
  return {
    ...runtime,
    serviceProjectPath,
  };
}

/**
 * 从本地稳定性 JSON 中读取指定下标的错误记录。
 */
async function loadLocalError(runtime: FixFromLocalJsonRuntime) {
  const jsonFilePath = resolveJsonFilePath(runtime.jsonFile as string);
  const report = await readErrorReport(jsonFilePath);
  const selectedError = getErrorByIndex(report, runtime.errorIndex as number);

  return {
    ...runtime,
    jsonFilePath,
    selectedError,
  };
}

/**
 * 读取常见错误知识库，作为本地修复 Agent 的参考上下文。
 */
async function loadErrorKnowledge(runtime: FixFromLocalJsonRuntime) {
  const knowledgeBase = await readErrorKnowledgeBase();
  return {
    ...runtime,
    errorKnowledgeContext: formatErrorKnowledgeBase(knowledgeBase),
  };
}

/**
 * 将错误记录整理成 Agent 可执行的修复任务提示词。
 */
function buildFixQuery(runtime: FixFromLocalJsonRuntime) {
  const error = runtime.selectedError as Record<string, unknown>;
  const errorTime = readStringField(error, 'Time');
  const errorType = readStringField(error, 'context.exception.exception_type_2');
  const errorCategory = readStringField(error, 'context.exception.exception_type_1');
  const errorPageUrl = readStringField(error, 'context.request.url');
  const errorMessage = readStringField(error, 'context.exception.exception_type_3');
  const errorStack = readStringField(error, '错误堆栈');
  const operationClues = readStringField(error, '操作线索');

  return `请执行本地稳定性错误修复任务。

服务名称: ${runtime.serviceName}
本地项目路径: ${runtime.serviceProjectPath}
本地错误 JSON: ${runtime.jsonFilePath}
错误下标: ${runtime.errorIndex}
目标修复分支: f/fitkibanaerror

Kibana 错误信息:
- 发生时间: ${errorTime}
- 错误分类: ${errorCategory}
- 错误类型: ${errorType}
- context.request.url: ${errorPageUrl}
- 错误内容: ${errorMessage}

错误堆栈:
${errorStack || '本地 JSON 未提供错误堆栈字段。'}

操作线索:
${operationClues || '本地 JSON 未提供操作线索字段。'}

常见错误知识库:
${runtime.errorKnowledgeContext || '未读取到常见错误知识库。'}

知识库使用要求:
1. 常见错误知识库只是参考，不允许在没有代码证据的情况下直接套用修复。
2. 如果知识库建议和当前代码不一致，以当前代码、错误内容、错误堆栈和操作线索为准。

执行要求:
1. 进入本地项目路径，先执行 git status，识别用户已有改动，不能覆盖用户已有改动。
2. 基于当前代码创建或切换到本地分支 f/fitkibanaerror；如果分支已存在，切换到该分支。
3. 根据 context.request.url 在微应用路由配置中定位对应页面代码。
4. 结合错误内容、错误堆栈和操作线索分析根因。
5. 只做最小必要修复，不做无关重构。
6. 修复后运行项目已有的类型检查、lint 或相关测试；如果无法运行，需要说明原因。
7. 最终回复根因、修改文件、验证结果和当前分支。
8. 最终回复末尾必须严格包含以下结构化摘要，标签和四个字段都不能省略，JSON 字符串中不能使用未转义换行：
<fix-summary>
{"errorName":"当前错误的简洁名称","rootCause":"本次结合代码确认的错误原因","fixSummary":"本次修复操作的简化步骤","branch":"实际创建或切换的修复分支"}
</fix-summary>`;
}

/**
 * 调用带本地文件和终端能力的 Agent 执行代码定位、修复和验证。
 */
async function runFixAgent(runtime: FixFromLocalJsonRuntime) {
  const model = createModel();
  const result = await runAgentWithTools(model, buildFixQuery(runtime), runtime.tools as StructuredToolInterface[], {
    saveRuns: runtime.saveRuns,
  });

  return {
    ...runtime,
    result,
  };
}

/**
 * 创建链路 2：读取本地 JSON 错误 -> 定位本地项目页面 -> 修复并创建分支。
 */
export function createFixFromLocalJsonSequence() {
  const fixKnowledgeCollectionSequence = createFixKnowledgeCollectionSequence();

  return RunnableSequence.from([
    RunnableLambda.from(validateFixInput),
    RunnableLambda.from(loadServicePath),
    RunnableLambda.from(loadLocalError),
    RunnableLambda.from(loadErrorKnowledge),
    RunnableLambda.from(runFixAgent),
    fixKnowledgeCollectionSequence,
  ]);
}
