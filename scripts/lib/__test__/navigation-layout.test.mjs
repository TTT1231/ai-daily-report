import test from "node:test";
import assert from "node:assert/strict";
import {
  getNavigationTypography,
  navigationMinimumWidth,
  navigationBottomItemMinimumWidth,
  navigationCapacity,
  getNavigationWindow,
  mergeAdjacentNavigationLabels,
  reportNavigationLabels,
} from "../navigation-layout.mjs";

// navigation-layout 是 validateReport 导航容量校验的底座（此前 0 测试）。
// 常量来自 config/video-layout.json：width=1920，minimumItemWidth=82，asciiWidthFactor=0.62，
// 底部窗口规格：windowItems=5，非激活 22px / 激活 26px，padding 18，激活间距 12，胶囊 92。

// ---------- getNavigationTypography：按条目数选更小字号 ----------
test("getNavigationTypography picks smaller fonts as item count grows", () => {
  assert.equal(
    getNavigationTypography(0).fontSize,
    24,
    "0 items -> largest font",
  );
  assert.equal(getNavigationTypography(7).fontSize, 21, ">=7 -> 21");
  assert.equal(getNavigationTypography(9).fontSize, 19, ">=9 -> 19");
  assert.equal(
    getNavigationTypography(12).fontSize,
    17,
    ">=12 -> smallest font",
  );
});

// ---------- navigationMinimumWidth：下限 + 字符宽度 ----------
test("navigationMinimumWidth floors short labels at minimumItemWidth (82)", () => {
  assert.equal(
    navigationMinimumWidth("A", 1),
    82,
    "single ASCII char still >= 82",
  );
  assert.equal(navigationMinimumWidth("", 1), 82, "empty label still >= 82");
});

test("navigationMinimumWidth counts CJK as full width and ASCII as 0.62", () => {
  // 6 CJK @ fontSize 17 (itemCount>=12) -> ceil(6*17 + 6*2 + 18) = ceil(132) = 132
  assert.equal(navigationMinimumWidth("一二三四五六", 12), 132);
  // long label exceeds the floor, so the content-driven width wins
  assert.ok(
    navigationMinimumWidth("一二三四五六七八九十", 1) > 82,
    "long CJK label should exceed the minimum floor",
  );
});

// ---------- navigationCapacity：溢出检测 ----------
test("navigationCapacity reports availableWidth=1920 and requiredWidth=0 for no labels", () => {
  assert.deepEqual(navigationCapacity([]), {
    availableWidth: 1920,
    requiredWidth: 0,
  });
});

test("navigationCapacity computes an exact requiredWidth for a single short label", () => {
  // 1 ASCII char, itemCount 1 -> fontSize 24; ceil(0.62*24 + 10*2 + 18)=ceil(52.88)=53 -> floored to 82
  assert.deepEqual(navigationCapacity(["A"]), {
    availableWidth: 1920,
    requiredWidth: 82,
  });
});

test("getNavigationWindow keeps the active item centered when possible", () => {
  const items = Array.from({ length: 23 }, (_, index) => index);
  assert.deepEqual(getNavigationWindow(items, 11, 5), [9, 10, 11, 12, 13]);
  assert.deepEqual(getNavigationWindow(items, 0, 5), [0, 1, 2, 3, 4]);
  assert.deepEqual(getNavigationWindow(items, 22, 5), [18, 19, 20, 21, 22]);
});

test("navigationCapacity measures bottom navigation by its widest visible window", () => {
  const labels = Array.from({ length: 23 }, () => "短标");
  assert.ok(navigationCapacity(labels).requiredWidth > 1920);
  assert.ok(
    navigationCapacity(labels, { windowed: true }).requiredWidth < 1920,
  );
});

// ---------- 底部窗口导航：激活项增量与最坏情况 ----------

test("navigationBottomItemMinimumWidth floors short labels and charges active extras", () => {
  assert.equal(
    navigationBottomItemMinimumWidth("甲", false),
    82,
    "short inactive label still >= 82",
  );
  // 6 CJK：非激活 ceil(6*22+18*2+18)=186；激活再加 26-22 字号差、间距 12 与胶囊 92。
  assert.equal(navigationBottomItemMinimumWidth("一二三四五六", false), 186);
  assert.equal(navigationBottomItemMinimumWidth("一二三四五六", true), 314);
});

