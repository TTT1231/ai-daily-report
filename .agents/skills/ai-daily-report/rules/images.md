# 把图片放进 data.json

> 这是 `ai-daily-report` skill 的细节文件。主线在 [`../SKILL.md`](../SKILL.md)。

## 放哪

图片统一放进 **`data-scheme/images/`**（不是 `public/images/`，不是根目录）。构建时 `data-scheme/*` 会被复制进 Remotion 的 `staticFile` 可访问范围，组件用 `staticFile(scene.overlayImg)` 读取。

## 允许的格式

来自 `data.schema.json` 的 `imagePath` 正则 `^images/.+\.(svg|png|jpe?g|webp|gif|avif)$`（与 `src/daily-report-data.ts` 的 Zod `imagePathSchema` 一致）：

- `.svg` / `.png` / `.jpg` / `.jpeg` / `.webp` / `.gif` / `.avif`

文件名自己起，建议语义化，如 `glm5.2.png`、`claude-update.png`。可参考 `demo/data-scheme-sample-1/images/`。

## 怎么引用

给 **scene** 加 `overlayImg` 字段（**注意：是 scene 级，不是 story 级、不是 tab 级**）。

`overlayImgWidth` / `overlayImgHeight` 是 **generated-only**：由 tts 构建期按图片文件**真实像素**写入 `data-generate.json`（Remotion 实际读取的 props），**无需手填**；值是原始像素，不是想让它显示成多大，渲染层用它们限制小图放大。rss 只写 `overlayImg` 路径、不写尺寸，手动写进 raw 也会被构建按文件真相覆盖。

构建期只把真实尺寸写入 `data-generate.json`。渲染层按横屏证据舞台自动 `contain`，不再给图片附加默认推近或平移动画。如果只有某一张图确实需要再大一点或小一点，在 raw `data.json` 的 scene 上手动填写 `overlayImgScale`；它只影响当前图片。不要去改 `EvidenceStage` 的全局样式，否则后面的所有证据图都会一起变化。

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

每个正文 scene 必须配一张来源证据图。同一张图可显式复用于多个连续 scene，让它陪伴连续讲解；每段字幕都须由该图支撑，并保持相同 scale。讲解转向新的事实时再切换对应证据：

```jsonc
"scenes": [
  { "id": "...-scene-1", "subtitle": "第一句口播。", "overlayImg": "images/a.png" },
  { "id": "...-scene-2", "subtitle": "第二句口播。", "overlayImg": "images/b.png" }
]
```

各模式容量：每 Story 最多 5 张不同证据图、总 scene ≤6，同图跨段不重复计算图片数量；正文不保留无图事实段（选图规则见 [`supplied-source-mode.md`](./supplied-source-mode.md)）；所有生产模式都要求正文逐段有证据。

## 关键行为：改图片会触发一次缓存复用的 TTS 同步

`scripts/render/dev.mjs` 的监听逻辑里，`data.json` / schema / `video-layout.json` / `video-timeline.json` / `.env` 变化会重新跑 TTS；图片文件变化也会触发一次 TTS 同步，**但音频走缓存复用、不调 MiniMax、不花钱**——目的是让构建按新文件重算 overlay 尺寸。同一报告日期的默认开场也会复用上一份文案，不会因为早/中/晚时段变化而重生。字幕没变，所以旁白不会重生成。

日常迭代图片很安全：加图、换图保存后，尺寸自动重算、预览自己就更新了。

## 渲染效果

`src/AiDailyReport.tsx` 的 `EvidenceStage` 组件：scene 有 `overlayImg` 时，证据图会在整段旁白期间占据标题与字幕之间的主舞台（`objectFit: contain`、圆角、阴影），场景切换时直接换图，方便观众暂停、快进和自行检查。正文缺 `overlayImg` 会被生产校验拒绝，不以 Tabs 摘要兜底。旧演示数据的卡片预览不代表生产规则。

渲染层按真实宽高把证据图分成常规图 / 小图 / 高窄截图三类，横图最多使用 1836×760 的舞台，高窄截图限高 740，小图限于 980×560，**整张图按 `contain` 等比放入舞台**。这意味着图越高、越窄，宽度仍会被压扁——一张 992×4046 的长截图会变成看不清的细条。遇到这种情况应更换证据素材或拆成多张正常比例图片，不要用全局缩放掩盖内容选型问题。

## EXIF 方向先摆正

图片写入 `data-scheme/images/` 前先规范化方向并清除 EXIF orientation。原始相机图先运行 `bun run image:normalize-orientation -- <path>`，按 orientation 烘焙旋转后再裁剪；已经被裁成正向像素但错误保留方向标记的图片运行同一命令并加 `--pixels-upright`，只清除标记、不要再次旋转。Chromium 会应用残留 orientation，而尺寸校验按像素宽高读取——两者错位会让图片横倒进成片，`bun run check-evidence` 会直接拒绝。修正后必须目视原图，并在最终 MP4 上用 `bun run evidence:frames` 检查每个 overlay 的中间帧；逐帧填写同目录 `review.json`，再运行 `bun run check-evidence-review -- --manifest=<temp>/manifest.json`。旧审核与当前 MP4、Generated 数据或帧哈希不一致时会被拒绝。

