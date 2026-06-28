import test from "node:test";
import assert from "node:assert/strict";
import {
  validateOverlayImageDimensions,
  validateReport,
} from "../report-validation.mjs";

// ============================================================================
// validateOverlayImageDimensions —— overlay 维度字段配对校验
// （尺寸是否匹配文件已故意移除：正确性由 report-builder 构建期写入）
// ============================================================================
function errorsFor(scene) {
  const errors = [];
  validateOverlayImageDimensions(scene, "stories[0].scenes[0]", errors);
  return errors;
}

test("dims mismatch no longer errors (build owns correctness)", () => {
  assert.deepEqual(
    errorsFor({overlayImg: "images/x.png", overlayImgWidth: 1158, overlayImgHeight: 1146}),
    [],
  );
});

test("missing dims is fine (optional hint)", () => {
  assert.deepEqual(errorsFor({overlayImg: "images/x.png"}), []);
});

test("width without height (or vice versa) still errors", () => {
  assert.deepEqual(errorsFor({overlayImg: "images/x.png", overlayImgWidth: 100}), [
    "stories[0].scenes[0].overlayImgWidth/overlayImgHeight: must be set together",
  ]);
});

test("dims without overlayImg still errors", () => {
  assert.deepEqual(errorsFor({overlayImgWidth: 100, overlayImgHeight: 100}), [
    "stories[0].scenes[0].overlayImg: is required when dimensions are set",
  ]);
});

test("scale without overlayImg still errors", () => {
  assert.deepEqual(errorsFor({overlayImgScale: 1.2}), [
    "stories[0].scenes[0].overlayImg: is required when scale is set",
  ]);
});

// ============================================================================
// validateReport —— 整期数据结构 + 时间线 + tts 不变量校验
// 这是渲染前最后一道门。以下覆盖此前完全未测的 ~11 条确定性断言。
// 全部用 checkAssets:false（资产存在性归 asset-check），纯结构/时间线，免盘。
// ============================================================================
const SCHEMA_REF = "../config/data.schema.json";

/** 调 validateReport 并只取 errors；默认 checkAssets:false（资产另由 asset-check 覆盖）。 */
const errorsOf = (report, options = {}) =>
  validateReport(report, {checkAssets: false, ...options}).errors;

const hasError = (errors, needle) => errors.some((e) => e.includes(needle));

// ---------- fixture 工厂（全部 schema-合法）----------
function tab(overrides = {}) {
  return {id: "tab-1", title: "标题", summary: "摘要内容。", ...overrides};
}

function scene(overrides = {}) {
  return {id: "scene-1", subtitle: "一段不超过 96 字的口播字幕。", ...overrides};
}

/** 带 timing + tts + audioSrc 的 scene（Generated 形态）；durationMs 由 audio+tail 派生保证自洽。 */
function timedScene({audioLengthMs = 1000, tailPaddingMs = 250, ...rest} = {}) {
  return {
    id: "scene-1",
    subtitle: "一段不超过 96 字的口播字幕。",
    timing: {startMs: 0, durationMs: audioLengthMs + tailPaddingMs},
    audioSrc: "audio/scene-1.mp3",
    tts: {
      provider: "minimax",
      hash: "0".repeat(64),
      model: "speech-01",
      voiceId: "voice-1",
      speed: 1,
      vol: 1,
      pitch: 0,
      audioLengthMs,
      tailPaddingMs,
    },
    ...rest,
  };
}

function story(overrides = {}) {
  return {
    id: "story-1",
    topTitle: "栏目",
    bottomTitle: "短标",
    contentTitle: "完整标题",
    tabs: [tab({id: "tab-1"}), tab({id: "tab-2"})],
    scenes: [scene({id: "scene-1"})],
    ...overrides,
  };
}

function rawReport(overrides = {}) {
  return {$schema: SCHEMA_REF, date: "2026-06-28", stories: [story()], ...overrides};
}

