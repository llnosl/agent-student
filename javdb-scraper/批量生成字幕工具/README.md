# 批量生成字幕工具技术方案

## 1. 当前电脑配置判断

本方案按当前电脑配置制定：

- CPU：AMD Ryzen 5 7500F，6 核 12 线程
- 内存：约 32GB
- GPU：NVIDIA GeForce RTX 4070，约 12GB 显存
- 驱动：591.86，`nvidia-smi` 显示 CUDA 13.1
- 当前状态：显存已有约 8.9GB 被占用，主要来自桌面程序、浏览器、VS Code、Ollama 本地模型等

结论：这台机器适合用 GPU 跑 `faster-whisper large-v3` 批量生成日语字幕。实际批处理前建议先关闭或暂停 Ollama、本地大模型、占用显存的浏览器标签页和不必要的图形程序，否则 `large-v3` 可能显存不足或速度下降。

## 2. 推荐总路线

推荐采用两阶段流程：

```text
本地视频
  -> faster-whisper 识别日语音频
  -> 生成日语 .srt
  -> 批量翻译成中文 .srt
  -> 播放器加载中文字幕
```

不建议一开始就追求“边识别边翻译”。先生成日语字幕更稳，后续可以复用、校对、重翻译，也更容易排查问题。

## 3. 模型选择

### 首选：large-v3 + float16

适合当前 RTX 4070：

```text
model: large-v3
device: cuda
compute_type: float16
language: ja
beam_size: 5
vad_filter: true
```

特点：

- 日语识别准确率最好
- 适合台词含糊、背景声较多的视频
- RTX 4070 可以跑，但批处理时建议单任务运行
- 需要尽量空出显存，最好让空闲显存保持在 8GB 以上

### 备选：medium + float16

如果 `large-v3` 显存不足、速度太慢，切换到：

```text
model: medium
device: cuda
compute_type: float16
language: ja
beam_size: 5
vad_filter: true
```

特点：

- 速度更快
- 显存压力小
- 准确率低于 `large-v3`，但日常观看通常够用
- 适合一次处理几十部视频

### 不推荐作为主力：small / base

这类模型速度快，但日语口语、嘈杂音频、多人对话时错误会明显变多。除非只是快速预览，否则不建议作为主力方案。

## 4. 工具选型

### 方案 A：Faster-Whisper-XXL，最适合 Windows 批处理

这是最推荐的落地方式。它把 `faster-whisper`、模型下载、CUDA 运行环境和命令行封装得更适合 Windows 用户。

适合你这种场景：

- 本地视频数量多
- 想批量生成 `.srt`
- 不想花太多时间处理 Python、CUDA、cuDNN 兼容问题

建议用它负责第一阶段：生成日语 `.srt`。

### 方案 B：Subtitle Edit + Whisper，适合单片校对

Subtitle Edit 更适合：

- 单部电影精修
- 手动调整时间轴
- 直接在图形界面里翻译
- 检查字幕断句和错字

不建议把 Subtitle Edit 作为大批量识别主力。它更适合后处理和校对。

### 方案 C：Python + faster-whisper，适合后续自定义脚本

如果后续想和 `javdb-scraper` 的整理结果打通，可以用 Python 脚本自动扫描文件夹，按视频名生成同名字幕。

这个方式灵活，但 Windows 上 GPU 环境更容易遇到 CUDA / cuDNN / CTranslate2 兼容问题。建议等方案 A 跑通后再做。

## 5. 推荐目录结构

建议把视频、日语字幕、中文字幕分开放：

```text
批量生成字幕工具/
  README.md
  input-videos/          # 待处理视频，可放快捷方式或实际视频
  output-ja-srt/         # faster-whisper 生成的日语字幕
  output-zh-srt/         # 翻译后的中文字幕
  logs/                  # 批处理日志
  scripts/               # 后续可放批处理脚本
```

如果视频已经由 `javdb-scraper` 整理成番号文件夹，建议字幕文件直接输出到视频同目录，文件名和视频文件同名：

```text
ABCD-123/
  ABCD-123.mp4
  ABCD-123.ja.srt
  ABCD-123.zh-CN.srt
```

播放器通常会自动识别同名字幕，后续迁移也更方便。

## 6. 日语字幕生成参数

用 `faster-whisper` 生成日语字幕时，关键参数建议如下：

```text
--model large-v3
--language ja
--task transcribe
--device cuda
--compute_type float16
--beam_size 5
--vad_filter true
--output_format srt
```

参数说明：

- `language ja`：强制按日语识别，避免自动识别误判
- `task transcribe`：输出原日语，不直接翻译成英文
- `device cuda`：使用 RTX 4070
- `compute_type float16`：适合 NVIDIA 显卡，速度和显存较平衡
- `beam_size 5`：提高识别稳定性，速度略慢但值得
- `vad_filter true`：过滤静音片段，减少无意义字幕

当前电脑建议并发数：

```text
large-v3：1 个视频同时跑
medium：1 到 2 个视频同时跑
```

