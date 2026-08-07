#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse as parseDotenv } from "dotenv";

const FIX_BRANCH = "f/fitkibanaerror";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDir, "..");
const agentRoot = path.resolve(skillRoot, "../../..");

function usage() {
  console.log(`Usage:
  node preflight-and-run.mjs --project <name> [options]

Options:
  --month YYYY-MM       Select a month; otherwise use the latest matching month
  --json-file <path>    Process one explicit JSON instead of automatic discovery
  --check-only          Run all read-only checks and stop (default)
  --execute             Recheck, then run npm run fix:local-errors
  --save-runs           Pass --save-runs to the fix chain
  --skip-agent-probe    Testing only; the Skill must not use this in real execution
  --help                Show this help`);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      result[key] = true;
    } else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

function command(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
}

function sanitize(text, secrets = []) {
  let sanitized = String(text || "").replace(
    /\bsk-[A-Za-z0-9_-]{8,}\b/g,
    "<redacted-api-key>",
  );
  for (const secret of secrets.filter(Boolean)) {
    sanitized = sanitized.split(String(secret)).join("<redacted-secret>");
  }
  return sanitized.slice(-2000);
}

function canonical(value) {
  const resolved = path.resolve(value);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function pathCovers(parent, child) {
  const normalizedParent = canonical(parent);
  const normalizedChild = canonical(child);
  return (
    normalizedChild === normalizedParent ||
    normalizedChild.startsWith(`${normalizedParent}${path.sep}`)
  );
}

function versionParts(value) {
  const match = String(value || "").match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  return match
    ? [Number(match[1]), Number(match[2]), Number(match[3] || 0)]
    : null;
}

function atLeast(actual, required) {
  for (let index = 0; index < 3; index += 1) {
    if (actual[index] > required[index]) return true;
    if (actual[index] < required[index]) return false;
  }
  return true;
}

function walkJson(directory, result = []) {
  if (!fs.existsSync(directory)) return result;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "agent-runs" && entry.name !== "skills") {
        walkJson(fullPath, result);
      }
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".json") &&
      entry.name.includes("稳定性错误")
    ) {
      result.push(fullPath);
    }
  }
  return result;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getServiceProjectEnvKey(serviceName) {
  const suffix = serviceName
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `SERVICE_PROJECT_PATH_${suffix}`;
}

function getPendingErrors(report) {
  if (!Array.isArray(report.errors)) return [];
  return report.errors.filter((error) => {
    const status =
      typeof error?.["批量修复状态"] === "string"
        ? error["批量修复状态"]
        : "";
    return status !== "fixed" && status !== "already-covered";
  });
}

function inspectErrorFile(file, serviceName, failures, warnings) {
  let report;
  try {
    report = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    failures.push({
      item: `错误 JSON 无法解析: ${file}`,
      fix: `修复 JSON 格式后重试。${error.message}`,
    });
    return null;
  }
  if (!Array.isArray(report.errors)) {
    failures.push({
      item: `错误 JSON 缺少 errors 数组: ${file}`,
      fix: "重新运行稳定性数据采集，生成标准错误 JSON。",
    });
    return null;
  }
  if (report.total !== report.errors.length) {
    failures.push({
      item: `total 与 errors.length 不一致: ${file}`,
      fix: `修正 total=${report.errors.length}，或重新采集该项目数据。`,
    });
  }
  if (
    typeof report.project === "string" &&
    !report.project.toLowerCase().startsWith(serviceName.toLowerCase())
  ) {
    failures.push({
      item: `JSON project 与服务不匹配: ${file}`,
      fix: `选择 ${serviceName} 对应的错误 JSON。`,
    });
  }
  try {
    fs.accessSync(file, fs.constants.R_OK | fs.constants.W_OK);
  } catch {
    failures.push({
      item: `错误 JSON 不可读写: ${file}`,
      fix: "为当前用户补充该文件的读写权限。",
    });
  }

  const pending = getPendingErrors(report);
  if (report.errors.length === 0) {
    warnings.push(`零错误文件已跳过: ${file}`);
    return { file, report, pending: [] };
  }
  if (pending.length === 0) {
    warnings.push(`全部错误组已完成，文件已跳过: ${file}`);
    return { file, report, pending: [] };
  }
  const evidenceFields = [
    "context.exception.exception_type_1",
    "context.exception.exception_type_2",
    "context.exception.exception_type_3",
    "context.request.url",
    "错误堆栈",
  ];
  const evidenceMissing = pending.filter(
    (error) =>
      !evidenceFields.some(
        (field) =>
          typeof error?.[field] === "string" && error[field].trim().length > 0,
      ),
  );
  if (evidenceMissing.length > 0) {
    failures.push({
      item: `${file} 有 ${evidenceMissing.length} 条待处理错误缺少全部定位证据`,
      fix: "补充异常类型、错误内容、URL 或错误堆栈后重试。",
    });
  }
  if (
    pending.every(
      (error) =>
        typeof error?.["错误堆栈"] !== "string" ||
        !error["错误堆栈"].trim(),
    )
  ) {
    warnings.push(`待处理错误未提供“错误堆栈”，定位精度可能下降: ${file}`);
  }
  return { file, report, pending };
}

