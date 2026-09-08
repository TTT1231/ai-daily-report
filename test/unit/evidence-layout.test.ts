// Evidence images stay static; these tests cover deterministic contain sizing.
import test from "node:test";
import assert from "node:assert/strict";
import { getOverlayImageLayout } from "../../src/AiDailyReport";
import type { DailyScene } from "../../src/daily-report-data";

const overlayScene = (overrides: Partial<DailyScene> = {}): DailyScene =>
  ({
    id: "test-scene",
    subtitle: "一段测试字幕",
    timing: { startMs: 0, durationMs: 1000 },
    overlayImg: "images/test.png",
    ...overrides,
  }) as DailyScene;

test("getOverlayImageLayout does not shrink tall screenshots as small assets", () => {
  const scene = overlayScene({ overlayImgWidth: 607, overlayImgHeight: 864 });
  const result = getOverlayImageLayout(scene);
  assert.deepEqual(result, {
    width: 520,
    height: 740,
    maxWidth: 1836,
    maxHeight: 740,
    small: false,
  });
});

test("getOverlayImageLayout caps phone-like screenshots below the main overlay height", () => {
  const scene = overlayScene({ overlayImgWidth: 720, overlayImgHeight: 1280 });
  const result = getOverlayImageLayout(scene);
  assert.deepEqual(result, {
    width: 416,
    height: 740,
    maxWidth: 1836,
    maxHeight: 740,
    small: false,
  });
});

test("getOverlayImageLayout enlarges medium tweet screenshots without treating them as small assets", () => {
  assert.deepEqual(
    getOverlayImageLayout(
      overlayScene({ overlayImgWidth: 594, overlayImgHeight: 632 }),
    ),
    { width: 696, height: 740, maxWidth: 1836, maxHeight: 740, small: false },
  );
  assert.deepEqual(
    getOverlayImageLayout(
      overlayScene({ overlayImgWidth: 588, overlayImgHeight: 568 }),
    ),
    { width: 766, height: 740, maxWidth: 1836, maxHeight: 740, small: false },
  );
});

test("getOverlayImageLayout still protects genuinely small images", () => {
  const scene = overlayScene({ overlayImgWidth: 550, overlayImgHeight: 412 });
  const result = getOverlayImageLayout(scene);
  assert.deepEqual(result, {
    width: 748,
    height: 560,
    maxWidth: 980,
    maxHeight: 560,
    small: true,
  });
});

test("getOverlayImageLayout keeps medium non-portrait images on the small path", () => {
  const scene = overlayScene({ overlayImgWidth: 620, overlayImgHeight: 450 });
  const result = getOverlayImageLayout(scene);
  assert.deepEqual(result, {
    width: 772,
    height: 560,
    maxWidth: 980,
    maxHeight: 560,
    small: true,
  });
});

test("getOverlayImageLayout lets landscape evidence fill the horizontal stage", () => {
  const result = getOverlayImageLayout(
    overlayScene({ overlayImgWidth: 2802, overlayImgHeight: 1098 }),
  );
  assert.deepEqual(result, {
    width: 1836,
    height: 719,
    maxWidth: 1836,
    maxHeight: 760,
    small: false,
  });
});
