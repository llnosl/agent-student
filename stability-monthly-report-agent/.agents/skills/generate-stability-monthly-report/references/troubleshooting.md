# 故障与恢复

## 目录

- Kibana 显示 0 hits
- Node 18 报 crypto is not defined
- CDP 与登录
- 长列表与实际采集数量
- URL 字段为空
- 同类错误重复
- 输出文件覆盖
- 飞书写入 EOF
- 月份与查询窗口不一致

## Kibana 显示 0 hits

症状：页面已正常打开，但爬虫持续等待 Discover 表格，最后报“table was not found”。

原因：零结果页没有数据表，只显示 `0 hits` 或 `No results match your search criteria`。

处理：

- 爬虫必须识别 `[data-test-subj='discoverNoResults']`、精确文本 `0 hits` 或无结果提示。
- 把它作为成功结果，保存 `total: 0, errors: []`。
- 不要把零结果误判成登录失败。

## Node 18 报 crypto is not defined

症状：命令在进入爬虫前，由 LangSmith UUID 代码抛出 `ReferenceError: crypto is not defined`。

处理：采集子进程追加：

```text
NODE_OPTIONS=--experimental-global-webcrypto
```

必须保留已有 `NODE_OPTIONS`，再拼接该选项，不能覆盖用户原配置。

## CDP 与登录

- 默认连接 `http://[::1]:9222`，同时为子进程设置：
  - `NO_PROXY=127.0.0.1,localhost,::1`
  - `no_proxy=127.0.0.1,localhost,::1`
- 项目脚本已负责自动登录时，不要另写登录逻辑，也不要因为中途出现登录页就立即中断。
- 不同 Kibana 域名可能各自触发一次认证；保持同一个 Chrome 实例和用户配置。
- 不要关闭用户现有浏览器上下文。

## 长列表与实际采集数量

- 必须允许页面自动滚动和懒加载完成。
- 不传 `--max-rows`、`--max-scroll-rounds`。
- 文档标题中的 `kibana(N)` 可能是上一期的旧数量，最终月报必须采用本次 JSON 的 `total`。
- 如果页面命中数明显大于采集数，检查虚拟列表滚动容器、懒加载等待和去重键；不要直接照抄页面旧计数。

## URL 字段为空

Kibana 常把页面地址展示为 `ui.page`，而采集输出需要 `context.request.url`。

处理：

- 支持 `ui.page -> context.request.url` 列别名。
- 仅当目标列为空时使用别名，避免覆盖真实的 `context.request.url`。
- 月报中 URL 去除 query/hash 后再用于同类问题的页面集合。

## 同类错误重复

不要使用完整 JSON、时间、用户名、release、动态 URL 参数作为问题指纹。

至少规范化：

- URL query/hash
- UUID
- 长数字 ID

归并后保留累计数量和受影响页面。项目和指标仍是隔离边界。

## 输出文件覆盖

同一项目通常同时存在 page crash 和 CoreJSError 两个链接。服务名必须加指标后缀，否则第二次采集会覆盖第一次输出。

示例：

- `wms-pda-page-crash`
- `wms-pda-core-js-error`

## 飞书写入 EOF

症状：`docs +update` 返回网络 EOF，前面多个分块已经成功。

处理：

1. 立即停止，不要从第一个分块重跑。
2. 读取目标文档 outline 或目标章节，确认失败分块是否实际写入。
3. 若未写入，使用状态文件中的 `next_chunk` 或显式 `--start-chunk N` 续写。
4. 若已经写入，推进状态后再继续，避免重复章节。

发布脚本将目标文档 token 和成功分块写入对应月份目录的 `monthly-report-YYYY-MM-state.json`。传 `--resume` 使用该状态继续。

另外，当前 `lark-cli wiki +node-get` 使用 `--node-token <Wiki URL 或 token>`，不支持 `--url`。遇到 `unknown flag: --url` 时修正参数，不要改用网页抓取。

## 月份与查询窗口不一致

`now-30d` 是相对时间。生成历史月份报告时，必须先把 Kibana 查询改成目标月份的绝对起止时间，或取得固定时间链接。

不得仅修改月报标题和输出文件名来伪装成历史月份数据。
