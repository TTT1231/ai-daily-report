import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVideoStoryStartMs,
  STORY_TRANSITION_FRAMES,
  VIDEO_FPS,
} from "./report-builder.mjs";

// 评论时间戳必须落在播放器真实渲染 story 的那一帧。成片在相邻 story 之间插入
// STORY_TRANSITION_FRAMES 的过渡（点击音效），这些过渡帧不在 TTS 的 startMs 里。
// 若评论直接用 startMs，每条都会偏早，且越往后偏差越大（每个过渡 +0.6s @30fps）。
test("buildVideoStoryStartMs includes inter-story transition gaps so comments match the rendered video", () => {
  const report = {
    intro: { scenes: [{ timing: { durationMs: 3000 } }] }, // 90 frames
    stories: [
      { scenes: [{ timing: { durationMs: 6000 } }] }, // 180 frames
      { scenes: [{ timing: { durationMs: 6000 } }] }, // 180 frames
    ],
    outro: { scenes: [{ timing: { durationMs: 2000 } }] },
  };

  const starts = buildVideoStoryStartMs(report).map(Math.round);

  // [intro, s1, s2, outro]
  // s1 start = 90 (intro) + 18 (transition) = 108 frames -> 3600ms
  // s2 start = 108 + 180 (s1) + 18 (transition) = 306 frames -> 10200ms
  assert.deepEqual(starts, [0, 3600, 10200, 16800]);

  // 关键属性：第二个 story 的成片起始时间，比 TTS startMs（无过渡）晚
  // 恰好 2 个过渡帧 = 2 * STORY_TRANSITION_FRAMES / VIDEO_FPS 秒。
  const naiveStartMs = 3000 + 6000; // intro + s1，无过渡
  const transitionDriftMs =
    (2 * STORY_TRANSITION_FRAMES * 1000) / VIDEO_FPS; // 1200ms
  assert.equal(starts[2], naiveStartMs + transitionDriftMs);
});