function findErrorFiles(
  options,
  serviceName,
  failures,
  warnings,
) {
  let files = [];
  if (options["json-file"]) {
    files = [
      path.isAbsolute(options["json-file"])
        ? options["json-file"]
        : path.resolve(agentRoot, options["json-file"]),
    ];
  } else {
    const pattern = new RegExp(
      `^(\\d{4}-\\d{2})-${escapeRegExp(serviceName)}(?:-|_)`,
    );
    const discovered = walkJson(path.join(agentRoot, "output"))
      .map((file) => ({ file, match: path.basename(file).match(pattern) }))
      .filter((item) => item.match);
    const month =
      options.month ||
      discovered
        .map((item) => item.match[1])
        .sort()
        .at(-1);
    if (!month) {
      failures.push({
        item: `未找到服务 ${serviceName} 的稳定性错误 JSON`,
        fix: "先生成对应月份稳定性月报，或用 --json-file 指定文件。",
      });
      return [];
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      failures.push({
        item: `月份格式错误: ${month}`,
        fix: "使用 YYYY-MM，例如 2026-07。",
      });
      return [];
    }
    files = discovered
      .filter((item) => item.match[1] === month)
      .map((item) => item.file)
      .sort();
    if (!files.length) {
      failures.push({
        item: `${month} 未找到服务 ${serviceName} 的错误 JSON`,
        fix: "先采集该项目数据，或指定存在的 --json-file。",
      });
      return [];
    }
  }

  const inspected = [];
  for (const file of files) {
    if (!fs.existsSync(file)) {
      failures.push({
        item: `错误 JSON 不存在: ${file}`,
        fix: "更正路径，或先生成对应月份稳定性月报。",
      });
      continue;
    }
    const result = inspectErrorFile(
      canonical(file),
      serviceName,
      failures,
      warnings,
    );
    if (result?.pending.length) inspected.push(result);
  }
  if (files.length > 0 && inspected.length === 0 && failures.length === 0) {
    failures.push({
      item: `服务 ${serviceName} 没有待处理错误`,
      fix: "无需创建修复分支；选择其他月份或项目。",
    });
  }
  return inspected;
}

function readJson(file, label, failures) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    failures.push({
      item: `${label} 无法读取或解析: ${file}`,
      fix: error.message,
    });
    return null;
  }
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  usage();
  process.exit(0);
}
if (!options.project) {
  usage();
  process.exit(2);
}
if (options.execute && options["check-only"]) {
  console.error("--execute 和 --check-only 不能同时使用。");
  process.exit(2);
}
if (options.execute && options["skip-agent-probe"]) {
  console.error("--execute 不允许跳过 Agent/MCP/模型探针。");
  process.exit(2);
}

const failures = [];
const warnings = [];
if (canonical(process.cwd()) !== canonical(agentRoot)) {
  failures.push({
    item: `当前目录不是 stability-monthly-report-agent 根目录: ${process.cwd()}`,
    fix: `先执行 cd "${agentRoot}"。`,
  });
}

