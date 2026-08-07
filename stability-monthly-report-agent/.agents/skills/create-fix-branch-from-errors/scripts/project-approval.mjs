#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse as parseDotenv } from "dotenv";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDir, "..");
const agentRoot = path.resolve(skillRoot, "../../..");
const aliasesFile = path.join(
  skillRoot,
  "references",
  "project-aliases.json",
);
const approvalDir = path.join(
  agentRoot,
  "output",
  "agent-runs",
  "pending-approvals",
);

function usage() {
  console.log(`Usage:
  node project-approval.mjs snapshot --project <name> [--month YYYY-MM]
  node project-approval.mjs review --snapshot <file>
  node project-approval.mjs approve --snapshot <file>
  node project-approval.mjs reject --snapshot <file>`);
}

function parseArgs(argv) {
  const [action, ...rest] = argv;
  const options = { action };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) {
      options[key] = true;
    } else {
      options[key] = value;
      index += 1;
    }
  }
  return options;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function canonical(value) {
  const resolved = path.resolve(value);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function getServiceProjectEnvKey(serviceName) {
  return `SERVICE_PROJECT_PATH_${serviceName
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")}`;
}

function walkJson(directory, result = []) {
  if (!fs.existsSync(directory)) return result;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "agent-runs") walkJson(fullPath, result);
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

function discoverFiles(serviceName, requestedMonth) {
  const escaped = serviceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^(\\d{4}-\\d{2})-${escaped}(?:-|_)`);
  const matches = walkJson(path.join(agentRoot, "output"))
    .map((file) => ({ file: canonical(file), match: path.basename(file).match(pattern) }))
    .filter((item) => item.match);
  const month =
    requestedMonth ||
    matches
      .map((item) => item.match[1])
      .sort()
      .at(-1);
  if (!month) {
    throw new Error(`未找到 ${serviceName} 的稳定性错误 JSON`);
  }
  const files = matches
    .filter((item) => item.match[1] === month)
    .map((item) => item.file)
    .sort();
  if (!files.length) {
    throw new Error(`${month} 未找到 ${serviceName} 的稳定性错误 JSON`);
  }
  return { month, files };
}

function fixedGroupKeys(files) {
  const keys = [];
  for (const file of files) {
    const report = readJson(file);
    for (const [index, error] of (report.errors || []).entries()) {
      if (error?.["批量修复状态"] !== "fixed") continue;
      const groupId =
        typeof error?.["错误分组ID"] === "string"
          ? error["错误分组ID"]
          : `legacy-${index}`;
      keys.push(`${file}::${groupId}`);
    }
  }
  return [...new Set(keys)];
}

function git(projectPath, args) {
  const result = spawnSync("git", args, {
    cwd: projectPath,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} 失败`);
  }
  return result.stdout.trim();
}

