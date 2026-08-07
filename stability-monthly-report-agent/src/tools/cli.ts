export type CliOptions = {
  query: string;
  saveRuns: boolean;
  workflow: 'chat' | 'collectErrorData' | 'fixFromLocalJson' | 'fixAllFromLocalJson';
  serviceName?: string;
  kibanaUrl?: string;
  cdpUrl?: string;
  jsonFile?: string;
  errorIndex?: number;
};

const DEFAULT_QUERY = '请确认模型和工具连接正常，并说明你能做什么。';

/**
 * 读取形如 --service ewms 的命令行参数值。
 */
function getFlagValue(argv: string[], flag: string) {
  const index = argv.indexOf(flag);
  if (index < 0) {
    return undefined;
  }

  return argv[index + 1];
}

/**
 * 解析命令行参数，避免控制参数被当成用户问题传给模型。
 */
export function parseCliArgs(argv: string[]): CliOptions {
  const saveRuns = argv.includes('--save-runs');
  const workflow = argv.includes('--collect-error-data')
    ? 'collectErrorData'
    : argv.includes('--fix-all-local-errors')
      ? 'fixAllFromLocalJson'
      : argv.includes('--fix-local-error')
        ? 'fixFromLocalJson'
        : 'chat';
  const serviceName = getFlagValue(argv, '--service');
  const kibanaUrl = getFlagValue(argv, '--kibana-url') || process.env.KIBANA_URL;
  const cdpUrl = getFlagValue(argv, '--cdp-url') || process.env.KIBANA_CDP_URL;
  const jsonFile = getFlagValue(argv, '--json-file');
  const errorIndexValue = getFlagValue(argv, '--error-index');
  const errorIndex = errorIndexValue === undefined ? undefined : Number(errorIndexValue);
  const controlFlags = new Set([
    '--save-runs',
    '--collect-error-data',
    '--fix-local-error',
    '--fix-all-local-errors',
    '--service',
    '--kibana-url',
    '--cdp-url',
    '--json-file',
    '--error-index',
  ]);
  const query = argv
    .filter((arg, index) => {
      const previous = argv[index - 1];
      return !controlFlags.has(arg) && !controlFlags.has(previous);
    })
    .join(' ')
    .trim();

  return {
    query: query || DEFAULT_QUERY,
    saveRuns,
    workflow,
    serviceName,
    kibanaUrl,
    cdpUrl,
    jsonFile,
    errorIndex,
  };
}
