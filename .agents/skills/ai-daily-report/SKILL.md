---
name: ai-daily-report
description: How to use the ai-daily-report project end-to-end — set it up, run the automated pipeline, switch the TTS model/provider, go fully manual, drop images into data.json, preview, render the final mp4, and publish to Bilibili. Use whenever the user asks how to use this project, how to run it, how to change the TTS, how to do things manually, how to add images to the daily report, how to render/export a video, how to publish/upload to Bilibili, or any question about operating the pipeline or editing data.json — even if they do not explicitly say "skill".
---

# AI Daily Report 使用指南

让用户「直接和 agent 对话」就把一期 AI 日报视频做出来：从配置环境、跑流水线、换 TTS、手动写内容、放图片，到预览、导出 mp4，再一键发布到 B站。

本 skill 是项目的总入口指南，README 的 FAQ 里说的「遇到难题可直接用本项目提供的 skill」就是指它。它和另外两个 skill 配合：`generate-svg`（出 Tab 图标）与 `remotion-best-practices`（改 Remotion 组件时的通用规范），那两个由它们各自的触发条件处理，这里不重复。

## 行为约定（重要）

这个 skill 触发后，遵循「**先讲解、再代执行**」：

1. **先讲清楚**：用一两句话说明这一步在做什么、为什么这么做、有没有副作用（花钱、改文件、覆盖归档、对外发布）。
2. **再动手**：需要改文件或跑命令前，把打算做的事讲明白再执行；遇到不确定（比如要覆盖现有内容、要花钱调 API、要往 B站 发真实稿件）先问用户。
3. **细节进 `rules/`**：主线只放最常用的结论，深入步骤在下面的 rules 文件里，按需读，别一次性全读。

## 开始前确认

每次先在心里过一遍这两点，缺什么先补什么：

- **环境变量** `.env`（参考 `.env.example`）：
  - RSS/AI 总结用：`AI_API_KEY`、`AI_BASE_URL`、`AI_MODEL` 三者均必填（OpenAI 兼容接口；`.env.example` 给了 DeepSeek 示例值）。`bili:meta` 生成 B站 标题/标签也复用这套。
  - 网络受限时可选：小写 `all_proxy`（如 `http://127.0.0.1:7890`）。**仅作用于 `rss` 抓取阶段**（RSS 源抓取 + 该阶段内部的 AI 评分请求）；MiniMax TTS、B站 标题/标签生成与投稿/评论/置顶等 Node 端请求**不**走此代理，始终直连。未配置则直连；配置后上述 `rss` 阶段请求必须走该代理，失败时不会回退直连。不要使用其他代理变量。
  - TTS 旁白用：`TTS_REQUIRE=true` 时需要 `MINIMAX_API_KEY`、`MINIMAX_TTS_MODEL`、`MINIMAX_TTS_VOICE_ID`、`MINIMAX_TTS_SPEED`；不需要旁白或没有 MiniMax Key 时设 `TTS_REQUIRE=false`，会跳过 MiniMax、音频和 ffmpeg 音质检测。
  - 图片识别用：`CLAUDE_VISION_ENABLED=true` 时，默认优先处理高分且含远程图的 Story；在调用上限/预算内识图，判定相关后才自动写 `overlayImg`。没有多模态能力或图片识别 MCP 时设为 `false`，流程会下载候选图到 `data-scheme/images/` 供手动配图。
  - 语音质量检测用：`REQUIRE_VOICE_QUALITY_FFMPEG=true` 时需要可用的 `ffmpeg`；没装 ffmpeg 但仍要生成旁白时设为 `false`。
- **运行时**：需要 `bun`、`go`（跑 RSS 采集器）；需要自动识图或生成 Tab 图标时还需要 `claude` CLI。
- **数据目录**：正式数据固定用 `data-scheme/`；示例预览用 `data-scheme-sample-1/2`，不会改正式数据。
  - `bun run preview` / `preview:notts` 只读 sample 目录；即使 `data-scheme/` 为空也应该能启动。
  - `bun run dev` / `video:render` 读取正式 `data-scheme/data-generate.json`，由 `tts` 生成。
- **发布到 B站** 额外需要一次扫码登录（见下方「发布到 B站」），登录态存 `biliup/cookies.json`，不进 `.env`。

## A. 自动出片（推荐主线）

适合「日常批量出片，一条命令搞定」。把数据采集、AI 总结、TTS、图标全自动化。

```bash
# 0. 配好 .env（见上），然后装依赖
bun install
#    要发 B站 时再单独跑一次 bili 前置（下载 biliup 工具 + 清理扫码产物）：
#    bun run biliup:prepare

# 1. 跑全流程：archive:rotate → rss → check-data-json → tts → generate-svg（跑完即结束，不自动开预览）
bun run video:prepare

# 如果要丢弃当前 data-scheme/ 和 RSS 去重快照后完全重建
bun run reset
bun run video:prepare
```

`bun run video:prepare`（`scripts/render/prepare-video.mjs`）先按顺序跑生产步骤并显示实时状态，任一步失败会中断。**跑完即结束，不再自动开预览**（要看画面单独 `bun run dev`）：

