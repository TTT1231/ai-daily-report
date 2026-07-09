# 发布到 B站（投稿 + 评论 + 置顶）

> 这是 `ai-daily-report` skill 的细节文件。主线在 [`../SKILL.md`](../SKILL.md)。

把当期成片自动发到 B站，并发表 + 置顶「今日日报」评论（内容来自 `data-scheme/comments.txt`，由 `comment:generate` 从时间线生成）。

## 命令

```bash
# 从零到发布：video:auto-generate → video:render → 渲封面 → comment:generate → video:meta → bili:full（投稿→等审核→发评论→置顶）
bun run all:bili

# 数据已备好、只想发 B站：video:render → 渲封面 → comment:generate → video:meta → bili:full
bun run publish:bili
```

也可拆开单步：`video:meta`（生成标题/标签）、`bili:upload`（纯投稿，已带 `--no-comment`，只发视频不发评论/置顶，纯测试可用它发一条试稿，发完记得去创作中心删）、`bili:full`（投稿+评论+置顶 全套）、`bili:comment` / `bili:stick`（单独发评/置顶）。`publish:bili` / `all:bili` 内部都调 `bili:full`。

> `bili:full` 会**真实发布**稿件 + 评论 + 置顶到你的 B站 号（对外动作）。`bili:upload` 是纯投稿。

## 首次使用（一次性）：扫码登录

登录态存进 `biliup/cookies.json`（已 gitignore；评论/置顶也直接读它，**不进 `.env`**）。可主动跑 `bun run biliup:prepare`（下载 biliup 工具 + 登录 + 清理扫码产物），bili 命令执行时也会自动触发同一套 ensure 逻辑：

```bash
bun run biliup:prepare                              # 一键备好 biliup 工具 + 登录态
# 或手动登录：
./biliup/biliup.exe -u biliup/cookies.json login   # 用 B站 App 扫码确认
```

- **biliup 工具**由 `bun run biliup:prepare`（内部走 `download-bili-tool`）下载到 `biliup/`（跨平台、平铺结构，已 gitignore）。首次发 B站 时 bili 命令会自动触发该 ensure 逻辑；升级重跑 `bun run download-bili-tool`，会自动保留登录态。
- **凭据**：评论/置顶的 `SESSDATA` / `bili_jct` 直接从 `biliup/cookies.json` 读（`scripts/publish/bili/bili-api.mjs`），不在 `.env` 重复维护。

## 标题 / 标签

由 `video:meta` 用 LLM 生成（手机短视频风、抓重点、适度夸张），写到 `data-scheme/video-meta.json`——可手改再审。

- 标题 = `前缀【AI日报 - MM - DD】`（≤80 字，中文/字母/符号每个算 1）。
- 标签 ≤10 个。
- **固定参数**（分区 `tid 231` 计算机技术、自制、创作声明 AI 标识、封面帧、评论前等待 3 分钟过审核）在 `config/bilibili.config.json`。

## 封面（重要坑：单张 + 双比例裁切）

- `render:cover` 截主视频第 `coverFrame` 帧（默认 45，配在 `bilibili.config.json`）→ `out/cover.png`。视频是 1920×1080，所以**自动封面固定是 16:9**，`coverFrame` 只决定截哪一帧、**不改比例**。
- 投稿时 `biliup --cover` **只上传这一张**。**B站 每个视频只能传一张封面**——首页推荐按 4:3、播放页/空间按 16:9 显示，是**同一张图被平台自动裁切**，不是两个上传位，也**不能分别传两张不同的图**（平台限制，不是工具限制）。
- 因此封面标题/主体要放在**中央安全区**（1920×1080 帧在首页 4:3 位会被裁掉左右各约 240px）。

**想要非 16:9 / 自制封面**有两条手动路：
1. `bun run render:cover` 之后、`bili:upload` 之前**手动替换 `out/cover.png`**；
2. 走一键 `all:bili` 发布后，去 **B站 创作中心 → 稿件管理 → 编辑 → 修改封面** 手动重传/调裁切（那里仍是单张封面，但能换图，是 `biliup` 之外唯一的封面定制入口）。
