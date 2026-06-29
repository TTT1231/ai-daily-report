# Changelog

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
