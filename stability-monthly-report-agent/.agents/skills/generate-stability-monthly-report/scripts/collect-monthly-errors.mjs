#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  assertMonth,
  fetchReportItems,
  monthFolderName,
  parseArgs,
  serviceNameFor,
} from "./lib.mjs";

function usage() {
  console.log(`Usage:
  node collect-monthly-errors.mjs --source-doc <wiki-url> --month YYYY-MM [options]

Options:
  --project-root <path>  Project root (default: cwd)
  --output-dir <path>    JSON directory (default: output/<中文月份>月份月报)
  --cdp-url <url>        Chrome CDP URL (default: http://[::1]:9222)
  --resume               Skip valid existing JSON files
  --start <index>        Zero-based source link index
  --limit <count>        Number of links to process
  --dry-run              Print commands without executing them`);
}

function validOutput(file, sourceUrl) {
  if (!fs.existsSync(file)) return false;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return (
      data.source_url === sourceUrl &&
      Array.isArray(data.errors) &&
      data.total === data.errors.length
    );
  } catch {
    return false;
  }
}

function runCollect(projectRoot, args, environment) {
  return new Promise((resolve) => {
    const child = spawn("npm", args, {
      cwd: projectRoot,
      stdio: "inherit",
      env: environment,
    });
    child.on("error", (error) =>
      resolve({ code: -1, error: error.message }),
    );
    child.on("close", (code) => resolve({ code: code ?? -1 }));
  });
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  usage();
  process.exit(0);
}
if (!options["source-doc"] || !options.month) {
  usage();
  process.exit(2);
}
assertMonth(options.month);

const projectRoot = path.resolve(options["project-root"] || process.cwd());
const cdpUrl = String(options["cdp-url"] || "http://[::1]:9222");
const rootOutputDir = path.join(projectRoot, "output");
const outputDir = options["output-dir"]
  ? path.resolve(projectRoot, String(options["output-dir"]))
  : path.join(rootOutputDir, monthFolderName(options.month));
const allItems = fetchReportItems(String(options["source-doc"]));
const start = Number(options.start || 0);
const limit = Number(options.limit || allItems.length);
const selected = allItems.slice(start, start + limit);
const outcomes = [];
fs.mkdirSync(outputDir, { recursive: true });

console.log(
  `Found ${allItems.length} links; processing ${selected.length} from index ${start}.`,
);

for (let offset = 0; offset < selected.length; offset += 1) {
  const item = selected[offset];
  const index = start + offset;
  const serviceName = serviceNameFor(item);
  const expectedFile = path.join(
    outputDir,
    `${options.month}-${serviceName}-稳定性错误.json`,
  );
  if (options.resume && validOutput(expectedFile, item.url)) {
    console.log(`[${index + 1}/${allItems.length}] skip ${serviceName}`);
    outcomes.push({ index, serviceName, code: 0, skipped: true });
    continue;
  }

  const npmArgs = [
    "run",
    "collect:error",
    "--",
    "--service",
    serviceName,
    "--kibana-url",
    item.url,
    "--cdp-url",
    cdpUrl,
    "--save-runs",
  ];
  console.log(
    `[${index + 1}/${allItems.length}] npm ${npmArgs.join(" ")}`,
  );
  if (options["dry-run"]) {
    outcomes.push({ index, serviceName, code: 0, dryRun: true });
    continue;
  }

  const nodeOptions = [
    process.env.NODE_OPTIONS,
    "--experimental-global-webcrypto",
  ]
    .filter(Boolean)
    .join(" ");
  const outcome = await runCollect(projectRoot, npmArgs, {
    ...process.env,
    NODE_OPTIONS: nodeOptions,
    NO_PROXY: "127.0.0.1,localhost,::1",
    no_proxy: "127.0.0.1,localhost,::1",
  });
  outcomes.push({ index, serviceName, ...outcome });
  if (outcome.code !== 0) {
    console.error(`Collection failed at index ${index}: ${serviceName}`);
    console.error(
      `Resume with --resume, or retry this item with --start ${index} --limit 1.`,
    );
    process.exitCode = 1;
    break;
  }
  if (!validOutput(expectedFile, item.url)) {
    const generatedFile = path.join(
      rootOutputDir,
      `${options.month}-${serviceName}-稳定性错误.json`,
    );
    if (generatedFile !== expectedFile && fs.existsSync(generatedFile)) {
      fs.renameSync(generatedFile, expectedFile);
    }
  }
  if (!validOutput(expectedFile, item.url)) {
    const currentMonth = new Date().toISOString().slice(0, 7);
    throw new Error(
      `Expected ${expectedFile} was not produced. The crawler names files by execution month (${currentMonth}); verify --month and the Kibana time window.`,
    );
  }
}

console.log(JSON.stringify({ total: allItems.length, outcomes }, null, 2));
