---
name: ai-daily-report
description: How to use the ai-daily-report project end-to-end — set it up, run the automated pipeline, switch the TTS model/provider, go fully manual, drop images into data.json, preview, and render the final mp4. Use whenever the user asks how to use this project, how to run it, how to change the TTS, how to do things manually, how to add images to the daily report, how to render/export a video, or any question about operating the pipeline or editing data.json — even if they do not explicitly say "skill".
---

# AI Daily Report 使用指南

让用户「直接和 agent 对话」就把一期 AI 日报视频做出来：从配置环境、跑流水线、换 TTS、手动写内容、放图片，到预览和导出成 mp4。

本 skill 是项目的总入口指南，README 的 FAQ 里说的「遇到难题可直接用本项目提供的 skill」就是指它。它和另外两个 skill 配合：`generate-svg`（出 Tab 图标）与 `remotion-best-practices`（改 Remotion 组件时的通用规范），那两个由它们各自的触发条件处理，这里不重复。

## 行为约定（重要）

这个 skill 触发后，遵循「**先讲解、再代执行**」：

1. **先讲清楚**：用一两句话说明这一步在做什么、为什么这么做、有没有副作用（花钱、改文件、覆盖归档）。
2. **再动手**：需要改文件或跑命令前，把打算做的事讲明白再执行；遇到不确定（比如要覆盖现有内容、要花钱调 API）先问用户。
3. **细节进 `rules/`**：主线只放最常用的结论，深入步骤在下面的 rules 文件里，按需读，别一次性全读。

## 开始前确认

每次先在心里过一遍这两点，缺什么先补什么：

- **环境变量** `.env`（参考 `.env.example`）：
  - RSS/AI 总结用：`AI_API_KEY`、`AI_BASE_URL`（默认 DeepSeek）、`AI_MODEL`（默认 `deepseek-v4-flash`）。
  - 网络受限时可选：小写 `all_proxy`（如 `http://127.0.0.1:7890`）。未配置则直连；配置后 RSS 和 AI 模型请求必须走该代理，失败时不会回退直连。不要使用其他代理变量。
  - TTS 旁白用：`MINIMAX_API_KEY`、`MINIMAX_TTS_MODEL`、`MINIMAX_TTS_VOICE_ID`、`MINIMAX_TTS_SPEED`。
- **运行时**：需要 `claude`（cli，用于图片识别 + 出图标）、`bun`、`go`（跑 RSS 采集器）。
- **数据目录** `data-scheme/` 必须存在（自动模式会自己生成；手动模式从 `data-scheme-sample/` 复制）。

## A. 自动出片（推荐主线）

适合「日常批量出片，一条命令搞定」。把数据采集、AI 总结、TTS、图标全自动化。

```bash
# 0. 配好 .env（见上），然后装依赖
bun install

# 1. 跑全流程：prerss → rss → tts → generate-svg → dev
bun run all
```

`bun run all`（`scripts/run-all.mjs`）先按顺序跑四个生产步骤并显示实时状态，任一步失败会中断；全部完成后以前台常驻方式启动 `bun run dev`：

| 步骤 | 做什么 | 产物 |
| --- | --- | --- |
| `prerss` | 归档上一天数据（必要时），保证每次都从干净状态开始 | `daily-dates/` |
| `rss` | Go 采集器抓 RSS → AI 筛选/聚类 → 生成结构 | `data-scheme/data.json` |
| `tts` | 给每个 scene 生成 MiniMax 旁白，算时间线 | `data-scheme/data-generate.json` + `audio/*.mp3` |
| `generate-svg` | 调 `claude -p /generate-svg` 给 tabs 出图标 | `data-scheme/icons/*.svg` |

`rss` 步骤会读取项目根目录 `.env` 中可选的小写 `all_proxy`。没有配置时跳过代理并直连；配置后 RSS 抓取与 AI 模型请求都会强制使用该代理，代理无效或不可用时直接报错。它不会读取 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 等其他代理变量，也不会自动探测本地代理端口。

