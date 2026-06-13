# AI Daily Report · Remotion 视频生成系统

基于 [Remotion](https://remotion.dev) 的 AI 日报视频生成系统，支持 TTS 旁白、双主题（亮色/暗色）、多卡片布局和完整的数据流水线。

<img src="./demo.gif" />

## 快速开始

[html可视化文档](./.claude/claude.html)

```bash
# 1. 安装依赖（需先安装 Bun）
bun install

# 2. 准备数据目录 data-scheme/（首次可直接复制示例）
#    确保 data.json 的 $schema 指向项目根目录的 data-schema.json
#    图片素材放进 data-scheme/images/
cp -r data-scheme-sample data-scheme

# 3. 在项目根目录创建 .env，Remotion / TTS / rss/ 共用同一份（参考 .env.example）
# --- MiniMax TTS ---
# MINIMAX_API_KEY=<your-api-key>
# MINIMAX_TTS_ENDPOINT=https://api.minimaxi.com/v1/t2a_v2
# MINIMAX_TTS_MODEL=speech-2.8-hd             # 按需选择 TTS 模型
# MINIMAX_TTS_VOICE_ID=Chinese_sweet_girl_vv1  # 选择你喜欢的音色
# MINIMAX_TTS_SPEED=1
# MINIMAX_TTS_REQUEST_INTERVAL_MS=2200         # 默认约 27 RPM，限流时自动等待重试
# MINIMAX_TTS_MAX_RETRIES=5
# MINIMAX_TTS_RATE_LIMIT_RETRY_MS=60000
# TTS_TAIL_PADDING_MS=250
# --- RSS 分析模型（OpenAI 兼容接口，换服务只改下面三项）---
# AI_API_KEY=<your-api-key>
# AI_BASE_URL=https://api.deepseek.com
# AI_MODEL=deepseek-v4-flash

# 4. 获取日报内容（二选一）
# 自动：从 Linux.do RSS 2.0 源抓取并生成 data-scheme/data.json
bun run rss
# 手动：直接编辑 data-scheme/data.json

# 5. 启动开发监听 + Remotion Studio（dev 会自动运行 TTS，通常无需单独执行）
bun run dev

# 可选：通过 skill 生成 Tabs 图标
#   claude: /generate-svg   codex: /generate-svg

# 单独生成 TTS（dev 未运行或需要手动生成时）
bun run tts
```

开发模式会监听 `data-scheme/data.json`、`data-schema.json`、`.env` 和图片素材：

- 修改 `data.json`、Schema 或 TTS 环境配置时，自动运行增量 TTS 并更新 `data-generate.json`。
- 未改变字幕的场景会复用已有音频；只增加或修改 `overlay.src` 不会重新请求旁白。
- 仅替换图片文件时交由 Remotion Studio 刷新，不运行 TTS。
- `.gitignore` 只影响 Git，不影响开发监听或 Remotion 的 `publicDir`。

## 其他命令

| 命令 | 作用 |
| --- | --- |
| `bun run rss` | 从 Linux.do RSS 抓取并生成 `data-scheme/data.json` |
| `bun run rss:test` | 运行 `rss/` 的 Go 测试 |
| `bun run tts` | 校验数据并生成 TTS 音频与时间线 |
| `bun run tts:dry-run` | 只模拟流程，不调用 MiniMax、不写文件 |
| `bun run tts:force` | 忽略缓存，全部重新生成音频 |
| `bun run prepare-report` | 串联 `tts` + `check-data-json:render`，渲染前一键就绪 |
| `bun run dev` | 启动数据监听与 Remotion Studio |
| `bun run dev:studio` | 只启动 Remotion Studio（不监听） |
| `bun run build` | 打包 Remotion bundle（`prebuild` 会先跑渲染校验） |
| `bun run comment` | 从时间线生成 B 站风格跳转评论 |
| `bun run archive` | 按完整日期归档当前 `data-scheme/` 到 `daily-dates/` |
| `bun run lint` | ESLint + `tsc` 类型检查 |
| `bun run upgrade` | 升级 Remotion 及相关依赖 |

## 示例数据

参考项目中[data-scheme-sample](./data-scheme-sample)里面的数据。
