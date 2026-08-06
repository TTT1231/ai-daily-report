# RSS 补选模式：从 rss-state.json 人工追加新闻

> 这是 `ai-daily-report` skill 的细节文件。主线在 [`../SKILL.md`](../SKILL.md)。

## 什么时候用

用户想人工控制选稿时，走 **`rss` → `rss:pick` → `video`** 三步流程：

```bash
# 1. 抓取 + 按历史人工 pick 去重，写 rss-state.json（候选池），停下
bun run rss

# 2. 浏览器勾选 → 写 picks.json → 服务自动关闭
bun run rss:pick

# 3. 读 picks.json，每条 picked 独立成 Story → tts → svg → check → data.json
bun run video
```

`bun run rss:pick` 起一个本地服务（端口 7788），把 `rss-state.json` 渲染成按 `sourceId` 分类的网页并自动打开浏览器。已进本期 `data.json` 的条目带绿标（默认不勾，避免重复）；已 pick 过的条目在 `bun run rss` 阶段就被跨次去重过滤掉，不会出现在挑选页，因此无需预勾选。勾选后点「保存并关闭」直接写 `ingest/picks.json`（`{hash: true}` 白名单）并自动关服务——不再走复制 JSONC 贴对话的弯路。

跨次去重只认用户已经手动勾选并保存过的 hash：仅仅被 RSS 抓到、但没有勾选的条目不会进入去重历史，下一次运行仍可继续选择。`run-picks` 成功生成视频后会把本次 picks 记入 `rss-state.json` 的 `picked` 历史，下一次 `rss` 抓取时这些条目会被 `filterUnpickedItems` 直接剔除，不再进入候选池；若上一次停在保存选择后、尚未成功生成视频，下一次 `rss` 也会先从 `picks.json` 把这些人工选择补记进历史（随后同样被去重过滤，不会再次展示）。

`bun run video`（picks 路径）读 `picks.json`，每条 picked **独立成一个单来源 Story**，跳过评分/聚类/合并（人工已挑，不让 AI 再筛/合），直接跑 Tabs(识图) → data.json → tts → svg → check。

### 旧的手动补选（已过时，保留备查）

以下「复制 JSONC 贴对话 → agent 手搓 Story 写 data.json」的流程已被上面的 `rss:pick` → `video` 取代，仅在 `picks.json` 不可用时作为 fallback：

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

## 环境变量一致性

RSS 补选模式必须尽量保持和 `bun run video:auto-generate` 一致的环境变量语义：

- **TTS**：追加 `data-scheme/data.json` 后必须跑 `bun run tts`。该命令已经在 `package.json` 中带 `node --env-file-if-exists=.env`，所以会继续受 `TTS_REQUIRE`、`MINIMAX_API_KEY`、`MINIMAX_TTS_MODEL`、`MINIMAX_TTS_VOICE_ID`、`MINIMAX_TTS_SPEED`、`REQUIRE_VOICE_QUALITY_FFMPEG` 等变量控制。不要手写 `audioSrc`、`timing` 或 `tts`。
- **Tab 图标**：TTS 后跑 `bun run generate-svg`，让图标继续按现有 `generate-svg` skill 生成，不手写 icon。
- **视觉/配图**：RSS 补选不能退化成纯文字追加。处理用户补选条目时，agent 必须读取 `.env` 中的 `CLAUDE_VISION_ENABLED`：
  - `CLAUDE_VISION_ENABLED=true` 或未设置：对补选条目（按其来源的 `proxy` 策略抓取，见下方「抓取规则」）的页面/RSS 内容提取远程图片，按自动模式的原则做识图与相关性判断；相关才下载到 `data-scheme/images/` 并写入对应 scene 的 `overlayImg` 路径（尺寸 `overlayImgWidth`/`overlayImgHeight` 是 generated-only，由 tts 构建期按文件重算写进 `data-generate.json`，raw 不写）。
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

linux.do 是 Discourse，整站（**含 `.rss` 端点**）都在 Cloudflare 后面。`.rss` 现在也吃 CF challenge——光带 `all_proxy` 拿到的是 "Just a moment..." 假页（约 6KB HTML，不是 RSS）。要拿到真实内容必须**三件套齐全**：`all_proxy`（代理）+ `LINUXDO_CF_CLEARANCE`（cf_clearance cookie）+ `LINUXDO_USER_AGENT`（签发该 cookie 的浏览器 UA），缺一就撞 challenge。这正是 `ingest/rss2.go:217-224` 对 linux.do 域名做的事；`bun run video:auto-generate` 能成功靠的是这三件套，不是只靠代理。详见 `.claude/rules/learn-experience.md` 的 linux.do 条目。

1. **抓正文+图用 `.rss` 端点**（topicId 取自用户贴的 `link`）。**绝不能 `source .env`**——`LINUXDO_USER_AGENT` 含未转义括号，会让 bash 整文件解析失败、连带 `$all_proxy` 也设不上；用 `grep|cut` 逐个抽值：
   ```bash
   ap=$(grep '^all_proxy=' .env | cut -d= -f2-)
   ck=$(grep '^LINUXDO_CF_CLEARANCE=' .env | cut -d= -f2-)
   ua=$(grep '^LINUXDO_USER_AGENT=' .env | cut -d= -f2-)
   ALL_PROXY="$ap" curl -sL --max-time 20 \
     -H "User-Agent: $ua" -H "Cookie: $ck" \
     "https://linux.do/t/topic/{topicId}.rss"
   ```
   每个 `<item>` 的 `<description>` 是 cooked HTML，含 `<img>` 和正文。**先 `head -c 5` 判定**：`<?xml` 才是真实 RSS，`<html` 就是 challenge 页，不要当成功。cf_clearance 会过期，且 UA 必须与签发该 cookie 的浏览器一致，否则仍被 challenge。

