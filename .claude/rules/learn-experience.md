# 经验与坑位记录

> 记录那些「静态检查通过、运行时才暴露」的坑，以及第三方库的隐式行为。
> 仅收录已通过实际运行验证的经验，不写未经验证的猜测。

---

## Remotion `interpolate()` 对输入区间有「严格单调」硬校验，短场景会让 overlay 动画直接崩渲染

- **Tags**: `#runtime` `#third-party-library` `#remotion` `#tricky-issue`
- **Trigger Context**: Remotion 4.0.475；视频里某个 scene 带有 `overlayImg`，且该 scene 时长较短（约 < 30~39 帧）；本项目 RSS 流水线会按相关性给「高分 + 含远程图」的 scene 自动配图，可能踩中这个条件。
- **Symptoms**: 渲染（Studio 预览 / `remotion render` / `remotion bundle` 后渲染帧）整段崩溃，抛出：
  ```
  inputRange must be strictly monotonically increasing but got [16,16]
  ```
  或 `[0, 16, 8.4, ...]` 这类非严格递增的区间。`tsc` 全程通过，无任何静态报错。
- **Root Cause**:
  1. `interpolate(input, inputRange, outputRange, options)` 在 `node_modules/remotion/dist/cjs/interpolate.js` 里**无条件**调用 `checkValidInputRange`，要求 `inputRange` 严格递增（`arr[i] > arr[i-1]`），不满足直接 `throw`；该校验发生在 clamp/extrapolate 短路逻辑**之前**，无法靠 `extrapolateLeft/Right: "clamp"` 绕过。
  2. overlay 动画原本按帧数推导 reveal/hide/scale 的关键帧点。scene 太短时这些点会塌缩成同一点（`hideStart === hideEnd`）或顺序错乱（`revealEnd > sceneDuration*0.42`），构造出退化/非单调区间，送进 `interpolate` 即抛错。
  3. Zod schema 只约束 `timing.durationMs` 为 `.positive()`，没有「带 overlayImg 的 scene 最小时长」下限，所以短时长 + 配图是合法数据，却会让渲染崩溃。
- **Verified Solution**（已落地于 `src/AiDailyReport.tsx`）：
  ```ts
  // 2 点区间：塌缩时直接返回边界值，绝不送退化区间给 interpolate
  const interpolateRange = (frame, start, end, from, to, options) => {
    if (start >= end) return frame >= end ? to : from;
    return interpolate(frame, [start, end], [from, to], options);
  };

  // 多点 scale：先判断完整 zoom 弧能否放下，放不下就降级成 2 点 reveal
  const getOverlayScale = (frame, revealStart, revealEnd, sceneDuration) => {
    const zoomEnd = sceneDuration * IMAGE_FOCUS_ZOOM_END;
    const returnStart = sceneDuration * IMAGE_FOCUS_RETURN_START;
    const returnEnd = sceneDuration * IMAGE_FOCUS_RETURN_END;
    const fullZoomFits =
      revealEnd < zoomEnd && zoomEnd < returnStart && returnStart < returnEnd;
    if (fullZoomFits) {
      return interpolate(frame, [revealStart, revealEnd, zoomEnd, returnStart, returnEnd], [...], opts);
    }
    if (revealStart < revealEnd) return interpolate(frame, [revealStart, revealEnd], [0.95, 1], opts);
    return 1;
  };
  ```
  并在 `src/overlay-animation.test.ts` 用曾经崩溃的时长 `1/5/10/20/30/38` 帧做回归测试。
- **Prevention Recommendations**:
  - 任何用 `interpolate` 且关键帧来自「时长 / 数量」推导的地方，都要先保证 `inputRange` 严格递增、不塌缩；默认假设输入可能退化。
  - 不要只靠 `tsc` 判断 Remotion 代码是否安全，必须实际 `remotion bundle` + 渲染帧验证（短时长、空数组、边界值）。
  - 评估是否给「带 overlay 的 scene」在 schema 层加最小帧数下限，从数据源头杜绝。

---

## 保底 Tab 摘要字数不足会让整期 data.json 生成 fatal 中止（静态检查全过、仅运行时暴露）

