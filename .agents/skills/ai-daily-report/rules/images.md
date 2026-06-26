# 把图片放进 data.json

> 这是 `ai-daily-report` skill 的细节文件。主线在 [`../SKILL.md`](../SKILL.md)。

## 放哪

图片统一放进 **`data-scheme/images/`**（不是 `public/images/`，不是根目录）。构建时 `data-scheme/*` 会被复制进 Remotion 的 `staticFile` 可访问范围，组件用 `staticFile(scene.overlayImg)` 读取。

## 允许的格式

来自 `data.schema.json` 的 `imagePath` 正则 `^images/.+\.(svg|png|jpe?g|webp|gif|avif)$`：

- `.svg` / `.png` / `.jpg` / `.jpeg` / `.webp` / `.gif` / `.avif`

文件名自己起，建议语义化，如 `glm5.2.png`、`claude-update.png`。可参考 `demo/data-scheme-sample-1/images/`。

## 怎么引用

给 **scene** 加 `overlayImg` 字段（**注意：是 scene 级，不是 story 级、不是 tab 级**）。

`overlayImgWidth` / `overlayImgHeight` 由构建按图片文件**真实像素**自动写入 `data-generate.json`，**无需手填**；值是原始像素，不是想让它显示成多大，渲染层用它们限制小图放大。raw 里写了只当提示、会被构建按文件真相覆盖；两个字段要么都不填、要么一起填（只填一个会被 `bun run check-data-json` 报出来）。

如果只有某一张图想再大一点或小一点，在这个 scene 上加 `overlayImgScale`，例如 `1.2`。它是人工微调的基础倍率，只影响当前图片，并会和正常的入场/聚焦动画叠加；不要去改 `SourceOverlay` 里的全局样式，否则后面的所有 overlay 图都会一起变大。

```jsonc
{
  "id": "topic-glm52",
  "topTitle": "模型发布",
  "bottomTitle": "GLM 5.2",
  "contentTitle": "智谱发布 GLM 5.2",
  "tabs": [ /* ... */ ],
  "scenes": [
    {
      "id": "topic-glm52-scene-1",
      "subtitle": "智谱 AI 发布 GLM 5.2，上下文窗口扩展至 128K。",
      "overlayImg": "images/glm5.2.png",
      "overlayImgScale": 1.15
    }
  ]
}
```

`overlayImg` 值**必须**以 `images/` 开头（不带 `data-scheme/` 前缀），正则校验如此。

## 多张图片

一个 scene 只能配一张图。要给同一个 story 放多张图，就写多个 scene，每个 scene 一张图、一句旁白，按顺序播放：

```jsonc
"scenes": [
  { "id": "...-scene-1", "subtitle": "第一句口播。", "overlayImg": "images/a.png" },
  { "id": "...-scene-2", "subtitle": "第二句口播。", "overlayImg": "images/b.png" }
]
```

## 关键行为：改图片会触发一次缓存复用的 TTS 同步

`scripts/render/dev.mjs` 的监听逻辑里，`data.json` / schema / `video-layout.json` / `video-timeline.json` / `.env` 变化会重新跑 TTS；图片文件变化也会触发一次 TTS 同步，**但音频走缓存复用、不调 MiniMax、不花钱**——目的是让构建按新文件重算 overlay 尺寸。字幕没变，所以旁白不会重生成。

日常迭代图片很安全：加图、换图保存后，尺寸自动重算、预览自己就更新了。

## 渲染效果

`src/AiDailyReport.tsx` 的 `SourceOverlay` 组件：scene 有 `overlayImg` 就居中显示这张图（`objectFit: contain`、圆角、阴影），并带「出现/消失 + 聚焦放大」动画；`overlayImgScale` 会作为这张图的基础倍率再叠加到动画上。没有 `overlayImg` 就什么都不显示，也就是说图片是**可选**的。

