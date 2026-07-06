---
name: ai-daily-report
description: How to use the ai-daily-report project end-to-end — set it up, run the automated pipeline, switch the TTS model/provider, go fully manual, drop images into data.json, preview, render the final mp4, and publish to Bilibili. Use whenever the user asks how to use this project, how to run it, how to change the TTS, how to do things manually, how to add images to the daily report, how to render/export a video, how to publish/upload to Bilibili, or any question about operating the pipeline or editing data.json — even if they do not explicitly say "skill".
---

# AI Daily Report 使用指南

让用户「直接和 agent 对话」就把一期 AI 日报视频做出来：从配置环境、跑流水线、换 TTS、手动写内容、放图片，到预览、导出 mp4，再一键发布到 B站。

本 skill 是项目的总入口指南，README 的 FAQ 里说的「遇到难题可直接用本项目提供的 skill」就是指它。它和另外两个 skill 配合：`generate-svg`（出 Tab 图标）与 `remotion-best-practices`（改 Remotion 组件时的通用规范），那两个由它们各自的触发条件处理，这里不重复。

## 常见用法速查

用户问「`/ai-daily-report` 这个 skill 怎么用」时，先按下面三种入口解释，不要一上来只讲完全手动模式：

1. **自动出片**：用户想一条命令生成当天日报，就让他配置 `.env` 后运行 `bun run video:prepare`。这会自动抓 RSS、筛选、生成 `data.json`、TTS 和 Tab 图标。
2. **审核删除**：用户跑完 `bun run video:prepare` 后审核，发现某条 story 不想要，直接说「删掉 topic-XXX」。agent 按 [`rules/review-remove-mode.md`](./rules/review-remove-mode.md) 从 `data-scheme/data.json` 干净地移除该 story、清理孤儿 icon、重跑 TTS 让 audio 和 `data-generate.json` 自愈，再跑校验。
3. **RSS 补选**：用户已经跑过 `bun run video:prepare`，但觉得自动筛选太少，就让他从 `ingest/rss-state.json` 复制多条想补进视频的记录，直接贴给 `/ai-daily-report`。agent 按 [`rules/rss-pick-mode.md`](./rules/rss-pick-mode.md) 解析这些记录，按 `.env` 里的视觉/TTS 开关补图和生成语音，追加到当前 `data-scheme/data.json`，再跑校验、TTS 和图标生成。
4. **完全手动**：用户不想用 RSS，或要做特别篇，才让他自己维护 `data-scheme/data.json`。agent 按 [`rules/manual-mode.md`](./rules/manual-mode.md) 协助。

最常见的日常用法是：**先自动出片，再按需审核删减 / RSS 补选**（删除走 `review-remove-mode.md`，追加走 `rss-pick-mode.md`，两者方向相反）。长期偏好才改 `ingest/preferences.jsonc`；当天临时想加的新闻不要要求用户维护关键词，直接走 RSS 补选。

## 行为约定（重要）

这个 skill 触发后，遵循「**先讲解、再代执行**」：

1. **先讲清楚**：用一两句话说明这一步在做什么、为什么这么做、有没有副作用（花钱、改文件、覆盖归档、对外发布）。
2. **再动手**：需要改文件或跑命令前，把打算做的事讲明白再执行；遇到不确定（比如要覆盖现有内容、要花钱调 API、要往 B站 发真实稿件）先问用户。
3. **细节进 `rules/`**：主线只放最常用的结论，深入步骤在下面的 rules 文件里，按需读，别一次性全读。

## 开始前确认

每次先在心里过一遍这两点，缺什么先补什么：

- **环境变量** `.env`（参考 `.env.example`）：
  - RSS/AI 总结用：`AI_API_KEY`、`AI_BASE_URL`、`AI_MODEL` 三者均必填（OpenAI 兼容接口；`.env.example` 给了 DeepSeek 示例值）。`video:meta` 生成视频标题/标签也复用这套。
  - 网络受限时可选：小写 `all_proxy`（如 `http://127.0.0.1:7890`）。**按来源决定**是否走代理——`ingest/sources.jsonc` 里标了 `"proxy": true` 的来源（如 linux.do，在 Cloudflare 后面）抓取时走 `all_proxy`，其他来源直连；AI 评分请求仍受 `all_proxy` 控制（配置后即走）。MiniMax TTS、B站 标题/标签生成与投稿/评论/置顶等 Node 端请求**不**走此代理，始终直连。标了 `proxy: true` 的来源若 `.env` 未配 `all_proxy` 或配置无效，抓取时直接报错，不静默回退直连。不要使用其他代理变量。注意：Claude/WebFetch/Fetch 这类 agent 工具不会自动读取项目 `.env`，人工补选 Linux.do 页面时如果 WebFetch 失败，应改用本地命令或项目脚本显式读取 `all_proxy` 后抓取，不能直接退化为只看标题生成。
  - TTS 旁白用：`TTS_REQUIRE=true` 时需要 `MINIMAX_API_KEY`、`MINIMAX_TTS_MODEL`、`MINIMAX_TTS_VOICE_ID`、`MINIMAX_TTS_SPEED`；不需要旁白或没有 MiniMax Key 时设 `TTS_REQUIRE=false`，会跳过 MiniMax、音频和 ffmpeg 音质检测。
  - 图片识别用：`CLAUDE_VISION_ENABLED=true` 时，默认处理达到日报入选线（Score ≥7）且含远程图的 Story；分数高的 Story 会先消耗调用预算，总量由 `CLAUDE_VISION_MAX_CALLS` 封顶。识图会使用 Story 标题、重要性和要点做相关性判断，相关才自动写 `overlayImg`。没有多模态、远程读取或图像分析 MCP 能力时设为 `false`，流程会下载候选图到 `data-scheme/images/` 供手动配图。
  - 语音质量检测用：`REQUIRE_VOICE_QUALITY_FFMPEG=true` 时需要可用的 `ffmpeg`；没装 ffmpeg 但仍要生成旁白时设为 `false`。
