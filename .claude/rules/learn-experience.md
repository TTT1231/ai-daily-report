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
  - **第二次踩同一坑（`scripts/archive/archive.mjs`，2026-07-09 验证）**：整目录 `renameSync(data-scheme/, daily-dates/{date})` 归档时，VS Code 文件监视器持有 `data-scheme/` 内文件句柄 → EPERM，与 Studio 持 audio/ 句柄是同一机理。修复采用 `try rename → catch EPERM/EACCES/EBUSY → cpSync(recursive) + rmSync(force)` 兜底。**附带更隐蔽的坑**：`cpSync(src, dst, {recursive:true})` 在 `dst` 已存在时会**合并进旧目录而非报错**——所以「整目录搬移」前必须先 `existsSync(dst)` 栅栏（目标已存在就中止/改名），否则同日期重复归档会把新内容并进旧目录、无声覆盖。归档脚本据此加了 `resolveArchiveName`（同日期加 `-01` 序号，沿用既有 `data-scheme-{date}-01` 约定）+ move 前 `existsSync` 安全栅栏。结论：不只是 audio/，任何被常驻进程触碰的资源目录做「整目录 rename 归档/提交」都会中招，且 cpSync 兜底本身要防「目标已存在被合并」。

---

## linux.do 抓取必须 cf_clearance + UA + proxy 三件套；且 clearance 会过期、强绑 UA（只换一个 → 403；"Just a moment" 假页 / 403 两种失败都见过）

- **Tags**: `#runtime` `#environment` `#third-party-library` `#tricky-issue` `#ingest`
- **Trigger Context**: 任何经 `ingest/rss2.go` 抓 linux.do 的入口——ingest 自动抓栏目 feed（`bun run rss` / `bun run video:half-auto` 抓 `https://linux.do/c/news/34.rss`），或按 `.claude/skills/ai-daily-report/rules/rss-pick-mode.md` 补选单条 topic（`.rss`）。`.env` 已配 `all_proxy` + `LINUXDO_CF_CLEARANCE` + `LINUXDO_USER_AGENT`，且「之前更新 cf_clearance 能跑通」，现在突然不行。
- **Symptoms**: 两种失败，状态码不同，排查前先分清：
  - **`200` + "Just a moment..." HTML**（~6.8KB）：CF 放行了连接、要求跑 JS challenge——通常是**根本没带 cookie**（如光秃 curl / 文档过时只带 proxy）。
  - **`403` + "Just a moment..." HTML**（~7.1KB）：带了 `cf_clearance`，但 **CF 不认这张票**（过期 / 出口 IP 变 / UA 不配）。`bun run rss` 表现为 `来源 linuxdo-news 抓取失败：第 1 页: HTTP 状态码: 403`。
  - 关键判读法：带 cookie 和不带 cookie 各 curl 一次——**两次反应完全一样（都 403）= clearance 完全不被认**（过期/IP/UA 不配）；带 cookie 能 200、不带 403 = cookie 有效。
- **Root Cause**:
  1. linux.do 全站在 Cloudflare 后，`.rss` 端点也吃 CF 防护。**仅带 `all_proxy` 不够**，CF 仍 challenge。`ingest/rss2.go:217-225` 对 `linux.do` 域名**额外**把整个 `LINUXDO_CF_CLEARANCE` 当 `Cookie` 头、把 `LINUXDO_USER_AGENT` 当 `User-Agent` 一起发——三件套（proxy + cf_clearance + 配套 UA）齐全才过。
  2. **cf_clearance 是「带指纹的消耗品」**：CF 签发时把 {出口 IP, User-Agent, 设备指纹} 钉死在票里，之后**任一项**对不上就作废 → 403。linux.do 的票 TTL 通常只有**几小时**，过期是常态，不是 bug；「之前能跑、现在 403」多半就是过期了。
  3. **只换 cf_clearance、不换 UA = 高频坑**：UA 强绑。用户曾把 `.env` 的 UA 留成陈旧假值 `Chrome/150.0.0.0`（2026-08 Chrome 稳定版约 140，这版本号不存在），换 clearance 时没同步换 UA → 新 clearance 配旧 UA → 403。两个值**必须来自同一次浏览器会话**。
  4. **clash 节点漂移**：clash 是规则代理，按域名分流；若 linux.do 走 `auto` / `url-test` 节点组，浏览器取票时走节点 A、Go 请求时被分到节点 B，出口 IP 不一样 → 即使 cf_clearance + UA 都对也 403。
  - 附带坑：`set -a; . ./.env` 整体 source 会**整文件失败**——`LINUXDO_USER_AGENT=Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...` 含未转义括号 `(`，bash 把它当语法错误，连带 `$all_proxy` 也设不上（后续 curl 其实没走代理，直连撞 CF 边缘仍返回 challenge 页，易被误判「代理无效」）。
