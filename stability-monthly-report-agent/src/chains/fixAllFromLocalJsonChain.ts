import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { RunnableLambda, RunnableSequence } from '@langchain/core/runnables';
import type { StructuredToolInterface } from '@langchain/core/tools';

import { runAgentWithTools } from '../tools/agent.js';
import type { CliOptions } from '../tools/cli.js';
import { appendConfirmedErrorKnowledge } from '../tools/errorKnowledge.js';
import { formatErrorKnowledgeBase, readErrorKnowledgeBase } from '../tools/errorKnowledge.js';
import { parseBatchFixSummary, type BatchFixSummary } from '../tools/fixSummary.js';
import {
  groupErrors,
  readErrorReport,
  readStringField,
  resolveJsonFilePath,
  writeBatchFixResultToErrorReport,
  type ErrorGroup,
} from '../tools/localJson.js';
import { createModel } from '../tools/model.js';
import { getServiceProjectPath } from '../tools/serviceProjects.js';

type BatchGroupResult = {
  group: ErrorGroup;
  status: 'fixed' | 'already-covered' | 'failed' | 'skipped';
  summary?: BatchFixSummary;
  error?: string;
};

export type FixAllFromLocalJsonRuntime = CliOptions & {
  tools?: StructuredToolInterface[];
  serviceProjectPath?: string;
  jsonFilePath?: string;
  errorKnowledgeContext?: string;
  errorGroups?: ErrorGroup[];
  groupResults?: BatchGroupResult[];
  validationResult?: unknown;
};

function validateBatchFixInput(runtime: FixAllFromLocalJsonRuntime) {
  const missingFields = [
    ['--service', runtime.serviceName],
    ['--json-file', runtime.jsonFile],
  ]
    .filter(([, value]) => !value)
    .map(([flag]) => flag);

  if (missingFields.length > 0) {
    throw new Error(`缺少批量修复参数: ${missingFields.join(', ')}`);
  }

  if (!runtime.tools) {
    throw new Error('Agent 工具未加载，无法执行批量修复链路');
  }

  return runtime;
}

async function loadBatchFixContext(runtime: FixAllFromLocalJsonRuntime) {
  const jsonFilePath = resolveJsonFilePath(runtime.jsonFile as string);
  const [serviceProjectPath, report, knowledgeBase] = await Promise.all([
    getServiceProjectPath(runtime.serviceName as string),
    readErrorReport(jsonFilePath),
    readErrorKnowledgeBase(),
  ]);
  const errorGroups = groupErrors(report);

  console.log(`\n读取到 ${report.errors?.length ?? 0} 条错误，按确定性指纹合并为 ${errorGroups.length} 个修复组。`);

  return {
    ...runtime,
    serviceProjectPath,
    jsonFilePath,
    errorKnowledgeContext: formatErrorKnowledgeBase(knowledgeBase),
    errorGroups,
  };
}

function hasCompletedGroup(group: ErrorGroup) {
  return group.errors.every((error) => {
    const status = readStringField(error, '批量修复状态');
    return status === 'fixed' || status === 'already-covered';
  });
}

function buildGroupFixQuery(runtime: FixAllFromLocalJsonRuntime, group: ErrorGroup, groupNumber: number) {
  const error = group.errors[0];
  const errorTime = readStringField(error, 'Time');
  const errorType = readStringField(error, 'context.exception.exception_type_2');
  const errorCategory = readStringField(error, 'context.exception.exception_type_1');
  const errorPageUrl = readStringField(error, 'context.request.url');
  const errorMessage = readStringField(error, 'context.exception.exception_type_3');
  const errorStack = readStringField(error, '错误堆栈');
  const operationClues = readStringField(error, '操作线索');

  return `请执行批量稳定性错误修复中的一个错误组。

批次信息:
- 当前组: ${groupNumber}/${runtime.errorGroups?.length ?? 0}
- 错误分组 ID: ${group.id}
- 原始错误下标: ${group.errorIndexes.join(', ')}
- 同类错误数量: ${group.errorIndexes.length}

项目上下文:
- 服务名称: ${runtime.serviceName}
- 本地项目路径: ${runtime.serviceProjectPath}
- 本地错误 JSON: ${runtime.jsonFilePath}
- 统一修复分支: f/fitkibanaerror

代表错误:
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

执行要求:
1. 进入本地项目路径，先执行 git status 和 git branch --show-current；保留用户已有改动。
2. 整个批次统一使用 f/fitkibanaerror。尚未进入该分支时创建或切换；已经在该分支时直接复用。
3. 根据 URL、异常信息、堆栈和操作线索定位根因；知识库只能作为参考，以当前代码证据为准。
4. 检查当前分支已有修改。如果本错误已被前序错误组的修改覆盖，不要重复修改，status 返回 already-covered。
5. 否则只做最小必要修复，不做无关重构，status 返回 fixed。
6. 如果证据不足或无法安全修复，不要猜测修改，status 返回 unresolved，并在 rootCause 和 fixSummary 中说明阻塞原因。
7. 本组只做必要的局部检查；完整类型检查、lint 或测试将在所有错误组结束后统一执行。
8. 最终回复末尾必须严格包含以下结构，JSON 中不能使用未转义换行:
<batch-fix-summary>
{"status":"fixed|already-covered|unresolved","errorName":"当前错误的简洁名称","rootCause":"结合代码确认的原因或无法修复的原因","fixSummary":"修复步骤、前序覆盖说明或阻塞说明","branch":"实际分支"}
</batch-fix-summary>`;
}

