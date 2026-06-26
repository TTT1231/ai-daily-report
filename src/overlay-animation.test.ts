import test from "node:test";
import assert from "node:assert/strict";
import {getOverlayAnimation, getOverlayImageLayout} from "./AiDailyReport";
import type {DailyScene} from "./daily-report-data";

// 这些时长曾经让 interpolate() 抛出
// "inputRange must be strictly monotonically increasing"，直接搞崩整段
// Remotion 渲染。任何带 overlayImg 的短场景现在都必须能安全渲染。
const CRASH_DURATIONS = [1, 5, 10, 20, 30, 38];

const overlayScene = (overrides: Partial<DailyScene> = {}): DailyScene =>
  ({
    id: "test-scene",
    subtitle: "一段测试字幕",
    timing: {startMs: 0, durationMs: 1000},
    overlayImg: "images/test.png",
    ...overrides,
  }) as DailyScene;

for (const duration of CRASH_DURATIONS) {
  test(`getOverlayAnimation stays in range across every frame of a ${duration}-frame overlay scene`, () => {
    const scene = overlayScene();
    for (let frame = 0; frame < duration; frame++) {
      const result = getOverlayAnimation(scene, frame, duration);
      for (const [name, value] of [
        ["opacity", result.opacity],
        ["reveal", result.reveal],
        ["hide", result.hide],
      ] as const) {
        assert.ok(
          value >= 0 && value <= 1,
          `${name} out of [0,1] at frame ${frame}: ${value}`,
        );
      }
      assert.ok(
        Number.isFinite(result.scale),
        `scale not finite at frame ${frame}: ${result.scale}`,
      );
    }
  });
}

test("getOverlayAnimation returns zero opacity when the scene has no overlay image", () => {
  const scene = overlayScene({overlayImg: undefined});
  const result = getOverlayAnimation(scene, 0, 60);
  assert.equal(result.opacity, 0);
});

test("getOverlayImageLayout does not shrink tall screenshots as small assets", () => {
  const scene = overlayScene({overlayImgWidth: 607, overlayImgHeight: 864});
  const result = getOverlayImageLayout(scene);
  assert.deepEqual(result, {width: 478, height: 680, maxWidth: 1640, maxHeight: 680, small: false});
});

test("getOverlayImageLayout caps phone-like screenshots below the main overlay height", () => {
  const scene = overlayScene({overlayImgWidth: 720, overlayImgHeight: 1280});
  const result = getOverlayImageLayout(scene);
  assert.deepEqual(result, {width: 383, height: 680, maxWidth: 1640, maxHeight: 680, small: false});
});

test("getOverlayImageLayout still protects genuinely small images", () => {
  const scene = overlayScene({overlayImgWidth: 550, overlayImgHeight: 412});
  const result = getOverlayImageLayout(scene);
  assert.deepEqual(result, {width: 748, height: 560, maxWidth: 980, maxHeight: 560, small: true});
});

test("getOverlayImageLayout keeps medium non-portrait images on the small path", () => {
  const scene = overlayScene({overlayImgWidth: 620, overlayImgHeight: 450});
  const result = getOverlayImageLayout(scene);
  assert.deepEqual(result, {width: 772, height: 560, maxWidth: 980, maxHeight: 560, small: true});
});

test("getOverlayAnimation reveals, holds, then hides on a long scene", () => {
  const scene = overlayScene();
  const duration = 120;
  assert.equal(getOverlayAnimation(scene, 0, duration).opacity, 0);
  assert.equal(getOverlayAnimation(scene, 60, duration).opacity, 1);
  assert.ok(
    getOverlayAnimation(scene, 60, duration).scale > 1,
    "scale should zoom past 1 mid-scene",
  );
  assert.ok(
    getOverlayAnimation(scene, duration - 1, duration).opacity < 1,
    "opacity should be fading out by the last frame",
  );
});

test("getOverlayAnimation keeps the zoom on a medium-length scene (43-66 frame band that previously lost it)", () => {
  for (const duration of [43, 50, 60, 66]) {
    const scene = overlayScene();
    let zoomed = false;
    for (let frame = 0; frame < duration; frame++) {
      if (getOverlayAnimation(scene, frame, duration).scale > 1.0001) {
        zoomed = true;
        break;
      }
    }
    assert.ok(
      zoomed,
      `scale should exceed 1 at some frame of a ${duration}-frame overlay scene`,
    );
  }
});
