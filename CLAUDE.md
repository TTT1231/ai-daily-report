# CLAUDE

## 项目目录

```
ai-daily-report/
├── src/                                 # Remotion 视频组件源码
│   ├── index.ts                         # 入口文件，注册 RemotionRoot
│   ├── Root.tsx                         # Composition 定义（1920×1080, 30fps）
│   ├── AiDailyReport.tsx                # 主组件：时间轴驱动的故事渲染器
│   ├── daily-report-data.ts             # Zod schema 定义 + JSON 数据解析与类型导出
│   ├── layout-config.ts                 # 项目级布局常量与查表，集中原本散落在组件里的魔法数字
│   ├── navigation-layout.ts             # 导航栏排版：字号/列宽/容量规则，读 config/video-layout.json
│   ├── tab-layout-preview-fixture.ts    # TabLayoutPreview 预览组件用的示例数据（仅调试用，非生产渲染）
│   ├── index.css                        # Tailwind CSS 入口
│   └── sound/
│       └── click-sound.mp3              # Story 切换音效
├── data-scheme/                         # 当前日报数据包（Remotion publicDir 指向此处）
│   ├── data.json                        # Raw 数据：标题、Tabs、字幕与图片引用（可由 ingest/ 生成）
│   ├── data-generate.json               # Generated 数据：TTS 派生的音频、时间线和缓存元数据（勿手改）
│   ├── video-meta.json                  # LLM 生成的视频标题+标签（投稿元数据，与平台无关）
│   ├── comments.txt                     # 从时间线生成的 B 站风格跳转评论
│   ├── images/                          # Scene overlayImg 图片素材
│   ├── icons/                           # Tabs 图标素材（由 generate-svg 技能产出）
│   └── audio/                           # TTS 生成的音频
├── config/                              # 项目级配置与 Schema（被 src / ingest / scripts 三侧引用）
│   ├── data.schema.json                 # Raw + Generated 共用的 JSON Schema（data.json 的 $schema）
│   ├── video-layout.json                # 人工维护的项目级固定布局配置，不随每次日报或视频生成变化
│   ├── video-layout.schema.json         # video-layout.json 的字段说明、取值范围与编辑器提示
│   ├── video-timeline.json              # 视频时间线常量（fps / story 间过渡帧），渲染侧与评论侧同源读取的单一事实源
│   ├── video-timeline.schema.json       # video-timeline.json 的字段说明与校验
│   └── bilibili.config.json             # B 站投稿固定配置：分区 tid / 自制 / 创作声明 / 封面帧 / 评论前等待
├── demo/                                # 演示素材、示例数据与可视化导览
│   ├── data-scheme-sample-1/            # 完整示例，含 TTS 音频；bun run preview
│   ├── data-scheme-sample-2/            # 无 TTS 示例；bun run preview:notts
│   ├── overview.html                    # 可视化导览（给用户看）
│   ├── demo-light.png                   # 亮色主题演示截图
│   ├── demo-dark.png                    # 暗色主题演示截图
│   └── demo-video.mp4                   # 完整视频演示
├── scripts/
│   ├── checks/                          # 数据与资源校验
│   │   ├── check-data-json.mjs          # 数据校验脚本（Raw 内容 / Generated 渲染就绪）
│   │   └── check-icons.mjs              # Generated 数据的图标资源校验
│   ├── render/                          # 视频生成与预览入口
│   │   ├── generate-tts.mjs             # TTS 编排入口：组织构建、合成、校验和提交
│   │   ├── generate-svg.mjs             # generate-svg 的 npm 入口 wrapper，allowlist 与自动流程同源
│   │   ├── dev.mjs                      # 开发监听入口：自动跑 TTS 并拉起 Remotion Studio
│   │   └── prepare-video.mjs            # video:prepare 编排：archive:rotate→rss→check-data-json→tts→generate-svg（不再自动开预览）
│   ├── archive/                         # 归档与重置
│   │   ├── archive.mjs                  # 按完整日期归档当前日报数据包
│   │   ├── archive-rotate.mjs           # archive:rotate 命令：抓取 RSS 前的归档轮转
│   │   └── reset.mjs                    # 清空 data-scheme/ 后用于完全重建
│   ├── rss-pick/                        # RSS 快照人工补选工具链
│   │   ├── build-rss-state-html.mjs     # 把 rss-state.json 渲染成按 sourceId 分类的 HTML 挑选页并打开浏览器
│   │   └── template.html                # 挑选页固定模板（CSS/JS 内联，脚本只注入运行期数据）
│   ├── publish/bili/                    # B 站发布工具链
│   │   ├── generate-comment.mjs         # 从时间线数据生成 B 站风格跳转评论 → data-scheme/comments.txt
│   │   ├── download-bili.mjs            # 下载/更新 biliup-rs（按需触发，保留登录态）
│   │   ├── ensure-biliup.mjs            # bili 命令前按需补齐 biliup：缺 exe 下载、缺登录态扫码
│   │   ├── biliup-prepare.mjs           # biliup:prepare 显式入口（换机器/重装后主动备齐工具）
│   │   ├── bili-upload.mjs              # bili:upload（纯投稿）/ bili:full（投稿+评论+置顶）（调 biliup + bili-api）
│   │   ├── bili-comment.mjs / bili-stick.mjs  # 单独 发评论 / 置顶
│   │   └── bili-api.mjs                 # B 站 评论/置顶 web API（凭据从 biliup/cookies.json 读，不走 .env）
│   └── lib/                             # 多个入口脚本共享的内部模块，不直接执行
│       ├── paths.mjs                    # 集中路径定义与 JSON 读取（rootDir 锚定，与入口目录深度无关）
│       ├── report-validation.mjs        # JSON Schema 与跨字段业务校验
│       ├── report-builder.mjs           # 构建 Intro / Outro、主题与图标恢复
│       ├── minimax-tts.mjs              # MiniMax TTS API 客户端
│       ├── generated-output.mjs         # 音频与 Generated JSON 事务提交与恢复
│       ├── tts-timeline.mjs             # TTS 时间线计算（startMs 累计 / 尾部留白 / Header 宽度）
│       ├── navigation-layout.mjs        # 导航栏容量与排版规则（Tabs 卡片网格尺寸查表）
│       ├── claude-allowlist.mjs         # generate-svg 的 claude 权限 allowlist 单一数据源
│       ├── generate-svg-preflight.mjs   # generate-svg 前置检查
│       ├── image-dims.mjs               # 按图片真实像素写入 overlayImgWidth/Height
│       ├── video-meta.mjs               # LLM 生成视频标题+标签 → data-scheme/video-meta.json（投稿元数据，与平台无关）
│       ├── icon-validation.mjs          # 图标资源校验逻辑
│       ├── asset-check.mjs              # 资源存在性校验
│       ├── audio-quality.mjs            # 音频质量检查
│       ├── biliup-readiness.mjs         # biliup 就绪判定纯函数（要不要下载/登录）
│       ├── prune-assets.mjs             # 清理无用资源
│       ├── process-tree.mjs             # 进程树管理
│       ├── step-outcome.mjs             # 步骤结果抽象（统一成功/失败语义）
│       ├── video-layout-validation.mjs  # video-layout.json 校验
│       ├── video-timeline-validation.mjs# video-timeline.json 校验
│       └── __test__/                    # lib 单测（bun run test:lib）
├── ingest/                              # Go 编写的多来源 RSS 采集器（package main，单模块）
│   ├── main.go                          # 入口：加载配置→抓取去重→模型评分→聚类→编排查卷 Tabs→写 data.json
│   ├── config.go                        # 运行时 AppConfig 组装（AI/Sources/Preferences/Lookback/StatePath）
│   ├── env.go                           # .env 读取与环境变量解析
│   ├── sources.go / sources.jsonc       # 人工维护：RSS 来源、启用状态和分页参数
│   ├── preferences.go / preferences.jsonc # 人工维护：重点实体、兴趣信号、不喜欢内容和筛选阈值
│   ├── rss2.go                          # RSS 2.0 解析；rss2_clean_text.go 清洗正文 HTML
│   ├── linuxdo_adapter.go               # LinuxDo 论坛（Discourse）适配
│   ├── linuxdo-rss.exe                  # 编译产物（已 gitignore，勿提交）
│   ├── vision.go                        # 视觉模型抽图：匹配 onebox 预览卡片取站点 icon / 外链缩略图
│   ├── model.go                         # OpenAI 兼容 chat/completions 客户端
│   ├── prompts.go                       # 评分 / 聚类 / 标题 等提示词
│   ├── ranking.go                       # 模型评分 + 关键词保底规则合并排序截断
│   ├── grouping.go                      # 聚类去重为 Story（含要点与来源序号，受导航容量上限约束）
│   ├── story_merge.go                   # 同 Topic 跨来源合并
│   ├── story_tabs.go / story_tab_text.go# 单 Story 内编排 Tabs 与文案
│   ├── image_assets.go / manual_images.go # 图片资源处理（自动抓取 + 人工补图）
│   ├── navigation_layout.go             # Story/Tabs 容量与导航排版（与 config/video-layout.json 同源规则）
│   ├── generate_datajson.go             # 组装并写出 data.json（带内容哈希）
│   ├── atomicfile.go                    # 原子写文件
│   ├── output.go                        # 终端报告输出（readme.html/rss-state.html 生成）
│   ├── state.go / rss-state.json        # 自动生成：最近抓取快照，可供补选，不要人工修改
│   ├── ssrf.go / vpnproxy.go            # SSRF 防护 / 代理（all_proxy）抓取
│   ├── text.go                          # 文本工具
│   ├── types.go / jsonc.go              # 类型定义 / JSONC（带注释 JSON）解析
│   └── *_test.go                        # 各模块测试（bun run rss:test 即 go -C ingest test ./...）
├── biliup/                              # biliup-rs 工具 + 登录态 cookies.json（按需下载，已 gitignore）
├── daily-dates/                         # archive.mjs 按日期归档的历史日报数据包
├── docs/                                # 架构文档与可视化说明（architecture.html 等）
├── .agents/skills/                      # 项目级 Skill 定义（generate-svg / remotion-best-practices 等）
├── .vscode/                             # 编辑器配置
├── remotion.config.ts                   # Remotion 配置（JPEG、publicDir、Tailwind）
└── package.json                         # 脚本入口（rss / tts / generate-svg / video:prepare / bili:* 等）
```

