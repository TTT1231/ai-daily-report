import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtempSync, writeFileSync, readFileSync, rmSync} from "node:fs";
import {join, dirname, resolve} from "node:path";
import {tmpdir} from "node:os";
import {
  buildGeneratedReport,
  collectTimelineScenes,
  buildVideoStoryStartMs,
} from "../report-builder.mjs";
import {sceneAudioFields, isReusable} from "../tts-timeline.mjs";
import {validateReport} from "../report-validation.mjs";

// config 形状与 generate-tts.mjs 的 config 对象一致
const ttsConfig = {
  model: "speech-2.8-hd",
  voiceId: "Chinese (Mandarin)_Warm_Girl",
  speed: 1,
  vol: 1,
  pitch: 0,
  tailPaddingMs: 250,
};

// ---------- sceneAudioFields：字段派生 ----------
test("sceneAudioFields derives duration from audio length + tail and advances the cursor", () => {
  const fields = sceneAudioFields("scene-1", "abc123", 1000, 5000, ttsConfig);
  assert.equal(fields.audioSrc, "audio/scene-1.mp3");
  assert.deepEqual(fields.timing, {startMs: 5000, durationMs: 1250});
  assert.equal(fields.nextCursorMs, 6250, "cursor must advance by durationMs");
});

test("sceneAudioFields tts carries all 9 cache/params fields", () => {
  const {tts} = sceneAudioFields("s", "h", 100, 0, ttsConfig);
  assert.deepEqual(Object.keys(tts).sort(), [
    "audioLengthMs",
    "hash",
    "model",
    "pitch",
    "provider",
    "speed",
    "tailPaddingMs",
    "voiceId",
    "vol",
  ]);
  assert.equal(tts.provider, "minimax");
  assert.equal(tts.audioLengthMs, 100);
  assert.equal(tts.tailPaddingMs, 250);
});

// ---------- scene-loop 装配的端到端自洽性 ----------
// 用真实 buildGeneratedReport + collectTimelineScenes + 受控 audioLengthMs 模拟 generate-tts
// 的 scene loop（唯一被替换的是 MiniMax 返回的音频时长），再写入 videoStartMs，断言装配出的
// Generated 报告通过 renderMode 全量校验——即 startMs 连续、duration=audio+tail、tts 完整、
// videoStartMs 合法。这是 generate-tts.mjs 此前完全未被覆盖的核心装配契约。
test("scene-loop assembly yields a contiguous, render-valid timeline", () => {
  // raw fixture 见 test/mock/raw-report.json（story-1 2 scenes + story-2 1 scene → 5 timeline scenes）
  const raw = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../test/mock/raw-report.json"), "utf8"),
  );

  const report = buildGeneratedReport(raw, undefined, new Date(2026, 5, 28, 10));
  const scenes = collectTimelineScenes(report);
  assert.equal(scenes.length, 5, "intro + 2+1 story scenes + outro");

  // 受控音频时长（真实运行来自 MiniMax；钉住它们即钉死整条 generated 结构）
  const audioLengths = [1200, 1500, 1800, 1100, 900];
  let cursorMs = 0;
  scenes.forEach((scene, index) => {
    const hash = createHash("sha256").update(`${scene.id}-${index}`).digest("hex");
    const fields = sceneAudioFields(scene.id, hash, audioLengths[index], cursorMs, ttsConfig);
    scene.audioSrc = fields.audioSrc;
    scene.timing = fields.timing;
    scene.tts = fields.tts;
    cursorMs = fields.nextCursorMs;
  });

  // videoStartMs 写回（与 generate-tts.mjs 的写法一致）
  const videoStoryStartMs = buildVideoStoryStartMs(report);
  const timelineStories = [report.intro, ...(report.stories ?? []), report.outro];
  timelineStories.forEach((story, index) => {
    if (story) story.videoStartMs = videoStoryStartMs[index] ?? 0;
  });

  // 装配出的 Generated 报告必须通过 render-mode 全量校验
  const result = validateReport(report, {renderMode: true, checkAssets: false});
  assert.deepEqual(result.errors, [], `assembled timeline should be render-valid: ${JSON.stringify(result.errors)}`);

  // 显式锁定连续性：每个 scene 的 startMs 等于此前所有 durationMs 之和
  let expectedStart = 0;
  for (const scene of scenes) {
    assert.equal(scene.timing.startMs, expectedStart, `${scene.id} startMs must be contiguous`);
    assert.equal(
      scene.timing.durationMs,
      scene.tts.audioLengthMs + scene.tts.tailPaddingMs,
      `${scene.id} durationMs must equal audioLengthMs + tailPaddingMs`,
    );
    expectedStart += scene.timing.durationMs;
  }

  // videoStartMs：intro 恒为 0，每个 story 的成片起始为非负整数
  assert.equal(report.intro.videoStartMs, 0, "intro videoStartMs must be 0");
  for (const story of report.stories) {
    assert.ok(Number.isInteger(story.videoStartMs) && story.videoStartMs >= 0);
  }
});

// ---------- isReusable：缓存命中分支 ----------
function withTempAudio(tap) {
  const dir = mkdtempSync(join(tmpdir(), "tts-reuse-"));
  try {
    const audioPath = join(dir, "scene-1.mp3");
    writeFileSync(audioPath, Buffer.from([0]));
    return tap(audioPath);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}

test("isReusable is true when hash, path and cached length all match and the file exists", () => {
  withTempAudio((audioPath) => {
    const scene = {id: "scene-1"};
    const cached = {audioSrc: "audio/scene-1.mp3", tts: {hash: "h1", audioLengthMs: 1000}};
    assert.equal(isReusable(scene, cached, "h1", audioPath, false), true);
  });
});

test("isReusable is false on hash mismatch, missing file, force, bad cached length, or no cache", () => {
  withTempAudio((audioPath) => {
    const scene = {id: "scene-1"};
    const cached = {audioSrc: "audio/scene-1.mp3", tts: {hash: "h1", audioLengthMs: 1000}};
    assert.equal(isReusable(scene, cached, "different-hash", audioPath, false), false, "hash mismatch");
    assert.equal(isReusable(scene, cached, "h1", join(dirname(audioPath), "nope.mp3"), false), false, "missing file");
    assert.equal(isReusable(scene, cached, "h1", audioPath, true), false, "force regenerates");
    assert.equal(
      isReusable(scene, {audioSrc: "audio/scene-1.mp3", tts: {hash: "h1", audioLengthMs: 0}}, "h1", audioPath, false),
      false,
      "non-positive cached length",
    );
    assert.equal(isReusable(scene, undefined, "h1", audioPath, false), false, "no cached scene");
  });
});
