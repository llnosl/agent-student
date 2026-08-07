# 修复分支前置条件

所有条件必须通过，任何失败都必须停止。

## Agent 项目

- 必须从 `stability-monthly-report-agent` 根目录执行。
- `package.json` 必须包含 `fix:local-errors`。
- `src/chains/fixAllFromLocalJsonChain.ts` 必须仍使用 `f/fitkibanaerror`；如果实现已变化，先更新 Skill。
- Agent 的 `node_modules` 必须存在。
- `config/error-knowledge-base.json` 必须是可解析、可写的 JSON，且包含 `items` 数组。

## `.env`

必须存在且配置非空：

- `MODEL_NAME`
- `MODEL_BASE_URL`
- `MODEL_API_KEY`
- `ALLOWED_PATHS`
- 当前服务对应的 `SERVICE_PROJECT_PATH_<服务名>`

服务名转成大写并把 `-` 等非字母数字字符替换为 `_`，例如：

- `ewms` → `SERVICE_PROJECT_PATH_EWMS`
- `fppc-pda-wap` → `SERVICE_PROJECT_PATH_FPPC_PDA_WAP`
- `fresh-product-process-center` → `SERVICE_PROJECT_PATH_FRESH_PRODUCT_PROCESS_CENTER`

这些变量只存负责人本机 `.env`，不要把个人绝对路径写入 `config/service-projects.json`。修复链路会把选中服务的路径作为本次终端默认工作目录，不需要反复修改 `COMMAND_WORKDIR`。

`ALLOWED_PATHS` 必须同时覆盖 Agent 根目录和目标业务项目绝对路径。

不要在错误提示里输出 `MODEL_API_KEY`、密码或其他密钥值。

## 服务映射

当前服务对应的 `.env` 路径必须指向：

- 已存在的目录；
- Git 仓库；
- 包含 `package.json` 的业务项目；
- 当前用户可写的路径。

缺失映射时停止，由负责人确认本地绝对路径后补入 `.env`。`config/service-projects.json` 保留给线上项目映射。

## 错误 JSON

- 指定文件必须存在、可解析、可写。
- 自动发现时从 `output/**` 中选择最新月份的对应服务文件。
- 顶层必须有 `errors` 数组，且 `total === errors.length`。
- 至少存在一条未标记为 `fixed`/`already-covered` 的错误。
- 每条待处理错误至少包含异常类型、错误内容、URL、错误堆栈中的一个证据字段。
- 零错误文件仅警告并跳过，不创建分支。

## 运行时与依赖

- 使用 Node.js 20 或更高版本；Node 18 可能触发 LangSmith `crypto is not defined`。
- `npm`、`npx`、`pnpm` 和 `git` 必须可用。
- 如果业务项目声明 `packageManager` 或 `check-version`，当前 Node/pnpm 必须满足该声明。
- 业务项目 `node_modules` 必须存在，避免修复结束后的类型检查、lint 或构建无法执行。
- 只读 Agent 探针必须成功，验证 MCP filesystem、模型连接和 tool binding。

## Git

- 业务项目工作区必须干净，包括未跟踪文件。
- 不得自动 stash、commit、reset、clean 或删除负责人改动。
- 固定分支为 `f/fitkibanaerror`。
- 当前已在该分支且工作区干净时允许复用。
- 该分支不存在时允许后续链路创建。
- 该分支已被另一个 worktree 使用时必须停止。

## 负责人补全后的流程

负责人补全缺失条件后，必须重新运行完整 `--check-only`，不能只重试失败的单项，也不能直接执行 `--execute`。
