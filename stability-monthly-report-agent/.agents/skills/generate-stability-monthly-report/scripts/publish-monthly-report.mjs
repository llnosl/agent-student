#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  assertMonth,
  escapeAttribute,
  escapeText,
  fetchReportItems,
  groupErrors,
  monthFolderName,
  parseArgs,
  runLark,
  serviceNameFor,
} from "./lib.mjs";

function usage() {
  console.log(`Usage:
  node publish-monthly-report.mjs --source-doc <wiki-url> --month YYYY-MM [options]

Options:
  --project-root <path>  Project root (default: cwd)
  --output-dir <path>    JSON directory (default: output/<中文月份>月份月报)
  --title <text>         Target title (default: 供应链前端闭环建设M月份月报)
  --dry-run              Validate and print summary without creating a document
  --resume               Continue from output/monthly-report-YYYY-MM-state.json
  --start-chunk <index>  Override the zero-based chunk to continue from`);
}

function readResults(items, outputDir, month) {
  return items.map((item) => {
    const serviceName = serviceNameFor(item);
    const file = path.join(
      outputDir,
      `${month}-${serviceName}-稳定性错误.json`,
    );
    if (!fs.existsSync(file)) throw new Error(`Missing JSON: ${file}`);
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(data.errors) || data.total !== data.errors.length) {
      throw new Error(`Invalid total/errors in ${file}`);
    }
    if (data.source_url !== item.url) {
      throw new Error(`source_url does not match the source document: ${file}`);
    }
    return { ...item, serviceName, file, data };
  });
}

