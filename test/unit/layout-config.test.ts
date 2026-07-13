import test from "node:test";
import assert from "node:assert/strict";
import {
  getAutomaticOverlayScale,
  getTabLayout,
} from "../../src/layout-config";
import { previewTabs } from "../../src/tab-layout-preview-fixture";

test("dense tab layouts expose six summary lines for the 110-unit data budget", () => {
  assert.equal(getTabLayout(5).summaryLineClamp, 6);
  assert.equal(getTabLayout(6).summaryLineClamp, 6);
  assert.equal(getTabLayout(4).summaryLineClamp, 5);
});

test("dense layout preview includes a near-limit complete summary", () => {
  const visibleLength = Array.from(
    previewTabs[0].summary.split("**").join("").split("`").join(""),
  ).length;
  assert.ok(visibleLength >= 105 && visibleLength <= 110);
  assert.match(previewTabs[0].summary, /。$/);
});

test("automatic overlay scale only enlarges portrait images up to 1000px", () => {
  assert.equal(getAutomaticOverlayScale(400, 800), 1.3);
  assert.equal(getAutomaticOverlayScale(675, 862), 1.2);
  assert.equal(getAutomaticOverlayScale(582, 646), 1.1);
  assert.equal(getAutomaticOverlayScale(1053, 1921), undefined);
  assert.equal(getAutomaticOverlayScale(1048, 1220), undefined);
  assert.equal(getAutomaticOverlayScale(1200, 630), undefined);
});
