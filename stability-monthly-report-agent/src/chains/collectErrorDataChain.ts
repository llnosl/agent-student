import { RunnableLambda, RunnableSequence } from '@langchain/core/runnables';

import type { CliOptions } from '../tools/cli.js';
import { createKibanaErrorCrawlerTool } from '../tools/kibanaCrawler.js';

export type CollectErrorDataRuntime = CliOptions & {
  result?: unknown;
};

/**
 * 校验 Kibana 错误采集链路的必填参数。
 */
function validateCollectInput(runtime: CollectErrorDataRuntime) {
  const missingFields = [
    ['--service', runtime.serviceName],
    ['--kibana-url', runtime.kibanaUrl],
  ]
    .filter(([, value]) => !value)
    .map(([flag]) => flag);

  if (missingFields.length > 0) {
    throw new Error(`缺少采集参数: ${missingFields.join(', ')}`);
  }

  return runtime;
}

/**
 * 调用 Kibana 爬虫工具，把错误数据保存到本地 output 目录。
 */
async function collectKibanaErrors(runtime: CollectErrorDataRuntime) {
  const crawlerTool = createKibanaErrorCrawlerTool();
  const result = await crawlerTool.invoke({
    url: runtime.kibanaUrl as string,
    microserviceName: runtime.serviceName as string,
    cdpUrl: runtime.cdpUrl,
  });

  console.log(`\nKibana 错误数据采集完成:\n${result}\n`);

  return {
    ...runtime,
    result,
  };
}

/**
 * 创建链路 1：Kibana 页面链接 + 微服务名称 -> 本地 output JSON。
 */
export function createCollectErrorDataSequence() {
  return RunnableSequence.from([
    RunnableLambda.from(validateCollectInput),
    RunnableLambda.from(collectKibanaErrors),
  ]);
}
