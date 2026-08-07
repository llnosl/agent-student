/**
 * SRT 字幕翻译脚本
 *
 * 功能：读取日语 .srt，使用 Ollama 本地模型翻译成简体中文字幕，
 *       保留原始序号和时间轴，输出到同目录。
 *
 * 用法：
 *   node "批量生成字幕工具/translate-srt-ollama.mjs" "F:/av合集/JUR-191/JUR-191.H265_ja.srt"
 *
 * 环境变量：
 *   OLLAMA_MODEL       - Ollama 模型名，默认 demonbyron/HY-MT1.5-1.8B:latest
 *   TRANSLATE_DELAY_MS - 每条字幕翻译后的等待时间，默认 150
 */

import { dirname, extname, join, resolve } from "node:path";
import { readFile, rename, writeFile } from "node:fs/promises";
import ollama from "ollama";

const INPUT_FILE = process.argv[2] || "JUR-191.H265_ja.srt";
const MODEL = process.env.OLLAMA_MODEL || "demonbyron/HY-MT1.5-1.8B:latest";
const DELAY_MS = Number(process.env.TRANSLATE_DELAY_MS || "150");

const TIMESTAMP_RE = /^\d{2}:\d{2}:\d{2},\d{3}\s+-->\s+\d{2}:\d{2}:\d{2},\d{3}/;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeNewlines(text) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function buildOutputPath(inputPath) {
  const dir = dirname(inputPath);
  const ext = extname(inputPath) || ".srt";
  const base = inputPath.slice(0, -ext.length);
  const outputBase = base.replace(/(?:[._-]?ja|[._-]?jp)$/i, "");
  return `${outputBase}_zh-CN${ext}`;
}

function parseSrt(raw) {
  return normalizeNewlines(raw)
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, blockIndex) => {
      const lines = block.split("\n");
      const timestampIndex = lines.findIndex((line) => TIMESTAMP_RE.test(line.trim()));

      if (timestampIndex === -1) {
        return {
          malformed: true,
          index: String(blockIndex + 1),
          timestamp: "",
          text: lines.join("\n"),
        };
      }

      return {
        malformed: false,
        index: lines.slice(0, timestampIndex).join("\n").trim() || String(blockIndex + 1),
        timestamp: lines[timestampIndex].trim(),
        text: lines.slice(timestampIndex + 1).join("\n").trim(),
      };
    });
}

function cleanTranslation(text) {
  return (text || "")
    .replace(/^```(?:text|中文|zh|srt)?\s*/i, "")
    .replace(/```$/i, "")
    .replace(/^翻译[:：]\s*/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderSrt(cues) {
  return `${cues
    .map((cue) => [cue.index, cue.timestamp, cue.text].filter(Boolean).join("\n"))
    .join("\n\n")}\n`;
}

async function translateText(text) {
  const source = text.trim();
  if (!source) return "";

  const response = await ollama.chat({
    model: MODEL,
    options: {
      temperature: 0.1,
    },
    messages: [
      {
        role: "system",
        content:
          "你是专业日译中字幕翻译。只输出简体中文译文，不解释，不添加序号，不添加时间轴。保留原意，语句自然，字幕要简洁。",
      },
      {
        role: "user",
        content: source,
      },
    ],
  });

  return cleanTranslation(response.message?.content || "");
}

async function main() {
  const inputPath = resolve(INPUT_FILE);
  const outputPath = buildOutputPath(inputPath);
  const tempPath = join(dirname(outputPath), `.${Date.now()}.${outputPath.split(/[\\/]/).pop()}.tmp`);

  console.log(`读取字幕: ${inputPath}`);
  console.log(`输出字幕: ${outputPath}`);
  console.log(`Ollama 模型: ${MODEL}`);

  const raw = await readFile(inputPath, "utf8");
  const cues = parseSrt(raw);
  console.log(`共 ${cues.length} 条字幕\n`);

  const translatedCues = [];

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];

    if (cue.malformed || !cue.text) {
      translatedCues.push(cue);
      continue;
    }

    process.stdout.write(`[${i + 1}/${cues.length}] `);

    try {
      const translated = await translateText(cue.text);
      translatedCues.push({ ...cue, text: translated || cue.text });
      console.log((translated || cue.text).replace(/\s+/g, " ").slice(0, 60));
    } catch (error) {
      translatedCues.push(cue);
      console.log(`翻译失败，保留原文: ${error.message}`);
    }

    await writeFile(tempPath, renderSrt(translatedCues), "utf8");
    await sleep(DELAY_MS);
  }

  await writeFile(tempPath, renderSrt(translatedCues), "utf8");
  await rename(tempPath, outputPath);
  console.log(`\n完成: ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