- **Verified Solution**（实测：ingest 栏目 feed 403 → 同会话重取 cf_clearance + UA 一起换 → 200 + `<?xml`；补选 topic-2506187 / 2505577 同样一次拿到）：
  ```bash
  # 0) 诊断：带 vs 不带 cookie，反应是否一致（都 403 = clearance 不被认）
  ap=$(grep '^all_proxy=' .env | cut -d= -f2-)
  ck=$(grep '^LINUXDO_CF_CLEARANCE=' .env | cut -d= -f2-)
  ua=$(grep '^LINUXDO_USER_AGENT=' .env | cut -d= -f2-)
  ALL_PROXY="$ap" curl -s -o /tmp/a -w "with-cookie: HTTP %{http_code}\n" --max-time 25 \
    -H "User-Agent: $ua" -H "Cookie: $ck" "https://linux.do/c/news/34.rss"
  ALL_PROXY="$ap" curl -s -o /tmp/b -w "no-cookie:    HTTP %{http_code}\n" --max-time 25 \
    -H "User-Agent: $ua" "https://linux.do/c/news/34.rss"
  # 1) 浏览器挂 clash 访问 .rss 过 CF → F12 Cookies 复制 cf_clearance（写 cf_clearance=<值>）
  #    → 同一浏览器 Console 跑 navigator.userAgent 复制完整串 → 两个值一起写进 .env
  # 2) 更新后立刻自测，别拿 bun run rss 当校验器：
  ALL_PROXY="$ap" curl -s -o /tmp/t.rss -w "HTTP %{http_code}, %{size_download} bytes\n" --max-time 25 \
    -H "User-Agent: $ua" -H "Cookie: $ck" "https://linux.do/c/news/34.rss"
  head -c 5 /tmp/t.rss   # 必须 '<?xml'；'<html' 就是还没好
  ```
  - 解析 RSS 正文+图时，Windows python 不认 Git Bash 的 `/tmp/...` 路径（FileNotFoundError）；用 `cygpath -w /tmp/x.rss` 转 Windows 路径再 `python - "$winpath"`，且 heredoc `<<'PY'` 会抢占 stdin，所以**不能** `cat file | python - <<'PY'`（会把脚本本身当数据读），要 `python - "$winpath" <<'PY'` 用 argv 传路径。
  - 提图必须看 `<img>` 的 class/尺寸：`class="site-icon"` / `width=235 height=256` 是站点 logo 弃用；`class="thumbnail"` 或正文 Markdown `![]()` 内嵌的才是内容图。只 grep cdn3 域名会把 logo 当配图。原图重写 `optimized/4X/{a}/{b}/{c}/{sha}_2_{W}x{H}.ext` → `original/4X/{a}/{b}/{c}/{sha}.ext` 恒成立。