const aliasesFile = path.join(skillRoot, "references", "project-aliases.json");
const aliasConfig = readJson(aliasesFile, "项目别名配置", failures);
const inputName = String(options.project).trim().toLowerCase();
const serviceName = aliasConfig?.aliases?.[inputName];
if (!serviceName) {
  failures.push({
    item: `不支持的项目名称: ${options.project}`,
    fix: `在 ${aliasesFile} 中补充经负责人确认的别名映射。`,
  });
}

const envFile = path.join(agentRoot, ".env");
let fileEnv = {};
if (!fs.existsSync(envFile)) {
  failures.push({
    item: "Agent 根目录缺少 .env",
    fix: "创建 .env 并配置模型、ALLOWED_PATHS 和服务对应的 SERVICE_PROJECT_PATH_<服务名>。",
  });
} else {
  try {
    fileEnv = parseDotenv(fs.readFileSync(envFile));
  } catch (error) {
    failures.push({
      item: ".env 无法解析",
      fix: error.message,
    });
  }
}
const runtimeEnv = { ...fileEnv, ...process.env };
for (const key of [
  "MODEL_NAME",
  "MODEL_BASE_URL",
  "MODEL_API_KEY",
  "ALLOWED_PATHS",
]) {
  if (!String(runtimeEnv[key] || "").trim()) {
    failures.push({
      item: `.env 缺少 ${key}`,
      fix: `在 .env 中配置非空的 ${key}。`,
    });
  }
}

const agentPackage = readJson(
  path.join(agentRoot, "package.json"),
  "Agent package.json",
  failures,
);
if (!agentPackage?.scripts?.["fix:local-errors"]) {
  failures.push({
    item: "Agent 缺少 npm script: fix:local-errors",
    fix: "恢复 stability-monthly-report-agent 的批量修复脚本配置。",
  });
}
if (!fs.existsSync(path.join(agentRoot, "node_modules"))) {
  failures.push({
    item: "Agent 依赖未安装",
    fix: `在 ${agentRoot} 执行 npm install。`,
  });
}

const chainFile = path.join(
  agentRoot,
  "src",
  "chains",
  "fixAllFromLocalJsonChain.ts",
);
if (
  !fs.existsSync(chainFile) ||
  !fs.readFileSync(chainFile, "utf8").includes(FIX_BRANCH)
) {
  failures.push({
    item: `批量修复链路未确认使用固定分支 ${FIX_BRANCH}`,
    fix: "检查链路实现并同步更新本 Skill，不能继续执行。",
  });
}

const serviceProjectEnvKey = serviceName
  ? getServiceProjectEnvKey(serviceName)
  : "";
const targetPath =
  serviceProjectEnvKey && String(runtimeEnv[serviceProjectEnvKey] || "").trim()
    ? canonical(runtimeEnv[serviceProjectEnvKey])
    : "";
if (serviceName && !targetPath) {
  failures.push({
    item: `.env 缺少本地项目路径 ${serviceProjectEnvKey}`,
    fix: `由负责人确认路径后，在 .env 增加 ${serviceProjectEnvKey}="<本地项目绝对路径>"。不要把个人路径写入 config/service-projects.json。`,
  });
}

let targetPackage = null;
if (targetPath) {
    if (!fs.existsSync(targetPath)) {
      failures.push({
        item: `业务项目目录不存在: ${targetPath}`,
        fix: `拉取项目或修正 .env 中的 ${serviceProjectEnvKey}。`,
      });
  } else {
    try {
      fs.accessSync(targetPath, fs.constants.R_OK | fs.constants.W_OK);
    } catch {
      failures.push({
        item: `业务项目目录不可读写: ${targetPath}`,
        fix: "为当前用户补充项目目录读写权限。",
      });
    }
    if (!fs.existsSync(path.join(targetPath, ".git"))) {
      failures.push({
        item: `业务项目不是 Git 仓库: ${targetPath}`,
        fix: "使用完整 Git 工作区，或修正项目映射。",
      });
    }
    targetPackage = readJson(
      path.join(targetPath, "package.json"),
      "业务项目 package.json",
      failures,
    );
    if (!fs.existsSync(path.join(targetPath, "node_modules"))) {
      failures.push({
        item: `业务项目依赖未安装: ${targetPath}`,
        fix: "按项目锁文件和 packageManager 安装依赖。",
      });
    }
  }
}

