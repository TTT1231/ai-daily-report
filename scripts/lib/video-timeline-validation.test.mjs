import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {videoTimelinePath} from "./paths.mjs";
import {validateVideoTimelineValue} from "./video-timeline-validation.mjs";

const currentTimeline = JSON.parse(readFileSync(videoTimelinePath, "utf8"));
const clone = (value) => JSON.parse(JSON.stringify(value));

test("accepts the current video timeline", () => {
  assert.deepEqual(validateVideoTimelineValue(currentTimeline).errors, []);
});

test("rejects an fps other than 30", () => {
  const timeline = clone(currentTimeline);
  timeline.fps = 60;

  assert.match(
    validateVideoTimelineValue(timeline).errors.join("\n"),
    /fps/,
  );
});

test("rejects a non-positive storyTransitionFrames", () => {
  const timeline = clone(currentTimeline);
  timeline.storyTransitionFrames = 0;

  assert.match(
    validateVideoTimelineValue(timeline).errors.join("\n"),
    /storyTransitionFrames/,
  );
});

test("rejects additional unknown properties", () => {
  const timeline = clone(currentTimeline);
  timeline.unknownField = true;

  assert.match(
    validateVideoTimelineValue(timeline).errors.join("\n"),
    /must NOT have additional properties/,
  );
});
