import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const videoLayout = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../../config/video-layout.json"),
    "utf8",
  ),
);
const navigation = videoLayout.navigation;
export const maxTopCategories = navigation.maxTopCategories;

// ASCII 字符的视觉宽度系数：单一事实源是 video-layout.json 的
// navigation.asciiWidthFactor。tab summary 可见宽度校验（report-validation）
// 等处也必须从这里取值，避免改配置后各处口径漂移。
export const asciiWidthFactor = navigation.asciiWidthFactor;
export const topNavigationComfortFillRatio =
  navigation.topComfortFillRatio;

export const getNavigationTypography = (itemCount) => {
  const layout = navigation.layouts.find(
    ({ minItems }) => itemCount >= minItems,
  );
  if (!layout) {
    throw new Error(`No navigation layout configured for ${itemCount} items`);
  }
  return layout;
};

const navigationLabelWidthUnits = (label) =>
  [...label].reduce(
    (total, character) =>
      total +
      ((character.codePointAt(0) ?? 0) <= 0xff
        ? navigation.asciiWidthFactor
        : 1),
    0,
  );

export const navigationMinimumWidth = (label, itemCount) => {
  const { fontSize, horizontalPadding } = getNavigationTypography(itemCount);
  return Math.ceil(
    Math.max(
      navigation.minimumItemWidth,
      navigationLabelWidthUnits(label) * fontSize +
        horizontalPadding * 2 +
        navigation.itemChromeWidth,
    ),
  );
};

// 底部窗口导航不使用 layouts 的响应式字号：非当前项与当前项字号、内边距固定，
// 且当前项额外携带序号胶囊。校验与渲染共用这里的口径，避免"通过校验但画面越界"。
// 必须与 src/navigation-layout.ts 保持同步。
export const navigationBottomItemMinimumWidth = (label, active) =>
  Math.ceil(
    Math.max(
      navigation.minimumItemWidth,
      navigationLabelWidthUnits(label) *
        (active
          ? navigation.bottomActiveFontSize
          : navigation.bottomInactiveFontSize) +
        navigation.bottomHorizontalPadding * 2 +
        navigation.itemChromeWidth +
        (active
          ? navigation.bottomActiveExtraGap + navigation.bottomCounterWidth
          : 0),
    ),
  );

export const getNavigationWindow = (
  items,
  activeIndex,
  windowItems = navigation.bottomWindowItems,
) => {
  if (items.length <= windowItems) return items;
  const safeActiveIndex = Math.min(Math.max(activeIndex, 0), items.length - 1);
  const preferredStart = safeActiveIndex - Math.floor(windowItems / 2);
  const start = Math.min(
    Math.max(preferredStart, 0),
    items.length - windowItems,
  );
  return items.slice(start, start + windowItems);
};

const navigationRowRequiredWidth = (labels) =>
  navigation.edgeInset * 2 +
  Math.max(0, labels.length - 1) * navigation.itemGap +
  labels.reduce(
    (total, label) => total + navigationMinimumWidth(label, labels.length),
    0,
  );

const navigationBottomRowRequiredWidth = (labels) => {
  const inactiveWidths = labels.map((label) =>
    navigationBottomItemMinimumWidth(label, false),
  );
  // 渲染时窗口内恰有一项激活；按最坏情况把增量最大的项当作激活项。
  const maxActiveDelta = Math.max(
    0,
    ...labels.map(
      (label, index) =>
        navigationBottomItemMinimumWidth(label, true) - inactiveWidths[index],
    ),
  );
  return (
    navigation.edgeInset * 2 +
    Math.max(0, labels.length - 1) * navigation.itemGap +
    inactiveWidths.reduce((total, width) => total + width, 0) +
    maxActiveDelta
  );
};

const navigationWindows = (labels) => {
  const windowItems = navigation.bottomWindowItems;
  if (labels.length <= windowItems) return [labels];
  return Array.from({ length: labels.length - windowItems + 1 }, (_, start) =>
    labels.slice(start, start + windowItems),
  );
};

export const navigationCapacity = (labels, { windowed = false } = {}) => ({
  availableWidth: videoLayout.width,
  requiredWidth: Math.max(
    0,
    ...(windowed ? navigationWindows(labels) : [labels]).map((row) =>
      windowed
        ? navigationBottomRowRequiredWidth(row)
        : navigationRowRequiredWidth(row),
    ),
  ),
});

export const mergeAdjacentNavigationLabels = (labels) =>
  labels.filter((label, index) => index === 0 || label !== labels[index - 1]);

export const reportNavigationLabels = (report) => {
  const intro = report.intro ?? { topTitle: "Intro", bottomTitle: "Intro" };
  const outro = report.outro ?? { topTitle: "结语", bottomTitle: "再见" };
  const timeline = [intro, ...(report.stories ?? []), outro];
  return {
    bottom: timeline.map(({ bottomTitle }) => bottomTitle),
    top: mergeAdjacentNavigationLabels(
      timeline.map(({ topTitle }) => topTitle),
    ),
  };
};
