# 手动模式：自己写 data.json

> 这是 `ai-daily-report` skill 的细节文件。主线在 [`../SKILL.md`](../SKILL.md)。

## 什么时候用手动模式

- 想完全掌控内容（不用 RSS 那套 AI 筛选）。
- 内容来源不是 RSS（手头的素材、内部新闻等）。
- 自动模式 `bun run video:auto-generate` 出了问题，需要兜底出一期。
- 想做一期「特别篇」，结构和日常不一样。

手动模式 = **你写 `data.json`，跳过 `rss` 那一步**；但 TTS、图标、预览、渲染这些后续步骤照常。

## 完整步骤

```bash
# 1. 装依赖（首次）
bun install

# 2. 准备数据目录（可复制完整示例后再改）
cp -r demo/data-scheme-sample-1 data-scheme
#    Windows PowerShell: Copy-Item -Recurse demo/data-scheme-sample-1 data-scheme

# 3. 编辑 data-scheme/data.json
#    务必保证文件顶部的 $schema 指向 config/ 下的 data.schema.json：
#    "$schema": "../config/data.schema.json"

# 4. 预览当前 data-scheme（会自动跑 TTS，带 HMR）
bun run dev
```

后续可选：

- 单独生成 TTS（`dev` 没开时）：`bun run tts`
- 只看固定示例：`bun run preview`（有 TTS）/ `bun run preview:notts`（无 TTS）
- 出 Tab 图标：`bun run generate-svg`（内部加载 `generate-svg` skill）
- 加图片：见 [`images.md`](./images.md)。
- 渲染成 mp4：见 [`render-export.md`](./render-export.md)。

## 必填字段速查

`data.json` 是 `data.schema.json` 定义的结构，顶层必填 `date` 和 `stories`。最小可用骨架：

```jsonc
{
  "$schema": "../config/data.schema.json",
  "theme": "light",                      // 可选：light / dark，缺省按小时自动选
  "date": "2026-06-15",                  // 必填：YYYY-MM-DD
  "stories": [
    {
      "id": "my-story",                  // ^[a-z0-9][a-z0-9-.]*$
      "topTitle": "模型发布",            // 顶部导航标签（相邻同名会合并）
      "bottomTitle": "GLM 5.2",          // 底部短标签
      "contentTitle": "智谱发布 GLM 5.2",// ≤30 字，完整语义，不用省略号
      "introTitle": "GLM 5.2 上线并提升工具调用能力", // 可选：Intro 概览使用的编辑标题，不复制来源标题
      "tabs": [                          // 2 ~ 6 张卡片
        {
          "id": "my-story-tab-1",
          "title": "能力",
          "summary": "`GLM 5.2` **支持 128K 上下文**，并提升函数调用与长文本任务的稳定性。"  // 必须一段粗体；英文专名用行内代码
        },
        { "id": "my-story-tab-2", "title": "价格", "summary": "..." }
      ],
      "scenes": [                        // 1 ~ 6 段，每段一句口播
        {
          "id": "my-story-scene-1",
          "subtitle": "智谱 AI 发布 GLM 5.2，上下文扩展至 128K。",  // 1 ~ 96 字，TTS 的输入文案
          "overlayImg": "images/glm5.2.png", // 正文必需，必须支撑对应口播
          // "overlayImgScale": 1.15            // 可选：只调这一张图的显示倍率（overlayImgWidth/Height 由构建自动写）
        }
      ]
    }
  ]
}
```

几个容易踩的约束（来自 schema）：

- `tabs`：**最少 2 张，最多 6 张**。
- `contentTitle`：**≤ 30 字**，必须是完整语义标题，不能用省略号截断。
- `introTitle`：可选，供开场资讯概览逐条展示；应改写成适合短视频观众的编辑标题，去掉论坛前缀、标题党问句、情绪化措辞和来源免责声明。省略时使用 `contentTitle`。
- `summary`：JSON 字符串最多 128 字；去掉 Markdown 后最多 110 个可见字符，视觉占用也不超过 110；必须且只能有一段粗体，英文模型/产品/API/错误码/版本专名使用行内代码且可有多段。
- `scenes`：**最少 1 段，最多 6 段**；段数按证据信息量与讲解需要决定，不按图片数量机械配额。带图 scene 的整段旁白以证据图为主画面；正文每段必须有证据，同一张图可跨多段连续讲解；核心证据不足的 Story 不入选。
- `subtitle`：**1 ~ 96 字**，建议 28~96，是 TTS 实际念的文案。
- `overlayImgWidth` / `overlayImgHeight`：构建期按图片文件真实像素自动写入 `data-generate.json`，无需手填；`overlayImgScale` 只静态微调当前 scene，不附加默认缩放或平移动画。
- `id`：只能小写字母/数字/`-`/`.`，**必须以小写字母或数字开头**。
- 正文 `topTitle` 最多 5 类（不含概览和结语），同类连续排列。顶部导航（`topTitle`）和底部导航（`bottomTitle`）的总展示宽度有上限，超了 schema 校验会报。宁可短一点。
- 顶层可选 `introContent` / `outroContent` 自定义开场/结尾旁白，不给就用默认问候/结语。

## 不要手写的部分

这些由脚本自动生成，**别自己写进 `data.json`**（写了也会被 `tts` 覆盖或导致校验报错）：

- `intro` / `outro` 块 → 由 `report-builder.mjs` 根据 `stories` 自动拼。
- 每个 scene 的 `audioSrc`、`timing`、`tts` → 由 `generate-tts.mjs` 写入。
- 每个 tab 的 `icon` → 由 `generate-svg` skill 写入。

它们只出现在 `data-generate.json`（渲染用的派生文件），`data.json` 只放「人维护的原始内容」。

## 校验

```bash
# 只校验 data.json（不要求 audio/timing 存在）
bun run check-data-json

# 校验 data-generate.json（渲染态，需要 audio/timing 都在）
bun run check-data-json:render
```

改完 `data.json` 先跑 `check-data-json`；跑完 TTS 后再跑 `:render`。

## 切换主题

顶层 `theme` 字段：`"light"`（亮色）/ `"dark"`（暗色）。不写就按当天小时数自动选（早间 light、晚间 dark，见 schema 描述）。想固定就在 `data.json` 里写死。

## 和自动模式并存

手动模式产出后，`data-scheme/` 里就是你这期的内容。**别再跑 `bun run video:auto-generate` 或 `bun run rss`**，否则 `rss` 会覆盖你的 `data.json`。需要的话用 `bun run archive` 把当前这期归档到 `daily-dates/` 再开始下一期。
