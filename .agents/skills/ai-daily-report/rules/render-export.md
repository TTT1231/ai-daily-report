# 渲染导出 mp4

> 这是 `ai-daily-report` skill 的细节文件。主线在 [`../SKILL.md`](../SKILL.md)。

## 现状：项目没有现成的 render 脚本

`package.json` 里和「出片」相关的命令：

- `build` = `remotion bundle` → 只**打包**（产出 `build/`），不渲染视频。
- `dev` / `dev:studio` → Remotion Studio **预览**，不导出文件。
- `prepare-report` = `tts` + 渲染态校验 → 只备数据，不渲染。

所以导出 mp4 用 Remotion 的裸命令 `remotion render`（`@remotion/cli` 已经是依赖，用 `npx` 即可，不需要全局装）。

## 标准流程

```bash
# 1. 确保渲染数据是最新的（生成 data-generate.json + 音频 + 校验）
bun run prepare-report

# 2. 渲染成 mp4
npx remotion render AiDailyReport out/video.mp4
```

- **composition id = `AiDailyReport`**（见 `src/Root.tsx`，大小写敏感；`TwoTabLayout` / `FourTabLayout` / `FiveTabLayout` 是布局测试用的，别拿来导正片）。
- **输出路径**自己定（上面写 `out/video.mp4`），目录会自动创建。
- 帧率 30fps、宽高取自 `video-layout.json`、时长由 `getReportDurationInFrames(30)` 按所有 scene 的音频时长**动态**算出来。

> 不需要传 `--props`：组件直接通过 `staticFile` 读 `data-scheme/`，没有输入 props。

## 渲染前检查清单

渲染是「最后一公里」，前面任何一步没做好，要么报错要么出废片。按这个顺序确认：

1. **`data-scheme/` 存在**，里面有 `data.json`。
2. **`data-generate.json` 和 `audio/*.mp3` 是最新的**：如果刚改过 `data.json`，先 `bun run tts`（或整个 `prepare-report`）。
3. **图标都在**：`data-generate.json` 里每个 tab 都有 `icon` 且对应文件存在。没有就先 `/generate-svg`。
4. **图片都在**：你写过 `overlayImg` 的图片都在 `data-scheme/images/`。
5. **校验通过**：`bun run check-data-json:render`。

最省心的做法：直接 `bun run prepare-report`（它做了 2 和 5），再手动确认 3、4。

## 常用可选参数

```bash
npx remotion render AiDailyReport out/video.mp4 \
  --scale 1           # 默认 1；想清晰点用 2（更慢、4 倍像素）；想快预览用 0.5
  --concurrency 50%   # 默认用一半 CPU 核；调高更快但更吃内存
  --jpeg-quality 80    # （仅 image sequence / 部分场景）画面质量
  --log verbose        # 看详细进度
```

完整参数见 `npx remotion render --help`。

## 常见坑

- **报「data-generate.json 不存在 / audio 不存在」** → 跳了 `prepare-report`。补跑 `bun run tts`。
- **时长不对 / 旁白错位** → `data-generate.json` 是旧的。改了 `data.json` 后必须重新 `tts`，因为时间线是按音频时长算的。
- **`check-data-json:render` 报 `provider` 不合法** → 改过 TTS 供应商但 schema/代码没对齐，见 [`tts-customize.md`](./tts-customize.md)。
- **图片显示不出来** → `overlayImg` 路径没带 `images/` 前缀，或文件没放进 `data-scheme/images/`，见 [`images.md`](./images.md)。
- **渲染很慢** → 默认串行程度高；试 `--concurrency 100%`（占满 CPU）或降低 `--scale`。

## 想加成脚本（可选）

如果觉得每次敲裸命令麻烦，可以在 `package.json` 的 `scripts` 里加：

```jsonc
"render": "npx remotion render AiDailyReport out/video.mp4",
"render:hd": "npx remotion render AiDailyReport out/video.mp4 --scale 2"
```

这样就能 `bun run render`。但这属于改项目文件，动手前跟用户确认，且本 skill 不默认这么改。