- **Prevention Recommendations**:
  - rss-pick-mode.md 里「`.rss`+`all_proxy` 就够、不走 JS challenge」的结论已过时；抓 linux.do 一律带 cf_clearance + UA + proxy 三件套（与 `ingest/rss2.go` 同源），别先试光秃 curl。
  - **cf_clearance 是消耗品**：几小时过期是常态，定期重取即可，别当成代码 bug 排查。
  - **更新 cf_clearance 时必须同时更新 UA**，两者来自同一次浏览器会话（`navigator.userAgent`）；别留陈旧假 UA（如不存在的 `Chrome/150`）。改完先 curl 自测（看 `HTTP %{http_code}` + `head -c 5`），`200`+`<?xml` 再跑 `bun run rss`。
  - **403 vs 200+challenge 先分清再动手**：403 = clearance 无效（过期/IP/UA 不配）；200+challenge HTML = 没带 cookie。带 vs 不带 cookie 各 curl 一次即可区分。
  - **clash 用固定节点**访问 linux.do，别用 `auto` / `url-test` / 负载均衡组——节点漂移致出口 IP 变 → clearance 作废。
  - 任何「`curl https://linux.do/...` 拿到 HTML」都先 `head -c 5` 判 `<?xml` vs `<html`；拿到 HTML 不代表代理生效（直连也能到 CF 边缘拿 challenge 页）。
  - 永远不要 `source` 本项目 `.env`（值未加引号、UA 含括号）；按需 `grep '^VAR=' .env | cut -d= -f2-` 抽单个值。

---

## 手动/少量 story 共用 `topTitle` 会让 `tts` 在生成完音频后抛 `intro.tabs < 2`，失败事务回滚导致**重跑再花一次 MiniMax**

- **Tags**: `#runtime` `#data-integrity` `#tricky-issue` `#cost`
- **Trigger Context**: 手动模式或任何「整期 story 数量少 / `topTitle` 去重后 < 2」的 data.json（典型：本期只有 2 条新闻，图省事让它们共用同一个 `topTitle` 想合并顶部导航）。`bun run check-data-json`（raw）先过，再跑 `bun run tts`。
- **Symptoms**: `check-data-json` 报 `raw content is valid: N stories` 通过；`tts` 先把 intro / 各 scene / outro 的旁白**全部合成完**（终端逐行打印 `generated XXXXms`），随后在落盘前的 generated 态校验抛错并整段回滚：
  ```
  Error: Generated report is invalid:
  - intro.tabs: must NOT have fewer than 2 items
      at scripts/render/generate-tts.mjs:258
  ```
  事务 abort → 本次合成的音频**没提交**（不进缓存）；改对 data.json 后重跑 `tts`，日志显示 `generated 4, reused 0`——**MiniMax 被重复计费**。`tsc`/`eslint`/`check-data-json` 全程不报，仅 tts 运行时暴露。
- **Root Cause**: `scripts/lib/report-builder.mjs` 的 `buildIntro`（:53-68）把 stories **按 `topTitle` 分组**，每组生成一张 intro 卡片（`intro-group-N`）；而 `data.schema.json` 的 `intro.tabs` 硬性 `minItems: 2`。两条 story 共用一个 `topTitle` → 只分出 1 组 → 1 张 intro 卡 → 违反 minItems 2。`topTitle` 在本项目一身二职：既决定**顶部导航的合并**（相邻同名合并成一段），又作为 **intro 概览的分组键**——为省导航宽度而共用，会默默把 intro 压成单卡。raw 校验不构建 intro，抓不到这层耦合；只有 tts 构建出 generated 态后才暴露。
- **Verified Solution**（实测：把两条 story 的 `topTitle` 从共用的「额度动态」改成各自的「OpenAI」/「Anthropic」后，重跑 `tts` 一次通过，`generated 4` 全成功落盘）：
  ```jsonc
  // 错（共用 topTitle）：intro 只有 1 组 → tts 报 intro.tabs < 2
  { "id": "a", "topTitle": "额度动态", ... },
  { "id": "b", "topTitle": "额度动态", ... }
  // 对（≥2 个不同 topTitle）：intro 有 2 组 → 过
  { "id": "a", "topTitle": "OpenAI",    ... },
  { "id": "b", "topTitle": "Anthropic", ... }
  ```
  分公司/分栏目命名反而更贴合「快报」语义；导航宽度仍宽松（实测 511/1920px）。若本期确只有 1 个栏目、又不想造第 2 个 topTitle，那本期的 intro 概览结构天然凑不齐 2 卡——这是 data.schema 的硬约束，别硬绕。
