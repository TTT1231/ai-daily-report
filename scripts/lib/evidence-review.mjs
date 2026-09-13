import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";

export const evidenceReviewChecks = [
  "upright",
  "readable",
  "supportsSubtitle",
  "sourceIdentifiable",
  "unobstructed",
];

export const sha256Text = (value) =>
  createHash("sha256").update(value).digest("hex");

export const sha256File = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

export function buildEvidenceReviewTemplate(manifest, manifestSha256) {
  return {
    schemaVersion: 1,
    manifestSha256,
    criteria: evidenceReviewChecks,
    reviews: (manifest.frames ?? []).map((frame) => ({
      fileName: frame.fileName,
      storyId: frame.storyId,
      sceneId: frame.sceneId,
      overlayImg: frame.overlayImg,
      subtitle: frame.subtitle,
      checks: Object.fromEntries(
        evidenceReviewChecks.map((check) => [check, null]),
      ),
      notes: "",
    })),
  };
}

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function validateEvidenceReview({
  manifest,
  manifestSha256,
  review,
  currentVideoSha256,
  currentGeneratedDataSha256,
  currentFrameSha256ByFileName,
}) {
  const errors = [];
  const frames = Array.isArray(manifest?.frames) ? manifest.frames : [];
  const reviews = Array.isArray(review?.reviews) ? review.reviews : [];

  if (manifest?.schemaVersion !== 1) {
    errors.push("manifest.schemaVersion: must equal 1");
  }
  if (review?.schemaVersion !== 1) {
    errors.push("review.schemaVersion: must equal 1");
  }
  if (review?.manifestSha256 !== manifestSha256) {
    errors.push(
      "review.manifestSha256: does not match this manifest; regenerate the review instead of reusing a stale verdict",
    );
  }
  if (manifest?.video?.sha256 !== currentVideoSha256) {
    errors.push(
      "video: rendered MP4 changed after frame extraction; extract and review fresh frames",
    );
  }
  if (manifest?.generatedData?.sha256 !== currentGeneratedDataSha256) {
    errors.push(
      "generated data: data-generate.json changed after frame extraction; render, extract, and review again",
    );
  }

  const reviewsByFileName = new Map();
  for (const [index, item] of reviews.entries()) {
    if (!isObject(item) || typeof item.fileName !== "string") {
      errors.push(`reviews[${index}]: must contain a fileName`);
      continue;
    }
    if (reviewsByFileName.has(item.fileName)) {
      errors.push(`reviews[${index}].fileName: duplicate ${item.fileName}`);
      continue;
    }
    reviewsByFileName.set(item.fileName, item);
  }

  const frameNames = new Set(frames.map((frame) => frame.fileName));
  for (const item of reviews) {
    if (typeof item?.fileName === "string" && !frameNames.has(item.fileName)) {
      errors.push(
        `review ${item.fileName}: is not present in the current frame manifest`,
      );
    }
  }

  let passedFrames = 0;
  for (const frame of frames) {
    const label = `${frame.storyId}/${frame.sceneId} (${frame.fileName})`;
    const item = reviewsByFileName.get(frame.fileName);
    if (!item) {
      errors.push(`${label}: missing visual review entry`);
      continue;
    }
    for (const field of ["storyId", "sceneId", "overlayImg", "subtitle"]) {
      if (item[field] !== frame[field]) {
        errors.push(
          `${label}: review.${field} does not match the extracted frame`,
        );
      }
    }
    const currentFrameSha256 = currentFrameSha256ByFileName.get(frame.fileName);
    if (frame.sha256 !== currentFrameSha256) {
      errors.push(`${label}: frame file changed after extraction`);
    }

    let passed = true;
    for (const check of evidenceReviewChecks) {
      const value = item.checks?.[check];
      if (value !== true) {
        passed = false;
        errors.push(
          `${label}: checks.${check} is ${value === false ? "failed" : "pending"}`,
        );
      }
    }
    const hasFailedCheck = evidenceReviewChecks.some(
      (check) => item.checks?.[check] === false,
    );
    if (hasFailedCheck && !String(item.notes ?? "").trim()) {
      errors.push(`${label}: notes are required when a visual check fails`);
    }
    if (passed) passedFrames++;
  }

  return {errors, passedFrames, totalFrames: frames.length};
}