function collectCandidates(snapshot) {
  const before = new Set(snapshot.fixedGroupKeysBefore);
  const candidates = [];
  const seen = new Set();
  for (const file of snapshot.jsonFiles) {
    const report = readJson(file);
    for (const [index, error] of (report.errors || []).entries()) {
      if (error?.["批量修复状态"] !== "fixed") continue;
      const groupId =
        typeof error?.["错误分组ID"] === "string"
          ? error["错误分组ID"]
          : `legacy-${index}`;
      const key = `${file}::${groupId}`;
      if (before.has(key) || seen.has(key)) continue;
      seen.add(key);
      const errorType =
        error?.["context.exception.exception_type_2"] ||
        error?.["context.exception.exception_type_1"] ||
        "稳定性错误";
      const message = error?.["context.exception.exception_type_3"] || "";
      candidates.push({
        errorName: message ? `${errorType}: ${message}`.slice(0, 200) : errorType,
        reason: error?.["错误原因"] || "",
        solution: [error?.["修复操作（简化）"] || ""],
        source: {
          jsonFile: file,
          errorIndex:
            Number.isInteger(error?.["代表错误下标"])
              ? error["代表错误下标"]
              : index,
          branch: git(snapshot.projectPath, ["branch", "--show-current"]),
          groupId,
        },
      });
    }
  }
  return candidates;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "<uuid>")
    .replace(/\b[0-9a-f]{16,}\b/gi, "<token>")
    .replace(/\b\d{4,}\b/g, "<number>")
    .replace(/[^\p{L}\p{N}<>]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameVariants(value) {
  const normalized = normalizeText(value);
  const withoutType = normalized.replace(
    /^(?:js|type|reference|syntax|range|aggregate|uri)?error\s+/,
    "",
  );
  return [...new Set([normalized, withoutType].filter(Boolean))];
}

function textTokens(value) {
  const normalized = normalizeText(value);
  const tokens = new Set(normalized.match(/[a-z0-9<>]+|[\p{Script=Han}]/gu) || []);
  const han = [...normalized.replace(/[^\p{Script=Han}]/gu, "")];
  for (let index = 0; index < han.length - 1; index += 1) {
    tokens.add(`${han[index]}${han[index + 1]}`);
  }
  return tokens;
}

function jaccard(left, right) {
  const leftTokens = textTokens(left);
  const rightTokens = textTokens(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  return intersection / (leftTokens.size + rightTokens.size - intersection);
}

function nameSimilarity(left, right) {
  let best = 0;
  for (const leftVariant of nameVariants(left)) {
    for (const rightVariant of nameVariants(right)) {
      if (leftVariant === rightVariant) return 1;
      best = Math.max(best, jaccard(leftVariant, rightVariant));
    }
  }
  return best;
}

function solutionText(item) {
  return Array.isArray(item?.solution)
    ? item.solution.join("\n")
    : String(item?.solution || "");
}

function compareKnowledge(candidate, existing) {
  const name = nameSimilarity(candidate.errorName, existing.errorName);
  const reason = jaccard(candidate.reason, existing.reason);
  const solution = jaccard(
    solutionText(candidate),
    solutionText(existing),
  );
  const exactName =
    nameVariants(candidate.errorName).some((variant) =>
      nameVariants(existing.errorName).includes(variant),
    );
  const similar =
    exactName ||
    (name >= 0.82 && Math.max(reason, solution) >= 0.45) ||
    (name >= 0.68 && reason >= 0.68 && solution >= 0.55);
  return {
    similar,
    score: Number((name * 0.5 + reason * 0.25 + solution * 0.25).toFixed(4)),
    dimensions: { name, reason, solution },
  };
}

function findSimilarKnowledge(candidate, items) {
  let best = null;
  for (const item of items) {
    const comparison = compareKnowledge(candidate, item);
    if (
      comparison.similar &&
      (!best || comparison.score > best.comparison.score)
    ) {
      best = { item, comparison };
    }
  }
  return best;
}

function sourceFingerprint(source) {
  return JSON.stringify({
    jsonFile: source?.jsonFile || "",
    errorIndex: source?.errorIndex,
    branch: source?.branch || "",
    groupId: source?.groupId || "",
  });
}

function mergeCandidateIntoExisting(existing, candidate, confirmedAt, snapshotFile) {
  const candidateSolutions = Array.isArray(candidate.solution)
    ? candidate.solution.filter(Boolean)
    : [];
  const existingSolutions = Array.isArray(existing.solution)
    ? existing.solution
    : [];
  for (const solution of candidateSolutions) {
    if (
      !existingSolutions.some(
        (current) =>
          normalizeText(current) === normalizeText(solution) ||
          jaccard(current, solution) >= 0.9,
      )
    ) {
      existingSolutions.push(solution);
    }
  }
  existing.solution = existingSolutions;
  if (!existing.reason && candidate.reason) {
    existing.reason = candidate.reason;
  }

  const newSource = {
    ...candidate.source,
    confirmedAt,
    approvalSnapshot: snapshotFile,
  };
  const sources = Array.isArray(existing.sources)
    ? existing.sources
    : existing.source
      ? [existing.source]
      : [];
  const fingerprint = sourceFingerprint(newSource);
  const sourceAlreadyExists = sources.some(
    (source) => sourceFingerprint(source) === fingerprint,
  );
  if (!sourceAlreadyExists) sources.push(newSource);
  existing.sources = sources;
  return sourceAlreadyExists ? "skipped" : "merged";
}

function loadSnapshot(file) {
  const resolved = canonical(file);
  const snapshot = readJson(resolved);
  return { file: resolved, snapshot };
}

function snapshotProject(options) {
  if (!options.project) throw new Error("snapshot 缺少 --project");
  const aliases = readJson(aliasesFile).aliases;
  const inputName = String(options.project).trim().toLowerCase();
  const serviceName = aliases[inputName];
  if (!serviceName) throw new Error(`不支持的项目名称: ${options.project}`);

  const envFile = path.join(agentRoot, ".env");
  const env = {
    ...parseDotenv(fs.readFileSync(envFile)),
    ...process.env,
  };
  const envKey = getServiceProjectEnvKey(serviceName);
  const configuredPath = String(env[envKey] || "").trim();
  if (!configuredPath) throw new Error(`.env 缺少 ${envKey}`);
  const projectPath = canonical(configuredPath);
  const { month, files } = discoverFiles(serviceName, options.month);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(
    approvalDir,
    `${timestamp}-${serviceName}.json`,
  );
  const snapshot = {
    version: 1,
    status: "pending-repair",
    inputProject: options.project,
    serviceName,
    month,
    projectPath,
    jsonFiles: files,
    fixedGroupKeysBefore: fixedGroupKeys(files),
    gitHeadBefore: git(projectPath, ["rev-parse", "HEAD"]),
    branchBefore: git(projectPath, ["branch", "--show-current"]),
    createdAt: new Date().toISOString(),
  };
  writeJson(file, snapshot);
  console.log(`APPROVAL_SNAPSHOT=${file}`);
}

function reviewProject(options) {
  if (!options.snapshot) throw new Error("review 缺少 --snapshot");
  const { file, snapshot } = loadSnapshot(options.snapshot);
  if (snapshot.status === "approved" || snapshot.status === "rejected") {
    throw new Error(`该项目已完成确认: ${snapshot.status}`);
  }
  const candidates = collectCandidates(snapshot);
  const knowledge = readJson(
    path.join(agentRoot, "config", "error-knowledge-base.json"),
  );
  const review = {
    project: snapshot.serviceName,
    branch: git(snapshot.projectPath, ["branch", "--show-current"]),
    changedFiles: git(snapshot.projectPath, ["diff", "--name-only", snapshot.gitHeadBefore])
      .split("\n")
      .filter(Boolean),
    diffStat: git(snapshot.projectPath, ["diff", "--stat", snapshot.gitHeadBefore]),
    newFixedGroups: candidates.map((candidate) => {
      const match = findSimilarKnowledge(candidate, knowledge.items || []);
      return {
        ...candidate,
        knowledgeMatch: match
          ? {
              id: match.item.id,
              errorName: match.item.errorName,
              score: match.comparison.score,
              dimensions: match.comparison.dimensions,
              action: "merge",
            }
          : { action: "add" },
      };
    }),
  };
  snapshot.status = "awaiting-approval";
  snapshot.review = review;
  snapshot.reviewedAt = new Date().toISOString();
  writeJson(file, snapshot);
  console.log(JSON.stringify(review, null, 2));
}

function approveProject(options) {
  if (!options.snapshot) throw new Error("approve 缺少 --snapshot");
  const { file, snapshot } = loadSnapshot(options.snapshot);
  if (snapshot.status === "approved") {
    throw new Error("该项目已经写入知识库，拒绝重复写入");
  }
  if (snapshot.status !== "awaiting-approval" || !snapshot.review) {
    throw new Error("必须先执行 review，再执行 approve");
  }
  const candidates = snapshot.review.newFixedGroups || [];
  if (!candidates.length) {
    throw new Error("本次没有新增 fixed 错误组，无需写入知识库");
  }
  const knowledgeFile = path.join(
    agentRoot,
    "config",
    "error-knowledge-base.json",
  );
  const knowledge = readJson(knowledgeFile);
  const confirmedAt = new Date().toISOString();
  const timestamp = Date.now();
  const stats = { added: 0, merged: 0, skipped: 0 };
  candidates.forEach((candidate, index) => {
    const match = findSimilarKnowledge(candidate, knowledge.items || []);
    if (match) {
      const result = mergeCandidateIntoExisting(
        match.item,
        candidate,
        confirmedAt,
        file,
      );
      stats[result] += 1;
      return;
    }
    const normalizedId = String(candidate.errorName)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64);
    knowledge.items.push({
      id: `${normalizedId || "confirmed-error"}-${timestamp}-${index}`,
      errorName: candidate.errorName,
      reason: candidate.reason,
      solution: candidate.solution,
      source: {
        ...candidate.source,
        confirmedAt,
        approvalSnapshot: file,
      },
    });
    stats.added += 1;
  });
  writeJson(knowledgeFile, knowledge);
  snapshot.status = "approved";
  snapshot.approvedAt = confirmedAt;
  writeJson(file, snapshot);
  console.log(
    `已处理 ${candidates.length} 条 ${snapshot.serviceName} 修复经验：新增 ${stats.added}，合并相似项 ${stats.merged}，重复来源跳过 ${stats.skipped}。`,
  );
}

function rejectProject(options) {
  if (!options.snapshot) throw new Error("reject 缺少 --snapshot");
  const { file, snapshot } = loadSnapshot(options.snapshot);
  if (snapshot.status === "approved") {
    throw new Error("该项目已经写入知识库，不能改为拒绝");
  }
  snapshot.status = "rejected";
  snapshot.rejectedAt = new Date().toISOString();
  writeJson(file, snapshot);
  console.log(`已拒绝 ${snapshot.serviceName}，未写入知识库。`);
}

const options = parseArgs(process.argv.slice(2));
try {
  if (options.action === "snapshot") snapshotProject(options);
  else if (options.action === "review") reviewProject(options);
  else if (options.action === "approve") approveProject(options);
  else if (options.action === "reject") rejectProject(options);
  else {
    usage();
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
