# AI Daily Report · Remotion 视频生成系统

基于 [Remotion](https://remotion.dev) 的 AI 日报视频生成系统，支持 TTS 旁白、双主题（亮色/暗色）、多卡片布局和完整的数据流水线。

<img src="./demo.gif" />

## 快速开始

[html可视化文档](./.claude/claude.html)

```bash
# 1. 创建文件夹data-scheme放在项目根目录
#   - [] 准备数据，`data.json` 和 所需的images素材（可选）
#   - [] 确保 `data.json`中`$schema`指向项目根目录的`data-schema.json`,

# 2. 创建.env并填写以下环境变量例如
# MINIMAX_API_KEY=<your-api-key>
# MINIMAX_TTS_ENDPOINT=https://api.minimaxi.com/v1/t2a_v2
# 根据需求选择对应的tts model
# MINIMAX_TTS_MODEL=speech-2.8-hd
# 选择你最爱的音色id
# MINIMAX_TTS_VOICE_ID=Chinese_sweet_girl_vv1
# MINIMAX_TTS_SPEED=1
# MINIMAX_TTS_VOLUME=1
# MINIMAX_TTS_PITCH=0
# TTS_TAIL_PADDING_MS=250

# 3. 生成 TTS 音频（需要 MiniMax API Key）
bun run tts

# 4. 根据需要生成icon（可选通过skill，tabs的图标）
# claude: /generate-svg
# codex: /generate-svg

# 5. 启动
bun run dev
```

## 示例数据

参考项目中[data-scheme-sample](./data-scheme-sample)里面的数据。
