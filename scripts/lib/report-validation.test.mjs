import test from "node:test";
import assert from "node:assert/strict";
import {validateOverlayImageDimensions} from "./report-validation.mjs";

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
