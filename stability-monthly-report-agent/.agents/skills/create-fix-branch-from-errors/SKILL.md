---
name: create-fix-branch-from-errors
description: 根据负责人提供的一个或多个项目名称，在 stability-monthly-report-agent 中校验前置条件并调用 npm run fix:local-errors 创建或复用 f/fitkibanaerror 分支；全部项目修复完成后，按请求顺序逐个展示该项目本次修改并询问是否认可，只有明确认可才把该项目本次新增修复写入 config/error-knowledge-base.json。用于“给 ewms 创建错误修复分支”“对七月月报的多个项目生成修复分支”等请求。
---

# 根据错误创建修复分支

先运行只读守门检查；检查未通过时停止。不得自动修改 `.env`、项目映射、Git 工作区、依赖或负责人代码来绕过检查。

## 输入

负责人至少提供项目名称。可选提供：

- 月份：`YYYY-MM`。未提供时选择有错误 JSON 的最新月份。
- JSON 文件：需要只处理指定文件时传入。
- 是否保存 Agent 运行记录。

项目别名由 [项目别名](references/project-aliases.json) 解析。目前支持：

- `ewms`
- `fppc-pda-web`、`fppc-pda-wap`
- `fresh-producter-center`、`fresh-product-process-center`

本地项目路径从 `.env` 的 `SERVICE_PROJECT_PATH_<服务名>` 读取。不得把负责人本机绝对路径写入 `config/service-projects.json`。修复链路会自动将选中项目设为本次终端默认工作目录，不需要切换 `COMMAND_WORKDIR`。

## 重要行为

`npm run fix:local-errors` 不只是创建分支。它会创建或复用固定分支 `f/fitkibanaerror`，随后读取错误、修改业务项目代码、回写 JSON、运行验证，并询问是否把成功经验写入知识库。

只有用户明确要求根据错误创建修复分支或执行修复时，才进入执行阶段。

“创建修复分支”不代表用户认可修复，也不代表允许写入知识库。

## 第一步：只读前置检查

从 stability-monthly-report-agent 根目录运行：

```bash
node .agents/skills/create-fix-branch-from-errors/scripts/preflight-and-run.mjs \
  --project '<负责人提供的项目名>' \
  --check-only
```

指定月份：

```bash
node .agents/skills/create-fix-branch-from-errors/scripts/preflight-and-run.mjs \
  --project '<项目名>' \
  --month 'YYYY-MM' \
  --check-only
```

指定 JSON：

```bash
node .agents/skills/create-fix-branch-from-errors/scripts/preflight-and-run.mjs \
  --project '<项目名>' \
  --json-file '<JSON 路径>' \
  --check-only
```

守门脚本必须一次性汇总所有缺失条件。任一检查失败时：

1. 不创建或切换分支。
2. 不运行修复 Agent。
3. 不改配置或安装依赖。
4. 告知负责人每个缺失项及补全方式。
5. 等负责人补全后重新执行 `--check-only`。

详细检查项见 [前置条件](references/preconditions.md)。

## 第二步：为全部项目建立审批快照

按用户给出的项目顺序，在任何修复命令前分别运行：

```bash
node .agents/skills/create-fix-branch-from-errors/scripts/project-approval.mjs \
  snapshot \
  --project '<项目名>' \
  --month 'YYYY-MM'
```

保存每个项目输出的 `APPROVAL_SNAPSHOT` 路径。快照用于区分历史修复和本次新增修复，不能省略。

## 第三步：执行全部项目

仅在 `--check-only` 输出 `PRECHECK PASSED` 后运行：

```bash
node .agents/skills/create-fix-branch-from-errors/scripts/preflight-and-run.mjs \
  --project '<项目名>' \
  --month 'YYYY-MM' \
  --execute \
  --save-runs
```

脚本会重新执行全部前置检查，不能复用旧检查结论。随后对目标月份内每个“有未处理错误”的 JSON 依次调用：

```bash
npm run fix:local-errors -- \
  --service '<规范服务名>' \
  --json-file '<绝对 JSON 路径>' \
  --save-runs
```

零错误文件、以及全部记录已标记为 `fixed`/`already-covered` 的文件不会触发分支创建。

如果用户一次要求多个项目：

1. 先完成全部项目的前置检查；任一项目不通过时，不开始任何项目。
2. 按用户给出的顺序执行全部项目。
3. 底层 `fix:local-errors` 出现“是否写入错误知识库”的提示时输入 `n`。这里的 `n` 仅表示延迟确认，不能把它解释成用户拒绝本次修复。
4. 不得在第一个项目完成后立即向用户询问；必须等本次请求中的全部项目都处理结束。
5. 某项目修复失败时记录失败，继续处理其他已通过前置检查的项目；失败项目不进入认可询问。

## 第四步：全部完成后逐项目确认

全部项目执行完成后，按用户最初给出的项目顺序逐个运行：

```bash
node .agents/skills/create-fix-branch-from-errors/scripts/project-approval.mjs \
  review \
  --snapshot '<APPROVAL_SNAPSHOT 路径>'
```

向用户展示当前项目的：

- 分支；
- 修改文件和 diff 统计；
- 本次新增成功修复的错误名称、原因和修复操作；
- 验证结果和未解决项。

然后只询问当前项目：

```text
是否认可 <项目名> 的本次修复分支，并将该项目本次修改点写入 config/error-knowledge-base.json？
```

等待用户明确回答后再继续：

- 认可：运行 `project-approval.mjs approve --snapshot '<路径>'`，确认写入成功，再询问下一个项目。
- 不认可：运行 `project-approval.mjs reject --snapshot '<路径>'`，不写 config，再询问下一个项目。
- 要求调整：不 approve、不 reject，先按用户要求处理；调整和验证完成后重新 review，再次询问该项目。
- 未回答：保持等待，不得默认认可或拒绝，也不得开始询问下一个项目。

一个项目的回答只作用于该项目，不得批量套用到其他项目；除非用户明确说“剩余项目全部认可”或“剩余项目全部不认可”。

### 知识库去重

`review` 和 `approve` 都必须重新读取当前 `config/error-knowledge-base.json`，不能只依据修复前缓存。

写入前按错误名称、根因和修复方案进行规范化相似匹配，忽略 URL、UUID、长 token、大数字、大小写和空白差异：

- 没有相似项：新增知识条目。
- 有相似项：不新增重复条目；把不重复的修复方案和本次来源合并进已有条目。
- 相同来源已存在：跳过，不重复追加。
- 不得仅因错误类型相同就合并；模糊名称匹配必须同时有根因或修复方案相似证据。

每次 approve 后报告新增、合并和重复来源跳过的数量。

## 执行后返回

返回：

- 输入项目名与规范服务名。
- 业务项目绝对路径。
- 实际处理的 JSON 列表及待处理数量。
- 当前/最终分支。
- 每条命令的退出状态。
- JSON 回写位置。
- 每个项目的认可结果和知识库写入结果。

任何一条修复命令失败时立即停止，不继续下一个 JSON，并保留已有代码与 JSON 结果供排查。
