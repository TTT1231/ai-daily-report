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
  - `CLAUDE_VISION_ENABLED=true` 或未设置：对补选条目（按其来源的 `proxy` 策略抓取，见下方「抓取规则」）的页面/RSS 内容提取远程图片，按自动模式的原则做识图与相关性判断；相关才下载到 `data-scheme/images/` 并写入对应 scene 的 `overlayImg`（尺寸 `overlayImgWidth`/`overlayImgHeight` 由构建按文件重算，可写可不写）。
  - `CLAUDE_VISION_ENABLED=false`：不自动写 `overlayImg`；如能提取候选图，可下载到 `data-scheme/images/` 供后续人工确认，并在最终说明中列出。
  - 视觉处理失败、页面无图或图片不相关时，仍可追加文字 Story，但必须在最终说明中说明“未写入 overlayImg”的原因。

视觉补选时不要让用户自己找图。agent 应主动处理：读取补选链接、提取候选图、过滤 onebox 预览图/头像/Logo/小图标/重复图，以及 Discourse 类来源（如 linux.do）常见但不适合作为新闻配图的表情包、反应图、签名装饰图、引用别人帖子带入的无关图。必要时用 Claude 视觉或可用图像能力，结合补选 Story 的主题、重要性和要点判断是否相关。不要因为用户是人工补选就跳过自动识图。

### 抓取规则：按来源的 `proxy` 字段决定是否走代理（以 `sources.jsonc` 为准）

补选抓取（取正文、取图）的网络代理**必须以 `ingest/sources.jsonc` 为单一事实源**，和自动采集器保持一致：

1. **先确定该补选条目对应哪个来源**：
   - 条目带 `sourceId` → 在 `sources.jsonc` 里找 `id` **等于该 `sourceId`** 的来源对象。
   - 条目只有 `link`（无 `sourceId`）→ 用 link 域名去 `sources.jsonc` 反查（找 `url` 域名匹配的来源）。
   - **不要凭 link 域名猜测 `proxy`**——必须落到 sources.jsonc 的来源对象上读字段。
2. **读到来源后按 `proxy` 字段决策**（有确定性知识，该强制就强制）：
   - `proxy: true`（如 `linuxdo-news`，在 Cloudflare 后面、直连必败）→ curl **必须带** `.env` 的 `all_proxy`，命令模板见下方 linux.do 示例；**不先试直连**（确定要代理，直连必败是浪费）。
   - `proxy: false` 或省略（直连可达的来源）→ curl **直连**，**不带** `ALL_PROXY`，也**不回退代理**；这类来源的图床域名、条目结构各不相同，按该来源自身结构处理，**不要套用** linux.do 的 `cdn3.ldstatic.com` / `upload://` 规则。
3. **来源在 `sources.jsonc` 里找不到**（`sourceId` 不存在 / 反查不到）→ 没有配置依据，按「**直连优先 + 代理兜底**」探测：
   - 先 curl **直连**抓取。
   - 直连失败（HTTP 非 200 / 超时 / 返回空 / 拿到 Cloudflare challenge 页如 "Just a moment"）→ 换 `all_proxy` **重试**；多次重试仍失败才判定抓不到，向用户说明。
   - 这是「无确定性知识时的运行时探测」，与步骤 2「有配置时强制」正交。
4. 若某来源标了 `proxy:true` 但 `.env` 未配 `all_proxy`，不要静默退回直连——明确告知用户「该来源需要代理但 .env 未配 all_proxy」（采集器遇到同样情况也会报错）。

> agent 工具（WebFetch / Fetch）不会自动读项目 `.env`，所以补选抓取一律用本地 `curl` 显式带代理；不要用 WebFetch（它既不走代理、也过不了 CF）。

> **输入不完整时**：只要拿到 `link` 就按上面规则抓（定位不到来源就走步骤 3 的「直连优先 + 代理兜底」，**不做复杂的格式归一化或 rss-state 反查**）；完全没 `link`（只有标题/描述）才抓不了，直接问用户要 link，不要凭标题硬编正文。

#### 示例：linux.do（`proxy:true`、Discourse + Cloudflare）

linux.do 是 Discourse。主站网页和 `/t/topic/{id}.json` 有 Cloudflare JS challenge，**curl / WebFetch / Playwright 直连都过不去**（表现为"连接被关闭""SSL 失败""拿到 Just a moment 页"）——**这是 CF 防护，不是网络阻断，不要误判放弃**。因为 linux.do 标了 `proxy:true`，正确姿势是全程走 `.env` 的 `all_proxy`，优先用 RSS 端点。`bun run video:prepare` 能成功就是靠 `all_proxy`。