生产步骤跑完后：

- **图片是唯一的手动步骤**：`bun run all` 不会插图。要加图就给 `data.json` 的 scene 填 `overlayImg`，并把图片放进 `data-scheme/images/`。详见下方「把图片放进 data.json」。
- **预览**：脚本自动进入 `bun run dev`（带 HMR + 自动 TTS 同步）；按 `Ctrl+C` 会停止预览并释放端口。

> 关于 `rss/rss-state.json`：它存的是上次抓取的快照，用来去重。重复内容会被剔除，但这个临时文件是判断依据，平时不用动它。

## B. 手动模式

适合「想完全掌控内容 / 自定义非 RSS 来源 / 自动流程出问题时兜底」：你自己写 `data.json`，不跑 `rss`。

主线很简单：复制示例目录 → 编辑 `data.json` → `bun run dev`（会自动 TTS）或手动 `bun run tts` → `/generate-svg` 出图标。

完整步骤、必填字段速查、theme 切换：**先读 [`rules/manual-mode.md`](./rules/manual-mode.md)** 再动手。

## 换 TTS 模型 / 供应商

一句话结论：**目前只适配了 MiniMax，RSS 用的 AI 模型随便换（改 `.env` 即可），TTS 要换供应商需要改代码。**

- 只换 MiniMax 的模型/音色/语速 → 纯改 `.env`（`MINIMAX_TTS_MODEL` / `MINIMAX_TTS_VOICE_ID` / `MINIMAX_TTS_SPEED`）。
- 换成别的 TTS 供应商（如阿里/字节）→ 要改 `scripts/lib/minimax-tts.mjs`、`scripts/generate-tts.mjs`、`data.schema.json` 三处，外加 `.env`。

详细改哪些点、怎么验证、缓存为何不用 `--force`：**先读 [`rules/tts-customize.md`](./rules/tts-customize.md)** 再动手。

## 把图片放进 data.json

一句话结论：**把图片丢进 `data-scheme/images/`，给对应的 scene 加 `"overlayImg": "images/文件名"`。**

- 图片是 **scene 级**的（不是 story 级、不是 tab 级），一张图配一句旁白。
- 允许格式：`.svg .png .jpg/.jpeg .webp`。
- 多张图 = 给同一个 story 写多个 scene，依次播放。
- 改图片**不会**重新请求 TTS（`scripts/dev.mjs` 故意如此），想只刷新预览直接保存即可。

完整规则、命名、验证方法：**先读 [`rules/images.md`](./rules/images.md)** 再动手。

## 渲染导出 mp4

一句话结论：**项目没有现成的 render 脚本（`build` 只是 `remotion bundle` 打包，不渲染），用裸命令 `npx remotion render` 即可。**

```bash
# 1. 先确保 data-generate.json 和音频是最新的（= 跑一次 TTS + 渲染态校验）
bun run prepare-report

# 2. 渲染（composition id = AiDailyReport，30fps，尺寸取自 video-layout.json）
npx remotion render AiDailyReport out/video.mp4
```

时长、可选参数、常见坑：**先读 [`rules/render-export.md`](./rules/render-export.md)** 再动手。

## Read First（按需读的细节）

动手做某件事前，先读对应文件：

| 想做的事 | 读哪个 |
| --- | --- |
| 手写 / 完全手动出片 | [`rules/manual-mode.md`](./rules/manual-mode.md) |
| 换 TTS 模型或供应商 | [`rules/tts-customize.md`](./rules/tts-customize.md) |
| 给日报加图片 | [`rules/images.md`](./rules/images.md) |
| 把视频渲染导出成 mp4 | [`rules/render-export.md`](./rules/render-export.md) |

要做 Tab 图标，用 `generate-svg` skill（README 和 `package.json` 里 `/generate-svg`）；要改 Remotion 组件本身（动画、布局、`<Audio>`/`<Img>` 用法），用 `remotion-best-practices` skill。
