# Linux.do AI 日报筛选与 Remotion 数据生成器

从 Linux.do「前沿快讯」分类 RSS 获取最近 24 小时的帖子，50 条，使用 DeepSeek 完成兴趣筛选、相似事件合并和视频 Tabs 编排；当高优先级帖子的正文过短且附有图片时，可调用 Claude CLI 的远程图像 MCP 补充截图事实，最终自动生成 Remotion AI 日报项目使用的 `data.json`。

## 关注范围

重点关注：

- OpenAI、ChatGPT、GPT、Codex
- Anthropic、Claude
- 智谱、GLM
- 月之暗面、Kimi、Moonshot
- DeepSeek、深度求索
- Qwen、Qween、通义千问、阿里云百炼
- 国家级 AI 政策、监管、执法和合规治理
- API 中转站、低价 AI 渠道的大规模封号、跑路、关停、上游限制等风险

明确排除：

- API 中转、卖号、拼车、代充、邀请码和低价促销广告
- 与 AI 无直接关系的科技、安全、硬件、云服务器、金融、航天和社会新闻
- AI 厂商相关的地缘政治、国际关系和公司立场声明
- 抽奖、拉新、赠送 Token、竞猜和签到等营销活动

### 评分与降级

- 只保留 `7/10` 及以上的候选，最终最多生成 15 个 Story。
- 关键词和国家级 AI 监管内容有代码级关键词保底，避免 DeepSeek 漏报。
- DeepSeek 返回局部无效 JSON 时，会跳过损坏条目并恢复其余评分。
- DeepSeek 评分整体失败时，程序会使用代码级兴趣规则继续执行。
- 聚类或 Tabs 生成失败时，也有本地降级策略，不会直接退回原始 RSS 全量列表。

### 去重与 Tabs

- 同一事件的重复报道合并成一个 Story。
- 同一事件中的发布、开源、API 上线、价格变化等不同信息会保留为独立要点。
- 不会仅因为新闻属于同一家公司就合并。
- 每个 Story 生成 `2` 至 `6` 个 Tabs。
- 每个 Tab 摘要至少 20 个汉字，并分为事实、影响判断或后续观察。
- 内容不足时宁可只生成两个可靠 Tabs，也不会为了数量编造事实。

### 远程图片补充

- 只对 `9/10` 及以上、正文少于默认阈值且含远程图片的来源启用，不会扫描所有帖子。
- Claude CLI 直接把图片 URL 交给已配置的远程图像分析 MCP，不会下载图片到本地。
- 图片必须与新闻标题直接相关；无关配图、装饰图和没有新增信息的图片会被丢弃。
- 图片中的明确事实会作为对应来源的补充证据交给 DeepSeek；不确定内容会保留不确定标记。
- 默认每次运行最多调用 4 张图片、每个来源最多保留 2 张相关图片，避免成本和耗时失控。

## 环境要求

- Go `1.26.2` 或兼容版本
- DeepSeek API Key
- 可选：已安装并登录的 Claude CLI，且配置了能够读取远程图片 URL 的图像分析 MCP
- 可访问 `https://linux.do` 和 `https://api.deepseek.com`

程序会优先读取系统代理环境变量；未配置时会尝试以下本地代理端口：

```text
127.0.0.1:7890
127.0.0.1:7897
127.0.0.1:1080
127.0.0.1:10809
```

## 配置

在 `ai-daily-report` 项目根目录统一维护 `.env`，不要在 `rss/` 内创建第二份：

```dotenv
DEEPSEEK_API_KEY=你的密钥

# 可选：高优先级短正文的远程图片事实补充
CLAUDE_VISION_ENABLED=true
CLAUDE_VISION_MAX_CALLS=4
CLAUDE_VISION_MAX_IMAGES_PER_SOURCE=2
CLAUDE_VISION_TEXT_THRESHOLD=500
CLAUDE_VISION_TIMEOUT_SECONDS=180
CLAUDE_VISION_MAX_BUDGET_USD=1.00
```

`CLAUDE_VISION_MAX_BUDGET_USD` 是单次 Claude CLI 调用的预算上限，不是整次运行的总预算。该功能会使用 `claude --dangerously-skip-permissions -p` 调用可用的远程图像 MCP；不需要图片补充时可设置 `CLAUDE_VISION_ENABLED=false`。

默认生成路径为项目根目录下的：

```text
data-scheme/data.json
```

目录结构不同或需要写入其他位置时，设置环境变量：

```powershell
$env:REPORT_DATA_PATH="C:\path\to\ai-daily-report\data-scheme\data.json"
bun run rss
```

## 使用

在 `ai-daily-report` 项目根目录运行完整流程：

```powershell
bun run rss
```

成功后终端会打印最终主题、来源、合并情况与视频 Tabs，并显示：

```text
已构建 Remotion data.json: <输出路径>
```

随后在 Remotion 项目中启动开发模式：

```powershell
bun run dev
```

Remotion 项目的开发监听器会在 `data.json` 变化后自动增量生成 `data-generate.json`。未修改字幕的场景会复用已有 TTS 音频。

## 生成的数据

生成的 `data.json` 包含：

- `date` 与根据运行时间选择的亮色或暗色主题
- 最终筛选后的 Stories
- 稳定的 Story、Tab 和 Scene ID
- 3 至 5 字的栏目 `topTitle`、3 至 5 字的时间线 `bottomTitle` 和最多 42 字的正文 `contentTitle`
- Intro 资讯概览使用不截断的完整 `introTitle`；Story 主画面仍使用长度受控的 `contentTitle`
- 每个 Tab 的 `summary` 主动使用 `**粗体**` 与行内代码突出重点；对应 `subtitle` 为 28 至 96 字的完整新闻口播，不提“卡片”或“详细内容”
- 每个 Story 的栏目、标题和 2 至 6 个 Tabs
- 与 Tabs 对应的 TTS 字幕 Scenes

当前不会自动写入 `overlay` 图片。后续可以在生成的 Scene 中补充：

```json
{
  "id": "kimi-k2.7-scene-1",
  "subtitle": "Kimi K2.7 Code 正式发布并开源。",
  "overlay": {
    "src": "images/kimi-k2.7-cover.jpg"
  }
}
```

## 验证

运行 Go 测试、静态检查和构建：

```powershell
go test ./...
go vet ./...
go build ./...
```

在 Remotion 项目中验证生成结果：

```powershell
bun run check-data-json
```

## 主要文件

| 文件             | 作用                                |
| ---------------- | ----------------------------------- |
| `rss/main.go`        | 串联完整处理流程                    |
| `config.go`      | RSS、模型、数量和长度限制           |
| `prompts.go`     | DeepSeek 评分、聚类与 Tabs 提示词   |
| `rss.go`         | 获取 Linux.do RSS                   |
| `ranking.go`     | 兴趣关键词加权和硬排除              |
| `grouping.go`    | 相似事件合并与本地降级分组          |
| `story_tabs.go`  | 根据首帖正文生成视频 Tabs           |
| `vision.go`      | 按需分析远程图片并提取补充事实      |
| `report_data.go` | 编译并安全写入 Remotion `data.json` |
| `main_test.go`   | 关键词、分组、Tabs 和输出测试       |

## 已知限制

- 当前主要依据 Linux.do RSS 首帖正文和相关截图，不会自动追踪所有外部官方链接。
- 自动生成内容仍应保留事实审查，特别是社区传闻、封号反馈和未正式公告的信息。
- 远程图片只用于补充文字事实，图片下载、精确裁剪和写入 `overlay` 尚未接入自动流程。
- DeepSeek 模型与接口地址目前在 `config.go` 中固定配置。
