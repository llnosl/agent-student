/**
 * JavDB 演员影片数据爬虫（HTTP 直连版）
 *
 * 功能：爬取 JavDB 某演员的所有影片信息，包括：番号、标题（含中文翻译）、
 *       简介、发行日期、时长、导演、片商、系列、标签、磁力链接。
 *       翻译使用本地 Ollama 模型。
 *
 * 注意：此版本使用 HTTP 直连，可能触发 Cloudflare 拦截。
 *       如果遇到验证页面，请改用 scrape-javdb-browser.mjs（浏览器版）。
 *
 * 环境变量:
 *   JAVDB_COOKIE       - JavDB 登录后的 Cookie（可选，用于访问受限内容）
 *   HTTPS_PROXY        - HTTP(S) 代理地址（如 http://127.0.0.1:7890）
 *   OLLAMA_MODEL       - Ollama 翻译模型（默认 demonbyron/HY-MT1.5-1.8B）
 *   MAX_PAGES          - 最多爬取页数（0 = 不限）
 *   CONCURRENCY        - 并发数（默认 2）
 *   TRANSLATE_DELAY_MS - 翻译间隔毫秒（默认 350）
 *   REQUEST_DELAY_MS   - 请求间隔毫秒（默认 700）
 *
 * 用法:
 *   node scrape-javdb.mjs [演员页面URL]
 *   node scrape-javdb.mjs "https://javdb.com/actors/1G09?t=s&sort_type=0"
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import ollama from "ollama";
import { ProxyAgent, setGlobalDispatcher } from "undici";

// ---------- 配置 ----------

const DEFAULT_URL = "https://javdb.com/actors/1G09?t=s&sort_type=0";
const BASE_URL = "https://javdb.com";
const OUTPUT_DIR = path.resolve("output");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "javdb-actor-1G09.json");

const startUrl = process.argv[2] || DEFAULT_URL;
const maxPages = Number(process.env.MAX_PAGES || "0");
const concurrency = Number(process.env.CONCURRENCY || "2");
const translateDelayMs = Number(process.env.TRANSLATE_DELAY_MS || "350");
const requestDelayMs = Number(process.env.REQUEST_DELAY_MS || "700");
const javdbCookie = process.env.JAVDB_COOKIE || "";
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY || "";
const ollamaModel = process.env.OLLAMA_MODEL || "demonbyron/HY-MT1.5-1.8B";

// 设置全局代理
if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  console.log(`Using proxy: ${proxyUrl}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- 工具函数 ----------

/** 将相对路径转为绝对 URL */
function absoluteUrl(href) {
  return new URL(href, BASE_URL).toString();
}

/** 清理文本：合并多余空白、去除首尾空格 */
function cleanText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

/**
 * 从文本中提取番号，如 "MEYD-884"、"meyd-884"
 * 支持多个候选，返回第一个匹配的
 */
function pickCode(...values) {
  for (const value of values) {
    const match = cleanText(value).match(/[A-Z]{2,10}[-_ ]?\d{2,6}/i);
    if (match) return match[0].replace(/[ _]/g, "-").toLowerCase();
  }
  return "";
}

// ---------- 网络请求 ----------

/**
 * 带重试的页面抓取
 * 遇到 403/429/5xx 会重试最多 3 次
 */
async function fetchText(url, attempt = 1) {
  await sleep(requestDelayMs);
  const response = await fetch(url, {
    headers: {
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7",
      "cache-control": "no-cache",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      ...(javdbCookie ? { cookie: javdbCookie } : {})
    }
  });

  if (!response.ok) {
    if (attempt < 3 && [403, 429, 500, 502, 503, 504].includes(response.status)) {
      await sleep(1500 * attempt);
      return fetchText(url, attempt + 1);
    }
    throw new Error(`Fetch failed ${response.status} ${response.statusText}: ${url}`);
  }

  return response.text();
}

// ---------- 页面解析 ----------

/**
 * 解析影片列表页
 * @returns {{ movies: Array, nextUrl: string }}
 */
function parseListPage(html, pageUrl) {
  const $ = cheerio.load(html);
  const movies = [];

  // 适配多种可能的 DOM 结构
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
    const code = pickCode(item.find("strong").first().text(), title, href);

    movies.push({
      code,
      originalTitle: title,
      url: absoluteUrl(href)
    });
  });

  // 查找下一页链接
  const nextHref = $("a.pagination-next:not([disabled]), .pagination-next a, a[rel='next']")
    .first()
    .attr("href");

  return {
    movies,
    nextUrl: nextHref ? absoluteUrl(nextHref) : "",
    pageUrl
  };
}

/**
 * 从详情页提取字段值（如导演、片商、日期等）
 * @param {cheerio.Root} $ - cheerio 实例
 * @param {string[]} names - 字段名候选（中/日文）
 */
