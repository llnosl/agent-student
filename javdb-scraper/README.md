# JavDB Scraper 工作流说明

这个目录包含一套 JavDB 演员影片数据工作流：爬取数据、补翻译、批量导入迅雷、按 JSON 重命名 `F:\av合集` 根目录下的文件夹和文件。

## 环境准备

进入项目目录并安装依赖：

```powershell
cd "D:\代码\神光 agent 开发学习\javdb-scraper"
npm install
```

依赖组件：

- Node.js，项目使用 ES Module。
- Chrome，浏览器爬虫默认路径是 `C:\Program Files\Google\Chrome\Application\chrome.exe`。
- Ollama，用于日文标题/简介翻译。
- 迅雷，用于批量导入磁力链接。

`package.json` 里的快捷命令：

```powershell
npm run scrape
npm run scrape:browser
```

## 工作流总览

推荐流程：

```text
1. scrape-javdb-browser.mjs   爬取 JavDB 演员页面，输出 JSON
2. translate-titles.mjs       可选，补翻译已有 JSON 中 title.zh 为空的记录
3. thunder-batch-download.mjs 批量向迅雷导入 JSON 中的 magnet 链接
4. reorganize-folders.mjs     根据 JSON 重命名 F:\av合集 第一层文件夹和文件
```

## 第 1 步：浏览器版爬虫

脚本：`scrape-javdb-browser.mjs`

推荐使用这个脚本。它会启动 Chrome，打开 JavDB 演员页，自动翻页收集影片链接，再进入详情页抓取番号、标题、简介、发行日期、时长、导演、片商、系列、标签、磁力链接，并调用 Ollama 翻译标题/简介。

当前版本还会读取详情页演员栏：

- 演员数量 `<= 2`：整条影片记录跳过，不写入 JSON。
- 演员数量 `> 2`：按原逻辑写入 JSON。

默认命令：

```powershell
node scrape-javdb-browser.mjs
```

指定演员页面：

```powershell
node scrape-javdb-browser.mjs "https://javdb.com/actors/1G09?t=s&sort_type=0"
```

执行流程：

1. 脚本打开 Chrome。
2. 如果有年龄确认，脚本会尝试自动点击。
3. 如果有验证页面，会等待 `MANUAL_WAIT_MS` 毫秒，期间可手动处理。
4. 第一页加载后，终端会提示确认当前页面是否正确。
5. 确认后自动翻页，直到没有下一页或达到 `MAX_PAGES`。
6. 详情页抓取完成后，终端会询问 JSON 标题。
7. 输出文件保存到 `output/`，格式类似 `20260707-233311-叶愛 JavDB 成人影片數據庫.json`。

确认页面后继续：

```text
确认开始爬取？[Enter=开始 / n=取消]
```

输出标题直接回车使用默认标题：

```text
请输入本次 JSON 标题，直接回车使用默认标题：xxx
标题：
```

常用环境变量：

| 变量 | 作用 | 默认值 |
|---|---|---|
| `CHROME_PATH` | Chrome 路径 | `C:\Program Files\Google\Chrome\Application\chrome.exe` |
| `HEADLESS=1` | 无头模式 | 默认有界面 |
| `CONFIRM_PAGE=0` | 跳过第一页确认 | 默认需要确认 |
| `MANUAL_WAIT_MS` | 验证页人工等待时间 | `12000` |
| `HTTPS_PROXY` / `HTTP_PROXY` | 代理地址 | 空 |
| `OLLAMA_MODEL` | Ollama 翻译模型 | `demonbyron/HY-MT1.5-1.8B` |
| `MAX_PAGES` | 最大爬取页数，`0` 不限制 | `0` |
| `CONCURRENCY` | 详情页并发数 | `1` |
| `TRANSLATE_DELAY_MS` | 翻译间隔毫秒 | `350` |

只爬前 3 页：

```powershell
$env:MAX_PAGES="3"; node scrape-javdb-browser.mjs "https://javdb.com/actors/1G09?t=s&sort_type=0"
```

跳过确认并使用无头模式：

```powershell
$env:CONFIRM_PAGE="0"; $env:HEADLESS="1"; node scrape-javdb-browser.mjs "https://javdb.com/actors/1G09?t=s&sort_type=0"
```

指定代理：

