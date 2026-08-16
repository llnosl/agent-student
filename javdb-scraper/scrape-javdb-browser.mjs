/**
 * JavDB 演员影片数据爬虫（浏览器版，推荐）
 *
 * 功能：通过 Playwright 启动 Chrome 浏览器爬取 JavDB 某演员的全部影片信息，
 *       包括：番号、标题（含 Ollama 中文翻译）、简介、发行日期、时长、
 *       导演、片商、系列、标签、磁力链接。
 *
 * 相比 HTTP 直连版，此版本能：
 *   - 绕过 Cloudflare 五秒盾人机验证
 *   - 自动点击"已满18岁"确认按钮
 *   - 支持交互式确认（在浏览器确认页面后回车继续）
 *   - 自动生成带时间戳和标题的 JSON 文件名
 *
 * 环境变量:
 *   CHROME_PATH        - Chrome 浏览器路径（默认 C:\Program Files\Google\Chrome\Application\chrome.exe）
 *   JAVDB_PROFILE_DIR  - 持久化浏览器资料目录（默认项目下 .browser-profile）
 *   CDP_URL            - 普通 Chrome 的远程调试地址（默认 http://127.0.0.1:9222）
 *   HEADLESS           - 设为 1 启用无头模式（默认有界面）
 *   CONFIRM_PAGE       - 设为 0 跳过开始前的确认步骤
 *   MANUAL_WAIT_MS     - 遇到验证页面等待时间毫秒（默认 12000）
 *   HTTPS_PROXY        - 浏览器代理（如 http://127.0.0.1:7890）
 *   OLLAMA_MODEL       - Ollama 翻译模型（默认 demonbyron/HY-MT1.5-1.8B）
 *   MAX_PAGES          - 最多爬取页数（0 = 不限）
 *   CONCURRENCY        - 详情页抓取并发数（默认 1）
 *   TRANSLATE_DELAY_MS - 翻译间隔毫秒（默认 350）
 *
 * 用法:
 *   node scrape-javdb-browser.mjs [演员页面URL]
 *   node scrape-javdb-browser.mjs "https://javdb.com/actors/1G09?t=s&sort_type=0"
 *   node scrape-javdb-browser.mjs --single "https://javdb.com/v/详情页ID"
 *
 * 工作流位置: 第 1 步 —— 爬取数据
 */

import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import * as cheerio from "cheerio";
import ollama from "ollama";
import { chromium } from "playwright-core";
import { ProxyAgent, setGlobalDispatcher } from "undici";

// ---------- 配置 ----------

const DEFAULT_URL = "https://javdb.com/actors/1G09?t=s&sort_type=0";
const BASE_URL = "https://javdb.com";
const OUTPUT_DIR = path.resolve("output");
const CHROME_PATH = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE_DIR = path.resolve(process.env.JAVDB_PROFILE_DIR || ".browser-profile");
const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";

const cliArgs = process.argv.slice(2);
const singleMode = cliArgs[0] === "--single";
const startUrl = (singleMode ? cliArgs[1] : cliArgs[0]) || DEFAULT_URL;
let maxPages = Number(process.env.MAX_PAGES || "0");
const concurrency = Number(process.env.CONCURRENCY || "1");
const translateDelayMs = Number(process.env.TRANSLATE_DELAY_MS || "350");
const manualWaitMs = Number(process.env.MANUAL_WAIT_MS || "12000");
const headless = process.env.HEADLESS === "1";
const requireConfirm = process.env.CONFIRM_PAGE !== "0";
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "";
const ollamaModel = process.env.OLLAMA_MODEL || "demonbyron/HY-MT1.5-1.8B";