if (targetPath && runtimeEnv.ALLOWED_PATHS) {
  const allowed = String(runtimeEnv.ALLOWED_PATHS)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!allowed.some((item) => pathCovers(item, agentRoot))) {
    failures.push({
      item: "ALLOWED_PATHS 未覆盖 Agent 根目录",
      fix: `把 ${agentRoot} 加入 ALLOWED_PATHS。`,
    });
  }
  if (!allowed.some((item) => pathCovers(item, targetPath))) {
    failures.push({
      item: `ALLOWED_PATHS 未覆盖业务项目: ${targetPath}`,
      fix: `把 ${targetPath} 加入 ALLOWED_PATHS。`,
    });
  }
}
const knowledgeFile = path.join(
  agentRoot,
  "config",
  "error-knowledge-base.json",
);
const knowledge = readJson(knowledgeFile, "错误知识库", failures);
if (!Array.isArray(knowledge?.items)) {
  failures.push({
    item: "错误知识库缺少 items 数组",
    fix: '修正为 {"version":1,"items":[]} 或有效的现有知识库。',
  });
}
if (fs.existsSync(knowledgeFile)) {
  try {
    fs.accessSync(knowledgeFile, fs.constants.R_OK | fs.constants.W_OK);
  } catch {
    failures.push({
      item: `错误知识库不可读写: ${knowledgeFile}`,
      fix: "补充当前用户读写权限。",
    });
  }
}

const requiredCommands = ["npm", "npx", "pnpm", "git"];
const commandVersions = {};
for (const name of requiredCommands) {
  const result = command(name, ["--version"]);
  if (result.status !== 0) {
    failures.push({
      item: `命令不可用: ${name}`,
      fix: `安装 ${name} 并确保它在 PATH 中。`,
    });
  } else {
    commandVersions[name] = result.stdout.trim();
  }
}

const nodeActual = versionParts(process.versions.node);
if (!nodeActual || !atLeast(nodeActual, [20, 0, 0])) {
  failures.push({
    item: `Node.js 版本过低: ${process.versions.node}`,
    fix: "切换到 Node.js 20 或更高版本；业务项目通常要求 20.18。",
  });
}
const checkVersionScript = targetPackage?.scripts?.["check-version"];
const requiredNode = String(checkVersionScript || "").match(
  /--node\s+(\d+(?:\.\d+){0,2})/,
);
if (requiredNode && nodeActual) {
  const expected = versionParts(requiredNode[1]);
  if (expected && (nodeActual[0] !== expected[0] || nodeActual[1] !== expected[1])) {
    failures.push({
      item: `业务项目要求 Node ${requiredNode[1]}，当前为 ${process.versions.node}`,
      fix: `按业务项目要求切换到 Node ${requiredNode[1]}。`,
    });
  }
}
const packageManager = String(targetPackage?.packageManager || "");
const requiredPnpm = packageManager.match(/^pnpm@(\d+)\.(\d+)/);
const actualPnpm = versionParts(commandVersions.pnpm);
if (
  requiredPnpm &&
  actualPnpm &&
  (actualPnpm[0] !== Number(requiredPnpm[1]) ||
    actualPnpm[1] !== Number(requiredPnpm[2]))
) {
  failures.push({
    item: `业务项目要求 pnpm ${requiredPnpm[1]}.${requiredPnpm[2]}.x，当前为 ${commandVersions.pnpm}`,
    fix: `切换到 pnpm ${requiredPnpm[1]}.${requiredPnpm[2]}.x。`,
  });
}

