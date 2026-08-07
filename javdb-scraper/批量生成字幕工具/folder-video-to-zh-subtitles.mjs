/**
 * 文件夹视频字幕一体化脚本
 *
 * 功能：传入一个视频文件或文件夹，递归扫描视频文件，先用 Faster-Whisper-XXL
 *       生成日语字幕，再用 Ollama 把日语字幕翻译成简体中文字幕。
 *
 * 用法：
 *   node "批量生成字幕工具/folder-video-to-zh-subtitles.mjs" "F:/av合集/JUR-191"
 *   node "批量生成字幕工具/folder-video-to-zh-subtitles.mjs" "F:/av合集"
 *
 * 环境变量：
 *   FWXXL_EXE              - Faster-Whisper-XXL exe 路径
 *   WHISPER_MODEL          - Whisper 模型，默认 medium
 *   WHISPER_DEVICE         - 识别设备，默认 cuda
 *   WHISPER_COMPUTE_TYPE   - 计算精度，默认 float16
 *   OLLAMA_MODEL           - Ollama 模型，默认 demonbyron/HY-MT1.5-1.8B:latest
 *   TRANSLATE_DELAY_MS     - 每条字幕翻译后的等待时间，默认 150
 *   OVERWRITE              - 设为 1 时覆盖已有字幕，默认跳过
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import ollama from "ollama";

const TARGET_PATH = resolve(process.argv[2] || ".");
const FWXXL_EXE = process.env.FWXXL_EXE || "D:/Faster-Whisper-XXL/Faster-Whisper-XXL/faster-whisper-xxl.exe";
const WHISPER_MODEL = process.env.WHISPER_MODEL || "medium";
const WHISPER_DEVICE = process.env.WHISPER_DEVICE || "cuda";
const WHISPER_COMPUTE_TYPE = process.env.WHISPER_COMPUTE_TYPE || "float16";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "demonbyron/HY-MT1.5-1.8B:latest";
const TRANSLATE_DELAY_MS = Number(process.env.TRANSLATE_DELAY_MS || "150");
const OVERWRITE = process.env.OVERWRITE === "1";

const VIDEO_EXTENSIONS = new Set([".mp4", ".mkv", ".avi", ".wmv", ".mov", ".m4v", ".ts", ".flv", ".webm"]);
const TIMESTAMP_RE = /^\d{2}:\d{2}:\d{2},\d{3}\s+-->\s+\d{2}:\d{2}:\d{2},\d{3}/;

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function withoutExt(filePath) {
  const ext = extname(filePath);
  return ext ? filePath.slice(0, -ext.length) : filePath;
}

function jaSrtPathFor(videoPath) {
  return `${withoutExt(videoPath)}_ja.srt`;
}

function zhSrtPathFor(videoPath) {
  return `${withoutExt(videoPath)}_zh-CN.srt`;
}

function normalizeNewlines(text) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
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

function renderSrt(cues) {
  return `${cues
    .map((cue) => [cue.index, cue.timestamp, cue.text].filter(Boolean).join("\n"))
    .join("\n\n")}\n`;
}

function cleanTranslation(text) {
  return (text || "")
    .replace(/^```(?:text|中文|zh|srt)?\s*/i, "")
    .replace(/```$/i, "")
    .replace(/^翻译[:：]\s*/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function findVideoFiles(targetPath) {
  const targetStat = await stat(targetPath);

  if (targetStat.isFile()) {
    return VIDEO_EXTENSIONS.has(extname(targetPath).toLowerCase()) ? [targetPath] : [];
  }

  const found = [];

  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }

      if (entry.isFile() && VIDEO_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        found.push(entryPath);
      }
    }
  }

  await walk(targetPath);
  return found.sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

function runCommand(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      windowsHide: false,
    });

    child.on("error", rejectRun);
    child.on("close", (code) => {
      if (code === 0) {
        resolveRun();
      } else {
        rejectRun(new Error(`命令退出码: ${code}`));
      }
    });
  });
}

async function generateJapaneseSrt(videoPath) {
  const outputPath = jaSrtPathFor(videoPath);

  if (!OVERWRITE && existsSync(outputPath)) {
    console.log(`  已有日语字幕，跳过识别: ${outputPath}`);
    return outputPath;
  }

  if (!existsSync(FWXXL_EXE)) {
    throw new Error(`找不到 Faster-Whisper-XXL: ${FWXXL_EXE}`);
  }

  console.log(`  生成日语字幕: ${videoPath}`);

  await runCommand(FWXXL_EXE, [
    videoPath,
    "--model",
    WHISPER_MODEL,
    "--language",
    "ja",
    "--task",
    "transcribe",
    "--device",
    WHISPER_DEVICE,
    "--compute_type",
    WHISPER_COMPUTE_TYPE,
    "--output_format",
    "srt",
    "--output_dir",
    "source",
    "--vad_filter",
    "True",
    "--beam_size",
    "5",
    "--standard_asia",
    "--postfix",
    "--print_progress",
  ]);

  if (!existsSync(outputPath)) {
    throw new Error(`识别完成但未找到预期日语字幕: ${outputPath}`);
  }

  return outputPath;
}

async function translateText(text) {
  const source = text.trim();
  if (!source) return "";

  const response = await ollama.chat({
    model: OLLAMA_MODEL,
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

async function translateSrt(jaPath, zhPath) {
  if (!OVERWRITE && existsSync(zhPath)) {
    console.log(`  已有中文字幕，跳过翻译: ${zhPath}`);
    return;
  }

  console.log(`  翻译中文字幕: ${jaPath}`);

  const raw = await readFile(jaPath, "utf8");
  const cues = parseSrt(raw);
  const translatedCues = [];
  const tempName = `.subtitle-translate-${createHash("sha1").update(zhPath).digest("hex").slice(0, 10)}.tmp`;
  const tempPath = join(dirname(zhPath), tempName);

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];

    if (cue.malformed || !cue.text) {
      translatedCues.push(cue);
      continue;
    }

    process.stdout.write(`    [${i + 1}/${cues.length}] `);

    try {
      const translated = await translateText(cue.text);
      const text = translated || cue.text;
      translatedCues.push({ ...cue, text });
      console.log(text.replace(/\s+/g, " ").slice(0, 70));
    } catch (error) {
      translatedCues.push(cue);
      console.log(`翻译失败，保留原文: ${error.message}`);
    }

    await writeFile(tempPath, renderSrt(translatedCues), "utf8");
    await sleep(TRANSLATE_DELAY_MS);
  }

  await writeFile(tempPath, renderSrt(translatedCues), "utf8");
  await rename(tempPath, zhPath);
}

async function processVideo(videoPath, index, total) {
  const zhPath = zhSrtPathFor(videoPath);

  console.log(`[${index}/${total}] ${videoPath}`);
  const jaPath = await generateJapaneseSrt(videoPath);
  await translateSrt(jaPath, zhPath);
  console.log(`  完成: ${zhPath}\n`);
}

async function main() {
  console.log(`扫描目标: ${TARGET_PATH}`);
  console.log(`Faster-Whisper-XXL: ${FWXXL_EXE}`);
  console.log(`Whisper: ${WHISPER_MODEL}, ${WHISPER_DEVICE}, ${WHISPER_COMPUTE_TYPE}`);
  console.log(`Ollama 模型: ${OLLAMA_MODEL}`);
  console.log(`覆盖已有字幕: ${OVERWRITE ? "是" : "否"}\n`);

  const videos = await findVideoFiles(TARGET_PATH);
  if (videos.length === 0) {
    console.log("没有找到可处理的视频文件。支持: mp4, mkv, avi, wmv, mov, m4v, ts, flv, webm");
    return;
  }

  console.log(`找到 ${videos.length} 个视频文件\n`);

  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < videos.length; i++) {
    try {
      await processVideo(videos[i], i + 1, videos.length);
      succeeded++;
    } catch (error) {
      failed++;
      console.error(`  失败: ${error.message}\n`);
    }
  }

  console.log(`处理完成。成功: ${succeeded}，失败: ${failed}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
