---
name: generate-stability-monthly-report
description: 从上一期飞书供应链稳定性月报的“核心指标”章节读取全部项目与 Kibana 链接，通过项目内 collect:error 链路连接 Chrome CDP 批量采集错误 JSON，按稳定错误指纹去重聚合，并在源文档同级创建指定月份的飞书稳定性月报。用于“生成某月稳定性月报”“遍历月报项目采集 Kibana”“根据上月模板创建本月月报”等任务。
---

# 生成稳定性月报

将飞书项目清单、Kibana 数据采集、错误归并和同级月报发布串成可恢复的固定流程。默认使用当前项目根目录和 `http://[::1]:9222`。

## 必要输入

开始前确认：

- 源飞书 Wiki 月报 URL。
- 目标月份，格式为 `YYYY-MM`。
- 当前项目根目录包含 `package.json`、`npm run collect:error` 和 `output/`。
- Chrome 已开启远程调试，或项目脚本能自行启动并处理登录。

目标月份不是当前月份时，必须先核对每个 Kibana URL 的时间范围。`now-30d` 表示执行时最近 30 天，不能自动代表历史月份。

## 依赖技能

在访问飞书前读取并遵循：

- `lark-shared`
- `lark-doc`
- `lark-wiki`

所有文档命令使用 `--api-version v2`；Wiki 与用户文档操作使用 `--as user`。

## 执行流程

### 1. 预检

1. 读取源文档 Wiki 节点信息，记录 `parent_node_token`。
2. 读取文档 outline，定位一级标题“核心指标”。
3. 读取该章节，确认结构是“指标 h2 → 分组 h3 → 项目 h4 → Kibana 引用链接”。
4. 检查 CDP：

```bash
curl --noproxy '*' 'http://[::1]:9222/json/version'
```

5. 检查项目构建：

```bash
npm run build
```

### 2. 批量采集

从项目根目录执行：

```bash
node .agents/skills/generate-stability-monthly-report/scripts/collect-monthly-errors.mjs \
  --source-doc '<SOURCE_WIKI_URL>' \
  --month 'YYYY-MM' \
  --project-root "$PWD" \
  --cdp-url 'http://[::1]:9222' \
  --resume
```

脚本必须逐链接调用：

```bash
npm run collect:error -- \
  --service '<project>-<metric>' \
  --kibana-url '<KIBANA_URL>' \
  --cdp-url 'http://[::1]:9222' \
  --save-runs
```

不得传 `--max-rows` 或 `--max-scroll-rounds`。使用指标后缀区分同一项目的两份数据，避免文件互相覆盖：

- `page crash(by js error)` → `page-crash`
- `CoreJSError` → `core-js-error`

JSON 按月份保存到 `output/<中文月份>月份月报/`，例如 `2026-07` 对应 `output/七月份月报/`。需要其他位置时显式传 `--output-dir`。

中断后继续时使用 `--resume`；精确分段重跑可使用 `--start` 和 `--limit`。

### 3. 校验 JSON

采集完成后必须确认：

- 链接数与 JSON 文件数一致。
- 每份 JSON 可解析。
- `total === errors.length`。
- `source_url` 与对应 Kibana 链接一致。
- 零结果也生成 `total: 0, errors: []`，不能算失败。

### 4. 归并同类错误

按“项目 + 指标 + 错误类型 + 稳定化后的错误消息”归并，不按整行 JSON 去重。

稳定化规则：

- URL 去除 query 和 hash。
- UUID 替换为 `{uuid}`。
- 六位及以上动态数字替换为 `{id}`。
- 同类错误累计数量，并收集受影响页面集合。
- 不跨项目合并，也不跨 page crash/CoreJSError 合并。

这能避免订单号、记录 ID、查询参数不同导致同一代码问题被重复列出。

### 5. 创建并发布月报

先预览汇总：

```bash
node .agents/skills/generate-stability-monthly-report/scripts/publish-monthly-report.mjs \
  --source-doc '<SOURCE_WIKI_URL>' \
  --month 'YYYY-MM' \
  --project-root "$PWD" \
  --dry-run
```

确认后发布：

```bash
node .agents/skills/generate-stability-monthly-report/scripts/publish-monthly-report.mjs \
  --source-doc '<SOURCE_WIKI_URL>' \
  --month 'YYYY-MM' \
  --project-root "$PWD"
```

发布脚本在源文档同级创建文档，默认标题为 `供应链前端闭环建设M月份月报`，并按以下结构写入：

- 概述
- 动态
- 核心指标
  - page crash(by js error)
  - CoreJSError
- 问题跟进
- 闭环建设Roadmap
- 链接

每个项目保留 Kibana 原链接。错误表使用“错误、数量、类型、截图、原因”五列，截图与原因必须留空。

### 6. 验证

发布后：

1. 用 `docs +fetch --scope outline --max-depth 4` 校验所有标题和项目。
2. 比较项目数、链接数、JSON 文件数。
3. 核对月报原始记录总数与 JSON `total` 之和。
4. 确认截图与原因列为空。
5. 返回飞书文档链接与本地 `output/` 路径。

## 故障处理

遇到异常时必须读取 [故障与恢复](references/troubleshooting.md)，按症状处理，不要盲目重跑全部链接或整篇文档。

## 脚本

- `scripts/collect-monthly-errors.mjs`：解析“核心指标”并串行调用项目采集命令。
- `scripts/publish-monthly-report.mjs`：读取 JSON、稳定化归并、创建同级 Wiki 文档并分块写入。
