# 审核删除模式：从 data.json 里删掉不想要的 story

> 这是 `ai-daily-report` skill 的细节文件。主线在 [`../SKILL.md`](../SKILL.md)。

## 什么时候用

用户已经跑过：

```bash
bun run video:prepare
```

自动出的 `data-scheme/data.json` 大体能用，但审核时发现**某几条 story 不想要**（和 AI 日报定位无关、质量不够、或用户主观判断不值得上镜），要把它们从当前期删掉。

典型输入是用户直接说一句话：

- 「删掉 topic-2464260」
- 「把『豆包专业版』那条删掉」
- 「topic-2467264 和 topic-2467060 这两条不要」

这不是追加流程（追加走 [`rss-pick-mode.md`](./rss-pick-mode.md)）。追加是从 `rss-state.json` 里**加**未收录的；删除是从 `data.json` 里**减**已收录的。两者方向相反，不要混用。

## 工作方式

一句话：**用户说要删哪条，agent 负责把它从 `data.json` 干净地移除，并同步清理派生产物。**

执行时按下面 5 步走，**不要只删 JSON 就停**：

1. **删 story 本体**：在 `data-scheme/data.json` 的 `stories` 数组里删掉整个 story 对象。story 是整块删——它内部的 `tabs`、`scenes` 跟着一起走，不需要手动解耦内部字段（story 内部没有跨字段引用）。

2. **删孤儿 icon**：按命名规则 `icons/{storyId}-*.svg`（即 `icons/{storyId}-{tabId}.svg`）删掉该 story 对应的图标文件。例如删 `topic-2464260`，就删 `data-scheme/icons/topic-2464260-*.svg`。**icon 自动清**——避免 `icons/` 目录越积越多。

3. **images 不自动删**：该 story 的 scene 里若有 `overlayImg`（指向 `data-scheme/images/`），**不要自动删图片文件**——因为图片可能是手工放进去、会被其他期或手动复用的。列出这些被解绑的 `overlayImg` 文件名交给用户，让用户决定是否手动删。

4. **重跑 `bun run tts`（关键，别漏）**：这是让派生产物自动自愈的唯一入口。它会：
   - 重建 `data-scheme/data-generate.json`（整份覆盖，被删 story 的 intro 分组条目、scene 的 `timing` / `videoStartMs` / `audioSrc` 随之消失）；
   - 自动 `unlink` 孤儿的 `audio/*.mp3`（凡是 id 不在本轮 `currentIds` 里的音频文件，会被清理）。
   - **不要手动删 `audio/*.mp3` 或 `data-generate.json`**——让 `tts` 来管，否则数据会不一致。

   ```bash
   bun run tts
   ```

   `tts` 已带 `node --env-file-if-exists=.env`，仍受 `TTS_REQUIRE`、`MINIMAX_*`、`REQUIRE_VOICE_QUALITY_FFMPEG` 等变量控制。已有 scene 通常可复用缓存，不会重复花钱。

5. **跑校验**：

   ```bash
   bun run check-data-json
   bun run check-data-json:render
   bun run check-icons
   ```

   `check-icons` 对残留孤儿 icon 只 warn 不 fail——即使第 2 步漏删了某个 icon，也不会阻断，但建议清干净。

## 找到要删的 story

- 用户通常会直接给 `topic-XXX` 形式的 id。在 `data.json` 的 `stories` 里按 `id` 字段定位即可。
- 如果用户只给标题或主题描述（如「豆包那条」），用 `contentTitle` / `bottomTitle` / scene 的 `subtitle` 去匹配，定位后跟用户确认一下 id 再删，避免误删。
- `data.json` 里没有 AI 评分或来源元数据，判断"要不要删"只能靠正文内容（标题、栏目、scene 摘要、配图），不要假设有 score 字段。

## 重要约束

- 不要重跑 `bun run video:prepare` 或 `bun run rss`：它们会**覆盖** `data-scheme/data.json`，把人工删除和本期的其他改动一起冲掉。
- 不要把删除结果写进 `data-generate.json`：原始维护文件永远是 `data-scheme/data.json`，`data-generate.json` 由 `tts` 生成。
- 不要手动删 `audio/*.mp3` 或改 `data-generate.json`：交给 `bun run tts` 自动处理。
- 不要自动删 `images/` 下的图片：可能被复用，交给用户判断。
- 不要修改 `ingest/preferences.jsonc`：删除是当天人工判断，不是长期偏好。

## 边界情况

- **删掉了唯一的 `activeIntro: true` 的 story**：整期会没有高亮开场 story。`check-data-json` **不报错**（`activeIntro` 非必填），但视频开场观感会变。可选地提醒用户，必要时把另一条 story 的 `activeIntro` 设为 `true`（整期最多一个）。
- **删中间某个 story**：可能让两个同 `topTitle` 的分段相邻并合并，通常无害；如果触发了 `topTitle` 非相邻重复的校验，按报错提示调整即可。
- **一次删多条**：逐条走完第 1、2、3 步的 JSON/文件改动后，统一跑一次 `tts`（第 4 步）和校验（第 5 步），不要每删一条就重跑一遍 TTS。

## 输出给用户

完成后简短说明：

- 删掉了哪几条（按 id + contentTitle）；
- 删了哪些 icon 文件；
- 列出哪些 `overlayImg` 图片被解绑、留给用户决定是否手动删；
- 确认已重跑 `tts` 并跑过校验；
- 如果删掉了 `activeIntro` 的 story，提醒用户整期当前无高亮开场。

不要把完整 `data.json` 贴给用户。