**走了代理仍偶发失败 ≠ 方法错了**：`all_proxy` + `.rss` 这条路本身已验证可用——大写 `ALL_PROXY`、小写 `all_proxy`、显式 `--proxy` 三种 curl 写法在代理健康时**都能拿到 HTTP 200**。但本地代理（`127.0.0.1:7890` 之类）会**瞬时抖动**，典型表现是 curl `exit 35`（SSL 握手失败）、返回 `0 字节`、bun `ECONNRESET`、PowerShell `EOF`，且**即使配了代理也照挂**。正确应对：**用同一条 curl 命令重试 2-3 次、每次间隔 5-10 秒**，代理多半很快自愈。**不要**因此改走 `bun fetch()` 或 PowerShell `Invoke-RestMethod`——它们走的是同一个代理隧道，会以同样方式失败，只白白烧掉几轮迭代；更不要退回直连或 WebFetch（必撞 CF）。只有多次重试仍全失败，才判定代理本身不可用，此时明确告知用户，不要继续猜。

1. **抓正文+图用 `.rss` 端点**（不走 JS challenge，curl+代理秒级拿到；topicId 取自用户贴的 `link`）：
   ```bash
   ALL_PROXY="$(grep -E '^all_proxy=' .env | cut -d= -f2-)" \
     curl -sL --max-time 15 -H "User-Agent: ai-daily-report-rss/1.0" \
     "https://linux.do/t/topic/{topicId}.rss"
   ```
   每个 `<item>` 的 `<description>` 是 cooked HTML，含 `<img>` 和正文。拿到的是真实内容，不是 challenge 页。

2. **别用 Playwright 抓单帖**——启动慢、易触发 CF 限流，是最后手段。`.rss`+curl 快几个数量级。WebFetch 也不走代理、过不了 CF，不要用它抓 linux.do。

3. **提取候选图、排除噪声**（以下 `cdn3.ldstatic.com`/`upload://`/post 结构均为 **Discourse 特有，仅适用于 linux.do**；其他 RSS 源的图床域名、引用方式、条目结构各不相同，需按各自结构处理，不要把这套 cdn3/upload:// 规则套到别的源）：
   - **扫所有 `<item>`，不要只看 post /1**：Discourse topic RSS 把 post /1（楼主）和每条回复各列成一个 `<item>`、倒序排列，正文图**可能在任意一条**（实测有原帖 post /1 是闲聊、真正的图在 post /2 的情况）。直接对**原始 RSS 文本**跑 `grep -oE 'cdn3\.ldstatic\.com/[A-Za-z0-9/._-]+\.(png|jpe?g|webp|gif|avif)'`，把全帖候选 URL 都列出来，别假设图在 post /1。
   - **提取 img src 前绝不能先删标签**：`sed 's/<[^>]*>/ /g'` 会把 `<img src="…">` 整段连同 URL 一起抹掉，造成"看起来没图"的假象。要先在**含标签的原文**里 grep 出 URL，再单独对正文做去标签。
   - **优先 cdn3 直链，`upload://` 短链只作兜底**：`upload://xxx` 是 Discourse 内部引用，转 `https://linux.do/uploads/short-url/xxx.ext` 可重定向到真实 CDN，**但 short-url 常返回 403**（实测）。同一张图几乎都在帖子里有 cdn3 直链，**先 grep cdn3 直链**；只有全帖确实没有 cdn3 直链、只剩 `upload://` 引用时，才回退 short-url。
   - 排除噪声：`/images/emoji/`（含 `cdn.ldstatic.com/images/emoji/` 这类 20×20 表情）、头像、Logo、`<300px` 小图、细长 banner（如 1035×121）、签名/反应图。
   - 拿全尺寸：把 `optimized/4X/{a}/{b}/{c}/{sha}_2_{W}x{H}.ext` 改写成 `original/4X/{a}/{b}/{c}/{sha}.ext`（去 `_2_WxH`，`optimized`→`original`）。

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

1. 解析用户粘贴的多条 RSS state 记录，提取 `hash`、`sourceId`、`title`、`link`；用 `sourceId`（或 link 域名）查 `ingest/sources.jsonc` 里对应来源的 `proxy`——查得到按配置走、查不到按「直连优先 + 代理兜底」探测（详见上方「抓取规则」）。
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