2. **瞬时失败就重试，不要换工具**：本地代理偶发抖动时同一命令重试 2-3 次、间隔 5-10 秒多半自愈。**不要**改走 `bun fetch()`、PowerShell `Invoke-RestMethod`、WebFetch 或 Playwright——它们走同一代理隧道、同样会失败（Playwright 还慢、易触发 CF 限流）；更不要退回直连（必撞 CF）。多次重试仍全失败才判定代理/cf_clearance 不可用，明确告知用户。

3. **提取候选图、排除噪声**（以下 `cdn3.ldstatic.com`/`upload://`/post 结构均为 **Discourse 特有，仅适用于 linux.do**；其他源按各自结构处理，不要套用）：
   - **扫所有 `<item>`，不要只看 post /1**：Discourse topic RSS 把楼主和每条回复各列成一个 `<item>`、倒序排列，正文图可能在任意一条（实测原帖 post/1 闲聊、真图在 post/2 的情况）。直接对**原始 RSS 文本**跑 `grep -oE 'cdn3\.ldstatic\.com/[A-Za-z0-9/._-]+\.(png|jpe?g|webp|gif|avif)'`，别假设图在 post/1。
   - **提取 img src 前不能先删标签**：`sed 's/<[^>]*>/ /g'` 会把 `<img src="…">` 整段连同 URL 抹掉。先在含标签原文里 grep URL，再单独去标签。
   - **优先 cdn3 直链，`upload://` 短链只作兜底**：`upload://xxx` 转 `https://linux.do/uploads/short-url/xxx.ext` 会重定向到 CDN，但 short-url 常返回 403。同一张图几乎都有 cdn3 直链，先 grep cdn3；只有全帖没有 cdn3 直链、只剩 `upload://` 时才回退 short-url。
   - 排除噪声：`/images/emoji/`、头像、Logo、`<300px` 小图、细长 banner（如 1035×121）、签名/反应图。
   - 拿全尺寸：`optimized/4X/{a}/{b}/{c}/{sha}_2_{W}x{H}.ext` → `original/4X/{a}/{b}/{c}/{sha}.ext`。

4. **下载图片**（CDN 走代理 + Referer 防盗链 + 重试；参考 `ingest/image_assets.go` 的 `downloadVisionOverlayImage`）。CDN 图片不在 CF challenge 后，cookie 不需要，但代理和 Referer 要：
   ```bash
   ALL_PROXY="$ap" curl -sL --max-time 25 --retry 3 \
     -H "User-Agent: $ua" \
     -H "Referer: https://linux.do/t/topic/{topicId}" \
     "{imageUrl}" -o "data-scheme/images/topic-{id}-{hash8}.{ext}"
   ```
   下完用 `file` 校验是完整横图（首次请求可能截断，靠 `--retry` 兜底）。

5. **限速**：连发会触发 CF challenge，每条间隔 4-8 秒。

6. **相关性判断**仍按上方 `CLAUDE_VISION_ENABLED` 的逻辑。用户明确说"不分析图片"时，可只按尺寸（横图、≥600px）和帖子上下文筛选，但在最终说明里告知跳过了视觉确认。

若三件套齐全仍抓不到（cf_clearance 过期 / 代理不可用），只能明确说明依据来自 RSS state 标题、已有快照或用户提供内容，**不要基于标题硬编正文**。

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
   - `tabs`：目标 2-4 个，避免硬凑；每个 tab 使用具体标题和摘要。人工 pick 只覆盖“是否值得选”，不会降低事实证据门槛：若来源只有一句话、无法支撑至少 2 个互不重复的事实角度，两轮定向重写后仍应跳过该 Story，绝不能凭常识编出第二张卡。
   - `scenes`：1-2 个，每个 subtitle 是完整口播句，避免标题党和未经证实扩写。
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
- 不要重新跑 `bun run video:auto-generate`。它会重新覆盖 `data-scheme/data.json`，把人工补选结果冲掉。
- 不要让用户逐条运行 `rss:add --link ...` 之类命令。用户的高效用法就是一次贴多条 RSS 条目。
- 不要把补选新闻写进 `data-generate.json`。原始维护文件永远是 `data-scheme/data.json`，`data-generate.json` 由 TTS 生成。
- 不要手写 `audioSrc`、`timing`、`tts`、`icon` 字段。
- 不要把视觉识图和配图丢给用户手动做；它必须受 `CLAUDE_VISION_ENABLED` 控制，并由 agent 在补选流程里处理。
- 如果用户贴了明显非 AI 或社会新闻，也按用户选择追加；但文案要诚实表达其与 AI 日报的关系，不强行包装成 AI 行业大事件。
- 如果补选数量很多，优先保持每条 2 个 tab、1-2 个 scene，避免视频过长。
- 人工 pick 被质量闸剔除是允许且预期的结果：重要性不能替代事实材料；宁可少一条，也不要把一句话扩写成没有依据的完整新闻。

## 输出给用户

完成后简短说明：

- 成功追加了几条；
- 每条补成了什么 `contentTitle`；
- 每条是否写入 `overlayImg`，没有写入时说明原因；
- 跑了哪些校验；
- 是否有因为重复或缺信息而跳过的条目。

不要把完整 `data.json` 贴给用户。