| 步骤              | 做什么                                              | 产物                                             |
| ----------------- | --------------------------------------------------- | ------------------------------------------------ |
| `archive:rotate`  | 归档上一天数据（必要时），保证每次都从干净状态开始  | `daily-dates/`                                   |
| `rss`             | Go 采集器抓 RSS → AI 筛选/聚类 → 生成结构           | `data-scheme/data.json`                          |
| `check-data-json` | 校验 Raw 数据（Schema / 重复 ID / 引用 / 资源路径） | （无产物，不通过则中断）                         |
| `tts`             | 给每个 scene 生成 MiniMax 旁白，算时间线            | `data-scheme/data-generate.json` + `audio/*.mp3` |
| `generate-svg`    | 调 `claude -p /generate-svg` 给 tabs 出图标         | `data-scheme/icons/*.svg`                        |

`rss` 步骤会读取项目根目录 `.env` 中可选的小写 `all_proxy`。没有配置时跳过代理并直连；配置后 RSS 抓取与 AI 模型请求都会强制使用该代理，代理无效或不可用时直接报错。它不会读取 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 等其他代理变量，也不会自动探测本地代理端口。

生产步骤跑完后：

- **图片自动 + 手动两条路**：`CLAUDE_VISION_ENABLED=true` 时，`rss` 视觉识别会默认优先处理高分且含远程图片的 Story；在调用上限/预算内，Claude 判定相关后自动把该图下载到 `data-scheme/images/` 并写入对应 scene 的 `overlayImg`；`CLAUDE_VISION_ENABLED=false` 时不会写 `overlayImg`，但会下载候选图，方便手动填图。详见下方「把图片放进 data.json」。
- **预览 / 渲染 / 发布**：`bun run preview` 看完整示例，`bun run preview:notts` 看无 TTS 示例；看当前 `data-scheme/` 用 `bun run dev`（HMR + 自动 TTS 同步）。导出用 `bun run video:render`，发 B站 用 `bun run all:bili`。

> 关于 `ingest/rss-state.json`：它存的是上次抓取的快照，用来去重。日常不用手动编辑；如果清空了 `data-scheme/` 或想完全重建，先跑 `bun run reset`，再跑 `bun run video:prepare`。

## B. 手动模式

适合「想完全掌控内容 / 自定义非 RSS 来源 / 自动流程出问题时兜底」：你自己写 `data.json`，不跑 `rss`。

主线很简单：参考或复制 `data-scheme-sample-1` → 编辑 `data-scheme/data.json` → `bun run dev`（会自动 TTS）或手动 `bun run tts` → `/generate-svg` 出图标。

完整步骤、必填字段速查、theme 切换：**先读 [`rules/manual-mode.md`](./rules/manual-mode.md)** 再动手。

## 换 TTS 模型 / 供应商

一句话结论：**目前只适配了 MiniMax，RSS 用的 AI 模型随便换（改 `.env` 即可），TTS 要换供应商需要改代码。**

- 只换 MiniMax 的模型/音色/语速 → 纯改 `.env`（`MINIMAX_TTS_MODEL` / `MINIMAX_TTS_VOICE_ID` / `MINIMAX_TTS_SPEED`）。
- 换成别的 TTS 供应商（如阿里/字节）→ 要改 `scripts/lib/minimax-tts.mjs`、`scripts/render/generate-tts.mjs`、`data.schema.json` 三处，外加 `.env`。

详细改哪些点、怎么验证、缓存为何不用 `--force`：**先读 [`rules/tts-customize.md`](./rules/tts-customize.md)** 再动手。

## 把图片放进 data.json

一句话结论：**把图片丢进 `data-scheme/images/`，给对应的 scene 加 `"overlayImg": "images/文件名"`。**

- 自动模式（`bun run video:prepare`）下，`rss` 视觉识别开启时会给部分高分 Story **自动下载并配图**（写入 `overlayImg`）；视觉关闭时只下载候选图，不写 `overlayImg`。下面讲的是没被自动配上、或手动模式下你自己加图时怎么做。
- 图片是 **scene 级**的（不是 story 级、不是 tab 级），一张图配一句旁白。
- 允许格式：`.svg .png .jpg/.jpeg .webp`。
- 多张图 = 给同一个 story 写多个 scene，依次播放。
- 改图片**不会**重新请求 TTS（`scripts/render/dev.mjs` 故意如此），想只刷新预览直接保存即可。

完整规则、命名、验证方法：**先读 [`rules/images.md`](./rules/images.md)** 再动手。

## 渲染导出 mp4

一句话结论：**用 `bun run video:render`（= `tts` + `render:mp4` → `out/AiDailyReport.mp4`）。** 想自定义渲染参数再用裸命令 `bunx remotion render`。

```bash
# 标准做法：自动跑 TTS 备好渲染数据 + 渲成 mp4
bun run video:render

# 或手动两步（便于控制时机 / 传参数）
bun run tts
bunx remotion render AiDailyReport out/AiDailyReport.mp4 \
  --props=data-scheme/data-generate.json \
  --public-dir=data-scheme
```

