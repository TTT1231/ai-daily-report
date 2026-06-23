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

- Claude CLI
- Bun
- Go
- ffmpeg（按需，用于 TTS 语音质量检测；没有时可设 `REQUIRE_VOICE_QUALITY_FFMPEG=false` 跳过）

## 快速开始

先选你要做什么：

| 目标 | 命令 / 入口 | 说明 |
| --- | --- | --- |
| 看效果 | `bun run preview` / `bun run preview:notts` | 不用配置 `.env` |
| 自动出片 | `bun run video:prepare` | RSS 抓取、总结、TTS、图标一条龙 |
| 手写内容 | 编辑 `data-scheme/data.json` | 自己控制标题、Tabs、字幕和图片 |

> [!TIP]
> 本项目用 `minimax` 生成 TTS 旁白，用 `deepseek-v4-flash` 总结 RSS 抓取的内容，用 `claude -p` 识别远程图片并生成对应图标。
>
> 图片识别依赖 claude 的多模态能力或图片识别类 mcp。
>
> RSS 的模型可自由切换；TTS 目前仅适配了 `minimax`，若要换其他 TTS，需要同步改 TTS 生成代码与 schema。

### 只看示例

```bash
bun install

bun run preview       # sample-1：完整 TTS 版本
bun run preview:notts # sample-2：无 TTS 静音版本
```

这两个命令只读 `data-scheme-sample-1/2`，不会跑 RSS/TTS，也不会改 `data-scheme/`。

数据来源速记：

| 命令 | 数据 props | 静态资源目录 | 是否需要 `data-scheme/` |
| --- | --- | --- | --- |
| `bun run preview` | `data-scheme-sample-1/data-generate.json` | `data-scheme-sample-1` | 否 |
| `bun run preview:notts` | `data-scheme-sample-2/data-generate.json` | `data-scheme-sample-2` | 否 |
| `bun run dev` / `bun run video:render` | `data-scheme/data-generate.json` | `data-scheme` | 是 |

如果示例预览报 `data-scheme/data-generate.json` 找不到，说明预览数据和正式数据又耦合到了一起。

### 方式一：Agent 自动化（推荐）

```bash
# 1. 配好 .env，然后安装依赖
bun install

# 2. 生成当期数据、旁白和图标
bun run video:prepare

# 3. 预览当前 data-scheme
bun run dev

# 4. 导出 mp4
bun run video:render
```

常用开关写在 `.env`：无多模态能力设 `CLAUDE_VISION_ENABLED=false`；没有 TTS Key 设 `TTS_REQUIRE=false`；没有 ffmpeg 设 `REQUIRE_VOICE_QUALITY_FFMPEG=false`。

自动配图没覆盖的 scene，可以把图片放进 `data-scheme/images/`，再在 `data.json` 里填 `overlayImg: "images/xxx"`。只换图片不会重新请求 TTS。

> [!WARNING]
> `ingest/rss-state.json` 保存上一次 RSS 抓取快照，用来判断重复内容。日常不用手动编辑；如果你清空了 `data-scheme/` 或想完全重建，请运行 `bun run reset` 后再执行 `bun run video:prepare`。

### 方式二：手写维护

你手动编辑 `data-scheme/data.json`，自己控制标题、Tabs、字幕与图片引用。

```bash
bun install

# 可从完整示例复制一份再改
cp -r data-scheme-sample-1 data-scheme

# 编辑 data-scheme/data.json

# 预览当前 data-scheme
bun run dev

# 可选：单独生成 TTS / 图标
bun run tts
# claude/codex: /generate-svg
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

## RSS 配置

RSS 采集器完整图文说明见 [`ingest/readme.html`](./ingest/readme.html)。

## 示例数据

- [`data-scheme-sample-1`](./data-scheme-sample-1)：完整示例，含 TTS 音频。
- [`data-scheme-sample-2`](./data-scheme-sample-2)：无 TTS 示例，适合没有 TTS 服务时预览。

## 可视化文档

想看更完整的结构说明，可参考 [HTML 可视化文档](./.claude/claude.html)。

## 注意事项

> [!WARNING]
> 请确保你能够正常访问 `linux.do`。网络受限时，只需在项目根目录 `.env` 配置小写 `all_proxy`，需科学上网环境。例如 `all_proxy=http://127.0.0.1:7890`。