- **Tags**: `#runtime` `#tricky-issue` `#go` `#data-integrity`
- **Trigger Context**: ingest 流水线末步 `generateDataJSON`；当某个 Story 的标题+理由偏短（如 "GLM。更新" 仅 5 字），且模型 Tabs 不足需走 `withFallbackStoryTabs` 保底补齐时。
- **Symptoms**: `go build` / `go vet` / `go test`（除专门回归测试外）全过；实际跑 `bun run rss` 时在 `[6/6] 生成 Remotion data.json` 抛 `Story "..." 只有 1 个 Tabs，至少需要 2 个`，整期 abort、不写 data.json，本次抓取的全部成果丢失。
- **Root Cause**:
  1. `fallbackStoryTabs` 的「事件概览」保底 Tab 摘要曾是 `fmt.Sprintf("%s。%s", group.Title, group.Reason)`；标题/理由短时摘要 < `minTabSummaryRunes`(20)。
  2. `tabRejectionReason` 会丢弃 summary 不足 20 字的 Tab，于是「事件概览」被丢弃，只剩「后续观察」一个保底 Tab → `withFallbackStoryTabs` 凑不齐 `minStoryTabs`(2)。
  3. `generateDataJSON` 对 `len(group.Tabs) < minStoryTabs` 直接 `return error`（generate_datajson.go:79），main 把它当致命错误中止。
  4. 这条链是「保底机制自身的兜底不够」+「末步硬性校验」叠加，单看任何一段都合理，组合起来却让一个常见的短标题场景炸掉整期。
- **Verified Solution**（已落地于 `ingest/story_tab_text.go` + 回归测试 `ingest/story_tab_text_test.go`）：
  ```go
  // 保底摘要加最小字数兜底：标题+理由过短时拼接固定长句，保证 >= minTabSummaryRunes
  func fallbackOverviewSummary(group NewsGroup) string {
      composed := strings.TrimSpace(fmt.Sprintf("%s。%s", strings.TrimSpace(group.Title), strings.TrimSpace(group.Reason)))
      if utf8.RuneCountInString(composed) >= minTabSummaryRunes {
          return composed
      }
      if composed == "" {
          return fallbackSummaryFloor
      }
      if !strings.HasSuffix(composed, "。") {
          composed += "。"
      }
      return composed + fallbackSummaryFloor
  }
  ```
  并补 `TestFallbackOverviewSummaryMeetsMinimum` / `TestFallbackStoryTabsReachMinimumWhenShort` 锁定「短标题/理由下保底 Tab 仍凑齐 minStoryTabs」。
- **Prevention Recommendations**:
  - 任何「保底/兜底」生成的结构体，其字段必须独立满足下游所有硬性校验（字数、非空、枚举值），不能假设上游传入的标题/理由够长。
  - 流水线末步的 fatal 校验（如 `len(tabs) < min`）要确保上游有真正能达到下限的兜底，否则 fatal 会把整期数据全赔进去；评估末步是否改为「降级生成 + 警告」而非 fatal。
  - 给「字数/数量下限」类约束补针对边界输入（空、极短）的回归测试，这类问题 tsc/vet 抓不到。

---

## Windows 下 Remotion Studio 持有音频句柄时，TTS 事务「整目录重命名 audio/」撞 EPERM，重试 ~4.5s 后让整次 dev 同步 abort（~40% 间歇性 HMR 失败真凶）

- **Tags**: `#runtime` `#environment` `#windows` `#third-party-library` `#remotion` `#tricky-issue`
- **Trigger Context**: Windows（实测 Win10 19045 + Node 24.15）；`bun run dev` 已拉起 Remotion Studio 且正在播放/拖动某个 scene 音频时，用户编辑 `data.json` 触发 `bun run tts` → commit。
- **Symptoms**: dev 终端打印 `❌ 自动同步失败`，tts 非零退出，`data-generate.json` 不更新（Studio 停在旧画面）；连续 3 次后 dev 暂停自动重试，用户必须 Ctrl+C 重启。**间歇性约 40%**——取决于浏览器 HTTP Range 请求与 commit 第一步 rename 瞬间是否重叠。`tsc`/`eslint`/普通单测全过，仅运行时 + 跨进程句柄才暴露。
- **Root Cause**:
  1. 旧 `createGeneratedOutputTransaction.commit()`（`scripts/lib/generated-output.mjs`）第一步 `renameWithRetry(audioDir, backupAudioDir)` 重命名**整个 `audio/` 目录**。Windows 内核规定：**目录里含有「打开的文件句柄」时，该目录不能被重命名**。
  2. Remotion Studio 的静态服务用 `createReadStream({start,end}).pipe(res)`（`@remotion/studio-server/.../serve-static.js`）按 HTTP Range 请求服务音频，响应期间持有该 mp3 的读句柄 fd；`<Audio src={staticFile(...)}>`（`src/AiDailyReport.tsx`）对每个旁白 scene 都挂载。Studio 常驻后，任何 in-flight/backpressured Range 请求都会在 commit 瞬间持有 fd。
  3. 命中即 `EPERM`，`renameWithRetry` 按 `100×(n+1)ms` 重试 10 次（实测 ~4.5s）后仍 EPERM → throw → `generate-tts.mjs` catch → `transaction.abort()` → tts 非零退出 → dev `❌ 自动同步失败`。
