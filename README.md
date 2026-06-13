# AI Daily Report · Remotion 视频生成系统

基于 [Remotion](https://remotion.dev) 的 AI 日报视频生成系统，支持 TTS 旁白、双主题（亮色/暗色）、多卡片布局和完整的数据流水线。

<img src="./demo.gif" />

## 快速开始

[html可视化文档](./.claude/claude.html)

本项目支持两种生成日报的方式：

| 方式             | 谁准备 data.json                   | 适合场景                     |
| ---------------- | ---------------------------------- | ---------------------------- |
| **手写维护**     | 你手动编辑 `data-scheme/data.json` | 想完全掌控内容，或自定义来源 |
| **Agent 自动化** | `bun run all` 自动抓取并生成       | 日常批量出片，一条命令搞定   |

> 两种方式都需要先配置 `.env`（MiniMax TTS + RSS 分析模型）。下面分别给出步骤。

### 配置 `.env`（两种方式通用）

在项目根目录创建 `.env`，Remotion / TTS / rss/ 共用同一份（参考 `.env.example`）：

```bash
# --- MiniMax TTS ---
# MINIMAX_API_KEY=<your-api-key>
# MINIMAX_TTS_ENDPOINT=https://api.minimaxi.com/v1/t2a_v2
# MINIMAX_TTS_MODEL=speech-2.8-hd             # 按需选择 TTS 模型
# MINIMAX_TTS_VOICE_ID=Chinese_sweet_girl_vv1  # 选择你喜欢的音色
# MINIMAX_TTS_SPEED=1
# MINIMAX_TTS_REQUEST_INTERVAL_MS=2200         # 默认约 27 RPM，限流时自动等待重试
# MINIMAX_TTS_MAX_RETRIES=5
# MINIMAX_TTS_RATE_LIMIT_RETRY_MS=60000
# TTS_TAIL_PADDING_MS=250
# --- RSS 分析模型（OpenAI 兼容接口，换服务只改下面三项）---
# AI_API_KEY=<your-api-key>
# AI_BASE_URL=https://api.deepseek.com
# AI_MODEL=deepseek-v4-flash
```

---

### 方式一：手写维护

你手动编辑 `data-scheme/data.json`，自己控制标题、Tabs、字幕与图片引用。

```bash
# 1. 安装依赖（需先安装 Bun）
bun install

# 2. 准备数据目录 data-scheme/（首次可直接复制示例）
#    确保 data.json 的 $schema 指向项目根目录的 data-schema.json
#    图片素材放进 data-scheme/images/
cp -r data-scheme-sample data-scheme

# 3. 编辑 data-scheme/data.json 填写日报内容
#    （不要手动添加 audioSrc、timing、tts）

# 4. 启动开发监听 + Remotion Studio（dev 会自动运行 TTS，通常无需单独执行）
bun run dev

# 可选：通过 skill 生成 Tabs 图标
#   claude: /generate-svg   codex: /generate-svg

# 单独生成 TTS（dev 未运行或需要手动生成时）
bun run tts
```

---

### 方式二：Agent 自动化

准备 Bun、Go 和 Claude CLI，再用 `bun run all` 一条命令自动完成：归档 → rss 抓取 → TTS 配音 → 生成 Tabs 图标。

> ⚠ **图片仍需手动插入**：`bun run all` 不会插图。执行后请到 `data-scheme/data.json` 给每个 Scene 填 `overlayImg: "images/xxx"`，并把图片放进 `data-scheme/images/`。仅替换图片不会重新请求旁白。

> 👁️ **Claude CLI 图片识别（按需触发）**：`rss` 抓取时，若某 Story 评分 ≥9、正文较短且含远程图片，会调用 `claude --dangerously-skip-permissions -p`（远程图像分析 MCP）识别图片内容、补充事实后再进入下一步解析。因此 **Claude CLI 的模型必须支持多模态，并配置图像分析 MCP**，否则图片识别步骤会失败。失败不中断流程，会降级为纯文本继续（但拿不到图片里的信息）。相关开关与预算见 `.env` 的 `CLAUDE_VISION_*` 项。

```bash
# 1. 准备运行环境（缺一不可，首次执行）
#    Bun:     bun --version
#    Go:      go version      （rss/ 采集器用）
#    Claude:  需安装 Claude CLI（generate-svg 步骤调用
#             claude --dangerously-skip-permissions -p "/generate-svg" 生成 Tabs 图标）

# 2. 安装依赖
bun install

# 3. .env 填好 MINIMAX_API_KEY 与 AI_API_KEY（见上方配置）

# 4. 一键自动生成（自动按序执行下方四步）
#    prerss  归档当前 data-scheme 到 daily-dates/
#    rss     抓取 Linux.do「前沿快讯」(linux.do/c/news/34.rss) 最近 24 小时内容，
#            AI 评分筛选 + 聚类（最多约 15 个主题），并基于 rss/rss-state.json
#            上一次快照自动去重，生成 data-scheme/data.json
#    tts     生成 TTS 音频与时间线
#    generate-svg  调用 Claude CLI 生成 Tabs 图标
bun run all

# 5. 手动给 data.json 各 Scene 填 overlayImg，图片放 data-scheme/images/

# 6. 预览或渲染
bun run dev      # Remotion Studio
bun run build    # 打包渲染
```

开发模式会监听 `data-scheme/data.json`、`data-schema.json`、`.env` 和图片素材：

- 修改 `data.json`、Schema 或 TTS 环境配置时，自动运行增量 TTS 并更新 `data-generate.json`。
- 未改变字幕的场景会复用已有音频；只增加或修改 `overlayImg` 不会重新请求旁白。
- 每个 Scene 可设置一个 `overlayImg: "images/..."`；同一 Story 的多个 Scene 可分别设置图片，并随各自字幕依次播放。
- 顶部导航合并相邻同名 `topTitle`；排除 Intro/Outro 后，`bottomTitle` 数量减去顶部相邻分段数不得超过 2。
- 仅替换图片文件时交由 Remotion Studio 刷新，不运行 TTS。
- `.gitignore` 只影响 Git，不影响开发监听或 Remotion 的 `publicDir`。

## 示例数据

参考项目中[data-scheme-sample](./data-scheme-sample)里面的数据。
