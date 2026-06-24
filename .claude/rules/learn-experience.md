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