- **Verified Solution**（已落地于 `scripts/lib/generated-output.mjs` + 回归测试 `scripts/lib/generated-output.test.mjs`）：
  把「整目录重命名（staging↔audio↔backup）」改成**逐文件操作**。实测（持读句柄时）：`writeFile` 覆盖 ✅、`writeFile` 新增 ✅、`unlink` 删除 ✅；只有「rename 目录」和「rename 覆盖被占用文件」会 EPERM——这两样本实现都不再做。
  ```js
  // commit 不再 rename(audio/)：逐文件写入 → 原子发布 manifest → best-effort 清孤儿
  async commit() {
    try {
      for (const [sceneId, audio] of generatedAudio) {
        await writeFile(resolve(audioDir, `${sceneId}.mp3`), audio); // 持句柄可写
      }
      if (stagedReportWritten) {
        await renameWithRetry(stagedGeneratedPath, generatedPath); // 单文件 rename，安全
      }
      const currentIds = new Set([...generatedAudio.keys(), ...reusedIds]);
      for (const entry of await readdir(audioDir).catch(() => [])) {
        if (!entry.endsWith(".mp3") || currentIds.has(entry.slice(0, -4))) continue;
        await unlink(resolve(audioDir, entry)).catch(() => {}); // 孤儿清理，失败忽略
      }
    } finally {
      await releaseLock();
    }
  }
  ```
  安全顺序：先写音频 → 再发布 manifest（Studio 仅在它 mtime 变化时 reload）→ 最后清孤儿。崩溃最坏只留下「manifest 与音频一致，或仅多出无害孤儿」；缺失/不匹配音频对 Remotion 也只 warn 不崩。回归测试 `commit succeeds while a reader holds an open handle...` 锁定契约（旧实现 4571ms 抛 EPERM，新实现 19ms 通过），并经真实 `bun run tts`（31 scene 全 reuse、不调 MiniMax）在 `data-scheme/` 上验证 data-generate.json 与修前完全一致、无残留 staging/lock。
- **Prevention Recommendations**:
  - Windows 上避免「重命名含打开文件的目录」或「rename 覆盖被占用文件」；改用 `writeFile` 原地覆盖 / `unlink`（Node 以 `FILE_SHARE_WRITE | FILE_SHARE_DELETE` 打开，持句柄可写可删）。
  - 凡是被另一个长驻进程（Studio / 编辑器 / Defender 实时扫描）会打开的资源目录，提交/发布都走「逐文件 + 单文件原子 rename 指针」，不要整目录 rename。
  - 这类「静态全过、运行时 + 跨进程句柄才暴露」的坑，必须有能「持句柄复现」的回归测试，tsc/eslint 抓不到。

---

## linux.do 抓内容/配图被 Cloudflare JS challenge 挡，误判成「网络阻断」放弃 —— 正解是 `.rss` 端点 + `all_proxy`，别用 Playwright/WebFetch

- **Tags**: `#environment` `#configuration` `#tricky-issue` `#network`
- **Trigger Context**: 用 `ai-daily-report` skill 的 RSS 补选模式（用户贴一条 `{"link": "https://linux.do/t/topic/{id}"}` 要求补进日报并配图），或任何 agent 想从 linux.do 单帖抓正文/图片时；Windows + 项目 `.env` 已配 `all_proxy=http://127.0.0.1:7890`，且 `bun run video:prepare` 本身能成功。
- **Symptoms**:
  - `curl` 访问主站网页或 `/t/topic/{id}.json`：SSL `exit 35`、超时 `exit 28`、`http code=000`，或返回 `<title>Just a moment...</title>` 的 Cloudflare challenge HTML 页（拿不到真实内容）。
  - Playwright 导航报 `net::ERR_CONNECTION_CLOSED`（前 1~2 次可能侥幸通过，同 IP 高频访问后被 CF 拒）。
  - WebFetch 报 `Unable to verify if domain linux.do is safe to fetch`。
  - 连续 2 分钟探测主站 `http=000` → 容易得出「linux.do 主站被网络阻断」的错误结论而放弃。
  - 图片下载 `exit 28` 拿到截断的坏图（如只下到 67KB，实际完整 97KB），误以为「下载路径不通」。
