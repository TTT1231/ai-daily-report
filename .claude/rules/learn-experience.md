# 经验与坑位记录

> 记录那些「静态检查通过、运行时才暴露」的坑，以及第三方库的隐式行为。
> 仅收录已通过实际运行验证的经验，不写未经验证的猜测。

---

## Remotion `interpolate()` 对输入区间有「严格单调」硬校验，短场景会让 overlay 动画直接崩渲染

- **Tags**: `#runtime` `#third-party-library` `#remotion` `#tricky-issue`
- **Trigger Context**: Remotion 4.0.475；视频里某个 scene 带有 `overlayImg`，且该 scene 时长较短（约 < 30~39 帧）；本项目 RSS 流水线会按相关性给「高分 + 正文较短」的 scene 自动配图，正好踩中这个条件。
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