/** 按 [intro, ...stories, outro] 顺序累计赋值 startMs，保证时间线连续（渲染期不变量）。 */
function assignContiguousStartMs(report) {
  let cursor = 0;
  const order = [
    ...(report.intro ? [report.intro] : []),
    ...(report.stories ?? []),
    ...(report.outro ? [report.outro] : []),
  ];
  for (const s of order) {
    for (const sc of s.scenes ?? []) {
      if (sc.timing) {
        sc.timing.startMs = cursor;
        cursor += sc.timing.durationMs;
      }
    }
  }
  return report;
}

/** 完整 Generated 报告：intro(1250ms) + 1 story(1750ms) + outro(1150ms) = 4150ms，时间线连续。 */
function generatedReport(overrides = {}) {
  const report = {
    $schema: SCHEMA_REF,
    date: "2026-06-28",
    intro: {
      id: "intro",
      topTitle: "概览",
      bottomTitle: "概览",
      contentTitle: "今日概览",
      tabs: [tab({id: "intro-tab-1"}), tab({id: "intro-tab-2"})],
      scenes: [timedScene({id: "intro-greeting", audioLengthMs: 1000})],
    },
    stories: [
      story({
        id: "story-1",
        scenes: [timedScene({id: "scene-1", audioLengthMs: 1500})],
      }),
    ],
    outro: {
      id: "outro",
      topTitle: "结束",
      bottomTitle: "结束",
      scenes: [timedScene({id: "outro-ending", audioLengthMs: 900})],
    },
    ...overrides,
  };
  return assignContiguousStartMs(report);
}

// ---------- 合法路径 ----------
test("validateReport accepts a minimal Raw report", () => {
  assert.deepEqual(errorsOf(rawReport()), []);
});

test("validateReport accepts a fully-assembled Generated report and reports total duration", () => {
  // Generated 带 intro/outro，必须在 renderMode 下校验（Raw 模式会判 intro/outro 非法）
  const result = validateReport(generatedReport(), {checkAssets: false, renderMode: true});
  assert.deepEqual(result.errors, []);
  assert.equal(result.totalDurationMs, 1250 + 1750 + 1150);
});

// ---------- $schema ----------
test("$schema must equal the canonical config path", () => {
  const r = rawReport();
  r.$schema = "https://example.com/wrong.json";
  assert.ok(hasError(errorsOf(r), '$schema: must equal "../config/data.schema.json"'));
});

// ---------- intro / outro 存在性 ----------
test("renderMode requires intro", () => {
  const r = generatedReport();
  delete r.intro;
  assignContiguousStartMs(r);
  assert.ok(hasError(errorsOf(r, {renderMode: true}), "intro: is required before rendering"));
});

test("renderMode requires outro", () => {
  const r = generatedReport();
  delete r.outro;
  assignContiguousStartMs(r);
  assert.ok(hasError(errorsOf(r, {renderMode: true}), "outro: is required before rendering"));
});

test("Raw mode rejects a manually-added intro", () => {
  const r = rawReport();
  r.intro = {
    id: "intro",
    topTitle: "x",
    bottomTitle: "x",
    contentTitle: "x",
    tabs: [tab({id: "t1"}), tab({id: "t2"})],
    scenes: [scene({id: "intro-greeting"})],
  };
  assert.ok(hasError(errorsOf(r), "intro/outro: are generated automatically"));
});

// ---------- id 唯一性 ----------
test("duplicate story.id is rejected", () => {
  const r = rawReport({
    stories: [
      story({id: "dup"}),
      story({id: "dup", scenes: [scene({id: "scene-2"})]}),
    ],
  });
  assert.ok(hasError(errorsOf(r), 'stories[1].id: duplicate id "dup"'));
});

test("Raw mode rejects the reserved story id 'intro'", () => {
  const r = rawReport({stories: [story({id: "intro"})]});
  assert.ok(hasError(errorsOf(r), "is reserved and generated automatically"));
});

test("duplicate tab.id within a story is rejected", () => {
  const r = rawReport({
    stories: [story({tabs: [tab({id: "dup"}), tab({id: "dup"})]})],
  });
  assert.ok(hasError(errorsOf(r), 'tabs[1].id: duplicate id "dup"'));
});

