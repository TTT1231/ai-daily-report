import {test} from "bun:test";
import assert from "node:assert/strict";
import {buildEvidencePreviewPlan} from "../evidence-preview-plan.mjs";
const report = {stories: [{id: "s", videoStartMs: 2000, scenes: [
  {id: "a", overlayImg: "images/a.png", timing: {startMs: 1000, durationMs: 2000}},
  {id: "b", overlayImg: "images/a.png", timing: {startMs: 3000, durationMs: 2000}},
  {id: "c", overlayImg: "images/a.png", overlayImgScale: 1.2, timing: {startMs: 5000, durationMs: 2000}},
]}]};
test("preview samples layouts once using video rather than audio timestamps", () => {
  const result = buildEvidencePreviewPlan(report, {fps: 30});
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.frames.map((frame) => frame.frame), [90, 210]);
});
test("explicit subtitle previews are retained and unknown selections fail", () => {
  assert.equal(buildEvidencePreviewPlan(report, {fps: 30, sceneIds: ["a", "b"]}).frames.length, 2);
  assert.ok(buildEvidencePreviewPlan(report, {fps: 30, sceneIds: ["missing"]}).errors.length);
});
