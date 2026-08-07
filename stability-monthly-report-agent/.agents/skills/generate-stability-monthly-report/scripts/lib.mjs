import { spawnSync } from "node:child_process";

export function parseArgs(argv) {
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

export function parseJsonOutput(output) {
  const text = String(output || "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error(`Command did not return JSON: ${text.slice(0, 500)}`);
  }
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 30 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    const message = result.stderr || result.stdout || `${command} failed`;
    throw new Error(message.trim());
  }
  return result;
}

export function runLark(args) {
  return parseJsonOutput(
    run("lark-cli", args, { encoding: "utf8" }).stdout,
  );
}

function decodeXmlText(value) {
  return String(value)
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"');
}

export function fetchReportItems(sourceDoc) {
  const outline = runLark([
    "docs",
    "+fetch",
    "--api-version",
    "v2",
    "--doc",
    sourceDoc,
    "--scope",
    "outline",
    "--max-depth",
    "4",
    "--detail",
    "with-ids",
    "--as",
    "user",
    "--format",
    "json",
  ]);
  const outlineContent = outline.data?.document?.content || "";
  const headings = [
    ...outlineContent.matchAll(/<h1\s+id="([^"]+)">([^<]+)<\/h1>/g),
  ];
  const coreHeading = headings.find(
    (match) => decodeXmlText(match[2]).trim() === "核心指标",
  );
  if (!coreHeading) {
    throw new Error('Source document has no h1 heading named "核心指标".');
  }

  const section = runLark([
    "docs",
    "+fetch",
    "--api-version",
    "v2",
    "--doc",
    sourceDoc,
    "--scope",
    "section",
    "--start-block-id",
    coreHeading[1],
    "--detail",
    "simple",
    "--doc-format",
    "markdown",
    "--as",
    "user",
    "--format",
    "json",
  ]);
  const content = section.data?.document?.content || "";
  const items = [];
  let metric = "";
  let group = "";
  let project = "";
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("## ")) {
      metric = line.slice(3).trim();
    } else if (line.startsWith("### ")) {
      group = line.slice(4).trim();
    } else if (line.startsWith("#### ")) {
      project = line
        .slice(5)
        .replace(/\s*[：:].*$/, "")
        .trim();
    } else if (line.startsWith("> [") && line.endsWith(")")) {
      const separator = line.indexOf("](");
      if (separator < 0 || !metric || !group || !project) continue;
      items.push({
        metric,
        group,
        project,
        linkName: line.slice(3, separator),
        url: line.slice(separator + 2, -1),
      });
    }
  }
  if (!items.length) {
    throw new Error(
      'No Kibana links found under "核心指标"; expected h2/h3/h4 plus blockquote links.',
    );
  }
  return items;
}

export function metricSlug(metric) {
  const normalized = metric.toLowerCase().replace(/\s+/g, "");
  if (normalized.includes("pagecrash")) return "page-crash";
  if (normalized.includes("corejserror")) return "core-js-error";
  return metric
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "metric";
}

export function projectSlug(project) {
  return project
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "unknown-project";
}

export function serviceNameFor(item) {
  return `${projectSlug(item.project)}-${metricSlug(item.metric)}`;
}

export function assertMonth(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || "")) {
    throw new Error("--month must use YYYY-MM.");
  }
}

export function monthFolderName(month) {
  assertMonth(month);
  const names = [
    "",
    "一",
    "二",
    "三",
    "四",
    "五",
    "六",
    "七",
    "八",
    "九",
    "十",
    "十一",
    "十二",
  ];
  return `${names[Number(month.slice(5))]}月份月报`;
}

export function escapeText(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\n", "<br/>");
}

export function escapeAttribute(value) {
  return escapeText(value).replaceAll('"', "&quot;");
}

export function normalizeUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return String(value);
  }
}

export function normalizeMessage(value) {
  return String(value || "未提供错误信息")
    .replace(/https?:\/\/[^\s]+/g, (raw) => {
      let url = raw;
      let suffix = "";
      while (/[),.;：，。]$/.test(url)) {
        suffix = url.slice(-1) + suffix;
        url = url.slice(0, -1);
      }
      return normalizeUrl(url) + suffix;
    })
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "{uuid}")
    .replace(/\b\d{6,}\b/g, "{id}");
}

export function groupErrors(errors) {
  const grouped = new Map();
  for (const error of errors || []) {
    const type =
      error["context.exception.exception_type_2"] ||
      error["context.exception.exception_type_1"] ||
      "未分类";
    const message = normalizeMessage(
      error["context.exception.exception_type_3"],
    );
    const key = `${type}\0${message}`;
    const current = grouped.get(key) || {
      type,
      message,
      count: 0,
      urls: new Set(),
    };
    current.count += 1;
    const url = normalizeUrl(error["context.request.url"]);
    if (url) current.urls.add(url);
    grouped.set(key, current);
  }
  return [...grouped.values()].sort(
    (left, right) =>
      right.count - left.count ||
      left.message.localeCompare(right.message, "zh-CN"),
  );
}