function writeState(file, state) {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

function renderProject(item) {
  const errors = groupErrors(item.data.errors);
  let xml =
    `<h4>${escapeText(item.project)}：kibana(${item.data.total})</h4>` +
    `<blockquote><a href="${escapeAttribute(item.url)}">打开 Kibana 查询</a></blockquote>`;
  if (!errors.length) return xml;

  xml +=
    '<table><colgroup><col width="360"/><col width="70"/><col width="110"/><col width="120"/><col width="180"/></colgroup>' +
    "<thead><tr>" +
    '<th background-color="light-gray">错误</th>' +
    '<th background-color="light-gray">数量</th>' +
    '<th background-color="light-gray">类型</th>' +
    '<th background-color="light-gray">截图</th>' +
    '<th background-color="light-gray">原因</th>' +
    "</tr></thead><tbody>";
  for (const error of errors) {
    const pages = [...error.urls];
    const text = pages.length
      ? `${escapeText(error.message)}<br/><span text-color="gray">影响页面：${pages
          .map(escapeText)
          .join("<br/>")}</span>`
      : escapeText(error.message);
    xml +=
      `<tr><td vertical-align="top">${text}</td>` +
      `<td vertical-align="top">${error.count}</td>` +
      `<td vertical-align="top">${escapeText(error.type)}</td>` +
      '<td vertical-align="top"></td>' +
      '<td vertical-align="top"></td></tr>';
  }
  return `${xml}</tbody></table>`;
}

function buildChunks(items, sourceDoc) {
  const rawTotal = items.reduce(
    (sum, item) => sum + Number(item.data.total),
    0,
  );
  const groupedTotal = items.reduce(
    (sum, item) => sum + groupErrors(item.data.errors).length,
    0,
  );
  const nonzeroLinks = items.filter((item) => item.data.total > 0).length;
  const projectCount = new Set(items.map((item) => item.project)).size;
  const chunks = [
    '<callout emoji="📌" background-color="light-blue" border-color="blue">' +
      `<p>本月稳定性数据已完成采集：覆盖 ${projectCount} 个项目、${items.length} 个 Kibana 链接，共采集 ${rawTotal} 条原始记录，按错误类型与稳定指纹归并为 ${groupedTotal} 类问题。</p>` +
      "</callout>" +
      "<h1>概述</h1>" +
      "<p>本月报沿用源月报的项目分组与指标结构，数据来自“核心指标”中的 Kibana 查询链接。</p>" +
      `<button action="OpenLink" src="${escapeAttribute(sourceDoc)}" background-color="light-blue">查看源月报</button>` +
      "<hr/><h1>动态</h1>" +
      "<table><thead><tr>" +
      '<th background-color="light-gray">指标</th>' +
      '<th background-color="light-gray">结果</th>' +
      "</tr></thead><tbody>" +
      `<tr><td>项目数</td><td>${projectCount}</td></tr>` +
      `<tr><td>Kibana 链接数</td><td>${items.length}</td></tr>` +
      `<tr><td>有报错的链接</td><td>${nonzeroLinks}</td></tr>` +
      `<tr><td>原始错误记录</td><td>${rawTotal}</td></tr>` +
      `<tr><td>归并后的同类问题</td><td>${groupedTotal}</td></tr>` +
      "</tbody></table>" +
      '<callout emoji="❗" background-color="light-yellow" border-color="yellow"><p>截图与原因暂不填写，保留空列供后续人工补充。</p></callout>' +
      "<hr/><h1>核心指标</h1>",
  ];

  const metrics = [...new Set(items.map((item) => item.metric))];
  for (const metric of metrics) {
    chunks.push(`<h2>${escapeText(metric)}</h2>`);
    const metricItems = items.filter((item) => item.metric === metric);
    const groups = [...new Set(metricItems.map((item) => item.group))];
    for (const group of groups) {
      chunks.push(
        `<h3>${escapeText(group)}</h3>` +
          metricItems
            .filter((item) => item.group === group)
            .map(renderProject)
            .join(""),
      );
    }
  }
  chunks.push(
    "<hr/><h1>问题跟进</h1>" +
      '<callout emoji="❗" background-color="light-yellow" border-color="yellow"><p>待补充错误原因、修复责任人与进展。</p></callout>' +
      "<hr/><h1>闭环建设Roadmap</h1>" +
      '<checkbox done="false">补充重点问题截图与原因</checkbox>' +
      '<checkbox done="false">确认修复方案与负责人</checkbox>' +
      '<checkbox done="false">完成修复验证并回填结果</checkbox>' +
      "<hr/><h1>链接</h1>" +
      `<p><a href="${escapeAttribute(sourceDoc)}">源稳定性月报</a></p>`,
  );
  return {
    chunks,
    summary: {
      projects: projectCount,
      links: items.length,
      rawTotal,
      groupedTotal,
      nonzeroLinks,
    },
  };
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

const sourceDoc = String(options["source-doc"]);
const projectRoot = path.resolve(options["project-root"] || process.cwd());
const outputDir = options["output-dir"]
  ? path.resolve(projectRoot, String(options["output-dir"]))
  : path.join(projectRoot, "output", monthFolderName(options.month));
const stateFile = path.join(
  outputDir,
  `monthly-report-${options.month}-state.json`,
);
const items = readResults(
  fetchReportItems(sourceDoc),
  outputDir,
  options.month,
);
const { chunks, summary } = buildChunks(items, sourceDoc);

if (options["dry-run"]) {
  console.log(
    JSON.stringify(
      { ...summary, chunks: chunks.length, stateFile, dryRun: true },
      null,
      2,
    ),
  );
  process.exit(0);
}

let state;
if (options.resume) {
  if (!fs.existsSync(stateFile)) {
    throw new Error(`Resume state does not exist: ${stateFile}`);
  }
  state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  if (state.sourceDoc !== sourceDoc || state.month !== options.month) {
    throw new Error("Resume state does not match source document/month.");
  }
} else {
  if (fs.existsSync(stateFile)) {
    throw new Error(
      `State already exists: ${stateFile}. Use --resume after verifying the target document.`,
    );
  }
  const sourceNode = runLark([
    "wiki",
    "+node-get",
    "--node-token",
    sourceDoc,
    "--as",
    "user",
    "--format",
    "json",
  ]).data;
  const monthNumber = Number(options.month.slice(5));
  const title =
    options.title || `供应链前端闭环建设${monthNumber}月份月报`;
  const target = runLark([
    "wiki",
    "+node-create",
    "--parent-node-token",
    sourceNode.parent_node_token,
    "--title",
    title,
    "--obj-type",
    "docx",
    "--as",
    "user",
    "--format",
    "json",
  ]).data;
  state = {
    sourceDoc,
    month: options.month,
    title,
    targetDoc: target.obj_token,
    targetNode: target.node_token,
    targetUrl: target.url,
    nextChunk: 0,
    complete: false,
  };
  writeState(stateFile, state);
}

const explicitStart = options["start-chunk"];
const startChunk =
  explicitStart === undefined ? Number(state.nextChunk || 0) : Number(explicitStart);
for (let index = startChunk; index < chunks.length; index += 1) {
  console.log(
    `Appending chunk ${index + 1}/${chunks.length} (${chunks[index].length} chars)`,
  );
  try {
    runLark([
      "docs",
      "+update",
      "--api-version",
      "v2",
      "--doc",
      state.targetDoc,
      "--command",
      "append",
      "--content",
      chunks[index],
      "--as",
      "user",
      "--format",
      "json",
    ]);
  } catch (error) {
    console.error(error.message);
    console.error(
      `Stopped at chunk ${index}. Fetch the target outline to check whether this chunk was applied before using --resume or --start-chunk ${index}.`,
    );
    process.exit(1);
  }
  state.nextChunk = index + 1;
  writeState(stateFile, state);
}

state.complete = true;
state.summary = summary;
writeState(stateFile, state);
console.log(JSON.stringify(state, null, 2));
