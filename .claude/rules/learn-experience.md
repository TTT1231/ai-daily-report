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

## RSS 补选抓 linux.do：`.rss` 端点现在也吃 Cloudflare challenge，光带 `all_proxy` 拿到的是 "Just a moment" 假页（rss-pick-mode 文档已过时）

- **Tags**: `#runtime` `#environment` `#third-party-library` `#tricky-issue`
- **Trigger Context**: Windows + bash 工具，按 `.claude/skills/ai-daily-report/rules/rss-pick-mode.md` 给用户补选 linux.do 条目、抓 `.rss` 取正文+图。`.env` 已配 `all_proxy=http://127.0.0.1:7897`、`bun run video:prepare` 自身能正常抓。
- **Symptoms**: 按文档「`ALL_PROXY=... curl ... https://linux.do/t/topic/{id}.rss`」抓，返回 **6902/6838 字节**的 HTML，`head -c` 是 `<html dir="ltr"><head><title>Just a moment...</title>`——CF JS challenge 页，不是 RSS。同条 curl 重试 3-4 次、间隔 8s **仍全是 challenge**（不是代理瞬时抖动，是方法错了）。文档却说「`.rss` 不走 JS challenge、curl+代理秒级拿到真实内容」——已与实测不符。
- **Root Cause**: linux.do 的 Cloudflare 防护现已覆盖 `.rss` 端点（不再只挡 HTML 页）。**仅带 `all_proxy` 不够**，CF 仍 challenge。项目自己的 Go 采集器能成功，是因为 `ingest/rss2.go:217-224` 对 `linux.do` 域名**额外**把整个 `LINUXDO_CF_CLEARANCE` 环境变量当 `Cookie` 头、把 `LINUXDO_USER_AGENT` 当 `User-Agent` 一起发出去（cf_clearance + 配套 UA 才过 CF）。文档作者写「proxy+`.rss` 就够」时可能是 cf_clearance 还没失效、或 CF 策略后来收紧；总之现在必须三件套齐全。
  - 附带坑：想 `set -a; . ./.env` 整体 source `.env` 会**整文件失败**——`LINUXDO_USER_AGENT=Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...` 含未转义括号 `(`，bash 把它当语法错误，连带 `$all_proxy` 也设不上（导致后续 curl 其实没走代理，直连撞到 CF 边缘节点仍返回 challenge 页，容易被误判为「代理无效」）。
- **Verified Solution**（实测：topic-2506187 / 2505571 均一次拿到 `<?xml` 真实 RSS）：
  ```bash
  # 1) 用 grep|cut 单独抽三个值，绝不整体 source .env（UA 含括号会炸）
  ap=$(grep '^all_proxy=' .env | cut -d= -f2-)
  ck=$(grep '^LINUXDO_CF_CLEARANCE=' .env | cut -d= -f2-)
  ua=$(grep '^LINUXDO_USER_AGENT=' .env | cut -d= -f2-)
  # 2) 三件套：proxy + Cookie(cf_clearance) + 浏览器 UA，少一个都拿 challenge 页
  ALL_PROXY="$ap" curl -sL --max-time 20 -H "User-Agent: $ua" -H "Cookie: $ck" \
    "https://linux.do/t/topic/{topicId}.rss" -o topic.rss
  # 判定：head -c 5 必须是 '<?xml'；是 '<html' 就是 challenge，不要当成功
  ```
  - 解析 RSS 正文+图时，Windows python 不认 Git Bash 的 `/tmp/...` 路径（FileNotFoundError）；用 `cygpath -w /tmp/x.rss` 转 Windows 路径再 `python - "$winpath"`，且 heredoc `<<'PY'` 会抢占 stdin，所以**不能** `cat file | python - <<'PY'`（会把脚本本身当数据读），要 `python - "$winpath" <<'PY'` 用 argv 传路径。
  - 提图必须看 `<img>` 的 class/尺寸：`class="site-icon"` / `width=235 height=256` 是站点 logo 弃用；`class="thumbnail"` 或正文 Markdown `![]()` 内嵌的才是内容图。只 grep cdn3 域名会把 logo 当配图。原图重写 `optimized/4X/{a}/{b}/{c}/{sha}_2_{W}x{H}.ext` → `original/4X/{a}/{b}/{c}/{sha}.ext` 恒成立（即使页面只引 optimized）。
- **Prevention Recommendations**:
  - rss-pick-mode.md 里「`.rss`+`all_proxy` 就够、不走 JS challenge」的结论已过时；抓 linux.do 一律带 `LINUXDO_CF_CLEARANCE` cookie + `LINUXDO_USER_AGENT` + `all_proxy` 三件套（与 `ingest/rss2.go` 同源），别先试光秃 curl。
  - 任何「`curl https://linux.do/...` 拿到 HTML」都要先 `head -c 5` 判 `<?xml` vs `<html`——拿到 HTML 不代表代理生效（直连也能到 CF 边缘拿 challenge 页）。
  - 永远不要 `source` 本项目 `.env`（值未加引号、UA 含括号）；按需 `grep '^VAR=' .env | cut -d= -f2-` 抽单个值。