test("activeTab referencing a non-existent tab is rejected", () => {
  const r = rawReport({stories: [story({activeTab: "no-such-tab"})]});
  assert.ok(hasError(errorsOf(r), 'activeTab: unknown tab id "no-such-tab"'));
});

test("duplicate global scene.id across stories is rejected", () => {
  const r = rawReport({
    stories: [
      story({id: "s1", scenes: [scene({id: "dup-scene"})]}),
      story({id: "s2", scenes: [scene({id: "dup-scene"})]}),
    ],
  });
  assert.ok(hasError(errorsOf(r), 'duplicate global scene id "dup-scene"'));
});

// ---------- activeIntro / topTitle 分段 ----------
test("more than one activeIntro is rejected", () => {
  const r = rawReport({
    stories: [
      story({id: "s1", topTitle: "A", activeIntro: true}),
      story({id: "s2", topTitle: "B", activeIntro: true}),
    ],
  });
  assert.ok(hasError(errorsOf(r), "only one story may set activeIntro to true"));
});

test("a topTitle reappearing in a non-adjacent segment is rejected", () => {
  const r = rawReport({
    stories: [
      story({id: "s1", topTitle: "A"}),
      story({id: "s2", topTitle: "B"}),
      story({id: "s3", topTitle: "A"}),
    ],
  });
  assert.ok(
    hasError(errorsOf(r), 'category "A" appears in multiple non-adjacent segments'),
  );
});

test("more than 5 unique topTitle categories is rejected", () => {
  const r = rawReport({
    stories: ["A", "B", "C", "D", "E", "F"].map((t, i) =>
      story({id: `s${i}`, topTitle: t}),
    ),
  });
  assert.ok(hasError(errorsOf(r), "at most 5 unique topTitle categories"));
});

// ---------- 时间线连续性（renderMode 头条不变量）----------
test("renderMode flags a scene missing timing", () => {
  const r = generatedReport();
  const scene0 = r.stories[0].scenes[0];
  delete scene0.timing;
  delete scene0.tts;
  delete scene0.audioSrc;
  assignContiguousStartMs(r);
  assert.ok(
    hasError(errorsOf(r, {renderMode: true}), "timing: is required before rendering"),
  );
});

test("renderMode flags a 1ms gap in startMs", () => {
  const r = generatedReport();
  r.stories[0].scenes[0].timing.startMs += 1;
  const errors = errorsOf(r, {renderMode: true});
  const gap = errors.find((e) => e.includes("timing.startMs: expected"));
  assert.ok(gap, `expected a startMs continuity error, got: ${JSON.stringify(errors)}`);
  assert.match(gap, /expected 1250, received 1251/);
});

test("renderMode flags a 1ms overlap in startMs", () => {
  const r = generatedReport();
  r.stories[0].scenes[0].timing.startMs -= 1;
  const errors = errorsOf(r, {renderMode: true});
  const overlap = errors.find((e) => e.includes("timing.startMs: expected"));
  assert.ok(overlap, `expected a startMs continuity error, got: ${JSON.stringify(errors)}`);
  assert.match(overlap, /expected 1250, received 1249/);
});

// ---------- tts 不变量 ----------
test("tts without audioSrc is rejected", () => {
  const r = generatedReport();
  delete r.stories[0].scenes[0].audioSrc;
  assert.ok(
    hasError(errorsOf(r, {renderMode: true}), "audioSrc: is required when tts metadata exists"),
  );
});

test("tts without timing is rejected", () => {
  const r = generatedReport();
  delete r.stories[0].scenes[0].timing;
  assert.ok(
    hasError(errorsOf(r, {renderMode: true}), "timing: is required when tts metadata exists"),
  );
});

test("durationMs must equal audioLengthMs + tailPaddingMs", () => {
  const r = generatedReport();
  r.stories[0].scenes[0].timing.durationMs += 1;
  assert.ok(
    hasError(errorsOf(r, {renderMode: true}), "must equal tts.audioLengthMs + tts.tailPaddingMs"),
  );
});