if (targetPath && fs.existsSync(path.join(targetPath, ".git"))) {
  const status = command("git", ["status", "--porcelain"], {
    cwd: targetPath,
  });
  if (status.status !== 0) {
    failures.push({
      item: `无法读取业务项目 Git 状态: ${targetPath}`,
      fix: sanitize(status.stderr || status.stdout),
    });
  } else if (status.stdout.trim()) {
    failures.push({
      item: `业务项目工作区不干净: ${targetPath}`,
      fix: "请负责人先提交、移走或明确处理现有改动；Skill 不会自动 stash/clean/reset。",
    });
  }

  const currentBranch = command("git", ["branch", "--show-current"], {
    cwd: targetPath,
  }).stdout.trim();
  const branchExists =
    command(
      "git",
      ["show-ref", "--verify", "--quiet", `refs/heads/${FIX_BRANCH}`],
      { cwd: targetPath },
    ).status === 0;
  if (branchExists && currentBranch !== FIX_BRANCH) {
    const worktrees = command("git", ["worktree", "list", "--porcelain"], {
      cwd: targetPath,
    }).stdout
      .split(/\n\n+/)
      .map((block) => ({
        path: block.match(/^worktree (.+)$/m)?.[1],
        branch: block.match(/^branch (.+)$/m)?.[1],
      }));
    const occupied = worktrees.find(
      (item) =>
        item.branch === `refs/heads/${FIX_BRANCH}` &&
        item.path &&
        canonical(item.path) !== targetPath,
    );
    if (occupied) {
      failures.push({
        item: `${FIX_BRANCH} 已被其他 worktree 使用: ${occupied.path}`,
        fix: "由负责人处理该 worktree 或选择正确工作区后重试。",
      });
    }
  }
}

const errorFiles = serviceName
  ? findErrorFiles(options, serviceName, failures, warnings)
  : [];

if (failures.length === 0 && !options["skip-agent-probe"]) {
  console.log("Running read-only Agent/MCP/model probe...");
  const probe = command(
    "npm",
    [
      "run",
      "dev",
      "--",
      "前置校验：不要调用工具，只回复 PREFLIGHT_OK",
    ],
    {
      cwd: agentRoot,
      env: runtimeEnv,
      timeout: 120_000,
    },
  );
  if (
    probe.status !== 0 ||
    !`${probe.stdout}\n${probe.stderr}`.includes("PREFLIGHT_OK")
  ) {
    failures.push({
      item: "Agent/MCP/模型探针失败",
      fix: sanitize(
        probe.error?.message || probe.stderr || probe.stdout || "无输出",
        [runtimeEnv.MODEL_API_KEY],
      ),
    });
  }
}

console.log("\n=== PRECHECK REPORT ===");
console.log(`输入项目: ${options.project}`);
console.log(`规范服务名: ${serviceName || "<unresolved>"}`);
console.log(`业务项目: ${targetPath || "<unresolved>"}`);
console.log(`固定分支: ${FIX_BRANCH}`);
for (const item of errorFiles) {
  console.log(`待处理 JSON: ${item.file} (${item.pending.length} 条)`);
}
for (const warning of warnings) console.log(`WARNING: ${warning}`);

if (failures.length > 0) {
  console.log(`\nPRECHECK FAILED: ${failures.length} 项条件未满足`);
  failures.forEach((failure, index) => {
    console.log(`${index + 1}. ${failure.item}`);
    console.log(`   补全方式: ${failure.fix}`);
  });
  console.log("\n补全后必须重新运行完整 --check-only。未执行任何修复命令。");
  process.exit(2);
}

console.log("\nPRECHECK PASSED");
if (!options.execute) {
  console.log("只读检查完成，未创建分支、未修改代码、未回写 JSON。");
  process.exit(0);
}

for (const item of errorFiles) {
  const args = [
    "run",
    "fix:local-errors",
    "--",
    "--service",
    serviceName,
    "--json-file",
    item.file,
  ];
  if (options["save-runs"]) args.push("--save-runs");
  console.log(`\nExecuting: npm ${args.join(" ")}`);
  const result = spawnSync("npm", args, {
    cwd: agentRoot,
    env: runtimeEnv,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error(
      `修复命令失败，已停止后续 JSON。失败文件: ${item.file}`,
    );
    process.exit(result.status || 1);
  }
}

const finalBranch = command("git", ["branch", "--show-current"], {
  cwd: targetPath,
}).stdout.trim();
console.log("\n=== EXECUTION COMPLETE ===");
console.log(`项目: ${serviceName}`);
console.log(`业务目录: ${targetPath}`);
console.log(`最终分支: ${finalBranch}`);
console.log(`处理 JSON 数量: ${errorFiles.length}`);
