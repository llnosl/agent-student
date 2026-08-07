/**
 * 标题翻译补全脚本
 *
 * 功能：读取已有的 JSON 数据文件，对其中尚未翻译（title.zh 为空）的条目，
 *       使用 Ollama 本地模型补充中文翻译，并写回原文件。
 *
 * 适用场景：
 *   - 爬虫过程中翻译失败/超时的条目
 *   - 后续新增翻译模型后重新翻译
 *   - 中途断掉后补翻译
 *
 * 环境变量:
 *   OLLAMA_MODEL       - Ollama 翻译模型（默认 demonbyron/HY-MT1.5-1.8B）
 *   TRANSLATE_DELAY_MS - 翻译调用间隔毫秒（默认 350）
 *
 * 用法:
 *   node translate-titles.mjs [JSON文件路径]
 *   node translate-titles.mjs "output/20260705-115128-夢実かなえ JavDB 成人影片數據庫.json"
 *
 * 工作流位置: 可选步骤 —— 爬取后翻译、或任何时候补全翻译
 */

import { readFile, writeFile } from "node:fs/promises";
import ollama from "ollama";

// ---------- 配置 ----------

const INPUT_FILE = process.argv[2] || "output/20260705-115128-夢実かなえ JavDB 成人影片數據庫.json";
const MODEL = process.env.OLLAMA_MODEL || "demonbyron/HY-MT1.5-1.8B";
const DELAY_MS = Number(process.env.TRANSLATE_DELAY_MS || "350");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- 工具函数 ----------

/** 清理文本 */
function cleanText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

// ---------- 翻译 ----------

/** 使用 Ollama 将日文翻译为简体中文 */
async function translateToChinese(text) {
  const source = cleanText(text);
  if (!source) return "";

  await sleep(DELAY_MS);

  try {
    const response = await ollama.chat({
      model: MODEL,
      messages: [
        { role: "user", content: `将以下日语文本翻译成简体中文，只返回翻译结果，不要解释：\n${source}` }
      ],
    });
    return cleanText(response.message.content);
  } catch (error) {
    console.error(`  翻译失败: ${error.message}`);
    return "";
  }
}

// ---------- 主流程 ----------

async function main() {
  console.log(`读取文件: ${INPUT_FILE}`);
  const raw = await readFile(INPUT_FILE, "utf8");
  const data = JSON.parse(raw);

  const items = data.items || [];
  console.log(`共 ${items.length} 条记录，使用模型: ${MODEL}\n`);

  let translated = 0;
  let skipped = 0;

  // 遍历所有条目，跳过已翻译的
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const original = item.title?.original || "";
    const code = item.code || `#${i + 1}`;

    if (item.title?.zh) {
      console.log(`[${i + 1}/${items.length}] ${code} 已有翻译，跳过`);
      skipped++;
      continue;
    }

    process.stdout.write(`[${i + 1}/${items.length}] ${code}: "${original.slice(0, 50)}..." ... `);

    if (!original) {
      console.log("无原文，跳过");
      skipped++;
      continue;
    }

    const zh = await translateToChinese(original);
    if (zh) {
      item.title.zh = zh;
      console.log(zh.slice(0, 60));
      translated++;
    } else {
      console.log("翻译失败");
    }
  }

  console.log(`\n翻译完成: ${translated} 条, 跳过: ${skipped} 条`);

  // 写回原文件
  await writeFile(INPUT_FILE, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  console.log(`已保存到: ${INPUT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