async function processErrorGroups(runtime: FixAllFromLocalJsonRuntime) {
  const groups = runtime.errorGroups as ErrorGroup[];
  const tools = runtime.tools as StructuredToolInterface[];
  const model = createModel();
  const groupResults: BatchGroupResult[] = [];

  for (const [groupIndex, group] of groups.entries()) {
    const progress = `[${groupIndex + 1}/${groups.length}] ${group.id}（原始下标: ${group.errorIndexes.join(', ')}）`;

    if (hasCompletedGroup(group)) {
      console.log(`\n跳过已完成错误组 ${progress}`);
      groupResults.push({ group, status: 'skipped' });
      continue;
    }

    console.log(`\n开始处理错误组 ${progress}`);

    try {
      const result = await runAgentWithTools(
        model,
        buildGroupFixQuery(runtime, group, groupIndex + 1),
        tools,
        { saveRuns: runtime.saveRuns },
      );
      const summary = parseBatchFixSummary(result);
      const status = summary.status === 'unresolved' ? 'failed' : summary.status;

      await writeBatchFixResultToErrorReport(runtime.jsonFilePath as string, group, {
        status,
        rootCause: summary.rootCause,
        fixSummary: summary.fixSummary,
        failureReason: summary.status === 'unresolved' ? summary.fixSummary : undefined,
      });

      groupResults.push({ group, status, summary });
      console.log(`错误组处理完成: ${group.id} -> ${status}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await writeBatchFixResultToErrorReport(runtime.jsonFilePath as string, group, {
        status: 'failed',
        failureReason: message,
      });
      groupResults.push({ group, status: 'failed', error: message });
      console.error(`错误组处理失败，继续下一组: ${group.id}: ${message}`);
    }
  }

  return {
    ...runtime,
    groupResults,
  };
}

async function runBatchValidation(runtime: FixAllFromLocalJsonRuntime) {
  const successfulResults = runtime.groupResults?.filter(
    (result) => result.status === 'fixed' || result.status === 'already-covered',
  ) ?? [];

  if (successfulResults.length === 0) {
    return runtime;
  }

  const query = `批量错误修复已经完成代码修改。请进入 ${runtime.serviceProjectPath}：
1. 执行 git status 和 git diff --check，检查当前 f/fitkibanaerror 分支的全部改动。
2. 根据项目 package.json 或现有脚本，统一运行合适的类型检查、lint 或相关测试。
3. 不要做新的无关重构。如果验证失败，只分析是否需要最小修正；能安全修正则修正后重跑，不能则明确报告。
4. 最终简洁汇报当前分支、验证命令和结果。`;

  try {
    const validationResult = await runAgentWithTools(
      createModel(),
      query,
      runtime.tools as StructuredToolInterface[],
      { saveRuns: runtime.saveRuns },
    );

    return {
      ...runtime,
      validationResult,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`批量统一验证执行失败，保留已回写的分组结果: ${message}`);
    return {
      ...runtime,
      validationResult: `验证执行失败: ${message}`,
    };
  }
}

async function confirmBatchKnowledge(runtime: FixAllFromLocalJsonRuntime) {
  const confirmedResults = runtime.groupResults?.filter(
    (result) => result.summary && result.status === 'fixed',
  ) ?? [];

  const fixedCount = runtime.groupResults?.filter((result) => result.status === 'fixed').length ?? 0;
  const coveredCount = runtime.groupResults?.filter((result) => result.status === 'already-covered').length ?? 0;
  const failedCount = runtime.groupResults?.filter((result) => result.status === 'failed').length ?? 0;
  const skippedCount = runtime.groupResults?.filter((result) => result.status === 'skipped').length ?? 0;

  console.log('\n批量修复完成:');
  console.log(`- 新修复: ${fixedCount}`);
  console.log(`- 被前序修复覆盖: ${coveredCount}`);
  console.log(`- 失败/未解决: ${failedCount}`);
  console.log(`- 已完成跳过: ${skippedCount}`);
  const failedIndexes = runtime.groupResults
    ?.filter((result) => result.status === 'failed')
    .flatMap((result) => result.group.errorIndexes) ?? [];
  if (failedIndexes.length > 0) {
    console.log(`- 失败原始下标: ${failedIndexes.join(', ')}`);
  }
  console.log(`- 结果 JSON: ${runtime.jsonFilePath}\n`);

  if (confirmedResults.length === 0) {
    return runtime;
  }

  const readline = createInterface({ input, output });
  try {
    while (true) {
      const answer = (await readline.question(
        `是否将本批次 ${confirmedResults.length} 个成功错误组写入错误知识库？(y/n): `,
      ))
        .trim()
        .toLowerCase();

      if (answer === 'n') {
        console.log('已取消批量写入错误知识库。');
        return runtime;
      }

      if (answer === 'y') {
        for (const result of confirmedResults) {
          const summary = result.summary as BatchFixSummary;
          await appendConfirmedErrorKnowledge({
            errorName: summary.errorName,
            rootCause: summary.rootCause,
            fixSummary: summary.fixSummary,
            jsonFile: runtime.jsonFilePath as string,
            errorIndex: result.group.representativeIndex,
            branch: summary.branch,
          });
        }
        console.log('已将本批次确认的修复经验写入 config/error-knowledge-base.json。');
        return runtime;
      }

      console.log('请输入 y 或 n。');
    }
  } finally {
    readline.close();
  }
}

/**
 * 创建链路 3：读取本地 JSON 全部错误 -> 确定性去重 -> 同一项目分支串行修复 -> 统一验证。
 */
export function createFixAllFromLocalJsonSequence() {
  return RunnableSequence.from([
    RunnableLambda.from(validateBatchFixInput),
    RunnableLambda.from(loadBatchFixContext),
    RunnableLambda.from(processErrorGroups),
    RunnableLambda.from(runBatchValidation),
    RunnableLambda.from(confirmBatchKnowledge),
  ]);
}
