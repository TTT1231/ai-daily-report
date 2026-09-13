import test from "node:test";
import assert from "node:assert/strict";
import {
  getBalancedIntroColumnLayout,
  getIntroScrollTransform,
} from "../../src/AiDailyReport";

test("intro scroll ends at the rendered content bottom", () => {
  assert.equal(getIntroScrollTransform(0, 700), "translateY(calc(0% + 0px))");
  assert.equal(
    getIntroScrollTransform(0.5, 700),
    "translateY(calc(-50% + 350px))",
  );
  assert.equal(
    getIntroScrollTransform(1, 700),
    "translateY(calc(-100% + 700px))",
  );
});

test("intro cards stay ordered while columns are height-balanced", () => {
  const bulletCounts = [9, 2, 4, 2, 2, 3, 2, 1, 2];
  const tabs = bulletCounts.map((count, index) => ({
    id: `intro-${index}`,
    title: `栏目${index}`,
    summary: Array.from({ length: count }, (_, bullet) => `要点${bullet}`).join(
      "\n",
    ),
    icon: `icons/intro-${index}.svg`,
  }));

  const layout = getBalancedIntroColumnLayout(tabs);

  assert.deepEqual(layout.columns, [
    [0, 4, 6, 8],
    [1, 2, 3, 5, 7],
  ]);
  assert.ok(
    Math.abs(layout.estimatedHeights[0] - layout.estimatedHeights[1]) <= 22,
  );
  for (const column of layout.columns) {
    assert.deepEqual(
      column,
      [...column].sort((a, b) => a - b),
    );
  }
});
