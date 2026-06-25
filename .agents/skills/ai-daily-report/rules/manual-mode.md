# 手动模式：自己写 data.json

> 这是 `ai-daily-report` skill 的细节文件。主线在 [`../SKILL.md`](../SKILL.md)。

## 什么时候用手动模式

- 想完全掌控内容（不用 RSS 那套 AI 筛选）。
- 内容来源不是 RSS（手头的素材、内部新闻等）。
- 自动模式 `bun run video:prepare` 出了问题，需要兜底出一期。
- 想做一期「特别篇」，结构和日常不一样。

手动模式 = **你写 `data.json`，跳过 `rss` 那一步**；但 TTS、图标、预览、渲染这些后续步骤照常。

## 完整步骤

```bash
# 1. 装依赖（首次）
bun install

# 2. 准备数据目录（可复制完整示例后再改）
cp -r data-scheme-sample-1 data-scheme
#    Windows PowerShell: Copy-Item -Recurse data-scheme-sample-1 data-scheme

# 3. 编辑 data-scheme/data.json
#    务必保证文件顶部的 $schema 指向项目根的 data.schema.json：
#    "$schema": "../data.schema.json"

# 4. 预览当前 data-scheme（会自动跑 TTS，带 HMR）
bun run dev
```

后续可选：

- 单独生成 TTS（`dev` 没开时）：`bun run tts`
- 只看固定示例：`bun run preview`（有 TTS）/ `bun run preview:notts`（无 TTS）
- 出 Tab 图标：`/generate-svg`（让 agent 跑这个 skill）
- 加图片：见 [`images.md`](./images.md)。
- 渲染成 mp4：见 [`render-export.md`](./render-export.md)。

## 必填字段速查

`data.json` 是 `data.schema.json` 定义的结构，顶层必填 `date` 和 `stories`。最小可用骨架：

```jsonc
{
  "$schema": "../data.schema.json",
  "theme": "light",                      // 可选：light / dark，缺省按小时自动选
  "date": "2026-06-15",                  // 必填：YYYY-MM-DD
  "stories": [
    {
      "id": "my-story",                  // ^[a-z0-9][a-z0-9-.]*$
      "topTitle": "模型发布",            // 顶部导航标签（相邻同名会合并）
      "bottomTitle": "GLM 5.2",          // 底部短标签
      "contentTitle": "智谱发布 GLM 5.2",// ≤42 字
      "tabs": [                          // 2 ~ 6 张卡片
        {
          "id": "my-story-tab-1",
          "title": "能力",
          "summary": "支持 **128K** 上下文，`函数调用` 更稳。"  // 受限 Markdown：**粗体** 和 `行内代码`
        },
        { "id": "my-story-tab-2", "title": "价格", "summary": "..." }
      ],
      "scenes": [                        // ≥1 段，每段一句口播
        {
          "id": "my-story-scene-1",
          "subtitle": "智谱 AI 发布 GLM 5.2，上下文扩展至 128K。"  // 1 ~ 96 字，TTS 的输入文案
          // "overlayImg": "images/glm5.2.png", // 可选，详见 images.md
          // "overlayImgScale": 1.15            // 可选：只调这一张图的显示倍率（overlayImgWidth/Height 由构建自动写）
        }
      ]
    }
  ]
}
```

几个容易踩的约束（来自 schema）：

- `tabs`：**最少 2 张，最多 6 张**。
- `contentTitle`：**≤ 42 字**。
- `subtitle`：**1 ~ 96 字**，建议 28~96，是 TTS 实际念的文案。
- `overlayImgWidth` / `overlayImgHeight`：构建期按图片文件真实像素自动写入 `data-generate.json`，无需手填；`overlayImgScale` 手动微调当前 scene 的基础倍率，会叠加正常的聚焦动画。
- `id`：只能小写字母/数字/`-`/`.`，**必须以小写字母或数字开头**。
- 顶部导航（`topTitle`）和底部导航（`bottomTitle`）的总展示宽度有上限，超了 schema 校验会报。宁可短一点。
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

手动模式产出后，`data-scheme/` 里就是你这期的内容。**别再跑 `bun run video:prepare` 或 `bun run rss`**，否则 `rss` 会覆盖你的 `data.json`。需要的话用 `bun run archive` 把当前这期归档到 `daily-dates/` 再开始下一期。