- **Prevention Recommendations**:
  - 跑 `tts` 前先保证整期 stories 的**去重 `topTitle` 数 ≥ 2**；「raw `check-data-json` 通过」**不等于**「tts 会通过」——intro 由构建期派生，raw 校验不构建它。
  - 这条「生成完音频才在落盘前校验、失败即回滚」的事务语义意味着：第一次 tts 因结构错失败 = 白花一次 MiniMax。结构没把握时，先确保 data.json 满足 intro 的隐含约束（≥2 个不同 topTitle）再调 tts，别拿 tts 当校验器试错。
  - 任何「共用 topTitle 想合并导航」的优化，都要同时检查它是否把 intro 分组数也压到了 < 2。

---

## `generate-svg` 一次性批量生成 ≥10 个图标时，子进程 Claude 的单段 JSON payload 极易转义/规范崩，脚本「全有或全无」导致零落盘（重试不保证成功）

- **Tags**: `#runtime` `#third-party-library` `#tricky-issue` `#tooling`
- **Trigger Context**: 一次新增多条 story（如手动补 3 条 story + 新 topTitle 触发 intro 多一组），导致 `bun run generate-svg` 需要一次性补 ≥10 个缺失图标（含 intro 卡片）。
- **Symptoms**: `bun run generate-svg` 非零退出，每次失败原因不同且随机：
  - `Claude did not return valid generate-svg JSON: Expected ',' or '}' after property value in JSON at position NNNN`（SVG 字符串里某个 `"` 漏转义成 `\"`，整段 JSON 废）。
  - `icons/<path>.svg SVG must not contain <text>` / `must have viewBox="0 0 96 96"` / 超 `MAX_SVG_BYTES`（个别 SVG 违反 `validateSvgString` 的硬禁令）。
  失败时 **一个图标都不落盘**（脚本零增量）。`tsc`/`check-data-json` 全程不报，仅 `generate-svg` 运行时暴露。
- **Root Cause**:
  1. `scripts/render/generate-svg.mjs` 把**所有**缺失图标（`buildGenerateSvgTargetPlan` 无数量上限）塞进**一个** prompt，让子进程 Claude 在单次响应里产出全部 SVG。
  2. 每个 SVG 是含大量 `"` / `<` / `>` 的 XML 字符串，放进 JSON 字符串须把内层 `"` 转义成 `\"`；批量 10+ 个累积到几 KB 后，LLM 漏转义是概率事件（实测 ~10 个时单次全合规概率约 30%）。
  3. `parseGenerateSvgPayload`（`scripts/lib/generate-svg-payload.mjs`）用整体 `JSON.parse`，**零容错**——一处坏则全废。
  4. `validatePayloadIcons` 要求 payload 必须包含**全部**期望 path（`missing` 任何一个就 throw），且 `applyGenerateSvgPayload`（写盘）在 validate 之后——所以**部分合规也无法部分落盘**，是"全有或全无"。
  5. 脚本无分批参数、无内部重试；`--force` 只切换"重生全部 vs 仅缺失"，不降批量。重跑靠的是 LLM 输出随机性，不保证收敛。
