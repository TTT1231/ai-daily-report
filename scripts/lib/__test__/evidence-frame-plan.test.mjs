import {test} from "bun:test";
import assert from "node:assert/strict";
import {buildEvidenceFramePlan} from "../evidence-frame-plan.mjs";

test("buildEvidenceFramePlan aligns generated scene timing with rendered story time", () => {
  const report = {
    stories: [
      {
        id: "story-a",
        videoStartMs: 10_000,
        scenes: [
          {
            id: "scene-a1",
            overlayImg: "images/a.png",
            timing: {startMs: 5_000, durationMs: 4_000},
          },
          {
            id: "scene-a2",
            timing: {startMs: 9_000, durationMs: 6_000},
          },
          {
            id: "scene-a3",
            overlayImg: "images/b.png",
            timing: {startMs: 15_000, durationMs: 2_000},
          },
        ],
      },
    ],
  };

  assert.deepEqual(buildEvidenceFramePlan(report), {
    errors: [],
    frames: [
      {
        storyId: "story-a",
        sceneId: "scene-a1",
        overlayImg: "images/a.png",
        timeMs: 12_000,
        fileName: "001-story-a-scene-a1.png",
      },
      {
        storyId: "story-a",
        sceneId: "scene-a3",
        overlayImg: "images/b.png",
        timeMs: 21_000,
        fileName: "002-story-a-scene-a3.png",
      },
    ],
  });
});

test("buildEvidenceFramePlan reports missing render timing only for stories with overlays", () => {
  const result = buildEvidenceFramePlan({
    stories: [
      {id: "text-only", scenes: [{id: "text", subtitle: "text"}]},
      {
        id: "missing",
        scenes: [{id: "overlay", overlayImg: "images/a.png"}],
      },
    ],
  });

  assert.deepEqual(result.frames, []);
  assert.deepEqual(result.errors, ['story "missing" is missing a valid videoStartMs']);
});
