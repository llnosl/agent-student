import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

const execFileAsync = promisify(execFile);

const DEFAULT_COLUMNS = [
  'Time',
  'context.exception.exception_type_2',
  'context.exception.exception_type_1',
  'context.request.url',
  'context.exception.exception_type_3',
  'context.release',
];

const DEFAULT_CDP_URLS = [
  'http://127.0.0.1:9222',
  'http://[::1]:9222',
];

const DEFAULT_CHROME_EXECUTABLE = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEFAULT_CHROME_DEBUG_ADDRESS = '::1';
const DEFAULT_CHROME_DEBUG_PORT = '9222';
const DEFAULT_CHROME_PROFILE_DIR = '$HOME/chrome-kibana-automation-profile';

function expandHome(value: string) {
  if (value === '$HOME') {
    return process.env.HOME || value;
  }

  if (value.startsWith('$HOME/')) {
    return path.join(process.env.HOME || '$HOME', value.slice('$HOME/'.length));
  }

  if (value === '~') {
    return process.env.HOME || value;
  }

  if (value.startsWith('~/')) {
    return path.join(process.env.HOME || '~', value.slice(2));
  }

  return value;
}

/**
 * 从爬虫 stdout 中提取最终保存的 JSON 文件路径。
 */
function parseSavedFilePath(stdout: string) {
  const match = stdout.match(/Saved \d+ rows to (.+)$/m);
  return match?.[1]?.trim();
}

/**
 * 检测 CDP 地址是否可用，可用时返回 true。
 */
async function canConnectCdp(cdpUrl: string) {
  try {
    const response = await fetch(`${cdpUrl}/json/version`, {
      signal: AbortSignal.timeout(2_000),
    });

    return response.ok;
  } catch {
    return false;
  }
}

function getChromeCdpUrl() {
  const address = process.env.KIBANA_CHROME_REMOTE_DEBUGGING_ADDRESS || DEFAULT_CHROME_DEBUG_ADDRESS;
  const port = process.env.KIBANA_CHROME_REMOTE_DEBUGGING_PORT || DEFAULT_CHROME_DEBUG_PORT;

  return address.includes(':') ? `http://[${address}]:${port}` : `http://${address}:${port}`;
}

function startChromeForKibana() {
  const chromeExecutable = process.env.KIBANA_CHROME_EXECUTABLE || DEFAULT_CHROME_EXECUTABLE;
  const address = process.env.KIBANA_CHROME_REMOTE_DEBUGGING_ADDRESS || DEFAULT_CHROME_DEBUG_ADDRESS;
  const port = process.env.KIBANA_CHROME_REMOTE_DEBUGGING_PORT || DEFAULT_CHROME_DEBUG_PORT;
  const userDataDir = expandHome(process.env.KIBANA_CHROME_USER_DATA_DIR || DEFAULT_CHROME_PROFILE_DIR);
  const args = [
    `--remote-debugging-address=${address}`,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
  ];

  const child = spawn(chromeExecutable, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.on('error', (error) => {
    console.warn(`启动 Chrome 失败: ${error.message}`);
  });
  child.unref();

  return {
    chromeExecutable,
    args,
    cdpUrl: getChromeCdpUrl(),
  };
}

async function waitForCdp(candidates: string[], timeoutMs = 30_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    for (const candidate of candidates) {
      if (await canConnectCdp(candidate)) {
        return candidate;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return undefined;
}

/**
 * 优先连接已有 CDP；如果不可用，则启动指定 Chrome 并等待 /json/version 可访问。
 */
async function resolveCdpUrl(cdpUrl?: string) {
  const candidates = [
    cdpUrl,
    process.env.KIBANA_CDP_URL,
    ...DEFAULT_CDP_URLS,
  ].filter(Boolean) as string[];

  for (const candidate of [...new Set(candidates)]) {
    if (await canConnectCdp(candidate)) {
      return candidate;
    }
  }

  const chrome = startChromeForKibana();
  const startedCandidates = [...new Set([chrome.cdpUrl, ...candidates])];
  const connectedCdpUrl = await waitForCdp(startedCandidates);
  if (connectedCdpUrl) {
    console.log(`已启动 Chrome 并连接 CDP: ${connectedCdpUrl}`);
    return connectedCdpUrl;
  }

  throw new Error(
    `未找到可用的 Chrome CDP 地址。已尝试启动 Chrome：${chrome.chromeExecutable} ${chrome.args.join(' ')}`,
  );
}

/**
 * 创建 Kibana 错误采集工具，通过 URL 和微服务名调用 Python 爬虫并保存到 output 目录。
 */
export function createKibanaErrorCrawlerTool() {
  return new DynamicStructuredTool({
    name: 'crawl_kibana_errors',
    description: '根据 Kibana Discover 链接和微服务名称自动滚动采集全部稳定性错误数据，并保存到本地 output 目录。',
    schema: z.object({
      url: z.string().url().describe('Kibana Discover 页面完整 URL'),
      microserviceName: z.string().min(1).describe('微服务名称，会作为 --project 参数和输出文件名的一部分'),
      cdpUrl: z.string().optional().describe('Chrome DevTools Protocol 地址，默认读取 KIBANA_CDP_URL 或 http://127.0.0.1:9222'),
      loginUsername: z.string().optional().describe('Kibana 登录用户名，默认读取 KIBANA_LOGIN_USERNAME'),
    }),
    func: async ({ url, microserviceName, cdpUrl, loginUsername }) => {
      const projectRoot = process.cwd();
      const outputDir = path.join(projectRoot, 'output');
      const resolvedCdpUrl = await resolveCdpUrl(cdpUrl);
      const args = [
        path.join(projectRoot, 'kibana_error_crawler.py'),
        url,
        '--project',
        microserviceName,
        '--cdp-url',
        resolvedCdpUrl,
        '--columns',
        ...DEFAULT_COLUMNS,
        '--output-dir',
        outputDir,
      ];

      const username = loginUsername || process.env.KIBANA_LOGIN_USERNAME;
      if (username) {
        args.push('--login-username', username);
      }

      const { stdout, stderr } = await execFileAsync('python3', args, {
        cwd: projectRoot,
        maxBuffer: 1024 * 1024 * 10,
        env: process.env,
      });
      const savedFilePath = parseSavedFilePath(stdout);

      return JSON.stringify({
        microserviceName,
        cdpUrl: resolvedCdpUrl,
        outputDir,
        savedFilePath,
        stdout,
        stderr,
      }, null, 2);
    },
  });
}
