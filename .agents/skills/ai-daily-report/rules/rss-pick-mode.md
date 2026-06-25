# RSS 补选模式：从 rss-state.json 人工追加新闻

> 这是 `ai-daily-report` skill 的细节文件。主线在 [`../SKILL.md`](../SKILL.md)。

## 什么时候用

用户已经跑过：

```bash
bun run video:prepare
```

当前 `data-scheme/data.json` 已经由自动 RSS 流程生成，但用户觉得自动筛选太少，于是从 `ingest/rss-state.json` 中复制了一批自己感兴趣的条目，要求追加进本期日报。

典型输入是用户直接贴一段 JSON 片段：

```jsonc
"c320d6cc1306f82f33b6bc76de676467a4638b89fdcb7679e85bbcb9a1d96224": {
  "sourceId": "linuxdo-news",
  "title": "Google Workspace CLI 项目作者被解雇",
  "link": "https://linux.do/t/topic/2463889"
},
"e554f218afed82752478953d3fc38a69886891230b3e141c05432e8605b041b4": {
  "sourceId": "linuxdo-news",
  "title": "豆包新版变化真蛮多的，继续更新:现在豆包喜欢在画图完成后介绍每一张图的特点|分享图片到豆包更难了",
  "link": "https://linux.do/t/topic/2461423"
}
```

这不是完全手动模式。不要让用户从零写 `data.json`，也不要要求用户逐条执行命令。

> **挑条目更省事**：手动翻 `rss-state.json` 很累。跑 `bun run rss:vision-pick` 会生成一个按 `sourceId` 分类的网页并自动打开浏览器——
> 已进本期 `data.json` 的条目会带绿标（默认不勾，避免重复补选），勾选后一键「复制选中为 JSONC」，粘回对话即可进入下面的补选流程。
> 实现见 `scripts/rss-pick/`。

## 环境变量一致性

RSS 补选模式必须尽量保持和 `bun run video:prepare` 一致的环境变量语义：

- **TTS**：追加 `data-scheme/data.json` 后必须跑 `bun run tts`。该命令已经在 `package.json` 中带 `node --env-file-if-exists=.env`，所以会继续受 `TTS_REQUIRE`、`MINIMAX_API_KEY`、`MINIMAX_TTS_MODEL`、`MINIMAX_TTS_VOICE_ID`、`MINIMAX_TTS_SPEED`、`REQUIRE_VOICE_QUALITY_FFMPEG` 等变量控制。不要手写 `audioSrc`、`timing` 或 `tts`。
- **Tab 图标**：TTS 后跑 `bun run generate-svg`，让图标继续按现有 `generate-svg` skill 生成，不手写 icon。
- **视觉/配图**：RSS 补选不能退化成纯文字追加。处理用户补选条目时，agent 必须读取 `.env` 中的 `CLAUDE_VISION_ENABLED`：
  - `CLAUDE_VISION_ENABLED=true` 或未设置：对补选条目的 Linux.do 页面/RSS 内容提取远程图片，按自动模式的原则做识图与相关性判断；相关才下载到 `data-scheme/images/` 并写入对应 scene 的 `overlayImg`（尺寸 `overlayImgWidth`/`overlayImgHeight` 由构建按文件重算，可写可不写）。
  - `CLAUDE_VISION_ENABLED=false`：不自动写 `overlayImg`；如能提取候选图，可下载到 `data-scheme/images/` 供后续人工确认，并在最终说明中列出。
  - 视觉处理失败、页面无图或图片不相关时，仍可追加文字 Story，但必须在最终说明中说明“未写入 overlayImg”的原因。

视觉补选时不要让用户自己找图。agent 应主动处理：读取补选链接、提取候选图、过滤 onebox 预览图/头像/Logo/小图标/重复图，以及 LinuxDo 常见但不适合作为新闻配图的表情包、反应图、签名装饰图、引用别人帖子带入的无关图。必要时用 Claude 视觉或可用图像能力，结合补选 Story 的主题、重要性和要点判断是否相关。不要因为用户是人工补选就跳过自动识图。

### Linux.do 内容与图片获取（已验证，全程走 all_proxy）

linux.do 是 Discourse。主站网页和 `/t/topic/{id}.json` 有 Cloudflare JS challenge，**curl / WebFetch / Playwright 直连都过不去**（表现为"连接被关闭""SSL 失败""拿到 Just a moment 页"）——**这是 CF 防护，不是网络阻断，不要误判放弃**。正确姿势：全程走 `.env` 的 `all_proxy`，优先用 RSS 端点。`bun run video:prepare` 能成功就是靠 `all_proxy`。

1. **抓正文+图用 `.rss` 端点**（不走 JS challenge，curl+代理秒级拿到；topicId 取自用户贴的 `link`）：
   ```bash
   ALL_PROXY="$(grep -E '^all_proxy=' .env | cut -d= -f2-)" \
     curl -sL --max-time 15 -H "User-Agent: ai-daily-report-rss/1.0" \
     "https://linux.do/t/topic/{topicId}.rss"
   ```
   每个 `<item>` 的 `<description>` 是 cooked HTML，含 `<img>` 和正文。拿到的是真实内容，不是 challenge 页。

2. **别用 Playwright 抓单帖**——启动慢、易触发 CF 限流，是最后手段。`.rss`+curl 快几个数量级。WebFetch 也不走代理、过不了 CF，不要用它抓 linux.do。

