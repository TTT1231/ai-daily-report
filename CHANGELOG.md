# Changelog

## 0.9.1

- Added: 半自动抓取（`bun run rss`）按人工 pick 历史跨次去重——已挑选并成功生成视频的条目不再进入候选池，避免重复展示；`rss-state.json` 新增 `picked` 字段持久化历史，旧文件自动迁移。
- Fixed: 挑选页把「已被消费」与「真正滚出 24h lookback 的过期项」分开提示，已使用的 pick 不再误报为「过期 pick 已丢弃」。
- Fixed: `rss-pick-mode.md` 文档与代码对齐——移除已失效的「已 pick 条目会预勾选」描述，澄清中断恢复语义（恢复后同样被去重过滤、不会再次展示）。

## 0.9.0

- Changed: 每条 Story 的口播（Scene）与信息卡（Tab）解耦——通常只生成 1 条、最多 2 条整条新闻的精简口播，不再逐张朗读 2～6 张 Tab，视频更短、TTS 更省
- Changed: 播放区主标题 contentTitle 上限 42→30 字，必须语义完整、禁止省略号截断；短原标题直接复用，超长标题由模型改写而非机械截取前缀
- Changed: 底部时间线短标签改为模型生成的「主体+事件」标题（navigation_title），不再走品牌推断兜底，避免扎堆退化成「AI 动态」
- Changed: Tab 摘要校验收紧——粗体最多一段，行内代码可按专名使用多段；Markdown 加权后视觉占用不超过 110 单位，必须完整句结尾，不得复制完整标题或与同 Story 其它卡重复
- Added: 不合格的 Story 最多触发两轮带拒绝原因的定向重写，仍不达标才逐条跳过；不再用原文碎片静默降级补齐（含人工 pick）
- Added: 渲染层自动给宽高均不超过 1000px 的小尺寸竖图放大（高窄 1.3／中等 1.2／轻微 1.1），自动值不写回 JSON，手动 overlayImgScale 仍可覆盖
- Added: AVIF overlay 端到端可用——ingest 解码 AVIF 尺寸（多图画布取最大、跳过缩略图）并接受 .avif，与构建期 JS 解析、schema 声明对齐
- Added: 新增 SixTabLayout 预览；Tab 摘要按布局行数限位（summaryLineClamp），接近 110 单位的摘要不再在密集布局里提前截断，标题超长时省略号
- Fixed: 半自动挑选页丢弃已不在当前候选池（24h lookback 之外滚掉）的过期 pick，不再写回 picks.json 触发「N 条 pick 找不到」的误导警告
- Fixed: linux.do 条目正文剥离 Discourse 统一追加的「X 个帖子 - Y 位参与者 阅读完整话题」页脚

## 0.8.0

- Added: 新增「半自动挑选」流水线与 `video:half-auto` 一键命令——先抓 RSS 快照，在本地挑选页勾选条目，再喂给 ingest 评分编排出 data.json，想人工干预选题时不再必须全自动跑模型
- Changed: 脚本命令重命名以匹配新职责：`video:prepare` → `video:auto-generate`、`rss:vision-pick` → `rss:pick`，原 `archive:rotate` 并入 `archive`（沿用旧名会失败）
- Fixed: linux.do 抓取恢复——Cloudflare 现已对 `.rss` 端点下发挑战，仅代理不再够用，补齐 cf_clearance Cookie + 浏览器 UA 后条目重新可抓
- Fixed: Windows 下归档（archive）整目录搬移被编辑器/杀软占用句柄撞 EPERM 而间歇失败，改为逐文件兜底，归档不再因句柄占用而中断
- Changed: `bun run dev` 自动 TTS 同步的日志更精简，成功时少刷屏

## 0.7.0

