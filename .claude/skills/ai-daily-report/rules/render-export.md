# 渲染导出 mp4

> 这是 `ai-daily-report` skill 的细节文件。主线在 [`../SKILL.md`](../SKILL.md)。

## 现状

`package.json` 里和「出片」相关的命令：

- `video:render` = `tts` + `remotion render` → **直接渲成 mp4**（`out/AiDailyReport.mp4`）。日常用这个。
- `build` = `remotion bundle` → 只**打包**（产出 `build/`），不渲染视频。
- `dev` / `dev:studio` → 预览当前 `data-scheme/`。
- `preview` / `preview:notts` → 只看固定示例（完整 TTS / 无 TTS）。

想自定义渲染参数（scale / concurrency 等）就用 Remotion 的裸命令 `remotion render`（`@remotion/cli` 已经是依赖，用 `bunx` 即可，不需要全局装）。

## 标准流程

```bash
# 最省心：自动跑 TTS 备好渲染数据 + 渲成 mp4
bun run video:render
# 产物：out/AiDailyReport.mp4

# 或手动两步（便于控制时机 / 传参数）
bun run tts
bunx remotion render AiDailyReport out/AiDailyReport.mp4
```

- **composition id = `AiDailyReport`**（见 `src/Root.tsx`，大小写敏感；`TwoTabLayout` / `FourTabLayout` / `FiveTabLayout` 是布局测试用的，别拿来导正片）。
- **输出路径**：`video:render` 固定写 `out/AiDailyReport.mp4`；裸命令可自己定（目录会自动创建）。
- 帧率与 story 间过渡帧取自 `video-timeline.json`（当前 30fps / 18 帧）、宽高取自 `video-layout.json`、时长由 `getReportDurationInFrames(fps)` 按所有 scene 的音频时长**动态**算出来。`video-timeline.json` 是时间线常量的单一事实源——渲染侧（TS）和评论/生成侧（JS）同源读取，改它即两侧同步。

> 正片渲染不用传 `--props`；`preview` 命令会把示例数据传给 Remotion。

## 渲染前检查清单

渲染是「最后一公里」，前面任何一步没做好，要么报错要么出废片。按这个顺序确认：

1. **`data-scheme/` 存在**，里面有 `data.json`。
2. **`data-generate.json` 和 `audio/*.mp3` 是最新的**：如果刚改过 `data.json`，先 `bun run tts`。`video:render` 已自动做这步。
3. **图标都在**：`data-generate.json` 里每个 tab 都有 `icon` 且对应文件存在。没有就先 `/generate-svg`。
4. **图片都在**：你写过 `overlayImg` 的图片都在 `data-scheme/images/`。
5. **校验通过**：`bun run check-data-json:render`。

最省心的做法：直接 `bun run video:render`（它做了 1→2→5），再手动确认 3、4。

## 常用可选参数（裸命令）

```bash
bunx remotion render AiDailyReport out/video.mp4 \
  --scale 1           # 默认 1；想清晰点用 2（更慢、4 倍像素）；想快预览用 0.5
  --concurrency 50%   # 默认用一半 CPU 核；调高更快但更吃内存
  --jpeg-quality 80    # （仅 image sequence / 部分场景）画面质量
  --log verbose        # 看详细进度
```

完整参数见 `bunx remotion render --help`。

## 常见坑

- **报「data-generate.json 不存在 / audio 不存在」** → 跳了 `tts`。补跑 `bun run tts`，或直接 `bun run video:render`。
- **时长不对 / 旁白错位** → `data-generate.json` 是旧的。改了 `data.json` 后必须重新 `tts`，因为时间线是按音频时长算的。
- **`check-data-json:render` 报 `provider` 不合法** → 改过 TTS 供应商但 schema/代码没对齐，见 [`tts-customize.md`](./tts-customize.md)。
- **图片显示不出来** → `overlayImg` 路径没带 `images/` 前缀，或文件没放进 `data-scheme/images/`，见 [`images.md`](./images.md)。
- **渲染很慢** → 默认串行程度高；试 `--concurrency 100%`（占满 CPU）或降低 `--scale`。