- **Root Cause**:
  1. linux.do（Discourse）主站网页和 `/t/topic/{id}.json` 在 Cloudflare 后，对非浏览器/可疑 UA 返回 JS challenge，curl/WebFetch 不执行 JS 过不去；Playwright 能过但同 IP 高频会被限流。**这是 CF 防护的正常行为，不是网络阻断、不是 GFW**。
  2. 关键：Discourse 的 **`/t/topic/{id}.rss` 端点不走 JS challenge**，`curl + all_proxy` 秒级返回完整 RSS XML（`<item><description>` 是 cooked HTML，含正文和 `<img>`）。项目 RSS 采集器（`ingest/`）一直靠 `.rss` + `all_proxy` 工作，这才是 `bun run video:prepare` 能成功的真相。
  3. 错误叠加：① 没走 `all_proxy`（curl/WebFetch/Playwright 都默认不走 `.env` 的代理变量，直连被挡）；② 上 Playwright 抓单帖（慢、易限流，是最后手段不是首选）；③ 把 CF 的 `http=000` 误判成「网络阻断」；④ 图片下载没加 `--retry`，首次截断就判「路径不通」。
- **Verified Solution**（实测通过，已沉淀进 `.claude/skills/ai-daily-report/rules/rss-pick-mode.md`「Linux.do 内容与图片获取」小节）：
  ```bash
  # 1) 抓正文+图：用 .rss 端点（不走 CF challenge），必须带 .env 的 all_proxy
  ALL_PROXY="$(grep -E '^all_proxy=' .env | cut -d= -f2-)" \
    curl -sL --max-time 15 -H "User-Agent: ai-daily-report-rss/1.0" \
    "https://linux.do/t/topic/{topicId}.rss"
  # 返回 RSS XML；<description> 含 cooked HTML + <img>，是真实内容不是 challenge 页

  # 2) 图 URL 拿全尺寸：optimized/.../{sha}_2_{W}x{H}.ext → original/.../{sha}.ext
  #    排除 /images/emoji/、头像、Logo、<300px 小图、细长 banner

  # 3) 下载图片：CDN 走代理 + Referer 防盗链 + 重试（首次可能截断）
  ALL_PROXY="$(grep -E '^all_proxy=' .env | cut -d= -f2-)" \
    curl -sL --max-time 25 --retry 3 \
    -H "User-Agent: ai-daily-report-rss/1.0" \
    -H "Referer: https://linux.do/t/topic/{topicId}" \
    "{imageUrl}" -o "data-scheme/images/topic-{id}-{hash8}.{ext}"
  # 下完用 file 命令校验是完整横图
  ```
  实测：`.rss` 秒级 200；CDN 图（`cdn3.ldstatic.com`）三种姿势（`all_proxy`+Referer / 直连+`-k`）都 `http=200` 完整字节；但 8 条 `.rss` 连发会触发 CF challenge，需每条间隔 4-8 秒。
- **Prevention Recommendations**:
  - **CF challenge ≠ 网络阻断**：拿到 "Just a moment" 页 / `ERR_CONNECTION_CLOSED` / `http=000` 时，先按 CF 防护排查，别下「网络阻断」结论。
  - 抓 Discourse 站（linux.do 等）内容，**优先用 `.rss` / feed 端点**，别上 Playwright 或 `.json`。
  - 复用项目已有网络姿势：抓 RSS 看 `ingest/`，下图片看 `ingest/image_assets.go` 的 `downloadVisionOverlayImage`（`all_proxy` + Referer + 重试 + 尺寸校验全做好），别从零用 Playwright 摸索。
  - 项目配了 `all_proxy` 时，所有外部站请求都要**显式带上**（curl `ALL_PROXY=`、WebFetch 默认不读 `.env`）。
  - 下载二进制资源加 `--retry`，并用 `file` 校验完整性，别把截断文件当成功产物配进 `data.json`。
