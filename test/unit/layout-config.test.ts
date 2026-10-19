import test from "node:test";
import assert from "node:assert/strict";
import { getTabLayout } from "../../src/layout-config";
import { previewTabs } from "../../src/tab-layout-preview-fixture";

test("a one-card brief occupies a centered single column with readable two-card typography", () => {
  const single = getTabLayout(1);
  assert.equal(single.columns, 1);
  assert.equal(single.rows, 1);
  assert.equal(single.containerWidth, "50%");
  assert.equal(single.summaryFontSize, getTabLayout(2).summaryFontSize);
  assert.equal(single.summaryLineClamp, getTabLayout(2).summaryLineClamp);
});

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
