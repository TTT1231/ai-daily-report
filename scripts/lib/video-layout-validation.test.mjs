import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {videoLayoutPath} from "./paths.mjs";
import {validateVideoLayoutValue} from "./video-layout-validation.mjs";

const currentLayout = JSON.parse(readFileSync(videoLayoutPath, "utf8"));
const clone = (value) => JSON.parse(JSON.stringify(value));

test("accepts the current video layout", () => {
  assert.deepEqual(validateVideoLayoutValue(currentLayout).errors, []);
});

test("rejects navigation layouts that are not ordered by descending minItems", () => {
  const layout = clone(currentLayout);
  layout.navigation.layouts[1].minItems = 13;

  assert.match(
    validateVideoLayoutValue(layout).errors.join("\n"),
    /must be lower than the previous layout threshold/,
  );
});

test("requires a zero-threshold fallback layout", () => {
  const layout = clone(currentLayout);
  layout.navigation.layouts.at(-1).minItems = 1;

  assert.match(
    validateVideoLayoutValue(layout).errors.join("\n"),
    /final layout must use minItems: 0 as a fallback/,
  );
});