- Added: ingest 用 LLM 对同主题、跨来源的条目做内容感知合并，故事更聚焦、去重更彻底
- Added: generate-svg 改为增量模式，只补齐缺失或无效的图标，已有的有效图标锁定不重写，生成更快更稳
- Changed: ingest 在 AI 阶段失败时直接中止整期，不再用本地降级凑数；凑不齐足够 Tab 的薄弱故事直接丢弃
- Changed: 论坛（LinuxDo）标题自动剥离楼层、标签等装饰，显示标题更干净
- Changed: 视频标题与标签从 B 站解耦，写入平台无关的 data-scheme/video-meta.json，命令 bili:meta 更名为 video:meta
- Fixed: LinuxDo 置顶帖导致 RSS 分页抓取失效，分页采集恢复正常
- Added: RSS 快照人工补选页重新设计，按来源分类挑选
- Added: Remotion 渲染冒烟测试纳入 CI
- Fixed: 模型评分、MiniMax TTS、video-meta 标题生成对瞬时 API 失败（限流/5xx/网络抖动）退避重试，单次抖动不再中止整轮 ingest 或丢弃已合成音频
- Fixed: RSS 抓取的 Retry-After 等待封顶 60s，异常或恶意 feed 无法再用超大值拖垮当日流水线
- Fixed: Zod schema 漏放 gif/avif（0.6.0 已声明支持、TS 正则没同步），手动 gif/avif overlay 不再在渲染时被拒
- Fixed: macOS/Linux 下 Ctrl+C 正确终止整棵子进程树（含 Remotion Chromium），不再留孤儿；Windows 杀进程失败改为显式告警
- Fixed: Story Tab summary 增加 25 至 110 个可见字符约束，避免长摘要撑爆卡片布局
- Changed: 清理 story tabs 未启用的定向修正重试死代码，行为不变

## 0.6.0

- Changed: `bun run dev` 每次保存不再对缓存音频重跑 ffmpeg 音质检，同步耗时从约 10s 降到 1-2s
- Added: overlay 图片支持 GIF / AVIF 格式（schema 放行，构建期读取真实像素尺寸）
- Fixed: 编辑 data.json 中途保存触发校验失败时不再被"连续失败"锁死，修正后保存即自动恢复
- Changed: overlay 图片尺寸（overlayImgWidth/Height）改为构建期按图片真实像素自动写入 data-generate.json，data.json 无需再手填；dev 换图也会自动重算尺寸（音频缓存复用、不调 MiniMax）

## 0.5.0

- Added: ingest 对近 24h 全量条目重新评分，加入视觉相关性评分与图片去重
- Added: render 支持 overlay 图片缩放（overlayImgScale）与数据回退
- Added: 关闭视觉时可下载候选图片；预览命令支持 sample 数据集
- Changed: 改用 props 传递 report 数据到 Remotion；timeline 以整数对齐
- Fixed: 逐文件音频提交与资源校验、字幕超长 token 回退、check-icons 失败熔断
- Fixed: scoped allowlists、B 站 cookie 恢复、minimax 超时、dev 重试退避
- Fixed: ingest 视觉步骤使用受限的 mcp 放行规则；SSRF 与渲染确定性加固

## 0.4.0

- Added: B 站视频上传 / 评论 / 置顶工具链，标题与标签 prompt 收紧
- Added: 校验 overlay 图片真实尺寸；mp4 导出脚本（render:video）
- Changed: rss/ 目录重命名为 ingest/，scripts/ 重组，命令职责清晰化
- Changed: video-timeline.json 成为时间线唯一数据源；发布链路加固
- Fixed: 渲染启动校验过严导致断点续传阻塞；AI 评分未转义 JSON 修复

## 0.3.0

- Added: run-all 一键流水线，带 spinner UI 并自动启动预览
- Added: RSS 自动从 feeds 插入 overlay 图片；要求 all_proxy 配置
- Changed: 评论输出改为带末尾时间戳的编号列表
- Fixed: outro 内容稳定、检测较短音频突发、navigation edgeInset 归零
- Fixed: overlay 动画在短场景下保护；评论时间戳与渲染时间线对齐

## 0.2.0

- Added: Linux.do RSS Go 工具与脚本；RSS2 支持；采集器模块化
- Added: run-all 脚本与报告 UI；story tabs 失败重试带反馈
- Added: RSS 源与兴趣画像外置为 JSONC 配置；layout 配置与 schema 重命名
- Changed: overlay 字段重命名为 overlayImg，新增 topTitle 规则

## 0.1.0

- Added: AiDailyReport 组件替代 Remotion 模板
- Added: TTS 旁白流水线与 JSON 驱动的数据层
- Added: 亮色/暗色双主题、intro/outro 生成、评论脚本
- Added: tab 图标、onboarding 文档、schema、样例数据、SVG 技能与校验脚本
- Changed: 简化并去重脚本工具模块；改善构建流水线