## 长截图不要用作 overlay

正因为上面这条：**长截图（文章/聊天长截图、竖向长图）会被等比压成看不清的细条**，在 overlay 里本质展不好——画面是 16:9 横向、scene 时长又短，长截图既塞不进框、内容也读不完。这是**内容选型问题、不是渲染问题**（平移/裁剪/延长 scene 都救不了），从源头避免：

- **优先用比例正常的图**（横图、方图，或轻微竖图）——静态居中、效果最好；
- **长截图不要用作 overlay**，换一张能代表该条新闻的正常比例图（关键人物 / 产品 / 数据图）；
- 没有合适证据时，删去该可选细节；若缺的是核心事件的证据，则排除整条 Story 并记录原因，不制作无图口播。

## 验证

```bash
# 1. 校验 data.json（overlayImg 路径、资源是否存在、宽高字段是否成对）
bun run check-data-json

# 2. 同步 data-generate.json（构建期写入真实宽高）后预览看效果
bun run tts
bun run dev
```

如果 `check-data-json` 报 `overlayImg` 不匹配正则，基本就是路径写错了（没带 `images/` 前缀，或用了不支持的格式）。`overlayImgWidth` / `overlayImgHeight` 由构建按文件真实像素自动写入，无需手动对齐；若 raw 里只填了其中一个，会被报“必须一起填”。

改过 `EvidenceStage` 尺寸公式时，还要跑 `bun test test/unit/evidence-layout.test.ts`，并用 `bunx remotion still AiDailyReport ... --props=data-scheme/data-generate.json --public-dir=data-scheme` 截代表帧检查高窄、常规、宽图和小图。

## 自动配图（rss 视觉识别）

自动模式（`bun run video:auto-generate`）下，`CLAUDE_VISION_ENABLED=true` 时，`ingest/vision.go` 会对达到日报入选线（Score ≥7）且含远程图的 Story 做视觉识别和自动配图。Story 按分数降序处理，分数高的先消耗预算；总量仍由 `CLAUDE_VISION_MAX_CALLS`、`CLAUDE_VISION_MAX_IMAGES_PER_SOURCE` 和 `CLAUDE_VISION_MAX_BUDGET_USD` 封顶。

1. **提取事实**：调 `claude` 识别图片内容，补充到文案。Claude 子进程只允许 `mcp__*` 和 `WebFetch`，不放行 `Bash`、`Write`、`Edit`。
2. **自动配图**：用聚类后的 Story 标题、重要性和要点做相关性判断。候选已经来自来源正文的直接内嵌图片并排除了 onebox，因此按“正文证据图”处理：证据/公告截图、示意图、数据/评测图、产品截图、官方物料都算相关，不要求覆盖 Story 的每一个要点；只要产品/机构名、核心事件、日期、数字或用户影响能明确对应即可。只有内容清晰可辨且能确认是纯表情包、头像、签名装饰、广告或另一个无关主题时才判不相关。相关后，把该图下载到 `data-scheme/images/` 并写入对应 scene 的 `overlayImg` 路径；原始宽高由 tts 构建期按文件算进 `data-generate.json`、供 `EvidenceStage` 布局用（rss 不把尺寸写进 `data.json`）。

远程图下载遇到网络错误、HTTP 429 或 5xx 会短暂重试；404、格式不支持、图片过大或疑似头像/Logo 这类永久性问题会跳过该图片；口播证据不完整的 Story 不写入生产数据，全部缺证据时保留原 data.json 并报错。

自动配图在 raw `data.json` 中仍只写 `overlayImg`；随后构建 `data-generate.json` 时写入图片真实尺寸，Remotion 据此把图片等比放入证据舞台。需要人工微调时，在 raw scene 中显式填写 `overlayImgScale`。

当前实现的触发条件（`shouldAnalyze`）：视觉开关启用、Story 分数 ≥ `visionMinStoryScore`（当前为 7，等于默认日报入选线）、未超调用上限且条目含远程图片；不看正文长短。不满足条件的 scene 不会自动配图，用上面的手动方式补即可。

`CLAUDE_VISION_ENABLED=false` 时不会调用 Claude 识图，也不会自动写 `overlayImg`。为了方便手动配图，`rss` 会把默认候选范围内的远程图片下载到 `data-scheme/images/`，文件名形如 `scene-1-1.png`、`scene-1-2.jpg`，并在终端打印下载到的文件名。你确认图片合适后，再手动把对应 scene 的 `overlayImg` 填成 `images/scene-1-1.png`。

所以 `overlayImg` 有两个来源：**自动（rss 视觉识别）** 和 **手动（你按上面填）**，两者写入同一个字段、渲染方式完全一样。

> 注意：自动配图只发生在 `rss` 步骤；手动模式（你自己写 data.json）不会有自动配图。
