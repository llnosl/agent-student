import 'dotenv/config';

import { RouterRunnable, RunnableLambda } from '@langchain/core/runnables';
import type { StructuredToolInterface } from '@langchain/core/tools';

import { createCollectErrorDataSequence } from './chains/collectErrorDataChain.js';
import { createFixAllFromLocalJsonSequence } from './chains/fixAllFromLocalJsonChain.js';
import { createFixFromLocalJsonSequence } from './chains/fixFromLocalJsonChain.js';
import { runAgentWithTools } from './tools/agent.js';
import { parseCliArgs, type CliOptions } from './tools/cli.js';
import { createKibanaErrorCrawlerTool } from './tools/kibanaCrawler.js';
import { createMcpClient } from './tools/mcp.js';
import { createModel } from './tools/model.js';
import { getServiceProjectPath } from './tools/serviceProjects.js';
import { createTerminalTool } from './tools/terminal.js';

type AgentRuntime = CliOptions & {
  tools?: StructuredToolInterface[];
  mcpClient?: ReturnType<typeof createMcpClient>;
  result?: unknown;
};

/**
 * RouterRunnable 的初始化阶段：解析 CLI 参数，生成 Agent 运行上下文。
 */
const parseArgsRunnable = RunnableLambda.from((): AgentRuntime => parseCliArgs(process.argv.slice(2)));

/**
 * RouterRunnable 的工具加载阶段：启动 MCP filesystem，并合并终端执行工具。
 */
const loadToolsRunnable = RunnableLambda.from(async (runtime: AgentRuntime): Promise<AgentRuntime> => {
  const mcpClient = createMcpClient();
  const mcpTools = await mcpClient.getTools();
  const isFixWorkflow =
    runtime.workflow === 'fixFromLocalJson' || runtime.workflow === 'fixAllFromLocalJson';
  const serviceWorkingDirectory =
    isFixWorkflow && runtime.serviceName
      ? await getServiceProjectPath(runtime.serviceName)
      : undefined;

  return {
    ...runtime,
    mcpClient,
    tools: [
      ...mcpTools,
      createTerminalTool(serviceWorkingDirectory),
      createKibanaErrorCrawlerTool(),
    ],
  };
});

/**
 * RouterRunnable 的执行阶段：创建模型并启动带工具调用循环的 Agent。
 */
const runAgentRunnable = RunnableLambda.from(async (runtime: AgentRuntime) => {
  if (!runtime.tools) {
    throw new Error('Agent 工具未加载，无法执行任务');
  }

  const model = createModel();
  const result = await runAgentWithTools(model, runtime.query, runtime.tools, { saveRuns: runtime.saveRuns });
  return {
    ...runtime,
    result,
  };
});

/**
 * 链路 1：从 Kibana 采集指定微服务的错误数据并保存到本地 output。
 */
const collectErrorDataRunnable = createCollectErrorDataSequence();

/**
 * 链路 2：读取本地错误 JSON，进入对应本地项目定位并修复问题。
 */
const fixFromLocalJsonRunnable = createFixFromLocalJsonSequence();

/**
 * 链路 3：读取本地错误 JSON 的全部错误，去重后在同一项目分支串行修复。
 */
const fixAllFromLocalJsonRunnable = createFixAllFromLocalJsonSequence();

/**
 * 根据 key 选择不同执行块，便于后续扩展月报采集、分析、修复等独立链路。
 */
const router = new RouterRunnable({
  runnables: {
    parseArgs: parseArgsRunnable,
    loadTools: loadToolsRunnable,
    runAgent: runAgentRunnable,
    collectErrorData: collectErrorDataRunnable,
    fixFromLocalJson: fixFromLocalJsonRunnable,
    fixAllFromLocalJson: fixAllFromLocalJsonRunnable,
  },
});

/**
 * 根据 CLI 解析出的 workflow 选择具体链路。
 */
function getRunnableKey(workflow: AgentRuntime['workflow']) {
  if (workflow === 'collectErrorData') {
    return 'collectErrorData';
  }

  if (workflow === 'fixFromLocalJson') {
    return 'fixFromLocalJson';
  }

  if (workflow === 'fixAllFromLocalJson') {
    return 'fixAllFromLocalJson';
  }

  return 'runAgent';
}

async function main() {
  let runtime: AgentRuntime | undefined;

  try {
    runtime = await router.invoke({ key: 'parseArgs', input: undefined });
    runtime = await router.invoke({ key: 'loadTools', input: runtime });
    await router.invoke({
      key: getRunnableKey(runtime.workflow),
      input: runtime,
    });
  } finally {
    await runtime?.mcpClient?.close();
  }
}

main().catch((error) => {
  console.error('Agent 启动失败:', error);
  process.exit(1);
});
