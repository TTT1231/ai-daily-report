<div align="center">

# AI Daily Report

### 用 Remotion 构建的 AI 日报自动视频生成

从 RSS 内容采集、AI 筛选，到 TTS 旁白与视频生成，一条流水线完成每日内容生产。

[快速开始](#快速开始) · [RSS 配置](./ingest/readme.html) · [可视化文档](./.claude/claude.html)

<br />

[![Remotion](https://img.shields.io/badge/Remotion-4.0.475-6A5ACD?style=flat-square&logo=remotion&logoColor=white)](https://remotion.dev)
[![React](https://img.shields.io/badge/React-19-20232A?style=flat-square&logo=react&logoColor=61DAFB)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Go](https://img.shields.io/badge/Go-1.26+-00ADD8?style=flat-square&logo=go&logoColor=white)](https://go.dev/)
[![Bun](https://img.shields.io/badge/Bun-Runtime-14151A?style=flat-square&logo=bun&logoColor=white)](https://bun.sh/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.0-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)

**TTS 旁白** · **亮色 / 暗色双主题** · **多卡片布局** · **完整数据流水线**

</div>

## 演示效果

<table>
  <tr>
    <th align="center">亮色主题</th>
    <th align="center">暗色主题</th>
  </tr>
  <tr>
    <td>
      <a href="./demo-video.mp4">
        <img src="./demo-light.png" alt="AI Daily Report 亮色主题演示" />
      </a>
    </td>
    <td>
      <a href="./demo-video.mp4">
        <img src="./demo-dark.png" alt="AI Daily Report 暗色主题演示" />
      </a>
    </td>
  </tr>
</table>

<p align="center">
  <a href="./demo-video.mp4"><strong>▶ 查看完整视频演示</strong></a>
</p>

## 准备环境

- claude cli
- bun
- go
- ffmpeg（按需，用于 TTS 语音质量检测；没有时可设 `REQUIRE_VOICE_QUALITY_FFMPEG=false` 跳过）

## 快速开始

本项目支持两种生成日报的方式：

| 方式                     | 谁准备 data.json                       | 适合场景                     |
| ------------------------ | -------------------------------------- | ---------------------------- |
| **手写维护**             | 你手动编辑 `data-scheme/data.json`     | 想完全掌控内容，或自定义来源 |
| **Agent 自动化（推荐）** | `bun run video:prepare` 自动抓取并生成 | 日常批量出片，一条命令搞定   |

> [!TIP]
> 本项目用 `minimax` 生成 TTS 旁白，用 `deepseek-v4-flash` 总结 RSS 抓取的内容，用 `claude -p` 识别远程图片并生成对应图标。
>
> 图片识别依赖 claude 的多模态能力或图片识别类 mcp。
>
> RSS 的模型可自由切换；TTS 目前仅适配了 `minimax`，若要换其他 TTS，修改 `scripts/render/generate-tts.mjs` 即可。

### 方式一：Agent 自动化（推荐）

> [!WARNING]
> **图片：自动 + 手动**：`rss` 视觉识别开启时，会给部分高分 Story（评分 ≥9、含远程图，且 Claude 判定相关）**自动下载并配图**（写入 `overlayImg`）；关闭 `CLAUDE_VISION_ENABLED` 时不会写入 `overlayImg`，但会把候选图下载到 `data-scheme/images/`，方便你手动判断后填写 `overlayImg: "images/xxx"`。仅替换图片不会重新请求旁白。

```bash
# 1. 填写好 .env：RSS 模型供应商/API Key、TTS Key，以及按需开关
#    网络受限时可在 .env 配置代理，例如all_proxy=http://127.0.0.1:7890
#    无多模态/识图能力：CLAUDE_VISION_ENABLED=false
#    不需要旁白或没有 MiniMax Key：TTS_REQUIRE=false
#    没装 ffmpeg 但仍要生成旁白：REQUIRE_VOICE_QUALITY_FFMPEG=false

# 2. install
bun install

# 3. 自动抓取 RSS、生成 data.json、TTS 与图标
bun run video:prepare

# 4（可选）. 自定义图片：自动配图没覆盖的 scene，可在 data.json 填 `overlayImg`，图片放 `data-scheme/images/`

# 5. 预览（HMR）：video:prepare / video:render 默认不开预览，单独起 dev
bun run dev

# 6. 导出 mp4
bun run video:render
```

> [!WARNING]
> `ingest/rss-state.json` 保存上一次 RSS 抓取快照，用来判断重复内容。日常不用手动编辑；如果你清空了 `data-scheme/` 或想完全重建，请运行 `bun run reset` 后再执行 `bun run video:prepare`。

### 方式二：手写维护（示例，不推荐）

你手动编辑 `data-scheme/data.json`，自己控制标题、Tabs、字幕与图片引用。

```bash
# 1. 安装依赖（需先安装 Bun）
bun install

# 2. 准备数据目录 data-scheme/（首次可直接复制示例）
#    确保 data.json 的 $schema 指向项目根目录的 data.schema.json
#    图片素材放进 data-scheme/images/
# 下面为示例
cp -r data-scheme-sample data-scheme

# 3. 编辑 data.json

# 4. run server
bun run dev

# 可选：通过 skill 生成 Tabs 图标
#   claude: /generate-svg   codex: /generate-svg

# 单独生成 TTS（dev 未运行或需要手动生成时）
bun run tts
```

---

## B 站评论 + 置顶

视频上传到 B 站后，可一键自动发送带时间戳的评论并置顶（方案：直接调用 web API，无需浏览器）。拆成两个独立命令：

```bash
# 0.（可选）先生成评论正文（带时间戳的章节索引）到 data-scheme/comments.txt
bun run comment:generate         # 或 bun run comment:generate --copy 复制到剪贴板

# 1. 发评论（不置顶）
bun run bili:comment -- --bvid BV1xxxxxxxx --from-file data-scheme/comments.txt
#   或直接传正文：
bun run bili:comment -- --bvid BV1xxxxxxxx --message "今日日报：..."
#   → 输出 rpid，用于下一步置顶

# 2. 置顶（必须传 --rpid，来自上一步的输出）
bun run bili:stick -- --bvid BV1xxxxxxxx --rpid <上一步的rpid>
```

> [!NOTE]
>
> - 凭据从 `biliup/cookies.json` 读取（由 `biliup login` 扫码登录生成，已 gitignore，**不进 `.env`**）。置顶需要 UP 主权限，必须用该视频 UP 主的账号。
> - `--bvid` 即视频 BV 号（URL 里 `BV...` 那段），脚本会自动换成评论接口需要的 oid；也可用 `--oid <aid>` 直接传内部 id。
> - 置顶内部带等待+重试，应对评论刚发出未索引时的 `-404`。

---

## FAQ

如果你在使用本项目中遇到了难题可直接用本项目提供的`skill`

```
/ai-daily-report  <your-problem or your doubt>
```

## 了解本项目rss

RSS 采集器完整图文说明见 [`ingest/readme.html`](./ingest/readme.html)。

## 示例数据

参考项目中[data-scheme-sample](./data-scheme-sample)里面的数据。

## 可视化了解本项目

如果你想深入了解本项目可以参考[html可视化文档](./.claude/claude.html)

## 注意事项

> [!WARNING]
> 请确保你能够正常访问 `linux.do`。网络受限时，只需在项目根目录 `.env` 配置小写 `all_proxy`，需科学上网环境。例如 `all_proxy=http://127.0.0.1:7890`。
>
> 如果你没有 TTS Key，设 `TTS_REQUIRE=false` 跳过 MiniMax 旁白；如果没有 ffmpeg，设 `REQUIRE_VOICE_QUALITY_FFMPEG=false` 跳过音质检测；如果没有多模态能力或识图 MCP，设 `CLAUDE_VISION_ENABLED=false`，流程会保留候选图供手动配图。