// 设置 Ollama 请求代理（翻译走 HTTP API，不走浏览器代理）
if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  console.log(`Using proxy: ${proxyUrl}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function cdpIsReady() {
  try {
    const response = await fetch(`${CDP_URL}/json/version`, {
      signal: AbortSignal.timeout(1000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureNormalChrome() {
  if (await cdpIsReady()) return;

  const cdp = new URL(CDP_URL);
  if (!["127.0.0.1", "localhost"].includes(cdp.hostname)) {
    throw new Error(`CDP_URL 未连接，且不能自动启动非本机 Chrome: ${CDP_URL}`);
  }

  const args = [
    `--remote-debugging-port=${cdp.port || "9222"}`,
    `--user-data-dir=${PROFILE_DIR}`,
    "--no-first-run",
    "--no-default-browser-check",
    startUrl,
  ];
  if (proxyUrl) args.unshift(`--proxy-server=${parseProxy(proxyUrl).server}`);
  if (headless) args.unshift("--headless=new");

  const chrome = spawn(CHROME_PATH, args, {
    detached: true,
    stdio: "ignore",
  });
  chrome.unref();

  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await cdpIsReady()) return;
    await sleep(500);
  }
  throw new Error(`普通 Chrome 已启动，但无法连接 CDP: ${CDP_URL}`);
}

// ---------- 工具函数 ----------

/** 将相对路径转为绝对 URL */
function absoluteUrl(href) {
  return new URL(href, BASE_URL).toString();
}

/** 清理文本 */
function cleanText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

/**
 * 安全化文件名：移除 Windows 不允许的字符，限制长度
 * 用于生成 JSON 输出文件名
 */
function sanitizeFilename(value) {
  const safe = cleanText(value)
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return safe || "javdb-scrape";
}

/** 生成时间戳字符串，如 "20260705-115128" */
function timestampForFilename(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}

/**
 * 从文本中提取番号
 * @param {...string} values - 候选文本
 * @returns {string} 小写番号，如 "meyd-884"
 */
function pickCode(...values) {
  for (const value of values) {
    const match = cleanText(value).match(/[A-Z]{2,10}[-_ ]?\d{2,6}/i);
    if (match) return match[0].replace(/[ _]/g, "-").toLowerCase();
  }
  return "";
}

/** 解析代理 URL 为 Playwright 可用的格式 */
function parseProxy(url) {
  if (!url) return undefined;
  const parsed = new URL(url);
  return {
    server: `${parsed.protocol}//${parsed.host}`,
    username: decodeURIComponent(parsed.username || ""),
    password: decodeURIComponent(parsed.password || "")
  };
}

// ---------- 浏览器辅助 ----------

/**
 * 检测并处理 JavDB 的"已满18岁"确认弹窗及 Cloudflare 验证
 * 如果是验证页面会暂停等待用户手动处理
 */
async function waitForHumanIfBlocked(page) {
  // 自动点击"已满18岁"按钮
  const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (/是,?我已滿18歲|是,?我已满18岁|已滿18歲|已满18岁/.test(text)) {
    const yes = page.getByText(/是,?我已滿18歲|是,?我已满18岁|已滿18歲|已满18岁/).first();
    await yes.click({ timeout: 5000 }).catch(() => {});
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  }

  // 检测是否需要人机验证
  const updatedText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (/forbidden|captcha|verify|cloudflare|just a moment|安全|验证/i.test(updatedText)) {
    console.log(`Page may require verification. Waiting ${manualWaitMs}ms for manual action...`);
    await sleep(manualWaitMs);
  }
}

/**
 * 导航到指定 URL 并返回页面 HTML
 * 自动处理年龄确认和验证
 */
async function gotoAndHtml(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForHumanIfBlocked(page);
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  return page.content();
}

/**
 * 交互式确认：让用户确认页面，并询问本次要爬取的页数
 * 适合需要在浏览器中手动操作（如登录）的场景
 */
async function confirmStartPage(page, defaultMaxPages) {
  if (!requireConfirm || headless) return defaultMaxPages;

  const title = await page.title().catch(() => "");
  const currentUrl = page.url();
  console.log("\n浏览器已打开，请确认当前页面是你要爬取的 JavDB 演员影片列表页。");
  console.log(`页面标题: ${title}`);
  console.log(`当前地址: ${currentUrl}`);
  console.log("确认后回到这个终端按 Enter 开始爬取；输入 n 后按 Enter 可取消。\n");

  const rl = createInterface({ input, output });
  const answer = await rl.question("确认开始爬取？[Enter=开始 / n=取消] ");

  if (/^n(o)?$/i.test(answer.trim())) {
    rl.close();
    throw new Error("用户取消爬取");
  }

  while (true) {
    const pageAnswer = await rl.question(
      `请输入要爬取的页数（0=全部，直接回车使用当前值 ${defaultMaxPages}）：`
    );
    const value = pageAnswer.trim() === "" ? defaultMaxPages : Number(pageAnswer.trim());

    if (Number.isInteger(value) && value >= 0) {
      rl.close();
      console.log(value === 0 ? "将爬取全部页面。" : `将爬取前 ${value} 页。`);
      return value;
    }

    console.log("输入无效，请输入 0 或正整数。");
  }
}

