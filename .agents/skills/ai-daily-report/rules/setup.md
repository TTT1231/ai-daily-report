# 环境与首次运行

只在安装、缺依赖、缺环境变量或网络抓取失败时读取本文件。

## 运行时

- 必需：`bun`、`go`
- 自动识图或生成 Tab 图标：`claude` CLI
- 开启语音质量检测：`ffmpeg`

首次执行：

```bash
bun install
```

## `.env`

以 `.env.example` 为单一配置说明：

- RSS/内容模型/视频标题：`AI_API_KEY`、`AI_BASE_URL`、`AI_MODEL`
- MiniMax TTS：`TTS_REQUIRE=true` 时配置 `MINIMAX_API_KEY`、`MINIMAX_TTS_MODEL`、`MINIMAX_TTS_VOICE_ID`、`MINIMAX_TTS_SPEED`
- 不需要旁白：`TTS_REQUIRE=false`
- 没有 ffmpeg 但仍需旁白：`REQUIRE_VOICE_QUALITY_FFMPEG=false`
- 自动识图：`CLAUDE_VISION_ENABLED=true`；调用数和预算由对应 `CLAUDE_VISION_*` 变量限制

不要打印或回显 `.env` 中的密钥、Cookie。

## 代理

代理只使用小写 `all_proxy`，来源是否必须走代理以 `ingest/sources.jsonc` 的 `proxy` 字段为准。

- `proxy:true`：必须使用 `all_proxy`，未配置就明确报错，不静默直连。
- `proxy:false` 或省略：直连，不擅自切代理。
- linux.do 还需要 `LINUXDO_CF_CLEARANCE` 与 `LINUXDO_USER_AGENT`；三者缺一可能得到 Cloudflare challenge 页面。

人工处理 RSS 补选时的具体抓取方式只读取 [`rss-pick-mode.md`](./rss-pick-mode.md)。

## 数据与预览

- 正式数据：`data-scheme/`
- 固定示例：`demo/data-scheme-sample-1/2`
- 当前正式数据预览：`bun run dev`
- 固定示例预览：`bun run preview` / `bun run preview:notts`