- **Verified Solution**（实测：手写 SVG 兜底后 `bun run check-icons` 33/33 通过、`check-data-json:render` render-ready）：
  - 不反复赌子进程。直接按 `.agents/skills/generate-svg/rules/{design,semantics,theme}.md` 规范**手写 SVG 文件**落盘到 `data-scheme/icons/`，文件名遵循 `defaultIconPathForTab`（`scripts/lib/icon-validation.mjs`）：普通 story = `icons/{storyId}-{tabId}.svg`，**intro 特殊 = `icons/{tabId}.svg`**（tabId 以 `intro-` 开头，如 `intro-group-3.svg`）。
  - 手写 SVG 必须满足 `validateSvgString` 全部 **fail 级**硬约束（`check-icons` 跑的是 `icon-validation.mjs`，与之几乎同源）：`viewBox="0 0 96 96"`、`xmlns="http://www.w3.org/2000/svg"`、禁 `<style>`/`<script>`、禁全幅背景 `<rect width="96" height="96">`；`<text>` 在 check-icons 里只是 warn 但在 generate-svg payload 校验里是 fail，**一律避开**（用 path/形状画文字，如 `$` = S 曲线 + 竖线）；主体落在 12-84、`<2048` 字节。light 主题用中深饱和色（深蓝/teal/琥珀/coral/magenta/violet），白只作小高光。
  - **icon 字段两条来路**（`scripts/lib/report-builder.mjs`）：story tab icon 由 raw `data.json` 深拷贝透传；intro tab icon 由 `restoreIcons` 从**旧 data-generate.json** 按 `storyId:tabId` 恢复。因此：① 给 story tab 加 icon → 改 raw `data.json` 后**重跑 `bun run tts`**（缓存复用、免费）即自动透传到 generated；② **intro 新增的 tab（如新 topTitle 产生的 `intro-group-N`）旧 generated 没记录 → restoreIcons 拿不到 → 必须手动写进 data-generate.json，且要在 tts 之后**（否则被重建覆盖）；手写一次后它成为新 previousReport，以后 tts 自动恢复。
  - 验证：`bun run check-icons`（icon 文件存在 + SVG 合规）+ `bun run check-data-json:render`（generated 可渲染）。
- **Prevention Recommendations**:
  - 别对 `generate-svg` 反复重试赌运气——批量 ≥10 时单次成功率低且失败=零落盘；直接手写兜底更确定，且不烧子进程 Claude 额度。
  - 手写兜底前先量图标是否真需要 11 个：`buildGenerateSvgTargetPlan` 会把所有缺失（含 intro 新组）算进去，`bun run check-icons` 的输出列清缺哪些 tab。
  - 长期更优解（未实施）：给 `generate-svg.mjs` 加分批参数（如每批 ≤4 个 icon，逐批请求 + 增量落盘 + 容错跳过坏 icon），把"全有或全无"改成"增量 + 重试单条"；评估后可提改进。
  - 任何「新 topTitle」改动都会让 intro 多一组卡片、多一个需配 icon 的 intro tab，规划图标时要把这个 intro tab 一并算上（它走 `icons/{tabId}.svg` 命名，不在 raw data.json）。

## IAB（ZCode 内置浏览器）截图采集证据图的三连坑

- **Tags**: `#runtime` `#third-party-library` `#tricky-issue` `#environment`
- **Trigger Context**: Windows + ZCode IAB（browser-use:control-browser），用 `tab.screenshot()` 采集新闻证据截图（1920x1080 视口）
- **Symptoms**:
  1. `tab.screenshot()` 间歇性抛 `browser screenshot activity capture failed for guest`（同一页面同一调用模式，时而成功时而失败）。
  2. `tab.screenshot({clip})` 按元素坐标裁剪截图直接失败（本环境 guest 不支持该路径）。
  3. 同一页面多次加载返回**完全相同的 PNG 字节数**，极易误诊为"返回了陈旧缓存帧"。
- **Root Cause**:
  1. guest 截图通道需要"预热"：新内核里 `tabs.get()` 后立刻截图易失败，先做几次只读交互（`title()`、`evaluate(readyState)`）+ 600ms 间隔再截，成功率显著提高。
  2. clip 截图在 IAB guest 上未实现/不稳定，报同样的 activity capture 失败。
  3. PNG 编码是确定性的：同一页面相同渲染 → 字节级相同的 PNG；同 tab 重复加载字节数恒等（跨新 tab 会差几十~几百字节，广告/字体变体）。字节相等 ≠ 缓存陈旧。