时长、可选参数、常见坑：**先读 [`rules/render-export.md`](./rules/render-export.md)** 再动手。

## 发布到 B站（投稿 + 评论 + 置顶）

把当期成片自动发到 B站，并发表 + 置顶「今日日报」评论（内容来自 `data-scheme/comments.txt`，由 `comment:generate` 从时间线生成）。一条龙：

```bash
# 从零到发布：video:prepare → video:render → 渲封面 → comment:generate → bili:meta → bili:full（投稿→等审核→发评论→置顶）
bun run all:bili

# 数据已备好、只想发 B站：video:render → 渲封面 → comment:generate → bili:meta → bili:full（投稿+评论+置顶）
bun run publish:bili
```

**首次使用（一次性）**——扫码登录 B站，登录态存进 `biliup/cookies.json`（已 gitignore；评论/置顶也直接读它，**不进 `.env`**）。可主动跑 `bun run biliup:prepare`（下载 biliup 工具 + 登录 + 清理扫码产物），bili 命令执行时也会自动触发同一套 ensure 逻辑：

```bash
bun run biliup:prepare                              # 一键备好 biliup 工具 + 登录态
# 或手动登录：
./biliup/biliup.exe -u biliup/cookies.json login   # 用 B站 App 扫码确认
```

要点：

- **标题 / 标签** 由 `bili:meta` 用 LLM 生成（手机短视频风、抓重点、适度夸张），写到 `data-scheme/bilibili-meta.json`——可手改再审。标题 = `前缀【AI日报 - MM - DD】`（≤80 字，中文/字母/符号每个算 1），标签 ≤10 个。
- **固定参数**（分区 `tid 231` 计算机技术、自制、创作声明 AI 标识、封面帧、评论前等待 3 分钟过审核）在 `bilibili.config.json`。
- **凭据**：评论/置顶的 `SESSDATA` / `bili_jct` 直接从 `biliup/cookies.json` 读（`scripts/publish/bili/bili-api.mjs`），不在 `.env` 重复维护。
- **biliup 工具**由 `bun run biliup:prepare`（内部走 `download-bili`）下载到 `biliup/`（跨平台、平铺结构，已 gitignore）。首次发 B站 时 bili 命令会自动触发该 ensure 逻辑；升级重跑 `bun run download-bili`，会自动保留登录态。
- 也可拆开单步：`bili:meta`（生成标题/标签）、`bili:upload`（纯投稿，只发视频）、`bili:full`（投稿+评论+置顶 全套，原 `bili:upload` 行为）、`bili:comment` / `bili:stick`（单独发评/置顶）。`publish:bili` / `all:bili` 内部都调 `bili:full`。
- **封面（默认 16:9；4:3 / 16:9 裁切是重要坑）**：`render:cover` 截主视频第 `coverFrame` 帧（默认 45，配在 `bilibili.config.json`）→ `out/cover.png`——视频是 1920×1080，所以**自动封面固定是 16:9**，`coverFrame` 只决定截哪一帧、**不改比例**。投稿时 `biliup --cover` **只上传这一张**。**B站 每个视频只能传一张封面**——首页推荐按 4:3、播放页/空间按 16:9 显示，是**同一张图被平台自动裁切**，不是两个上传位，也**不能分别传两张不同的图**（平台限制，不是工具限制）。因此封面标题/主体要放在**中央安全区**（1920×1080 帧在首页 4:3 位会被裁掉左右各约 240px）。**想要非 16:9 / 自制封面**有两条手动路：① `bun run render:cover` 之后、`bili:upload` 之前**手动替换 `out/cover.png`**；② 走一键 `all:bili` 发布后，去 **B站 创作中心 → 稿件管理 → 编辑 → 修改封面** 手动重传/调裁切（那里仍是单张封面，但能换图，是 `biliup` 之外唯一的封面定制入口）。

> `bili:full` 会**真实发布**稿件 + 评论 + 置顶到你的 B站 号（对外动作）。`bili:upload` 是纯投稿（已带 `--no-comment`，只发视频，不发评论/置顶）——纯测试可用它发一条试稿，发完记得去创作中心删测试稿。

## Read First（按需读的细节）

动手做某件事前，先读对应文件：

| 想做的事             | 读哪个                                               |
| -------------------- | ---------------------------------------------------- |
| 手写 / 完全手动出片  | [`rules/manual-mode.md`](./rules/manual-mode.md)     |
| 换 TTS 模型或供应商  | [`rules/tts-customize.md`](./rules/tts-customize.md) |
| 给日报加图片         | [`rules/images.md`](./rules/images.md)               |
| 把视频渲染导出成 mp4 | [`rules/render-export.md`](./rules/render-export.md) |

发布到 B站 没有独立 rule 文件，主线（登录 / 配置 / 命令 / 注意事项）就在上面的「发布到 B站」一节。

要做 Tab 图标，用 `generate-svg` skill（README 和 `package.json` 里 `/generate-svg`）；要改 Remotion 组件本身（动画、布局、`<Audio>`/`<Img>` 用法），用 `remotion-best-practices` skill。