```powershell
$env:HTTPS_PROXY="http://127.0.0.1:7897"; node scrape-javdb-browser.mjs "https://javdb.com/actors/1G09?t=s&sort_type=0"
```

指定 Ollama 模型：

```powershell
$env:OLLAMA_MODEL="demonbyron/HY-MT1.5-1.8B"; node scrape-javdb-browser.mjs "https://javdb.com/actors/1G09?t=s&sort_type=0"
```

## 第 1 步备选：HTTP 直连版爬虫

脚本：`scrape-javdb.mjs`

这个脚本不启动浏览器，直接请求页面。它可能被 Cloudflare 或登录限制拦截。除非明确需要，否则优先使用浏览器版。

默认命令：

```powershell
node scrape-javdb.mjs
```

指定演员页面：

```powershell
node scrape-javdb.mjs "https://javdb.com/actors/1G09?t=s&sort_type=0"
```

使用 Cookie：

```powershell
$env:JAVDB_COOKIE="你的 Cookie 字符串"; node scrape-javdb.mjs "https://javdb.com/actors/1G09?t=s&sort_type=0"
```

限制页数和并发：

```powershell
$env:MAX_PAGES="3"; $env:CONCURRENCY="2"; node scrape-javdb.mjs "https://javdb.com/actors/1G09?t=s&sort_type=0"
```

HTTP 版固定输出：

```text
output/javdb-actor-1G09.json
```

## 第 2 步：补全翻译

脚本：`translate-titles.mjs`

这个脚本读取已有 JSON，只翻译 `title.zh` 为空的记录，已有翻译会跳过，并写回原 JSON 文件。

命令：

```powershell
node translate-titles.mjs "output\20260711-100055-蒂亞 JavDB 成人影片數據庫.json"
```

指定翻译模型：

```powershell
$env:OLLAMA_MODEL="demonbyron/HY-MT1.5-1.8B"; node translate-titles.mjs "output/20260707-233311-叶愛 JavDB 成人影片數據庫.json"
```

调大翻译间隔：

```powershell
$env:TRANSLATE_DELAY_MS="800"; node translate-titles.mjs "output/20260707-233311-叶愛 JavDB 成人影片數據庫.json"
```

## 第 3 步：批量导入迅雷

脚本：`thunder-batch-download.mjs`

当前版本只做迅雷导入：

- 读取 JSON。
- 筛选 `magnet:` 链接。
- 逐条调用迅雷添加下载任务。
- 生成 `-导入迅雷.bat` 备用脚本。

当前版本不会创建 `F:\av合集`，也不会创建任何下载子文件夹。

预览命令，不调用迅雷：

```powershell
$env:DRY_RUN="1"; node thunder-batch-download.mjs "output/20260707-233311-叶愛 JavDB 成人影片數據庫.json"
```

实际导入迅雷：

```powershell
node thunder-batch-download.mjs "output\20260711-100055-蒂亞 JavDB 成人影片數據庫.json"
```

指定迅雷路径：

```powershell
$env:THUNDER_EXE="D:\YOUXI\Thunder\Program\Thunder.exe"; node thunder-batch-download.mjs "output/20260707-233311-叶愛 JavDB 成人影片數據庫.json"
```

调整每个任务间隔：

```powershell
$env:DELAY_MS="3000"; node thunder-batch-download.mjs "output/20260707-233311-叶愛 JavDB 成人影片數據庫.json"
```

生成的 BAT 文件示例：

```text
output/20260707-233311-叶愛 JavDB 成人影片數據庫-导入迅雷.bat
```

如果脚本调用迅雷失败，可以双击这个 BAT 文件重试导入。

## 第 4 步：按 JSON 重命名文件夹和根目录文件

脚本：`reorganize-folders.mjs`

这个脚本根据 JSON 的 `code` 和 `title.zh` 重命名 `F:\av合集` 第一层的文件夹和文件。

处理范围：

- 会处理：`F:\av合集\JUR-191`
- 会处理：`F:\av合集\JUR-191.mp4`
- 不会处理：`F:\av合集\某文件夹\JUR-191.mp4`

命名规则：

```text
CODE大写 + 空格 + 中文标题
```

文件会保留原扩展名：