- **Verified Solution**:
  ```js
  // 1) 预热 + 重试截图（已验证可产出有效帧）
  async function warmShot(tab) {
    for (let i = 0; i < 4; i++) {
      await tab.title().catch(() => {});
      await tab.playwright.evaluate(() => document.readyState).catch(() => {});
      await tab.playwright.waitForTimeout(600);
      try {
        const b = await tab.screenshot();       // 整屏截图，不用 clip
        if (b.length > 100_000) return b;       // 空白页字节数下限校验
      } catch {}
    }
    throw new Error("screenshot unavailable");
  }
  // 2) 页面身份在同一调用内用 title + DOM 几何双重确认（getBoundingClientRect 的 h1 坐标），
  //    不要靠字节数判断帧新旧。
  // 3) 裁剪交给本地 ffmpeg：ffmpeg -i full.png -vf "crop=W:H:X:Y" out.png
  ```
- **Prevention Recommendations**:
  - 证据截图一律"整屏截取 + 字节数下限 + 同调用内 title/DOM 校验 + 本地 ffmpeg 裁剪到标题+导语区域"。
  - 判定页面身份看 DOM 几何/文本，不看 PNG 字节数；字节恒等是确定性编码的正常现象。
  - `goto` 后 `waitForLoadState` 可能在旧文档上提前返回：必须轮询 `title()` 出现目标关键字再等待 settle（1200ms+），否则会拍到上一个页面。

## IAB 截图"低密度渲染"——用户肉眼看糊、视觉模型却判锐利（续前条）

- **Tags**: `#runtime` `#third-party-library` `#tricky-issue` `#environment`
- **Trigger Context**: 同一 IAB 截图问题更深一层的根因：用户反馈"浏览器里打开页面清晰，但截出的 PNG 模糊"
- **Symptoms**:
  1. IAB 截出的 PNG 尺寸正确（如 1920x1080）但内容发虚——guest 以低于视口的光栅密度渲染后放大输出。
  2. 视觉模型（analyze_image）会判其"锐利清晰"，不可信；用户肉眼才是真相。
  3. 无头 Chrome 直采（--headless=new --force-device-scale-factor=2）在新闻站基本不可用：CNBC 弹直播页、IT之家重定向首页、Phoronix 人机验证墙。
- **Root Cause**: IAB 内嵌 guest 的有效渲染分辨率低于声明的 CSS 视口；量化证据：对截图做"高斯模糊前后差异能量"（ffmpeg avgblur+blend difference 的 YAVG），IAB 采集为 3.06-3.27，同项目 agent-browser（真 Chrome）采集的验收图为 3.64-4.26——软了 10-39%。
- **Verified Solution**:
  1. 用 **agent-browser（真 Chrome via CDP）** 采集：`agent-browser set viewport 1920 1080 2` 开 2x 视网膜 → 截图为 3840x2160 真实像素密度，实测高频能量 4.7-7.6（全项目最锐）。
  2. Phoronix 等有 Cloudflare 墙的站点：真 Chrome 打开后验证页会**自动通过**（等 10-30 秒再 `get title` 确认），不要用 networkidle 等待（广告页永远等不到，命令会挂死）。
  3. 裁剪只留文章栏（按 h1/正文 getBoundingClientRect × 2 坐标），文字填满卡片。
- **Prevention Recommendations**:
  - 证据图采集一律走 agent-browser 2x，不走 IAB 截图；IAB 仅用于读 DOM/文本。
  - 判断"糊不糊"用 ffmpeg 高频能量量化对比，不信视觉模型的主观"锐利"结论。
  - `agent-browser eval "JSON.stringify({...getBoundingClientRect()})"` 拿坐标，配合本地 ffmpeg crop，别用截图工具自带的 clip。