3. **提取候选图、排除噪声**：取 `cdn3.ldstatic.com` 的图；排除 `/images/emoji/`、头像、Logo、`<300px` 小图、细长 banner（如 1035×121）、签名/反应图。拿全尺寸：把 `optimized/4X/{a}/{b}/{c}/{sha}_2_{W}x{H}.ext` 改写成 `original/4X/{a}/{b}/{c}/{sha}.ext`（去 `_2_WxH`，`optimized`→`original`）。`upload://xxx` 是 Discourse 内部引用，转成 `https://linux.do/uploads/short-url/xxx.ext` 重定向到真实 CDN。

4. **下载图片**（CDN 走代理 + Referer 防盗链，带重试；参考 `ingest/image_assets.go` 的 `downloadVisionOverlayImage`）：
   ```bash
   ALL_PROXY="$(grep -E '^all_proxy=' .env | cut -d= -f2-)" \
     curl -sL --max-time 25 --retry 3 \
     -H "User-Agent: ai-daily-report-rss/1.0" \
     -H "Referer: https://linux.do/t/topic/{topicId}" \
     "{imageUrl}" -o "data-scheme/images/topic-{id}-{hash8}.{ext}"
   ```
   下完用 `file` 校验是完整横图（首次请求可能截断，靠 `--retry` 兜底；不要把截断的坏图配上去）。

5. **限速**：`.rss` 不要短时间连发（8 条连发会触发 CF challenge），每条间隔 4-8 秒。

6. **相关性判断**仍按上方 `CLAUDE_VISION_ENABLED` 的逻辑。用户明确说"不分析图片"时，可只按尺寸（横图、≥600px）和帖子上下文筛选，但要在最终说明里告知跳过了视觉确认。

若按上述走 `all_proxy` + `.rss` 仍抓不到（代理真的不可用），只能明确说明依据来自 RSS state 标题、已有快照或用户提供内容，**不要基于标题硬编正文**。

## 工作方式

一句话：**用户负责贴想补选的 RSS 条目，agent 负责把这些条目转成当前日报里的 Story。**

执行时：

1. 解析用户粘贴的多条 RSS state 记录，提取 `hash`、`sourceId`、`title`、`link`。
2. 读取 `ingest/rss-state.json`，确认这些 hash 或 link 确实存在；不存在时用用户粘贴的 title/link 继续，但要说明无法从 state 反查更多上下文。
3. 读取当前 `data-scheme/data.json`，检查是否已经包含相同 `link`、相同 topic id 或相似标题，避免重复追加。
4. 对每条补选新闻生成一个 `DailyStory`：
   - `id`：优先用 Linux.do topic id，例如 `topic-2463889`；否则用标题 slug。
   - `topTitle`：按内容语义归类，例如 `行业动态`、`模型产品`、`账号风险`、`额度价格`、`AI工具`。
   - `bottomTitle`：短标签，尽量 2-6 个汉字或短英文。
   - `contentTitle`：保留新闻核心，不超过 schema 限制。
   - `tabs`：2-4 个，避免硬凑；每个 tab 使用具体标题和摘要。
   - `scenes`：1-3 个，每个 subtitle 是完整口播句，避免标题党和未经证实扩写。
5. 如果 link 是 Linux.do topic，应主动读取原帖或 RSS 中可见内容来补充事实；只引用可见事实，不编造。
6. 按上面的“环境变量一致性”处理补选条目的图片与 `overlayImg`。
7. 把生成的 Story 追加到 `data-scheme/data.json` 的 `stories` 末尾，保持已有自动生成内容不被重写。
8. 跑校验与派生产物：

```bash
bun run check-data-json
bun run tts
bun run generate-svg
bun run check-icons
bun run check-data-json:render
```

如果只是刚追加文字，`tts` 会为新增 scene 生成音频，已有 scene 通常可复用缓存。

## 重要约束

- 不要修改 `ingest/preferences.jsonc`。这类补选是当天人工判断，不是长期偏好。
- 不要重新跑 `bun run video:prepare`。它会重新覆盖 `data-scheme/data.json`，把人工补选结果冲掉。
- 不要让用户逐条运行 `rss:add --link ...` 之类命令。用户的高效用法就是一次贴多条 RSS 条目。
- 不要把补选新闻写进 `data-generate.json`。原始维护文件永远是 `data-scheme/data.json`，`data-generate.json` 由 TTS 生成。
- 不要手写 `audioSrc`、`timing`、`tts`、`icon` 字段。
- 不要把视觉识图和配图丢给用户手动做；它必须受 `CLAUDE_VISION_ENABLED` 控制，并由 agent 在补选流程里处理。
- 如果用户贴了明显非 AI 或社会新闻，也按用户选择追加；但文案要诚实表达其与 AI 日报的关系，不强行包装成 AI 行业大事件。
- 如果补选数量很多，优先保持每条 2 个 tab、1-2 个 scene，避免视频过长。

## 输出给用户

完成后简短说明：

- 成功追加了几条；
- 每条补成了什么 `contentTitle`；
- 每条是否写入 `overlayImg`，没有写入时说明原因；
- 跑了哪些校验；
- 是否有因为重复或缺信息而跳过的条目。

不要把完整 `data.json` 贴给用户。