/**
 * 询问用户为本次输出 JSON 文件命名
 * @param {string} defaultTitle - 默认标题（取页面 title）
 * @returns {string} 用户输入或默认的标题
 */
async function askOutputTitle(defaultTitle) {
  const fallback = cleanText(defaultTitle) || "JavDB scrape result";
  const rl = createInterface({ input, output });
  const answer = await rl.question(`请输入本次 JSON 标题，直接回车使用默认标题：${fallback}\n标题：`);
  rl.close();
  return cleanText(answer) || fallback;
}

// ---------- 页面解析 ----------

/** 解析影片列表页，返回影片数组和下一页链接 */
function parseListPage(html, pageUrl) {
  const $ = cheerio.load(html);
  const movies = [];

  $(".movie-list .item, .videos .item, .grid-item, a.box").each((_, el) => {
    const item = $(el);
    const link = item.is("a") ? item : item.find('a[href^="/v/"]').first();
    const href = link.attr("href");
    if (!href || !href.includes("/v/")) return;

    const title = cleanText(
      item.find(".video-title").text() ||
      item.find(".title").text() ||
      item.find("img").attr("title") ||
      item.find("img").attr("alt") ||
      link.text()
    );

    movies.push({
      code: pickCode(item.find("strong").first().text(), title, href),
      originalTitle: title,
      url: absoluteUrl(href)
    });
  });

  const nextHref = $("a.pagination-next:not([disabled]), .pagination-next a, a[rel='next']")
    .first()
    .attr("href");

  return {
    movies,
    nextUrl: nextHref ? absoluteUrl(nextHref) : "",
    pageUrl
  };
}

/** 从详情页提取指定字段的值（如导演、片商） */
function fieldValue($, names) {
  const wanted = new Set(names);
  let value = "";

  $(".panel-block, .movie-panel-info .item, .video-meta-panel .item, .metadata .item").each((_, el) => {
    const label = cleanText($(el).find("strong, .label, .title").first().text()).replace(/:|：/g, "");
    if (!wanted.has(label)) return;
    value = cleanText($(el).find(".value").text() || $(el).clone().children("strong,.label,.title").remove().end().text());
    return false;
  });

  return value;
}

/**
 * 从详情页提取演员列表。
 * 优先读取演员栏里的链接文本；如果没有链接，再退回到字段文本拆分。
 */
function actorNames($) {
  const wanted = new Set(["演員", "演员", "女優", "女优", "出演者", "Actress", "Actor"]);
  const actors = [];

  $(".panel-block, .movie-panel-info .item, .video-meta-panel .item, .metadata .item").each((_, el) => {
    const item = $(el);
    const label = cleanText(item.find("strong, .label, .title").first().text()).replace(/:|：/g, "");
    if (!wanted.has(label)) return;

    item.find("a").each((_, a) => {
      const name = cleanText($(a).text());
      if (name) actors.push(name);
    });

    if (actors.length === 0) {
      const text = cleanText(item.find(".value").text() || item.clone().children("strong,.label,.title").remove().end().text());
      for (const name of text.split(/[、,，/\s]+/).map(cleanText).filter(Boolean)) {
        actors.push(name);
      }
    }

    return false;
  });

  return [...new Set(actors)];
}

/**
 * 从详情页提取类别标签。
 * JavDB 的类别行不一定带 .tags 或 .genre 类名，因此同时按字段标题定位。
 */
