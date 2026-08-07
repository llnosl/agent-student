/**
 * 迅雷批量下载脚本
 *
 * 功能：读取爬虫输出的 JSON 文件，提取所有磁力链接，
 *       通过迅雷批量添加下载任务，同时生成 BAT 备用脚本。
 *
 * 环境变量:
 *   THUNDER_EXE - 迅雷主程序路径（默认 D:\YOUXI\Thunder\Program\Thunder.exe）
 *   DELAY_MS    - 每个下载任务间隔毫秒（默认 1500）
 *   DRY_RUN     - 设为 1 开启预览模式，只生成 BAT 不调用迅雷
 *
 * 用法:
 *   # 正式下载
 *   node thunder-batch-download.mjs "output/xxx.json"
 *
 *   # 预览模式（只生成 BAT）
 *   $env:DRY_RUN="1"; node thunder-batch-download.mjs "output/xxx.json"
 *
 * 工作流位置: 第 3 步 —— 批量下载
 */

import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

// ---------- 配置 ----------

const INPUT_FILE = process.argv[2]
  || "output/20260705-115128-夢実かなえ JavDB 成人影片數據庫.json";
const THUNDER_EXE = process.env.THUNDER_EXE || "D:\\YOUXI\\Thunder\\Program\\Thunder.exe";
const DELAY_MS = Number(process.env.DELAY_MS || "1500");
const DRY_RUN = process.env.DRY_RUN === "1";

// ---------- 工具函数 ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 主流程 ----------

async function main() {
  // 1. 读取 JSON 数据
  const raw = await readFile(INPUT_FILE, "utf8");
  const data = JSON.parse(raw);
  const items = data.items || [];

  // 2. 筛选有磁力链接的条目
  const withMagnet = items.filter(
    (item) => item.magnet && item.magnet.startsWith("magnet:")
  );
  const withoutMagnet = items.filter(
    (item) => !item.magnet || !item.magnet.startsWith("magnet:")
  );

  console.log(`共 ${items.length} 条记录`);
  console.log(`有磁力链接: ${withMagnet.length} 条`);
  console.log(`无磁力链接: ${withoutMagnet.length} 条（跳过）\n`);

  if (withMagnet.length === 0) {
    console.log("没有可下载的磁力链接，退出。");
    return;
  }

  // 3. 批量添加下载任务，同时生成 BAT 备用文件
  const batLines = ["@echo off", "chcp 65001 >nul", ""];
  let success = 0;
  let failed = 0;

  console.log("=".repeat(60));
  if (DRY_RUN) {
    console.log("  DRY-RUN 模式：仅预览，不实际调用迅雷");
  } else {
    console.log("  正在批量添加下载任务到迅雷...");
  }
  console.log("=".repeat(60));

  for (let i = 0; i < withMagnet.length; i++) {
    const item = withMagnet[i];
    const code = item.code || `#${i + 1}`;
    const zh = item.title?.zh?.slice(0, 50) || "";
    const label = zh ? `${code} ${zh}` : code;

    // BAT 备份行
    batLines.push(`echo [${i + 1}/${withMagnet.length}] ${label}`);
    batLines.push(`start "" "${THUNDER_EXE}" "${item.magnet}"`);
    batLines.push(`timeout /t 1 /nobreak >nul`);
    batLines.push("");

    process.stdout.write(`[${String(i + 1).padStart(2)}/${withMagnet.length}] ${label} ... `);

    if (DRY_RUN) {
      console.log("预览");
      success++;
      continue;
    }

    // 以 detached 模式启动迅雷，不阻塞当前进程
    try {
      const child = spawn(THUNDER_EXE, [item.magnet], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.on("error", (err) => {
        console.log(`失败: ${err.message}`);
      });
      child.unref();
      console.log("OK");
      success++;
      await sleep(DELAY_MS);
    } catch (err) {
      console.log(`失败: ${err.message}`);
      failed++;
    }
  }

  // 4. 保存 BAT 备用文件
  const batFile = INPUT_FILE.replace(/\.json$/i, "") + "-导入迅雷.bat";
  await writeFile(batFile, batLines.join("\r\n"), "utf8");

  console.log("\n" + "=".repeat(60));
  console.log(`完成: 成功 ${success} 条, 失败 ${failed} 条`);
  console.log(`\nBAT 备用脚本已保存: ${batFile}`);
  console.log(`  如果下载未自动开始，请双击运行此 BAT 文件。`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