```text
JUR-191.mp4
→ JUR-191 公共厕所里的“乳房杀手”！一个有着108厘米巨乳、属于都市传说级别的女性变态者出现了——叶爱.mp4
```

匹配规则：

- 从文件夹名或根目录文件名中提取番号。
- 不区分大小写。
- 优先完整番号匹配，例如 `miaa-003-c` 匹配 JSON 的 `miaa-003-c`。
- 如果完整匹配失败，允许后缀版本回退到基础番号，例如 `juq-963-c` 回退匹配 JSON 的 `juq-963`。
- 如果 JSON 中没有对应番号，会跳过，不删除、不改名。

预览命令，不实际改名：

```powershell
node reorganize-folders.mjs "output/20260707-233311-叶愛 JavDB 成人影片數據庫.json" "F:\av合集"
```

实际执行重命名：

```powershell
$env:DRY_RUN="0"; node reorganize-folders.mjs "output/20260707-233311-叶愛 JavDB 成人影片數據庫.json" "F:\av合集"
```

使用默认目标目录 `F:\av合集`：

```powershell
node reorganize-folders.mjs "output/20260707-233311-叶愛 JavDB 成人影片數據庫.json"
```

实际执行并使用默认目标目录：

```powershell
$env:DRY_RUN="0"; node reorganize-folders.mjs "output/20260707-233311-叶愛 JavDB 成人影片數據庫.json"
```

## 完整执行示例

从爬取到导入迅雷，再整理命名：

```powershell
cd "D:\代码\神光 agent 开发学习\javdb-scraper"
node scrape-javdb-browser.mjs "https://javdb.com/actors/1G09?t=s&sort_type=0"
node translate-titles.mjs "output/你的输出文件.json"
$env:DRY_RUN="1"; node thunder-batch-download.mjs "output/你的输出文件.json"
node thunder-batch-download.mjs "output/你的输出文件.json"
node reorganize-folders.mjs "output/你的输出文件.json" "F:\av合集"
$env:DRY_RUN="0"; node reorganize-folders.mjs "output/你的输出文件.json" "F:\av合集"
```

只重新整理已有下载文件：

```powershell
cd "D:\代码\神光 agent 开发学习\javdb-scraper"
node reorganize-folders.mjs "output/你的输出文件.json" "F:\av合集"
$env:DRY_RUN="0"; node reorganize-folders.mjs "output/你的输出文件.json" "F:\av合集"
```

只重新导入迅雷：

```powershell
cd "D:\代码\神光 agent 开发学习\javdb-scraper"
$env:DRY_RUN="1"; node thunder-batch-download.mjs "output/你的输出文件.json"
node thunder-batch-download.mjs "output/你的输出文件.json"
```

## 输出 JSON 结构

浏览器版输出大致结构：

```json
{
  "title": "叶愛 JavDB 成人影片數據庫",
  "sourceUrl": "https://javdb.com/actors/...",
  "confirmedUrl": "https://javdb.com/actors/...",
  "scrapedAt": "2026-07-07T15:33:11.000Z",
  "count": 9,
  "items": [
    {
      "code": "jur-191",
      "title": {
        "original": "JUR-191 ...",
        "zh": "JUR-191 公共厕所里的..."
      },
      "description": {
        "original": "...",
        "zh": "..."
      },
      "releaseDate": "...",
      "duration": "...",
      "director": "...",
      "studio": "...",
      "series": "...",
      "tags": ["..."],
      "magnet": "magnet:?xt=urn:btih:...",
      "magnetInfo": {
        "title": "...",
        "size": "1.56GB",
        "hasSubtitle": false
      },
      "url": "https://javdb.com/v/..."
    }
  ]
}
```

## 注意事项

- 浏览器版爬虫会打开新 Chrome 上下文，不会自动复用你系统浏览器的登录态。
- 如果页面停在登录页或验证页，需要在脚本打开的 Chrome 窗口里处理后再确认继续。
- `scrape-javdb-browser.mjs` 当前会过滤演员数 `<= 2` 的影片记录。
- `thunder-batch-download.mjs` 当前不会创建下载目录或子文件夹。
- `reorganize-folders.mjs` 默认是预览模式，只有设置 `DRY_RUN=0` 才会实际改名。
- `reorganize-folders.mjs` 只处理目标目录第一层，不递归处理子文件夹内部文件。
