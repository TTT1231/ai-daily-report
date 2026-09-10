import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {videoLayoutPath} from "../../scripts/lib/paths.mjs";
import {validateVideoLayoutValue} from "../../scripts/lib/video-layout-validation.mjs";

const currentLayout = JSON.parse(readFileSync(videoLayoutPath, "utf8"));
const clone = (value) => JSON.parse(JSON.stringify(value));

test("accepts the current video layout", () => {
  assert.deepEqual(validateVideoLayoutValue(currentLayout).errors, []);
});

test("requires a top-navigation comfort ratio", () => {
  const layout = clone(currentLayout);
  delete layout.navigation.topComfortFillRatio;

  assert.match(
    validateVideoLayoutValue(layout).errors.join("\n"),
    /topComfortFillRatio/,
  );
});

test("rejects a top-navigation comfort ratio above the hard width", () => {
  const layout = clone(currentLayout);
  layout.navigation.topComfortFillRatio = 1.01;

  assert.match(
    validateVideoLayoutValue(layout).errors.join("\n"),
    /topComfortFillRatio/,
  );
});

test("rejects navigation layouts that are not ordered by descending minItems", () => {
  const layout = clone(currentLayout);
  layout.navigation.layouts[1].minItems = layout.navigation.layouts[0].minItems;

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
