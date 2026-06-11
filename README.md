# AI Daily Report

日报内容、图片和生成音频统一放在 `data-scheme/`：

- `data.json`：raw 文件，由人维护，只包含标题、Tabs、字幕和图片引用。
- `data-generate.json`：派生文件，由 TTS 脚本生成，额外包含音频、时间线和缓存元数据。
- `audio/`：TTS 生成的 Scene 音频。

不要手动修改 `data-generate.json`；重新运行 TTS 时会根据 `data.json` 生成它。

## 推荐工作流

1. 编辑并人工审查 `data-scheme/data.json` 的标题、Tabs、字幕和图片引用。
2. 运行 `npm run check-data-json`，验证内容格式；此时允许没有音频和时间线。
3. 在环境变量中设置 `MINIMAX_API_KEY`，运行 `npm run tts`。
4. TTS 为每个 Scene 生成 `data-scheme/audio/<scene-id>.mp3`，并生成
   `data-generate.json`，其中包含 `audioSrc`、`timing` 和 `tts` 缓存信息。
5. 运行 `npm run dev` 预览，或运行 `npm run build` 构建。两者都会先执行
   `check-data-json:render`，确保音频和连续时间线已经就绪。

可以将 `.env.example` 复制为 Git 已忽略的 `.env` 并填写 Key，也可以使用
PowerShell 临时环境变量：

```powershell
$env:MINIMAX_API_KEY="your-api-key"
npm run tts:dry-run
npm run tts
npm run dev
```

也可以使用 `npm run prepare-report` 连续执行内容校验、TTS 和渲染校验。
`npm run tts:force` 会忽略缓存并重新生成全部音频。

## TTS 配置

默认使用 MiniMax `speech-2.8-hd` 和
`Chinese (Mandarin)_Warm_Girl`。可选环境变量记录在 `.env.example` 中。

`TTS_TAIL_PADDING_MS` 默认为 `250`，用于在每句旁白末尾留出轻微停顿。
Header1 和 Header3 的宽度直接使用 TTS 回写的 Scene 时长自动计算。
Remotion 始终读取 `data-generate.json`，而人工只需要维护 `data.json`。
