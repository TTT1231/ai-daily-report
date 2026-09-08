import test from "node:test";
import assert from "node:assert/strict";
import { getTabLayout } from "../../src/layout-config";
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