test("windowed capacity treats the longest label in a window as the active item", () => {
  const labels = ["一二三四五六", "甲乙", "一二三四五六七八九", "丙", "丁"];
  const allInactive =
    labels.reduce(
      (total, label) => total + navigationBottomItemMinimumWidth(label, false),
      0,
    ) + 4 * 4;
  const { requiredWidth } = navigationCapacity(labels, { windowed: true });
  assert.ok(
    requiredWidth > allInactive,
    `worst case ${requiredWidth}px must exceed all-inactive ${allInactive}px`,
  );
});

test("windowed capacity accepts fifteen five-char stories that a full-row model rejects", () => {
  // 15 个五字标题（17 个标签）：渲染层只需 5 项滑动窗口，校验必须放行；
  // 旧的"全量单排"口径会算出 1954px 并错误拒绝。
  const labels = ["Intro", ...Array.from({ length: 15 }, () => "五字标题甲"), "再见"];
  const { availableWidth, requiredWidth } = navigationCapacity(labels, {
    windowed: true,
  });
  assert.ok(requiredWidth < availableWidth);
  assert.ok(
    navigationCapacity(labels).requiredWidth > availableWidth,
    "full-row model is expected to reject this fixture",
  );
});

test("windowed capacity rejects the five fourteen-char blind spot that rendered past 1920px", () => {
  // 5 个 14 字标签：旧模型（layouts 字号、忽略激活项胶囊）算出 1886px 放行，
  // 实际渲染约 1964px 越界；新口径必须拒绝。
  const labels = Array.from({ length: 5 }, () => "字".repeat(14));
  const { availableWidth, requiredWidth } = navigationCapacity(labels, {
    windowed: true,
  });
  assert.ok(
    requiredWidth > availableWidth,
    `expected overflow detection, got ${requiredWidth}px`,
  );
});

test("navigationCapacity grows requiredWidth with more and longer labels", () => {
  const short = navigationCapacity(["短标"]).requiredWidth;
  const three = navigationCapacity(["短标", "短标", "短标"]).requiredWidth;
  const long = navigationCapacity([
    "这是一个比较长的底部导航标签",
  ]).requiredWidth;
  assert.ok(three > short, "more labels -> larger requiredWidth");
  assert.ok(long > short, "longer label -> larger requiredWidth");
});

test("navigationCapacity flags overflow when long labels exceed the video width", () => {
  // 5 个 20-CJK 字符的标签 @ fontSize 24 -> 每个约 518px，合计 ~2606px > 1920
  const labels = Array.from({ length: 5 }, () => "字".repeat(20));
  const { availableWidth, requiredWidth } = navigationCapacity(labels);
  assert.ok(
    requiredWidth > availableWidth,
    "expected navigation overflow to be detected",
  );
});

// ---------- mergeAdjacentNavigationLabels ----------
test("mergeAdjacentNavigationLabels collapses only consecutive duplicates", () => {
  assert.deepEqual(
    mergeAdjacentNavigationLabels(["A", "A", "B", "A", "C", "C"]),
    ["A", "B", "A", "C"],
  );
  assert.deepEqual(mergeAdjacentNavigationLabels([]), []);
  assert.deepEqual(mergeAdjacentNavigationLabels(["X"]), ["X"]);
});

// ---------- reportNavigationLabels ----------
test("reportNavigationLabels lists every bottom title and merges adjacent top titles", () => {
  const labels = reportNavigationLabels({
    intro: { topTitle: "Intro", bottomTitle: "Intro" },
    stories: [
      { topTitle: "模型", bottomTitle: "GLM" },
      { topTitle: "模型", bottomTitle: "Qwen" },
      { topTitle: "芯片", bottomTitle: "Jalapeño" },
    ],
    outro: { topTitle: "结语", bottomTitle: "再见" },
  });
  assert.deepEqual(labels.bottom, ["Intro", "GLM", "Qwen", "Jalapeño", "再见"]);
  assert.deepEqual(labels.top, ["Intro", "模型", "芯片", "结语"]);
});

test("reportNavigationLabels synthesizes intro/outro labels when absent", () => {
  const labels = reportNavigationLabels({
    stories: [{ topTitle: "A", bottomTitle: "a" }],
  });
  assert.equal(labels.bottom[0], "Intro");
  assert.equal(labels.bottom[labels.bottom.length - 1], "再见");
  assert.equal(labels.top[0], "Intro");
  assert.equal(labels.top[labels.top.length - 1], "结语");
});
