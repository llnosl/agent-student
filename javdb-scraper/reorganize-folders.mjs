/**
 * 文件夹/根目录文件重命名脚本 —— 根据 JSON 中的 title.zh 重命名。
 *
 * 场景：已有 JSON 数据（含番号 code 和中文标题 title.zh），
 *       目标目录下存在以番号开头的文件夹或视频文件，但名称可能不统一。
 *       本脚本只处理目标目录第一层，不递归进入子文件夹。
 *
 * 用法:
 *   node reorganize-folders.mjs <JSON文件> [目标目录]
 *
 *   - JSON文件: 爬虫输出的 JSON 文件路径（必填）
 *   - 目标目录: 可选，默认为 F:\av合集
 *   - 默认预览，设置 DRY_RUN=0 才执行:
 *     PowerShell: $env:DRY_RUN="0"; node reorganize-folders.mjs "output/xxx.json"
 *     CMD:        set DRY_RUN=0 && node reorganize-folders.mjs "output/xxx.json"
 */

import { readFile, readdir, rename } from "node:fs/promises";
import path from "node:path";

// ---------- 配置 ----------

const INPUT_FILE = process.argv[2];
if (!INPUT_FILE) {
  console.error("错误: 请指定 JSON 文件路径");
  console.error("用法: node reorganize-folders.mjs <JSON文件> [目标目录]");
  process.exit(1);
}

const ROOT = process.argv[3] || "F:\\av合集";
const DRY_RUN = process.env.DRY_RUN !== "0";

// ---------- 工具函数 ----------

/**
 * 安全化 Windows 文件名：移除非法字符、合并空白、限制长度。
 * Windows 单段文件名上限 255 字符，这里限制 120 字符保证可读性。
 */
function fixWindowsFilename(name) {
  return name
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/**
 * 构建目标基础名："番号 中文标题"。
 * 去除标题开头的番号（避免重复），不额外截断标题正文，由 fixWindowsFilename 统一限制总长。
 */
function buildFolderName(code, zhTitle) {
  const displayCode = code.toUpperCase();
  const label = zhTitle
    ? zhTitle.replace(/^[A-Z]+[-_ ]?\d+\s*[:：]?\s*/i, "").trim()
    : code;
  return fixWindowsFilename(`${displayCode} ${label}`);
}

/**
 * 从文件夹名中提取完整番号，如：
 *   "meyd-884 新人..." → "meyd-884"
 *   "[7sht.me]MIAA-003-C" → "miaa-003-c"
 * 不区分大小写返回小写；保留 -C、-U 等后缀，后续必须与 JSON code 全名匹配。
 */
function extractCode(name) {
  const m = name.match(/[a-zA-Z]{2,10}[-_]?\d{2,6}(?:[-_][a-zA-Z0-9]+)?/);
  return m ? m[0].replace(/_/g, "-").toLowerCase() : null;
}

/**
 * 去掉版本后缀后的基础番号，如 juq-963-c → juq-963。
 * 仅用于完整匹配失败后的兜底匹配。
 */
function baseCode(code) {
  return code.replace(/-[a-zA-Z0-9]+$/, "");
}

// ---------- 主流程 ----------

async function main() {
  // 1. 读取 JSON，构建 code → zh 映射表（不区分大小写）
  console.log(`读取 JSON: ${INPUT_FILE}`);
  const raw = await readFile(INPUT_FILE, "utf8");
  const data = JSON.parse(raw);
  const items = data.items || [];

  const zhMap = new Map();
  for (const item of items) {
    const code = (item.code || "").toLowerCase();
    const zh = item.title?.zh || "";
    if (code && zh && !zhMap.has(code)) {
      zhMap.set(code, zh);
    }
  }
  console.log(`从 JSON 读取到 ${zhMap.size} 条 code→zh 映射\n`);

  // 2. 扫描目标目录
  console.log(`扫描目标目录: ${ROOT}\n`);
  const entries = await readdir(ROOT, { withFileTypes: true });
  const targets = entries.filter((e) => e.isDirectory() || e.isFile());

  let renamed = 0;
  let skippedNoCode = 0;
  let skippedNoZh = 0;
  let skippedSameName = 0;

  for (const target of targets) {
    const currentName = target.name;
    const currentPath = path.join(ROOT, currentName);
    const ext = target.isFile() ? path.extname(currentName) : "";
    const nameForCode = target.isFile() ? path.basename(currentName, ext) : currentName;
    const kind = target.isFile() ? "文件" : "文件夹";

    // 从文件夹名或根目录文件名提取番号
    const code = extractCode(nameForCode);
    if (!code) {
      console.log(`[跳过] 无法提取番号: ${kind} ${currentName}`);
      skippedNoCode++;
      continue;
    }

    // 优先完整番号匹配；失败后允许 xxx-C / xxx-U 等后缀版本回退匹配基础番号。
    const exactZh = zhMap.get(code);
    const fallbackCode = baseCode(code);
    const fallbackZh = fallbackCode !== code ? zhMap.get(fallbackCode) : "";
    const zh = exactZh || fallbackZh;
    if (!zh) {
      console.log(`[跳过] JSON 中无此完整番号: ${code} ← ${kind} ${currentName}`);
      skippedNoZh++;
      continue;
    }
    if (!exactZh && fallbackZh) {
      console.log(`[后缀匹配] ${code} → ${fallbackCode}`);
    }

    // 构建新名称
    const newName = `${buildFolderName(code, zh)}${ext}`;
    const newPath = path.join(ROOT, newName);

    // 名称相同则跳过
    if (currentName === newName) {
      skippedSameName++;
      continue;
    }

    console.log(`[匹配] ${kind} ${currentName}`);
    console.log(`  → ${newName}`);

    if (DRY_RUN) {
      renamed++;
    } else {
      try {
        await rename(currentPath, newPath);
        console.log(`  ✓ 已重命名`);
        renamed++;
      } catch (err) {
        console.log(`  ✗ 失败: ${err.message}`);
      }
    }
  }

  // 3. 汇总
  console.log(`\n${"=".repeat(60)}`);
  if (DRY_RUN) console.log("  DRY-RUN 模式（设置 DRY_RUN=0 执行实际操作）\n");
  console.log(`  重命名: ${renamed} 个`);
  console.log(`  跳过(无法提取番号): ${skippedNoCode} 个`);
  console.log(`  跳过(JSON无此番号): ${skippedNoZh} 个`);
  console.log(`  跳过(名称已一致): ${skippedSameName} 个`);
}

main().catch(console.error);