不建议 `large-v3` 多开。多开容易显存爆掉，实际总耗时不一定更短。

## 7. 中文字幕翻译方案

### 首选：先批量机翻，再抽查校对

推荐流程：

```text
日语 .srt
  -> 保留时间轴
  -> 只翻译字幕正文
  -> 输出中文 .srt
```

关键点：不要让翻译工具重写时间轴。时间轴由 Whisper 负责，翻译阶段只处理文本。

### 翻译引擎选择

#### DeepL API

优点：

- 日译中质量高
- 语气自然
- 适合批量脚本

缺点：

- 需要 API key
- 有额度或付费限制
- 部分敏感内容可能受限制

#### 本地大模型，例如 Ollama

优点：

- 不上传字幕文本
- 没有 API 额度限制
- 可以按自己的规则翻译

缺点：

- 会占用显存或内存
- 和 `faster-whisper large-v3` 同时运行会抢 RTX 4070 显存
- 建议识别和翻译分开跑，不要同时跑

#### Subtitle Edit 翻译

优点：

- 图形界面方便
- 适合单部视频检查和修正
- 对不想写脚本的场景最友好

缺点：

- 批量能力一般
- 大量视频会比较慢

## 8. 推荐执行顺序

### 第一步：先跑 1 部测试片

用 `large-v3 + float16 + ja + vad_filter` 生成一份日语 `.srt`。

检查：

- 字幕时间轴是否跟声音对得上
- 是否出现大量乱码或语言误判
- 是否有很长的字幕行
- RTX 4070 显存是否稳定

### 第二步：确认模型档位

如果效果好但速度能接受：继续用 `large-v3`。

如果显存不足或速度太慢：改用 `medium`。

如果字幕质量不稳定：保持 `large-v3`，并关闭更多占显存进程。

### 第三步：批量生成日语字幕

按文件夹扫描视频，跳过已有 `.ja.srt` 的视频，避免重复处理。

推荐匹配视频后缀：

```text
.mp4 .mkv .avi .wmv .mov .m4v
```

输出命名：

```text
原视频名.ja.srt
```

### 第四步：批量翻译中文字幕

读取 `.ja.srt`，保留序号和时间轴，只翻译正文，输出：

```text
原视频名.zh-CN.srt
```

也可以直接使用当前目录提供的 Ollama 翻译脚本：

```text
批量生成字幕工具/translate-srt-ollama.mjs
```

它会读取日语 `.srt`，调用本地 Ollama 模型逐条翻译字幕正文，并保留原始字幕序号和时间轴。输出文件会写到输入字幕同目录。

从项目根目录执行：

```powershell
cd "D:\代码\神光 agent 开发学习\javdb-scraper"
node "批量生成字幕工具\translate-srt-ollama.mjs" "F:\av合集\JUR-191\JUR-191.H265_ja.srt"
```

输出命名规则：

```text
JUR-191.H265_ja.srt
-> JUR-191.H265_zh-CN.srt
```

如果输入文件名不是 `_ja.srt` 或 `.ja.srt` 结尾，会直接在原文件名后生成 `_zh-CN.srt`。

可用环境变量：

| 变量 | 作用 | 默认值 |
|---|---|---|
| `OLLAMA_MODEL` | Ollama 翻译模型 | `demonbyron/HY-MT1.5-1.8B:latest` |
| `TRANSLATE_DELAY_MS` | 每条字幕翻译后的等待时间，毫秒 | `150` |

指定模型示例：

```powershell
$env:OLLAMA_MODEL="demonbyron/HY-MT1.5-1.8B:latest"
node "批量生成字幕工具\translate-srt-ollama.mjs" "F:\av合集\JUR-191\JUR-191.H265_ja.srt"
```

调大翻译间隔示例：

```powershell
$env:TRANSLATE_DELAY_MS="800"
node "批量生成字幕工具\translate-srt-ollama.mjs" "F:\av合集\JUR-191\JUR-191.H265_ja.srt"
```

运行前需要确保 Ollama 已启动，并且本地已拉取要使用的模型。

### 第五步：播放器验证

推荐播放器：

- PotPlayer
- VLC
- mpv

验证内容：

- 字幕是否自动加载
- 中文是否乱码
- 时间轴是否偏移
- 长句是否挡画面

## 9. 和 javdb-scraper 的结合方式

`javdb-scraper` 当前更适合负责资料抓取、标题翻译和文件夹整理；字幕工具建议作为独立流程，不直接改现有脚本。

后续如果要打通，可以新增一个字幕批处理脚本，逻辑如下：

```text
扫描 output/ 或整理后的番号目录
  -> 找到视频文件
  -> 如果同目录没有 .ja.srt，则生成日语字幕
  -> 如果已有 .ja.srt 但没有 .zh-CN.srt，则翻译中文字幕
  -> 写入 logs/subtitle-jobs.jsonl
```

这样不会影响现有 JavDB 抓取和整理逻辑，出错时也容易重跑。

