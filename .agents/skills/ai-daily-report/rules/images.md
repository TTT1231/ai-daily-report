# 把图片放进 data.json

> 这是 `ai-daily-report` skill 的细节文件。主线在 [`../SKILL.md`](../SKILL.md)。

## 放哪

图片统一放进 **`data-scheme/images/`**（不是 `public/images/`，不是根目录）。构建时 `data-scheme/*` 会被复制进 Remotion 的 `staticFile` 可访问范围，组件用 `staticFile(scene.overlayImg)` 读取。

## 允许的格式

来自 `data.schema.json` 的 `imagePath` 正则 `^images/.+\.(svg|png|jpe?g|webp)$`：

- `.svg` / `.png` / `.jpg` / `.jpeg` / `.webp`

文件名自己起，建议语义化，如 `glm5.2.png`、`claude-update.png`。`data-scheme-sample/images/` 里有现成示例可参考。

## 怎么引用

给 **scene** 加 `overlayImg` 字段（**注意：是 scene 级，不是 story 级、不是 tab 级**）：

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
      "overlayImg": "images/glm5.2.png"      // ← 加这一行
    }
  ]
}
```

值**必须**以 `images/` 开头（不带 `data-scheme/` 前缀），正则校验如此。

## 多张图片

一个 scene 只能配一张图。要给同一个 story 放多张图，就写多个 scene，每个 scene 一张图、一句旁白，按顺序播放：

```jsonc
"scenes": [
  { "id": "...-scene-1", "subtitle": "第一句口播。", "overlayImg": "images/a.png" },
  { "id": "...-scene-2", "subtitle": "第二句口播。", "overlayImg": "images/b.png" }
]
```

## 关键行为：改图片不会重算 TTS

`scripts/dev.mjs` 的监听逻辑里，**只有** `data.json` / schema / `video-layout.json` / `.env` 变化才会重新跑 TTS；图片文件变化只会让 Remotion Studio 刷新画面、**不调 API、不花钱**。

所以日常迭代图片很安全：改完保存，预览自己就更新了。

## 渲染效果

`src/AiDailyReport.tsx` 的 `SourceOverlay` 组件：scene 有 `overlayImg` 就居中显示这张图（`objectFit: contain`、圆角、阴影），并带「出现/消失 + 聚焦放大」动画；没有就什么都不显示。也就是说图片是**可选**的，不加 `overlayImg` 的 scene 就纯字幕。

## 验证

```bash
# 1. 校验 schema（包含 overlayImg 的正则）
bun run val-schema

# 2. 预览看效果
bun run dev
```

如果 `val-schema` 报 `overlayImg` 不匹配正则，基本就是路径写错了（没带 `images/` 前缀，或用了不支持的格式）。

## 自动配图（rss 视觉识别）

自动模式（`bun run all`）下，`rss/vision.go` 会对高分 Story 的远程图片同时做两件事：

1. **提取事实**：调 `claude` 多模态识别图片内容，补充到文案。
2. **自动配图**：判定相关后，把该图下载到 `data-scheme/images/` 并写入对应 scene 的 `overlayImg`（带原始宽高，供 `SourceOverlay` 布局用）。

触发条件（`shouldAnalyze`）：Story 评分 ≥9、正文 <500 字且含远程图片，受 `CLAUDE_VISION_*` 的调用上限/预算控制（默认开）。不满足条件的 scene 不会自动配图，用上面的手动方式补即可。

所以 `overlayImg` 有两个来源：**自动（rss 视觉识别）** 和 **手动（你按上面填）**，两者写入同一个字段、渲染方式完全一样。

> 注意：自动配图只发生在 `rss` 步骤；手动模式（你自己写 data.json）不会有自动配图。