渲染层会按真实宽高把 overlay 分成三类：常规图、小图、高窄截图。小图继续限制在较小高度，避免低清素材被过度放大；高窄截图（如推文长截图、手机截图，宽高比很窄且面积足够）会走专门的 portrait 高度上限，比小图更大，但低于常规图高度，避免聚焦动画顶到标题或压到底部字幕。遇到“竖向截图太小”时，先确认 `data-generate.json` 里的真实宽高和分类，再决定是否需要 `overlayImgScale`，不要直接改全局上限。

## 验证

```bash
# 1. 校验 data.json（overlayImg 路径、资源是否存在、宽高字段是否成对）
bun run check-data-json

# 2. 同步 data-generate.json（构建期写入真实宽高）后预览看效果
bun run tts
bun run dev
```

如果 `check-data-json` 报 `overlayImg` 不匹配正则，基本就是路径写错了（没带 `images/` 前缀，或用了不支持的格式）。`overlayImgWidth` / `overlayImgHeight` 由构建按文件真实像素自动写入，无需手动对齐；若 raw 里只填了其中一个，会被报“必须一起填”。

改过 `SourceOverlay` 尺寸公式时，还要跑 `bun test src/overlay-animation.test.ts`，并用 `bunx remotion still AiDailyReport ... --props=data-scheme/data-generate.json --public-dir=data-scheme` 截代表帧检查高窄、常规、宽图和小图。

## 自动配图（rss 视觉识别）

自动模式（`bun run video:prepare`）下，`CLAUDE_VISION_ENABLED=true` 时，`ingest/vision.go` 会对达到日报入选线（Score ≥7）且含远程图的 Story 做视觉识别和自动配图。Story 按分数降序处理，分数高的先消耗预算；总量仍由 `CLAUDE_VISION_MAX_CALLS`、`CLAUDE_VISION_MAX_IMAGES_PER_SOURCE` 和 `CLAUDE_VISION_MAX_BUDGET_USD` 封顶。

1. **提取事实**：调 `claude` 识别图片内容，补充到文案。Claude 子进程只允许 `mcp__*` 和 `WebFetch`，不放行 `Bash`、`Write`、`Edit`。
2. **自动配图**：用聚类后的 Story 标题、重要性和要点做相关性判断。证据图、示意图、数据/评测图、产品截图、官方物料都算相关；纯表情包、头像、签名装饰图、与 Story 无关的截图会被判不相关。相关后，把该图下载到 `data-scheme/images/` 并写入对应 scene 的 `overlayImg`（带原始宽高，供 `SourceOverlay` 布局用）。

远程图下载遇到网络错误、HTTP 429 或 5xx 会短暂重试；404、格式不支持、图片过大或疑似头像/Logo 这类永久性问题会直接跳过，不中断整期日报生成。

自动配图不会自动写 `overlayImgScale`；这个字段留给预览后的人工微调。

当前实现的触发条件（`shouldAnalyze`）：视觉开关启用、Story 分数 ≥ `visionMinStoryScore`（当前为 7，等于默认日报入选线）、未超调用上限且条目含远程图片；不看正文长短。不满足条件的 scene 不会自动配图，用上面的手动方式补即可。

`CLAUDE_VISION_ENABLED=false` 时不会调用 Claude 识图，也不会自动写 `overlayImg`。为了方便手动配图，`rss` 会把默认候选范围内的远程图片下载到 `data-scheme/images/`，文件名形如 `scene-1-1.png`、`scene-1-2.jpg`，并在终端打印下载到的文件名。你确认图片合适后，再手动把对应 scene 的 `overlayImg` 填成 `images/scene-1-1.png`。

所以 `overlayImg` 有两个来源：**自动（rss 视觉识别）** 和 **手动（你按上面填）**，两者写入同一个字段、渲染方式完全一样。

> 注意：自动配图只发生在 `rss` 步骤；手动模式（你自己写 data.json）不会有自动配图。
