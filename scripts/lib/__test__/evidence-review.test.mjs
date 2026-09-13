import {test} from "bun:test";
import assert from "node:assert/strict";
import {
  buildEvidenceReviewTemplate,
  evidenceReviewChecks,
  validateEvidenceReview,
} from "../evidence-review.mjs";

const manifest = {
  schemaVersion: 1,
  video: {path: "video.mp4", sha256: "video-hash"},
  generatedData: {path: "data-generate.json", sha256: "data-hash"},
  frames: [
    {
      fileName: "001-story-scene.png",
      storyId: "story",
      sceneId: "scene",
      overlayImg: "images/evidence.png",
      subtitle: "一条必须由证据画面直接支撑的事实。",
      outputPath: "frame.png",
      sha256: "frame-hash",
    },
  ],
};

const validate = (review, overrides = {}) =>
  validateEvidenceReview({
    manifest,
    manifestSha256: "manifest-hash",
    review,
    currentVideoSha256: "video-hash",
    currentGeneratedDataSha256: "data-hash",
    currentFrameSha256ByFileName: new Map([
      ["001-story-scene.png", "frame-hash"],
    ]),
    ...overrides,
  });

test("evidence review template starts every visual criterion pending", () => {
  const review = buildEvidenceReviewTemplate(manifest, "manifest-hash");
  assert.deepEqual(review.criteria, evidenceReviewChecks);
  assert.deepEqual(
    review.reviews[0].checks,
    Object.fromEntries(evidenceReviewChecks.map((check) => [check, null])),
  );
  assert.equal(validate(review).errors.length, evidenceReviewChecks.length);
});

test("evidence review passes only after every criterion is explicitly true", () => {
  const review = buildEvidenceReviewTemplate(manifest, "manifest-hash");
  review.reviews[0].checks = Object.fromEntries(
    evidenceReviewChecks.map((check) => [check, true]),
  );
  assert.deepEqual(validate(review), {
    errors: [],
    passedFrames: 1,
    totalFrames: 1,
  });
});

test("evidence review rejects failed checks and requires an explanation", () => {
  const review = buildEvidenceReviewTemplate(manifest, "manifest-hash");
  review.reviews[0].checks = Object.fromEntries(
    evidenceReviewChecks.map((check) => [check, true]),
  );
  review.reviews[0].checks.unobstructed = false;
  const errors = validate(review).errors.join("\n");
  assert.match(errors, /checks\.unobstructed is failed/);
  assert.match(errors, /notes are required/);
});

test("evidence review rejects stale video, data, manifest, and frame hashes", () => {
  const review = buildEvidenceReviewTemplate(manifest, "old-manifest-hash");
  review.reviews[0].checks = Object.fromEntries(
    evidenceReviewChecks.map((check) => [check, true]),
  );
  const errors = validate(review, {
    currentVideoSha256: "new-video-hash",
    currentGeneratedDataSha256: "new-data-hash",
    currentFrameSha256ByFileName: new Map([
      ["001-story-scene.png", "new-frame-hash"],
    ]),
  }).errors.join("\n");
  assert.match(errors, /manifestSha256/);
  assert.match(errors, /rendered MP4 changed/);
  assert.match(errors, /data-generate\.json changed/);
  assert.match(errors, /frame file changed/);
});