- **运行时**：需要 `bun`、`go`（跑 RSS 采集器）；需要自动识图或生成 Tab 图标时还需要 `claude` CLI。
- **数据目录**：正式数据固定用 `data-scheme/`；示例预览用 `demo/data-scheme-sample-1/2`，不会改正式数据。
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
| `generate-svg`    | 调 `bun run generate-svg` 批量生成 tabs 图标        | `data-scheme/icons/*.svg`                        |

`rss` 步骤的网络代理规则见上方「开始前确认」的 `all_proxy` 段，不再赘述。补充两点专属于 `rss` 的：标了 `proxy: true` 的来源（如 linux.do）抓取时**除 `all_proxy` 外还需要 `LINUXDO_CF_CLEARANCE` + `LINUXDO_USER_AGENT` 三件套**才过 Cloudflare（CF 现已覆盖 `.rss` 端点），`ingest/rss2.go` 已内置此逻辑；agent 的 WebFetch/Fetch 不会自动读项目 `.env`，人工补选抓 linux.do 时要用本地 curl 显式带三件套（详见 `rss-pick-mode.md`）。

生产步骤跑完后：

- **图片自动 + 手动两条路**：`CLAUDE_VISION_ENABLED=true` 时，`rss` 视觉识别会处理达到日报入选线（Score ≥7）且含远程图片的 Story；在调用上限/预算内，Claude 会结合 Story 上下文判定相关，相关后自动把该图下载到 `data-scheme/images/` 并写入对应 scene 的 `overlayImg`；`CLAUDE_VISION_ENABLED=false` 时不会写 `overlayImg`，但会下载候选图，方便手动填图。详见下方「把图片放进 data.json」。
- **预览 / 渲染 / 发布**：`bun run preview` 看完整示例，`bun run preview:notts` 看无 TTS 示例；看当前 `data-scheme/` 用 `bun run dev`（HMR 只同步 data → TTS 并刷新 Studio，**不含 Tab 图标**——新增/改 tab 后图标缺失需单独 `bun run generate-svg`）。导出用 `bun run video:render`，发 B站 用 `bun run all:bili`。

> 关于 `ingest/rss-state.json`：它存的是最近一次完整抓取快照，用于来源失败时保留上次状态，也方便从抓取结果里人工补选新闻；当前采集器会对最近时间窗口内的全部条目重新评分，不再用它做跨次预过滤。日常不用手动编辑；如果想丢弃当前数据与快照后完全重建，先跑 `bun run reset`，再跑 `bun run video:prepare`。

## B. 手动模式

适合「想完全掌控内容 / 自定义非 RSS 来源 / 自动流程出问题时兜底」：你自己写 `data.json`，不跑 `rss`。

主线很简单：参考或复制 `demo/data-scheme-sample-1` → 编辑 `data-scheme/data.json` → `bun run dev`（会自动 TTS）或手动 `bun run tts` → `bun run generate-svg` 出图标。

完整步骤、必填字段速查、theme 切换：**先读 [`rules/manual-mode.md`](./rules/manual-mode.md)** 再动手。

## C. RSS 补选模式

适合「已经跑完 `bun run video:prepare`，但自动筛选出来的新闻太少，用户从 `ingest/rss-state.json` 里挑了几条想补进本期视频」。

这是**半自动补选**，不是完全手写：用户直接把一段 `rss-state.json` 条目贴给 `/ai-daily-report`，例如：

```jsonc
"c320d6cc...": {
  "sourceId": "linuxdo-news",
  "title": "Google Workspace CLI 项目作者被解雇",
  "link": "https://linux.do/t/topic/2463889"
},
"e554f218...": {
  "sourceId": "linuxdo-news",
  "title": "豆包新版变化真蛮多的...",
  "link": "https://linux.do/t/topic/2461423"
}
```

这时不要让用户逐条跑命令，也不要要求用户改 `preferences.jsonc`。按 [`rules/rss-pick-mode.md`](./rules/rss-pick-mode.md) 执行：解析用户粘贴的多条 RSS 记录 → 按各来源在 `sources.jsonc` 的 `proxy` 字段决定抓取是否走代理 → 对照当前 `data-scheme/data.json` 去重 → 按 `.env` 的视觉开关补图/写 `overlayImg` → 生成并追加对应 Story → 校验 → 重新生成 TTS 与图标。