function fieldValue($, names) {
  const wanted = new Set(names);
  let value = "";

  $(".panel-block, .movie-panel-info .item, .video-meta-panel .item, .metadata .item").each((_, el) => {
    const label = cleanText($(el).find("strong, .label, .title").first().text()).replace(/:|：/g, "");
    if (!wanted.has(label)) return;
    value = cleanText($(el).find(".value").text() || $(el).clone().children("strong,.label,.title").remove().end().text());
    return false; // 找到即退出
  });

  return value;
}

/** 文件大小字符串转字节数（用于排序比较） */
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

/**
 * 从详情页解析所有磁力候选
 * 从 <a href="magnet:..."> 或 [data-clipboard-text="magnet:..."] 等属性中提取
 */
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

/**
 * 从候选中选择最佳磁力链接
 * 优先选中文字幕版本，其次选最小文件
 */
function pickBestMagnet(candidates) {
  if (candidates.length === 0) return null;
  const pool = candidates.some((candidate) => candidate.hasSubtitle)
    ? candidates.filter((candidate) => candidate.hasSubtitle)
    : candidates;
  return [...pool].sort((a, b) => a.sizeBytes - b.sizeBytes)[0];
}

/**
 * 解析影片详情页
 * @param {string} html - 详情页 HTML
 * @param {object} fallback - 列表页获取的基本信息作为回退
 */
function parseDetailPage(html, fallback) {
  const $ = cheerio.load(html);
  const h1 = cleanText($("h1.title, .video-detail h1, h1").first().text());
  const metaDescription = cleanText($('meta[name="description"]').attr("content"));
  const intro = cleanText(
    $(".video-description, .movie-description, .panel.movie-panel-info .content, .description").first().text()
  );
  const code = pickCode(fieldValue($, ["番號", "番号", "識別碼", "识别码", "ID"]), h1, fallback.originalTitle, fallback.url);
  const title = h1 || fallback.originalTitle;
  const description = intro || metaDescription.replace(title, "").trim();
  const magnet = pickBestMagnet(parseMagnetCandidates($));

  return {
    ...fallback,
    code: code || fallback.code,
    originalTitle: title,
    originalDescription: description,
    releaseDate: fieldValue($, ["日期", "發行日期", "发行日期", "発売日"]),
    duration: fieldValue($, ["時長", "时长", "収録時間"]),
    director: fieldValue($, ["導演", "导演", "監督"]),
    studio: fieldValue($, ["片商", "製作商", "制作商", "メーカー"]),
    series: fieldValue($, ["系列"]),
    tags: $(".tags a, .genre a, .panel-block.genre a")
      .map((_, a) => cleanText($(a).text()))
      .get()
      .filter(Boolean),
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

/** 限制并发的批量操作 */
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

/** 翻页收集所有影片链接 */
async function collectMovieLinks() {
  const seen = new Set();
  const movies = [];
  let pageUrl = startUrl;
  let pageCount = 0;

  while (pageUrl) {
    pageCount += 1;
    if (maxPages > 0 && pageCount > maxPages) break;

    console.log(`Fetching list page ${pageCount}: ${pageUrl}`);
    const html = await fetchText(pageUrl);
    const page = parseListPage(html, pageUrl);

    for (const movie of page.movies) {
      if (seen.has(movie.url)) continue;
      seen.add(movie.url);
      movies.push(movie);
    }

    if (!page.nextUrl || page.nextUrl === pageUrl) break;
    pageUrl = page.nextUrl;
  }

  return movies;
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  // 1. 收集所有影片链接
  const links = await collectMovieLinks();
  console.log(`Found ${links.length} unique movies`);

  // 2. 逐条抓取详情 + 翻译
  const details = await mapLimit(links, concurrency, async (movie, index) => {
    console.log(`Fetching detail ${index + 1}/${links.length}: ${movie.code || movie.url}`);
    try {
      const html = await fetchText(movie.url);
      const detail = parseDetailPage(html, movie);
      const [titleZh, descriptionZh] = await Promise.all([
        translateToChinese(detail.originalTitle),
        translateToChinese(detail.originalDescription)
      ]);

      return {
        code: detail.code,
        title: {
          original: detail.originalTitle,
          zh: titleZh
        },
        description: {
          original: detail.originalDescription,
          zh: descriptionZh
        },
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
        title: {
          original: movie.originalTitle,
          zh: ""
        },
        description: {
          original: "",
          zh: ""
        },
        url: movie.url,
        error: error.message
      };
    }
  });

  // 3. 保存结果
  const output = {
    sourceUrl: startUrl,
    scrapedAt: new Date().toISOString(),
    count: details.length,
    items: details
  };

  await writeFile(OUTPUT_FILE, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Saved ${details.length} items to ${OUTPUT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