## 测试

按改动范围选用命令，避免无谓跑重型测试（本地手动判断；CI 详见 `.github/workflows/test.yml`）：

| 命令 | 覆盖 | 耗时 | 本地触发条件 |
|---|---|---|---|
| `bun run test:lib` / `test:unit` | scripts/lib 单测 + 纯 JS 逻辑单测 | 秒级 | 改了对应模块 |
| `bun run test:integration` | JS 集成（数据/TTS/校验），**不含渲染** | 秒级 | 改了 `scripts/`、`config/*.json`、数据校验逻辑 |
| `bun run test:render` | Remotion 渲染冒烟（每帧 spawn Chromium） | ~1.5min | 改了 `src/`（Remotion 组件）/ `remotion.config.ts` / `config/video-layout.json` / `config/video-timeline.json` |
| `bun run test:e2e` | 全链路：data.json→TTS→data-generate.json→remotion still（mock TTS） | ~27s | 改了 `scripts/render/generate-tts.mjs`、`scripts/lib/{report-builder,tts-timeline,generated-output,report-validation}.mjs`、或 `src/` |
| `bun run rss:test` | Go ingest 模块（`go -C ingest test ./...`） | 秒级 | 改了 `ingest/` |

> 注意：`test:e2e` 起点是 fixture JSON，**不跑 ingest**；RSS/Go 改动跑 `rss:test`，别错跑 e2e。
> CI（公开仓库，Actions 免费无限额）跑 `test:unit` + `test:integration` + `test:render` + go test；e2e 仅本地手动跑。