## 换 TTS 模型 / 供应商

一句话结论：**目前只适配了 MiniMax，RSS 用的 AI 模型随便换（改 `.env` 即可），TTS 要换供应商需要改代码。**

- 只换 MiniMax 的模型/音色/语速 → 纯改 `.env`（`MINIMAX_TTS_MODEL` / `MINIMAX_TTS_VOICE_ID` / `MINIMAX_TTS_SPEED`）。
- 换成别的 TTS 供应商（如阿里/字节）→ 要改 `scripts/lib/minimax-tts.mjs`、`scripts/render/generate-tts.mjs`、`config/data.schema.json` 三处，外加 `.env`。

详细改哪些点、怎么验证、缓存为何不用 `--force`：**先读 [`rules/tts-customize.md`](./rules/tts-customize.md)** 再动手。

## 把图片放进 data.json

一句话结论：**把图片丢进 `data-scheme/images/`，给对应的 scene 加 `"overlayImg": "images/文件名"`；`"overlayImgWidth"` / `"overlayImgHeight"` 由构建按文件真实像素自动写入 `data-generate.json`，无需手填。**

- 自动模式（`bun run video:prepare`）下，`rss` 视觉识别开启时会给达到日报入选线（Score ≥7）且含远程图的 Story **自动下载并配图**（写入 `overlayImg`）；视觉关闭时只下载候选图，不写 `overlayImg`。下面讲的是没被自动配上、或手动模式下你自己加图时怎么做。
- 图片是 **scene 级**的（不是 story 级、不是 tab 级），一张图配一句旁白。
- 允许格式：`.svg .png .jpg/.jpeg .webp .gif .avif`。
- `overlayImgWidth` / `overlayImgHeight` 是 **generated-only**：rss 只把 `overlayImg` 路径写进 `data.json`，尺寸由 tts 构建期按文件真实像素算进 `data-generate.json`（Remotion 实际读取的 props），**无需手填**；手动写进 raw 也会被构建按文件真相覆盖。
- 只想让某一张图更大/更小，用当前 scene 的 `overlayImgScale`（如 `1.2`）手动微调基础倍率；它会和正常的入场/聚焦动画叠加，不要改 Remotion 组件里的全局样式。
- 多张图 = 给同一个 story 写多个 scene，依次播放。
- 改图片会触发一次 TTS 同步以重算 overlay 尺寸，但音频走缓存复用、**不调 MiniMax、不花钱**（`scripts/render/dev.mjs`）；字幕没变，旁白不会重生成。

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

一条龙发布：投稿视频 → 等审核 → 发「今日日报」评论（内容来自 `comment:generate`）→ 置顶。

```bash
# 从零到发布：video:prepare → video:render → 渲封面 → comment:generate → video:meta → bili:full
bun run all:bili

# 数据已备好、只想发 B站：video:render → 渲封面 → comment:generate → video:meta → bili:full
bun run publish:bili

# 首次（一次性）：扫码登录，登录态存 biliup/cookies.json（不进 .env）
bun run biliup:prepare
```

登录态、标题/标签、单步拆分（`bili:upload` 纯投稿 / `bili:full` 全套 / `bili:comment` / `bili:stick`）、**封面双比例裁切坑（单张封面、4:3 vs 16:9、安全区、自制封面两条手动路）**、固定参数所在文件：**先读 [`rules/publish-bili.md`](./rules/publish-bili.md)** 再动手。

> `bili:full` 会**真实发布**稿件 + 评论 + 置顶到你的 B站 号（对外动作）。纯测试用 `bili:upload`（已带 `--no-comment`，只发视频），发完记得去创作中心删测试稿。

## Read First（按需读的细节）

动手做某件事前，先读对应文件：

| 想做的事             | 读哪个                                               |
| -------------------- | ---------------------------------------------------- |
| 手写 / 完全手动出片  | [`rules/manual-mode.md`](./rules/manual-mode.md)     |
| 审核删除已生成的 story | [`rules/review-remove-mode.md`](./rules/review-remove-mode.md) |
| 从 RSS 抓取结果补选新闻 | [`rules/rss-pick-mode.md`](./rules/rss-pick-mode.md) |
| 换 TTS 模型或供应商  | [`rules/tts-customize.md`](./rules/tts-customize.md) |
| 给日报加图片       | [`rules/images.md`](./rules/images.md)               |
| 把视频渲染导出成 mp4 | [`rules/render-export.md`](./rules/render-export.md) |
| 发布到 B站 / 封面坑  | [`rules/publish-bili.md`](./rules/publish-bili.md)   |

要做 Tab 图标，用 `bun run generate-svg`（内部加载 `generate-svg` skill）；要改 Remotion 组件本身（动画、布局、`<Audio>`/`<Img>` 用法），用 `remotion-best-practices` skill。
