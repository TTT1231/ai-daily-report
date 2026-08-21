import test from "node:test";
import assert from "node:assert/strict";
import {
  getOverlayAnimation,
  getOverlayImageLayout,
} from "../../src/AiDailyReport";
import type { DailyScene } from "../../src/daily-report-data";

// 这些时长曾经让 interpolate() 抛出
// "inputRange must be strictly monotonically increasing"，直接搞崩整段
// Remotion 渲染。任何带 overlayImg 的短场景现在都必须能安全渲染。
const CRASH_DURATIONS = [1, 5, 10, 20, 30, 38];

const overlayScene = (overrides: Partial<DailyScene> = {}): DailyScene =>
  ({
    id: "test-scene",
    subtitle: "一段测试字幕",
    timing: { startMs: 0, durationMs: 1000 },
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
  const scene = overlayScene({ overlayImg: undefined });
  const result = getOverlayAnimation(scene, 0, 60);
  assert.equal(result.opacity, 0);
});

test("getOverlayImageLayout does not shrink tall screenshots as small assets", () => {
  const scene = overlayScene({ overlayImgWidth: 607, overlayImgHeight: 864 });
  const result = getOverlayImageLayout(scene);
  assert.deepEqual(result, {
    width: 478,
    height: 680,
    maxWidth: 1640,
    maxHeight: 680,
    small: false,
  });
});

test("getOverlayImageLayout caps phone-like screenshots below the main overlay height", () => {
  const scene = overlayScene({ overlayImgWidth: 720, overlayImgHeight: 1280 });
  const result = getOverlayImageLayout(scene);
  assert.deepEqual(result, {
    width: 383,
    height: 680,
    maxWidth: 1640,
    maxHeight: 680,
    small: false,
  });
});

test("getOverlayImageLayout enlarges medium tweet screenshots without treating them as small assets", () => {
  assert.deepEqual(
    getOverlayImageLayout(
      overlayScene({ overlayImgWidth: 594, overlayImgHeight: 632 }),
    ),
    { width: 639, height: 680, maxWidth: 1640, maxHeight: 680, small: false },
  );
  assert.deepEqual(
    getOverlayImageLayout(
      overlayScene({ overlayImgWidth: 588, overlayImgHeight: 568 }),
    ),
    { width: 704, height: 680, maxWidth: 1640, maxHeight: 680, small: false },
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

test("getOverlayAnimation reveals, zooms in, holds, then hides on a long scene", () => {
  const scene = overlayScene();
  const duration = 120;
  assert.equal(getOverlayAnimation(scene, 0, duration).opacity, 0);
  assert.equal(getOverlayAnimation(scene, 60, duration).opacity, 1);
  const mid = getOverlayAnimation(scene, 60, duration).scale;
  assert.ok(
    mid > 1 && mid < 1.12,
    `scale should be mid-zoom at frame 60: ${mid}`,
  );
  // 推近窗口固定 ~2s（revealEnd=28 → zoomEnd=88），88 帧处正好推到放大镜峰值。
  const held = getOverlayAnimation(scene, 88, duration).scale;
  assert.ok(
    Math.abs(held - 1.12) < 1e-9,
    `scale should hold the magnifier peak at the zoom end: ${held}`,
  );
  assert.ok(
    getOverlayAnimation(scene, duration - 1, duration).opacity < 1,
    "opacity should be fading out by the last frame",
  );
});

test("getOverlayAnimation follows a long subtitle instead of stopping at a fixed duration", () => {
  const scene = overlayScene();
  const duration = 240;
  assert.equal(getOverlayAnimation(scene, 120, duration).opacity, 1);
  assert.equal(getOverlayAnimation(scene, 208, duration).opacity, 1);

  const fading = getOverlayAnimation(scene, 219, duration).opacity;
  assert.ok(
    fading > 0 && fading < 1,
    "overlay should fade during the final second",
  );
  assert.equal(getOverlayAnimation(scene, 229, duration).opacity, 0);
  assert.equal(getOverlayAnimation(scene, duration - 1, duration).opacity, 0);
});

test("getOverlayAnimation stays render-safe on medium-length scenes (43-66 frame band that previously crashed)", () => {
  for (const duration of [43, 50, 60, 66]) {
    const scene = overlayScene();
    let reachedFullScale = false;
    for (let frame = 0; frame < duration; frame++) {
      const { scale } = getOverlayAnimation(scene, frame, duration);
      // 放大镜推近峰值为 1.12；放不下完整弧线的短场景退化为仅入场 0.95→1。
      assert.ok(
        Number.isFinite(scale) && scale >= 0.94 && scale <= 1.13,
        `scale out of range at frame ${frame} of ${duration}: ${scale}`,
      );
      if (scale >= 1) reachedFullScale = true;
    }
    assert.ok(
      reachedFullScale,
      `scale should reach at least 1 after the reveal during a ${duration}-frame overlay scene`,
    );
  }
});
