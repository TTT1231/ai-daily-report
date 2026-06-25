# Changelog

## Unreleased

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
