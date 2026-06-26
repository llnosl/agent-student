import { spawn } from 'child_process';
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEDIA_CRAWLER_DIR = path.resolve(__dirname, '../../MediaCrawler');
const PYTHON_BIN = path.resolve(MEDIA_CRAWLER_DIR, 'venv/bin/python');
const DATA_DIR = path.resolve(MEDIA_CRAWLER_DIR, 'data');

function checkMediaCrawlerSetup() {
  try {
    fs.accessSync(path.join(MEDIA_CRAWLER_DIR, 'main.py'), fs.constants.R_OK);
  } catch {
    return 'MediaCrawler 子模块未初始化，请运行: git submodule update --init && cd MediaCrawler && python3 -m venv venv && venv/bin/pip install -r requirements.txt';
  }
  try {
    fs.accessSync(PYTHON_BIN, fs.constants.X_OK);
  } catch {
    return 'MediaCrawler Python 虚拟环境未安装，请运行: cd MediaCrawler && python3 -m venv venv && venv/bin/pip install -r requirements.txt';
  }
  return null;
}

const PLATFORMS = {
  xhs: '小红书',
  dy: '抖音',
  ks: '快手',
  bili: 'B站',
  wb: '微博',
  tieba: '贴吧',
  zhihu: '知乎',
};

const PLATFORM_DATA_DIRS = {
  xhs: 'xhs',
  dy: 'douyin',
  ks: 'kuaishou',
  bili: 'bili',
  wb: 'weibo',
  tieba: 'tieba',
  zhihu: 'zhihu',
};

function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseJsonl(content) {
  return content
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function runCrawler(args, timeoutMs = 120_000) {
  const setupError = checkMediaCrawlerSetup();
  if (setupError) {
    throw new Error(setupError);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_BIN, ['main.py', ...args], {
      cwd: MEDIA_CRAWLER_DIR,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`爬虫执行超时（${timeoutMs / 1000}s）`));
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`爬虫退出码 ${code}\nstderr: ${stderr}\nstdout: ${stdout}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`启动爬虫失败: ${err.message}`));
    });
  });
}

async function readLatestJsonl(platform, crawlerType, itemType) {
  const dataDir = PLATFORM_DATA_DIRS[platform] || platform;
  const dir = path.join(DATA_DIR, dataDir, 'jsonl');
  const prefix = `${crawlerType}_${itemType}_`;

  try {
    const files = await readdir(dir);
    const matched = files
      .filter((f) => f.startsWith(prefix) && f.endsWith('.jsonl'))
      .sort()
      .reverse();

    if (matched.length === 0) return [];

    const content = await readFile(path.join(dir, matched[0]), 'utf-8');
    return parseJsonl(content);
  } catch {
    return [];
  }
}

export async function searchContent({ platform, keywords, maxCount = 10, getComments = false, timeoutMs = 120_000 }) {
  const args = [
    '--platform', platform,
    '--type', 'search',
    '--keywords', keywords,
    '--crawler_max_notes_count', String(maxCount),
    '--get_comment', getComments ? 'true' : 'false',
    '--save_data_option', 'jsonl',
    '--headless', 'true',
    '--lt', 'cookie',
  ];

  await runCrawler(args, timeoutMs);

  const contents = await readLatestJsonl(platform, 'search', 'contents');
  const comments = getComments ? await readLatestJsonl(platform, 'search', 'comments') : [];

  return { contents, comments, count: contents.length };
}

export async function getPostDetail({ platform, postIds, getComments = true, timeoutMs = 120_000 }) {
  const args = [
    '--platform', platform,
    '--type', 'detail',
    '--specified_id', postIds,
    '--get_comment', getComments ? 'true' : 'false',
    '--save_data_option', 'jsonl',
    '--headless', 'true',
    '--lt', 'cookie',
  ];

  await runCrawler(args, timeoutMs);

  const contents = await readLatestJsonl(platform, 'detail', 'contents');
  const comments = getComments ? await readLatestJsonl(platform, 'detail', 'comments') : [];

  return { contents, comments, count: contents.length };
}

export async function getCreatorPosts({ platform, creatorIds, maxCount = 10, timeoutMs = 120_000 }) {
  const args = [
    '--platform', platform,
    '--type', 'creator',
    '--creator_id', creatorIds,
    '--crawler_max_notes_count', String(maxCount),
    '--save_data_option', 'jsonl',
    '--headless', 'true',
    '--lt', 'cookie',
  ];

  await runCrawler(args, timeoutMs);

  const contents = await readLatestJsonl(platform, 'creator', 'contents');
  const creators = await readLatestJsonl(platform, 'creator', 'creators');

  return { creators, contents, count: contents.length };
}

export async function queryLocalData({ platform, dataType = 'contents', crawlerType = 'search' }) {
  if (platform) {
    const data = await readLatestJsonl(platform, crawlerType, dataType);
    return { platform, crawlerType, dataType, data, count: data.length };
  }

  const result = {};
  for (const p of Object.keys(PLATFORMS)) {
    const data = await readLatestJsonl(p, crawlerType, dataType);
    if (data.length > 0) {
      result[p] = { count: data.length, data };
    }
  }
  return result;
}

export async function listPlatforms() {
  const platforms = [];

  for (const [key, name] of Object.entries(PLATFORMS)) {
    const dataDir = PLATFORM_DATA_DIRS[key] || key;
    const dir = path.join(DATA_DIR, dataDir, 'jsonl');
    let hasData = false;
    try {
      const files = await readdir(dir);
      hasData = files.length > 0;
    } catch { }

    platforms.push({
      id: key,
      name,
      crawlerTypes: ['search', 'detail', 'creator'],
      hasLocalData: hasData,
    });
  }

  return platforms;
}
