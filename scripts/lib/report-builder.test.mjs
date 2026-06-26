import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {
  buildGeneratedReport,
  buildVideoStoryStartMs,
  STORY_TRANSITION_FRAMES,
  VIDEO_FPS,
} from "./report-builder.mjs";
import {readImageDimensions} from "./image-dims.mjs";

const videoTimeline = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../config/video-timeline.json"), "utf8"),
);

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

// 单一事实源守卫：report-builder 导出的时间线常量必须来自 video-timeline.json，
// 而不是各自硬编码。改 video-timeline.json 即两侧（评论/生成侧 JS 与渲染侧 TS）同步。
// 若有人误把常量改回硬编码，本测试会失败。
test("timeline constants are sourced from video-timeline.json (single source of truth)", () => {
  assert.equal(
    VIDEO_FPS,
    videoTimeline.fps,
    "VIDEO_FPS must equal video-timeline.json#fps",
  );
  assert.equal(
    STORY_TRANSITION_FRAMES,
    videoTimeline.storyTransitionFrames,
    "STORY_TRANSITION_FRAMES must equal video-timeline.json#storyTransitionFrames",
  );
});

// buildVideoStoryStartMs 是 generate-tts 写入 story.videoStartMs 的权威实现。
// 锁定它的核心契约：intro 恒从 0 开始；返回数组与 [intro, ...stories, outro] 对齐。
test("buildVideoStoryStartMs aligns with [intro, ...stories, outro] and starts intro at 0", () => {
  const report = {
    intro: {scenes: [{timing: {durationMs: 3000}}]},
    stories: [{scenes: [{timing: {durationMs: 6000}}]}],
    outro: {scenes: [{timing: {durationMs: 2000}}]},
  };
  const starts = buildVideoStoryStartMs(report).map(Math.round);
  assert.equal(starts.length, 3, "one entry per [intro, story, outro]");
  assert.equal(starts[0], 0, "intro always starts at 0ms");
  // generate-tts writes starts[index] onto timelineStories[index].videoStartMs,
  // so data.stories[i] (timelineStories[i+1]) reads starts[i+1].
  assert.ok(starts[1] > 0, "first story starts after intro + transition");
});

const overlaySampleDir = resolve(import.meta.dirname, "../../demo/data-scheme-sample-1");

test("buildGeneratedReport default intro says lunar date and weekday", () => {
  const gen = buildGeneratedReport(
    {
      $schema: "../config/data.schema.json",
      date: "2026-06-24",
      stories: [],
    },
    undefined,
    new Date(2026, 5, 24, 20),
  );

  assert.equal(
    gen.intro.scenes[0].subtitle,
    "大家晚上好，今天是农历五月初十，星期三，欢迎收看今天的 AI 日报。",
  );
});

function rawReportWithOverlay(overlayImg, sceneExtra = {}) {
  return {
    $schema: "../config/data.schema.json",
    date: "2026-06-25",
    stories: [
      {
        id: "s1",
        topTitle: "测试",
        bottomTitle: "T",
        contentTitle: "测试标题内容",
        tabs: [
          {id: "s1-t1", title: "A", summary: "第一张卡片摘要内容。"},
          {id: "s1-t2", title: "B", summary: "第二张卡片摘要内容。"},
        ],
        scenes: [
          {id: "s1-scene-1", subtitle: "一句足够长的测试旁白文案用于校验。", overlayImg, ...sceneExtra},
        ],
      },
    ],
  };
}

test("buildGeneratedReport writes overlay dims from the real image file", () => {
  const gen = buildGeneratedReport(
    rawReportWithOverlay("images/codex-reset.png"),
    undefined,
    new Date(2026, 5, 25, 10),
    overlaySampleDir,
  );
  const scene = gen.stories[0].scenes[0];
  const expected = readImageDimensions("images/codex-reset.png", overlaySampleDir);
  assert.equal(scene.overlayImgWidth, expected.width);
  assert.equal(scene.overlayImgHeight, expected.height);
});

test("buildGeneratedReport overwrites stale raw dims with file truth", () => {
  const raw = rawReportWithOverlay("images/codex-reset.png", {
    overlayImgWidth: 1158,
    overlayImgHeight: 1146,
  });
  const gen = buildGeneratedReport(raw, undefined, new Date(2026, 5, 25, 10), overlaySampleDir);
  const scene = gen.stories[0].scenes[0];
  const expected = readImageDimensions("images/codex-reset.png", overlaySampleDir);
  assert.equal(scene.overlayImgWidth, expected.width);
  assert.equal(scene.overlayImgHeight, expected.height);
});

test("buildGeneratedReport keeps overlayImg but writes no dims when file missing", () => {
  const gen = buildGeneratedReport(
    rawReportWithOverlay("images/does-not-exist.png"),
    undefined,
    new Date(2026, 5, 25, 10),
    overlaySampleDir,
  );
  const scene = gen.stories[0].scenes[0];
  assert.equal(scene.overlayImg, "images/does-not-exist.png");
  assert.equal(scene.overlayImgWidth, undefined);
  assert.equal(scene.overlayImgHeight, undefined);
});

test("buildGeneratedReport clears stale raw dims when file missing", () => {
  const gen = buildGeneratedReport(
    rawReportWithOverlay("images/does-not-exist.png", {
      overlayImgWidth: 999,
      overlayImgHeight: 888,
    }),
    undefined,
    new Date(2026, 5, 25, 10),
    overlaySampleDir,
  );
  const scene = gen.stories[0].scenes[0];
  assert.equal(scene.overlayImg, "images/does-not-exist.png");
  assert.equal(scene.overlayImgWidth, undefined);
  assert.equal(scene.overlayImgHeight, undefined);
});

test("buildGeneratedReport preserves overlayImgScale and leaves scenes without overlayImg alone", () => {
  const raw = rawReportWithOverlay("images/codex-reset.png", {overlayImgScale: 1.2});
  raw.stories[0].scenes.push({id: "s1-scene-2", subtitle: "另一句测试旁白文案内容。"});
  const gen = buildGeneratedReport(raw, undefined, new Date(2026, 5, 25, 10), overlaySampleDir);
  const s1 = gen.stories[0].scenes[0];
  assert.equal(s1.overlayImgScale, 1.2);
  const s2 = gen.stories[0].scenes[1];
  assert.equal(s2.overlayImg, undefined);
  assert.equal(s2.overlayImgWidth, undefined);
});
