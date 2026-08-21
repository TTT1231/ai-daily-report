---
name: ai-daily-report
description: "Operate and troubleshoot the ai-daily-report project end to end: setup, automatic or half-automatic RSS workflows, data.json editing and validation, duplicate-ID and stale-generated-data fixes, TTS, images, SVG tab icons, preview, render, and video metadata/comments. Use for any request about running, fixing, editing, or rendering this project."
---

# AI Daily Report

把用户的自然语言请求直接落实为一期可预览、可渲染或可发布的 AI 日报。项目根目录是当前工作目录；原始数据只维护 `data-scheme/data.json`，`data-generate.json` 是派生产物。

## 执行原则

1. 先判断请求属于“讲解、生产、修改、排错、发布”中的哪一种。
2. 只读取对应的一个规则文件；不要预读全部 `rules/`。
3. 用户要求修复或修改时直接检查并执行，不要先复述整套教程。
4. 先跑最窄、最快且无外部副作用的命令。结构错误不要先跑 RSS、TTS、SVG、渲染或浏览器。
5. 修改 `data.json` 后先跑 `bun run check-data-json`；只有 Raw 通过后才重建需要的派生产物。
6. 调用付费 API 或覆盖/归档当前一期前，说明副作用；普通本地校验无需确认。

## 快速路由

| 用户目标 | 立即执行 | 按需读取 |
| --- | --- | --- |
| 报错、重复 ID、数据不合法、流程很慢 | `bun run check-data-json`；按首条错误定位 | [`rules/troubleshooting.md`](./rules/troubleshooting.md) |
| 首次安装、缺环境变量、代理/运行时问题 | 对照 `.env.example` 检查缺项 | [`rules/setup.md`](./rules/setup.md) |
| 一条命令自动生成日报 | `bun run video:auto-generate` | 本文件“生产主线” |
| 浏览 RSS 后人工勾选 | `bun run video:half-auto` | [`rules/rss-pick-mode.md`](./rules/rss-pick-mode.md) |
| 删除当前一期某条 Story | 只改 Raw，再同步派生 | [`rules/review-remove-mode.md`](./rules/review-remove-mode.md) |
| 手写/修改 `data.json` | 编辑 Raw → Raw 校验 | [`rules/manual-mode.md`](./rules/manual-mode.md) |
| 配图或修改图片显示 | 修改 scene 的 `overlayImg` | [`rules/images.md`](./rules/images.md) |
| 更换 TTS 模型或供应商 | 先区分 MiniMax 配置与新供应商代码改造 | [`rules/tts-customize.md`](./rules/tts-customize.md) |
| 导出 mp4 | `bun run video:render` | [`rules/render-export.md`](./rules/render-export.md) |
| 生成标题/标签/评论 | `bun run video:meta` | 本文件“生产主线” |

## 生产主线

### 全自动

```bash
bun run video:auto-generate
bun run video:meta
```

第一条执行 `archive → ingest(run-auto) → Raw 校验 → TTS → SVG → icon 校验`。第二条一次生成：

- `data-scheme/comments.txt`
- `data-scheme/video-meta.json`

要看当前一期用 `bun run dev`；要导出用 `bun run video:render`。

### 半自动选稿

```bash
bun run video:half-auto
bun run video:meta
```

`video:half-auto` 执行 `archive → rss → rss:pick → video`。`rss:pick` 会打开本地选择页并等待用户保存；保存后流程继续。不要再单独要求用户运行 `comment:generate`，它已经合并进 `video:meta`。

### 完全手动

读取 [`rules/manual-mode.md`](./rules/manual-mode.md)，编辑 `data-scheme/data.json` 后依次执行：

```bash
bun run check-data-json
bun run tts
bun run generate-svg
```

## 修改后的最小验证

按改动范围选最小集合：

- 只改 Raw 文案/ID：`bun run check-data-json`
- 改 scene、顺序或图片引用：Raw 校验 → `bun run tts` → `bun run check-data-json:render`
- 改 Tab ID/数量/含义：上一步 + `bun run generate-svg` → `bun run check-icons`
- 改 `ingest/`：`bun run rss:test`
- 改 `scripts/lib/`：`bun run test:lib`
- 改 `scripts/` 流程或 Schema：`bun run test:integration`
- 改 Remotion 组件：按项目 `CLAUDE.md` 运行 render/e2e 范围测试

不要用 `video:auto-generate` 验证一次局部 JSON 修复；它会重抓并覆盖当前一期。

## 数据边界

- `data-scheme/data.json`：唯一人工维护源。
- `data-scheme/data-generate.json`、`audio/`：由 `bun run tts` 管理，不手改。
- `icons/`：由 `bun run generate-svg` 管理。
- 每张新闻 Tab 必须且只能有一段粗体；英文模型、产品、API、错误码、版本专名使用行内代码，可有多段。
- `video:meta` 读取完整 `stories` 后生成标题/标签，并同时生成时间轴评论。

## 规则索引

- 环境与依赖：[`rules/setup.md`](./rules/setup.md)
- 快速排错：[`rules/troubleshooting.md`](./rules/troubleshooting.md)
- 手动数据：[`rules/manual-mode.md`](./rules/manual-mode.md)
- 删除 Story：[`rules/review-remove-mode.md`](./rules/review-remove-mode.md)
- RSS 人工选择：[`rules/rss-pick-mode.md`](./rules/rss-pick-mode.md)
- 图片：[`rules/images.md`](./rules/images.md)
- TTS：[`rules/tts-customize.md`](./rules/tts-customize.md)
- 渲染：[`rules/render-export.md`](./rules/render-export.md)

Tab 图标内容设计由 `generate-svg` skill 负责；Remotion 组件改造由 `remotion-best-practices` skill 负责。
