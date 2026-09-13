# 导出 MP4

导出是已完成证据准备后的阶段，不能用整片渲染来试截图。
取证、审核和批量 PNG 预览见 [`evidence-workflow.md`](./evidence-workflow.md)。

```bash
# Raw/素材改变后刷新记录，目视填写新出现的待审项
bun run evidence:prepare-review
bun run evidence:check-preflight
# Raw 变化需要同步 Generated；口播未变时音频复用缓存
bun run tts
# 只为实际显示的卡片准备图标
bun run check-icons -- --plan
bun run check-icons
# 排版疑问只出 PNG；局部修复可以传 --scenes=...
bun run evidence:preview
# 正式编码，输出 out/AiDailyReport.mp4
bun run render:mp4
bun run evidence:frames
# 全部成片检查完成后
bun run check-evidence-review -- --manifest=<temp>/manifest.json
```

- `render:mp4` 检查 Generated、图片、可见图标和当前事实/素材预检后才调用 Remotion。不要用裸 `remotion render` 绕过这些检查。
- Generated 已同步时直接 `render:mp4`，不用 `video:render` 重复 TTS。`video:render` 用于需要同步 Raw 的情况。
- Composition 是 `AiDailyReport`，publicDir 为 `data-scheme/`；demo 的 `preview`/`preview:notts` 和布局测试 Composition 不代表当前日报。
- fps/过渡取自 `config/video-timeline.json`，布局取自 `config/video-layout.json`，旁白时长由 Generated 决定。
- 图改了先刷新素材/口播审核，字幕改了只重新审核受影响映射；缓存 TTS 不会替你验证内容。
- 用户要求不渲染 MP4 时只做其授权的数据/测试/PNG 预览，不调用任何 MP4 入口。
- 不为默认提速降低清晰度、改 PNG 帧格式或盲目拉满并发。先确认渲染次数及各阶段耗时；渲染参数调整需针对实测瓶颈，兼顾证据文字清晰度。