## 10. 实用注意事项

- 批处理前先运行 `nvidia-smi` 看显存占用。
- 如果 Ollama 正在跑本地模型，先停掉或改到字幕翻译阶段再启动。
- 识别阶段优先保证 GPU 给 `faster-whisper` 使用。
- 中文字幕翻译阶段可以用 CPU 或本地模型慢慢跑，不要和 `large-v3` 抢显存。
- 每次先测试 1 部视频，再扩大到 5 部，最后再全量跑。
- 保留日语 `.srt`，不要只保留中文 `.srt`。日语字幕是后续重翻译和校对的基础。

## 11. 最终推荐配置

当前机器的最优默认方案：

```text
识别工具：Faster-Whisper-XXL 或 Python faster-whisper
识别模型：large-v3
识别语言：ja
运行设备：cuda
精度：float16
并发数：1
输出：同目录同名 .ja.srt
翻译：DeepL API 或本地 Ollama，输出 .zh-CN.srt
校对工具：Subtitle Edit
播放器：PotPlayer
```

如果追求速度，降级方案：

```text
识别模型：medium
并发数：1 到 2
其他参数保持不变
```

建议先按 `large-v3` 跑通 1 部视频，确认速度和字幕质量后，再决定是否写自动化批处理脚本。

## 12. 批量生成并翻译脚本

当前推荐使用一体化脚本：

```text
批量生成字幕工具/folder-video-to-zh-subtitles.mjs
```

它会递归扫描传入路径下的视频文件，逐个执行：

```text
视频文件
  -> Faster-Whisper-XXL 生成 视频名_ja.srt
  -> Ollama 翻译生成 视频名_zh-CN.srt
```

处理整个 `F:\av合集`：

```powershell
node "批量生成字幕工具\folder-video-to-zh-subtitles.mjs" "F:\av合集"
```

只处理单个视频文件夹：

```powershell
node "批量生成字幕工具\folder-video-to-zh-subtitles.mjs" "F:\av合集\JUR-191 公共厕所里的乳房杀手！一个有着108厘米巨乳、属于都市传说级别的女性变态者出现了——叶爱"
```

也可以直接传入单个视频文件：

```powershell
node "批量生成字幕工具\folder-video-to-zh-subtitles.mjs" "F:\av合集\JUR-191\JUR-191.mp4"
```

脚本默认配置：

```text
Faster-Whisper-XXL：D:/Faster-Whisper-XXL/Faster-Whisper-XXL/faster-whisper-xxl.exe
Whisper 模型：medium
识别设备：cuda
精度：float16
日语字幕：视频名_ja.srt
中文字幕：视频名_zh-CN.srt
翻译模型：demonbyron/HY-MT1.5-1.8B:latest
```

可用环境变量：

| 变量 | 作用 | 默认值 |
|---|---|---|
| `FWXXL_EXE` | Faster-Whisper-XXL exe 路径 | `D:/Faster-Whisper-XXL/Faster-Whisper-XXL/faster-whisper-xxl.exe` |
| `WHISPER_MODEL` | Whisper 模型 | `medium` |
| `WHISPER_DEVICE` | 识别设备 | `cuda` |
| `WHISPER_COMPUTE_TYPE` | 计算精度 | `float16` |
| `OLLAMA_MODEL` | Ollama 翻译模型 | `demonbyron/HY-MT1.5-1.8B:latest` |
| `TRANSLATE_DELAY_MS` | 每条字幕翻译后的等待时间，毫秒 | `150` |
| `OVERWRITE=1` | 重新生成已有字幕 | 默认跳过已有字幕 |

如果要重新生成已有字幕：

```powershell
$env:OVERWRITE="1"
node "批量生成字幕工具\folder-video-to-zh-subtitles.mjs" "F:\av合集"
```

如果要临时切回 `large-v3`：

```powershell
$env:WHISPER_MODEL="large-v3"
node "批量生成字幕工具\folder-video-to-zh-subtitles.mjs" "F:\av合集"
```

如果 Faster-Whisper-XXL 安装在其他位置：

```powershell
$env:FWXXL_EXE="D:\Faster-Whisper-XXL\Faster-Whisper-XXL\faster-whisper-xxl.exe"
node "批量生成字幕工具\folder-video-to-zh-subtitles.mjs" "F:\av合集"
```

运行前需要确认：

- Faster-Whisper-XXL 可执行文件路径正确。
- Ollama 已启动，并且已经拉取 `OLLAMA_MODEL` 指定的模型。
- 识别阶段和翻译阶段都会顺序执行；已有 `_ja.srt` 或 `_zh-CN.srt` 默认跳过，脚本中断后可以直接重跑。

旧版自动化脚本仍保留：

```text
批量生成字幕工具/batch-generate-and-translate.mjs
```

脚本内部用参数数组调用 Faster-Whisper-XXL，所以路径里有中文、空格、弯引号或英文引号时，比手写 PowerShell 命令更稳定。
