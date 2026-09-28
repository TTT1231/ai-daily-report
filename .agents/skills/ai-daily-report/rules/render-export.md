# 导出 MP4

导出是已完成证据准备后的阶段。默认自动校验后渲染一次并交付；
取证、按需局部预览和可选成片审核统一见 [`evidence-workflow.md`](./evidence-workflow.md)。

素材/口播预检、Generated 和可见图标已就绪时，只执行：

```bash
# 正式编码，输出 out/AiDailyReport.mp4
bun run render:mp4
```

- `render:mp4` 检查 Generated、图片、可见图标和当前事实/素材预检后才调用 Remotion；无需在它前面再单独执行同一组检查。不要用裸 `remotion render` 绕过这些检查。
- Raw/素材确实改变或缺少预检记录时，才运行 `evidence:prepare-review`，记录取证时的实际判断并补审变化项，再通过 `evidence:check-preflight`。需要同步 Generated 时再运行一次 `tts`；口播未变时复用音频缓存。可见图标有缺失/变化时用 `check-icons -- --plan` 确定生成目标。
- Generated 已同步时直接 `render:mp4`，不用 `video:render` 重复 TTS。`video:render` 用于需要同步 Raw 的情况。
- Composition 是 `AiDailyReport`，publicDir 为 `data-scheme/`；demo 的 `preview`/`preview:notts` 和布局测试 Composition 不代表当前日报。
- fps/过渡取自 `config/video-timeline.json`，布局取自 `config/video-layout.json`，旁白时长由 Generated 决定。
- 图改了先刷新素材/口播审核，字幕改了只重新审核受影响映射；缓存 TTS 不会替你验证内容。
- 命令成功且本次输出文件存在、非空后交付，不默认追加 PNG 预览、`evidence:frames` 或“最新预览复核”。具体排版疑问在编码前局部预览；完整成片目视审核仅用户明确要求时执行。重渲染须有已确认的问题或用户改动，先批量修复再编码。
- 用户要求不渲染 MP4 时只做其授权的数据/测试/PNG 预览，不调用任何 MP4 入口。
- 不为默认提速降低清晰度、改 PNG 帧格式或盲目拉满并发。先确认渲染次数及各阶段耗时；渲染参数调整需针对实测瓶颈，兼顾证据文字清晰度。
