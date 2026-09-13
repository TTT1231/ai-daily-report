import {test} from "bun:test";
import assert from "node:assert/strict";
import {collectTabIconEntries, validateReportIcons} from "../icon-validation.mjs";
import {buildGenerateSvgTargetPlan} from "../generate-svg-payload.mjs";
test("production icons follow visible cards, including mixed legacy stories", () => {
  const report = {intro: {id: "intro", tabs: [{id: "intro-a"}]}, stories: [
    {id: "evidence", tabs: [{id: "a"}], scenes: [{overlayImg: "images/a.png"}]},
    {id: "legacy", tabs: [{id: "b"}], scenes: [{overlayImg: "images/b.png"}, {}]},
  ]};
  assert.deepEqual(collectTabIconEntries(report).map((entry) => entry.storyId), ["intro", "legacy"]);
  assert.equal(collectTabIconEntries(report, {visibleOnly: false}).length, 3);
  assert.equal(validateReportIcons(report).totalTabs, 2);
  assert.deepEqual(buildGenerateSvgTargetPlan(report, {force: true}).targets.map((target) => target.storyId), ["intro", "legacy"]);
});
