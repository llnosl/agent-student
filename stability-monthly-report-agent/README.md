# Stability Monthly Report Agent

## 环境变量配置

运行 Agent 前，在项目根目录创建 `.env` 文件。不要把真实密码或模型密钥提交到代码仓库。

| 字段名 | 是否必填 | 说明 |
|------|----------|------|
| `MODEL_NAME` | 必填 | LangChain 使用的聊天模型名称，例如 OpenAI 兼容模型 id。 |
| `MODEL_BASE_URL` | 必填 | OpenAI 兼容接口的 base URL。 |
| `MODEL_API_KEY` | 必填 | 模型接口密钥。 |
| `ALLOWED_PATHS` | 建议配置 | MCP filesystem 允许读写的目录，多个目录用英文逗号分隔。需要包含当前 Agent 项目和待修复的业务项目目录；不配置时只允许访问当前执行目录。 |
| `SERVICE_PROJECT_PATH_<服务名>` | 修复链路必填 | 服务对应的负责人本地项目绝对路径。服务名转成大写，并把 `-` 等非字母数字字符替换为 `_`，例如 `SERVICE_PROJECT_PATH_FPPC_PDA_WAP`。个人路径只放 `.env`，不要写入 `config/service-projects.json`。 |
| `KIBANA_URL` | 可选 | 默认 Kibana Discover 链接。命令里不传 `--kibana-url` 时使用；适合规避 zsh 对 `!` 的历史展开问题。 |
| `KIBANA_CDP_URL` | 可选 | 默认 Chrome DevTools Protocol 地址。未配置时会自动探测 `http://127.0.0.1:9222` 和 `http://[::1]:9222`。 |
| `KIBANA_LOGIN_USERNAME` | 可选 | Kibana 登录用户名。Python 爬虫检测到登录页时会使用。 |
| `KIBANA_PASSWORD` | 可选 | Kibana 登录密码。Python 爬虫检测到登录页时会读取；如果密码里包含 `#`，需要在 `.env` 中加引号。 |
| `KIBANA_CHROME_EXECUTABLE` | 可选 | Agent 自动启动 Chrome 时使用的可执行文件路径。默认：`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`。 |
| `KIBANA_CHROME_REMOTE_DEBUGGING_ADDRESS` | 可选 | Chrome 远程调试监听地址。默认：`::1`。 |
| `KIBANA_CHROME_REMOTE_DEBUGGING_PORT` | 可选 | Chrome 远程调试端口。默认：`9222`。 |
| `KIBANA_CHROME_USER_DATA_DIR` | 可选 | Kibana 自动化使用的 Chrome 用户数据目录。默认：`$HOME/chrome-kibana-automation-profile`。 |
| `COMMAND_WORKDIR` | 可选兼容项 | 普通对话链路的终端默认目录。修复链路会根据 `--service` 自动读取对应的 `SERVICE_PROJECT_PATH_<服务名>`，不需要手动切换此字段。 |

示例：

```env
MODEL_NAME="<model-name>"
MODEL_BASE_URL="https://example.com/v1"
MODEL_API_KEY="<model-api-key>"

ALLOWED_PATHS="/path/to/stability-monthly-report-agent,/path/to/ewms,/path/to/fppc-pda-wap,/path/to/fresh-product-process-center"
SERVICE_PROJECT_PATH_EWMS="/path/to/ewms"
SERVICE_PROJECT_PATH_FPPC_PDA_WAP="/path/to/fppc-pda-wap"
SERVICE_PROJECT_PATH_FRESH_PRODUCT_PROCESS_CENTER="/path/to/fresh-product-process-center"

KIBANA_LOGIN_USERNAME="pupumall_owl"
KIBANA_PASSWORD="<kibana-password>"
KIBANA_CDP_URL="http://[::1]:9222"
KIBANA_CHROME_REMOTE_DEBUGGING_ADDRESS="::1"
KIBANA_CHROME_REMOTE_DEBUGGING_PORT="9222"
KIBANA_CHROME_USER_DATA_DIR="$HOME/chrome-kibana-automation-profile"
```

如果值里包含 `#`，需要加引号，否则 dotenv 会把 `#` 后面的内容当成注释：

```env
KIBANA_PASSWORD="<password-with-#-inside>"
```

启动爬虫命令
unsetopt BANG_HIST

npm run collect:error -- \
  --service serviceName \
  --kibana-url "$KIBANA_URL" \
  --cdp-url "http://[::1]:9222" \
  --save-runs

采集时会自动识别 Discover 表格或页面的滚动容器，持续向下滚动并累积虚拟列表中已渲染的数据。当滚动到末尾且连续多次没有新增数据时自动结束，无需配置最大行数或滚动次数。Kibana 表头使用 `ui.page` 时会自动映射为输出 JSON 的标准字段 `context.request.url`；其他请求列缺失时会在爬虫日志中输出警告。

## 批量修复本地错误

批量修复链路会读取 JSON 的完整 `errors` 数组，按 URL、异常类型、规范化错误内容和业务堆栈生成确定性指纹。同一错误组只修复一次，结果会回写到组内全部原始记录；不同错误组在同一个项目和 `f/fitkibanaerror` 分支中串行处理，最后统一执行项目验证。

```bash
npm run fix:local-errors -- \
  --service fresh-product-process-center \
  --json-file ./output/2026-07-fresh-product-process-center-稳定性错误.json
```

可追加 `--save-runs` 保存各错误组的 Agent 执行过程。已标记为 `fixed` 或 `already-covered` 的错误组在再次运行时会自动跳过。
