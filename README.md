<div align="center">

# AI Daily Report

### 用 Remotion 构建的 AI 日报自动视频生成

从 RSS 内容采集、AI 筛选，到 TTS 旁白与视频生成，一条流水线完成每日内容生产。

[快速开始](#快速开始) · [RSS 配置](./rss/readme.html) · [可视化文档](./.claude/claude.html)

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

## 快速开始

本项目支持两种生成日报的方式：

| 方式                     | 谁准备 data.json                   | 适合场景                     |
| ------------------------ | ---------------------------------- | ---------------------------- |
| **手写维护**             | 你手动编辑 `data-scheme/data.json` | 想完全掌控内容，或自定义来源 |
| **Agent 自动化（推荐）** | `bun run all` 自动抓取并生成       | 日常批量出片，一条命令搞定   |

> [!Tip] 提示
> 本项目用 `minimax` 生成 TTS 旁白，用 `deepseek-v4-flash` 总结 RSS 抓取的内容，用 `claude -p` 识别远程图片并生成对应图标。
>
> 图片识别依赖 claude 的多模态能力或图片识别类 mcp。
>
> RSS 的模型可自由切换；TTS 目前仅适配了 `minimax`，若要换其他 TTS，修改 `scripts/generate-tts.mjs` 即可。

### 方式一：Agent 自动化（推荐）

> [!WARNING] 注意
> **图片仍需手动插入（可选）**：`bun run all` 不会插图。执行后请到 `data-scheme/data.json` 给每个 Scene 填 `overlayImg: "images/xxx"`，并把图片放进 `data-scheme/images/`。仅替换图片不会重新请求旁白。图片是可选事实源，你可根据喜好自己添加。

```bash
# 1. 填写好对应的tts api key和rss的模型供应商和api key

# 2. install
bun install

# 3. run command
bun run all

# 4. 插入图片（可选）： data.json Scene 中根据需要填写 `overlayImg`，图片放 `data-scheme/images/` 即可

# 5. 预览（HMR）
bun run dev
```

> [!WARNING] 注意
> `rss/rss-state.json` 这里保存的是上一次命令的抓取的快照，如果有重复这里会进行剔除，但是会以这个临时文件进行参考。

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

## FAQ

如果你在使用本项目中遇到了难题可直接用本项目提供的`skill`

```
/ai-daily-report  <your-problem or your doubt>
```

## 了解本项目rss

RSS 采集器完整图文说明见 [`rss/readme.html`](./rss/readme.html)。

## 示例数据

参考项目中[data-scheme-sample](./data-scheme-sample)里面的数据。

## 可视化了解本项目

如果你想深入了解本项目可以参考[html可视化文档](./.claude/claude.html)