function categoryTags($) {
  const wanted = new Set(["類別", "类别", "類型", "类型", "Genre", "Genres"]);
  const tags = [];

  $(".panel-block, .movie-panel-info .item, .video-meta-panel .item, .metadata .item").each((_, el) => {
    const item = $(el);
    const label = cleanText(item.find("strong, .label, .title").first().text()).replace(/:|：/g, "");
    if (!wanted.has(label)) return;

    item.find("a").each((_, a) => {
      const tag = cleanText($(a).text());
      if (tag) tags.push(tag);
    });

    if (tags.length === 0) {
      const text = cleanText(
        item.find(".value").text() || item.clone().children("strong,.label,.title").remove().end().text()
      );
      tags.push(...text.split(/[、,，/|]+/).map(cleanText).filter(Boolean));
    }

    return false;
  });

  // 兼容旧页面中直接使用 .tags/.genre 类名的结构。
  $(".tags a, .genre a, .panel-block.genre a").each((_, a) => {
    const tag = cleanText($(a).text());
    if (tag) tags.push(tag);
  });

  return [...new Set(tags)];
}

/** 文件大小字符串转字节数 */
function sizeToBytes(value) {
  const match = cleanText(value).match(/(\d+(?:\.\d+)?)\s*(TB|TiB|GB|GiB|MB|MiB|KB|KiB)/i);
  if (!match) return Number.POSITIVE_INFINITY;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const scale = unit.startsWith("t") ? 1024 ** 4 :
    unit.startsWith("g") ? 1024 ** 3 :
    unit.startsWith("m") ? 1024 ** 2 : 1024;
  return amount * scale;
}

