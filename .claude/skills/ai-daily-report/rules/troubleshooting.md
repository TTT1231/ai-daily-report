# 快速排错

目标是先在几十秒内确定错误层，不要直接重跑完整生产链。

## 固定顺序

1. 运行最窄复现：

   ```bash
   bun run check-data-json
   ```

2. 只处理第一类根因；错误会给出 JSON 路径。重复 ID 还会同时给出首次出现路径。
3. 只修改 `data-scheme/data.json`。如果 Raw 合法但 Generated 报错，重建派生数据，不要修 `data-generate.json`。
4. Raw 通过后，按受影响产物运行最小同步命令。

## 重复 ID

校验器区分三种作用域：

- `stories[n].id: duplicate id`：Story ID 在整期必须唯一。
- `stories[n].tabs[m].id: duplicate id`：Tab ID 在当前 Story 内必须唯一。
- `stories[n].scenes[m].id: duplicate global scene id`：Scene ID 在整期必须唯一。

修复后同步引用：

- 改 Tab ID时，同步该 Story 的 `activeTab`（若它指向旧 ID）。
- 改 Story ID时，建议同步其 Tab/Scene ID 前缀，避免以后难以追踪。
- 改 Scene ID 后必须跑 TTS；改 Tab ID 后必须重新生成 SVG。

最小验证：

```bash
bun run check-data-json
bun run tts
bun run check-data-json:render
```

若改了 Tab ID，再执行：

```bash
bun run generate-svg
bun run check-icons
```

不要为重复 ID 跑 `rss`、`video:auto-generate`、Remotion render 或浏览器；这些步骤不能修复结构错误，且可能覆盖当前数据。

## 常见错误映射

| 错误特征 | 根因 | 快速处理 |
| --- | --- | --- |
| Raw 合法，Generated 的 ID/标题/Tab 还是旧值 | `data-generate.json` 过期 | `bun run tts` |
| `activeTab: unknown tab id` | Tab 改名后引用未同步 | 修改 Raw 的 `activeTab` |
| `must use exactly one bold span` | 新闻卡没有粗体重点 | 用一段 `**...**` 标核心变化/机制/影响/结论 |
| `file not found: icons/...` | 新增/改名的 Tab 缺 SVG | `bun run generate-svg` |
| `file not found: audio/...`、缺 timing/tts | TTS 派生数据未同步 | `bun run tts` |
| navigation `requires ...px` | 顶/底导航标签过长或过多 | 缩短 `topTitle` / `bottomTitle`，再校验 |
| `category ... non-adjacent segments` | 同一 `topTitle` 被其它栏目隔开 | 调整 Story 顺序或栏目名 |
| `overlayImg` 路径/尺寸错误 | Raw 图片引用错误或派生尺寸旧 | 修路径 → `bun run tts` |

## 命令失败

- `rss`/网络错误：读取 [`setup.md`](./setup.md) 和 [`rss-pick-mode.md`](./rss-pick-mode.md)。
- TTS/API 错误：先运行 `bun run tts:dry-run`；再读取 [`tts-customize.md`](./tts-customize.md)。
- SVG 错误：运行 `bun run check-icons`，再交给 `generate-svg` skill。
- 渲染错误：先确保 `check-data-json:render` 与 `check-icons` 通过，再读取 [`render-export.md`](./render-export.md)。

连续三次出现同一个失败后停止盲试，保留完整错误文本并向用户说明阻塞点。
