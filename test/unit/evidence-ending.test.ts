import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {resolveDailyReport, getReportTimelineStories} from "../../src/daily-report-data";
import {getReportDurationInFrames} from "../../src/AiDailyReport";
// @ts-expect-error Production JS builder is exercised across the rendering boundary.
import {buildGeneratedReport, collectTimelineScenes, buildVideoStoryStartMs, VIDEO_FPS, STORY_TRANSITION_FRAMES} from "../../scripts/lib/report-builder.mjs";
// @ts-expect-error Production JS validator has no declaration file.
import {validateReport} from "../../scripts/lib/report-validation.mjs";

const fixture = () => JSON.parse(readFileSync(resolve(__dirname, "../mock/raw-report.json"), "utf8"));

test("evidence reports omit the outro from generation, validation and the rendered duration", () => {
  const raw = fixture();
  for (const story of raw.stories) {
    for (const scene of story.scenes) scene.overlayImg = "images/codex-reset.png";
  }
  raw.outroContent = "旧配置的告别语也不应追加";
  const generated = buildGeneratedReport(raw);
  assert.equal(generated.outro, undefined);
  let cursor = 0;
  for (const scene of collectTimelineScenes(generated)) {
    scene.timing = {startMs: cursor, durationMs: 1000};
    cursor += 1000;
  }
  assert.deepEqual(validateReport(generated, {renderMode: true, checkAssets: false}).errors, []);
  const report = resolveDailyReport(generated);
  assert.equal(buildVideoStoryStartMs(generated).length, 3);
  assert.deepEqual(getReportTimelineStories(report).map(story => story.id), ["intro", "story-1", "story-2"]);
  const expectedFrames = 4 * VIDEO_FPS + 2 * STORY_TRANSITION_FRAMES;
  assert.equal(getReportDurationInFrames(VIDEO_FPS, report), expectedFrames);

  // Existing generated props may still contain the old outro and its audio.
  const legacy = resolveDailyReport({...generated, outro: {
    id: "outro", topTitle: "结语", bottomTitle: "结语",
    scenes: [{id: "outro-ending", subtitle: "明天见", audioSrc: "audio/outro-ending.mp3",
      timing: {startMs: cursor, durationMs: 2000}}],
  }});
  assert.equal(getReportDurationInFrames(VIDEO_FPS, legacy), expectedFrames);
  assert.ok(getReportTimelineStories(legacy).every(story => story.id !== "outro"));
});

test("mixed card and evidence reports preserve the existing outro contract", () => {
  const raw = fixture();
  raw.stories[0].scenes[0].overlayImg = "images/codex-reset.png";
  const generated = buildGeneratedReport(raw);
  assert.equal(generated.outro.id, "outro");
  let cursor = 0;
  for (const scene of collectTimelineScenes(generated)) {
    scene.timing = {startMs: cursor, durationMs: 1000};
    cursor += 1000;
  }
  const timeline = getReportTimelineStories(resolveDailyReport(generated));
  assert.equal(timeline[timeline.length - 1].id, "outro");
  delete generated.outro;
  assert.throws(() => resolveDailyReport(generated), /outro is required/);
});