/** 从文本中提取 magnet: 链接 */
function extractMagnet(value) {
  const raw = cleanText(value);
  if (!raw) return "";
  const decoded = (() => {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  })();
  const match = decoded.match(/magnet:\?xt=urn:[^\s"'<>]+/i);
  return match ? match[0] : "";
}

/** 解析详情页中所有的磁力链接候选项 */
function parseMagnetCandidates($) {
  const seen = new Set();
  const candidates = [];

  $('a[href*="magnet:"], [data-clipboard-text*="magnet:"], [data-magnet*="magnet:"], [data-url*="magnet:"]').each((_, el) => {
    const node = $(el);
    const magnet = extractMagnet(
      node.attr("href") ||
      node.attr("data-clipboard-text") ||
      node.attr("data-magnet") ||
      node.attr("data-url") ||
      node.text()
    );
    if (!magnet || seen.has(magnet)) return;
    seen.add(magnet);

    const container = node.closest("tr, li, .item, .file, .magnet, .movie-file, .panel-block, .content").first();
    const text = cleanText([
      container.text(),
      node.attr("title"),
      node.attr("aria-label"),
      node.text()
    ].filter(Boolean).join(" "));

    candidates.push({
      url: magnet,
      title: text,
      size: cleanText(text.match(/\d+(?:\.\d+)?\s*(?:TB|TiB|GB|GiB|MB|MiB|KB|KiB)/i)?.[0]),
      sizeBytes: sizeToBytes(text),
      hasSubtitle: /字幕|中文|中字|subtitle|sub\b/i.test(text)
    });
  });

  return candidates;
}

/** 从候选中选最优磁力：有字幕选最大字幕文件，无字幕选最小文件 */
function pickBestMagnet(candidates) {
  if (candidates.length === 0) return null;
  const subtitleCandidates = candidates.filter((candidate) => candidate.hasSubtitle);
  if (subtitleCandidates.length > 0) {
    return [...subtitleCandidates].sort((a, b) => b.sizeBytes - a.sizeBytes)[0];
  }
  return [...candidates].sort((a, b) => a.sizeBytes - b.sizeBytes)[0];
}

/** 解析影片详情页完整信息 */
function parseDetailPage(html, fallback) {
  const $ = cheerio.load(html);
  const h1 = cleanText($("h1.title, .video-detail h1, h1").first().text());
  const metaDescription = cleanText($('meta[name="description"]').attr("content"));
  const intro = cleanText(
    $(".video-description, .movie-description, .panel.movie-panel-info .content, .description").first().text()
  );
  const title = h1 || fallback.originalTitle;
  const magnet = pickBestMagnet(parseMagnetCandidates($));
  const actors = actorNames($);

  return {
    ...fallback,
    code: pickCode(fieldValue($, ["番號", "番号", "識別碼", "识别码", "ID"]), title, fallback.originalTitle, fallback.url) || fallback.code,
    originalTitle: title,
    originalDescription: intro || metaDescription.replace(title, "").trim(),
    releaseDate: fieldValue($, ["日期", "發行日期", "发行日期", "発売日"]),
    duration: fieldValue($, ["時長", "时长", "収録時間"]),
    director: fieldValue($, ["導演", "导演", "監督"]),
    studio: fieldValue($, ["片商", "製作商", "制作商", "メーカー"]),
    series: fieldValue($, ["系列"]),
    actors,
    tags: categoryTags($),
    magnet
  };
}

// ---------- 翻译 ----------

/** 使用 Ollama 本地模型将日文翻译为简体中文 */
async function translateToChinese(text) {
  const source = cleanText(text);
  if (!source) return "";

  await sleep(translateDelayMs);

  try {
    const response = await ollama.chat({
      model: ollamaModel,
      messages: [
        { role: "user", content: `将以下日语文本翻译成简体中文，只返回翻译结果，不要解释：\n${source}` }
      ],
    });
    return cleanText(response.message.content);
  } catch {
    return "";
  }
}

// ---------- 并发控制 ----------

/** 限制并发的批量异步操作 */
async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await mapper(items[current], current);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ---------- 主流程 ----------

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  if (singleMode && !cliArgs[1]) {
    throw new Error('单条模式缺少详情页 URL。用法：node scrape-javdb-browser.mjs --single "https://javdb.com/v/详情页ID"');
  }

  // 1. 由普通 Chrome 进程打开持久化资料目录，再通过 CDP 连接。
  // 不加入 Playwright 启动浏览器时附带的自动化参数；真人验证仍需手动完成。
  await ensureNormalChrome();
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  if (!context) throw new Error(`CDP 中没有可用的浏览器上下文: ${CDP_URL}`);
  const pages = context.pages();
  const page = pages.find((candidate) => candidate.url().includes("javdb.com")) || pages[0] || await context.newPage();
  console.log(`Connected to normal Chrome via CDP: ${CDP_URL}`);
  console.log(`Using persistent browser profile: ${PROFILE_DIR}`);

  // 单条详情页模式：指定页面一定保存，不执行演员数量或类别过滤。
  if (singleMode) {
    console.log(`Fetching single detail: ${startUrl}`);
    const html = await gotoAndHtml(page, startUrl);
    const detail = parseDetailPage(html, {
      code: pickCode(startUrl),
      originalTitle: "",
      url: page.url()
    });

    if (!detail.code && !detail.originalTitle) {
      throw new Error("当前页面没有解析到影片详情，请确认 URL 指向 JavDB 详情页并已完成登录或真人验证。");
    }

    const [titleZh, descriptionZh] = await Promise.all([
      translateToChinese(detail.originalTitle),
      translateToChinese(detail.originalDescription)
    ]);
    const record = {
      code: detail.code,
      title: { original: detail.originalTitle, zh: titleZh },
      description: { original: detail.originalDescription, zh: descriptionZh },
      releaseDate: detail.releaseDate,
      duration: detail.duration,
      director: detail.director,
      studio: detail.studio,
      series: detail.series,
      tags: detail.tags,
      magnet: detail.magnet?.url || "",
      magnetInfo: detail.magnet ? {
        title: detail.magnet.title,
        size: detail.magnet.size,
        hasSubtitle: detail.magnet.hasSubtitle
      } : null,
      url: detail.url
    };
    const outputFile = path.join(
      OUTPUT_DIR,
      `${timestampForFilename()}-${sanitizeFilename(detail.code || "single")}-single.json`
    );

    await writeFile(outputFile, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    await browser.close();
    console.log("\n----- 单条影片 JSON（可直接复制到目标 JSON 的 items 数组）-----");
    console.log(JSON.stringify(record, null, 2));
    console.log("----- 单条影片 JSON 结束 -----\n");
    console.log(`Saved single item to ${outputFile}`);
    return;
  }

  // 2. 翻页收集所有影片链接
  const seen = new Set();
  const links = [];
  let pageUrl = startUrl;
  let pageCount = 0;

  while (pageUrl) {
    pageCount += 1;
    if (maxPages > 0 && pageCount > maxPages) break;

    console.log(`Fetching list page ${pageCount}: ${pageUrl}`);
    let html = await gotoAndHtml(page, pageUrl);

    // 第一页需要用户确认
    if (pageCount === 1) {
      maxPages = await confirmStartPage(page, maxPages);
      pageUrl = page.url(); // 用户可能在浏览器中跳转到了其他页面
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      html = await page.content();
    }

    const parsed = parseListPage(html, pageUrl);

    if (pageCount === 1 && parsed.movies.length === 0) {
      console.log("当前页面没有解析到影片条目，请确认浏览器停留在影片列表页后重新运行脚本。");
      break;
    }

    for (const movie of parsed.movies) {
      if (seen.has(movie.url)) continue;
      seen.add(movie.url);
      links.push(movie);
    }

    if (!parsed.nextUrl || parsed.nextUrl === pageUrl) break;
    pageUrl = parsed.nextUrl;
  }

  console.log(`Found ${links.length} unique movies`);

  // 3. 逐条抓取详情页 + 翻译标题和简介
  const details = await mapLimit(links, concurrency, async (movie, index) => {
    console.log(`Fetching detail ${index + 1}/${links.length}: ${movie.code || movie.url}`);
    try {
      const detailPage = await context.newPage();
      const html = await gotoAndHtml(detailPage, movie.url);
      await detailPage.close();
      const detail = parseDetailPage(html, movie);
      const hasPriorityTag = detail.tags.some((tag) => /多\s*[pｐ]|黑人/iu.test(tag));
      if (detail.actors.length <= 2 && !hasPriorityTag) {
        console.log(
          `Skipping ${detail.code || movie.code || movie.url}: actors ${detail.actors.length} <= 2 and no 多P/黑人 tag`
        );
        return null;
      }

      if (detail.actors.length <= 2 && hasPriorityTag) {
        console.log(
          `Keeping ${detail.code || movie.code || movie.url}: matched 多P/黑人 tag with ${detail.actors.length} actor(s)`
        );
      }

      const [titleZh, descriptionZh] = await Promise.all([
        translateToChinese(detail.originalTitle),
        translateToChinese(detail.originalDescription)
      ]);

      return {
        code: detail.code,
        title: { original: detail.originalTitle, zh: titleZh },
        description: { original: detail.originalDescription, zh: descriptionZh },
        releaseDate: detail.releaseDate,
        duration: detail.duration,
        director: detail.director,
        studio: detail.studio,
        series: detail.series,
        tags: detail.tags,
        magnet: detail.magnet?.url || "",
        magnetInfo: detail.magnet ? {
          title: detail.magnet.title,
          size: detail.magnet.size,
          hasSubtitle: detail.magnet.hasSubtitle
        } : null,
        url: detail.url
      };
    } catch (error) {
      return {
        code: movie.code,
        title: { original: movie.originalTitle, zh: "" },
        description: { original: "", zh: "" },
        url: movie.url,
        error: error.message
      };
    }
  });

  const filteredDetails = details.filter(Boolean);

  // 4. 询问输出文件名并保存 JSON
  const outputTitle = await askOutputTitle(await page.title().catch(() => ""));
  const outputFile = path.join(
    OUTPUT_DIR,
    `${timestampForFilename()}-${sanitizeFilename(outputTitle)}.json`
  );

  const output = {
    title: outputTitle,
    sourceUrl: startUrl,
    confirmedUrl: page.url(),
    scrapedAt: new Date().toISOString(),
    count: filteredDetails.length,
    items: filteredDetails
  };

  await writeFile(outputFile, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  // 正常关闭专用 Chrome，登录与验证 Cookie 已写入持久化资料目录。
  await browser.close();
  console.log(`Saved ${filteredDetails.length} items to ${outputFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
