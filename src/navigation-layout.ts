import videoLayout from "../config/video-layout.json";

const navigation = videoLayout.navigation;

export const getNavigationTypography = (itemCount: number) => {
  const layout = navigation.layouts.find(
    ({ minItems }) => itemCount >= minItems,
  );
  if (!layout) {
    throw new Error(`No navigation layout configured for ${itemCount} items`);
  }
  return layout;
};

const navigationLabelWidthUnits = (label: string) =>
  [...label].reduce(
    (total, character) =>
      total +
      ((character.codePointAt(0) ?? 0) <= 0xff
        ? navigation.asciiWidthFactor
        : 1),
    0,
  );

export const navigationMinimumWidth = (label: string, itemCount: number) => {
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
export const navigationBottomItemMinimumWidth = (
  label: string,
  active: boolean,
) =>
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

export const getNavigationWindow = <T>(
  items: T[],
  activeIndex: number,
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

const navigationRowRequiredWidth = (labels: string[]) =>
  navigation.edgeInset * 2 +
  Math.max(0, labels.length - 1) * navigation.itemGap +
  labels.reduce(
    (total, label) => total + navigationMinimumWidth(label, labels.length),
    0,
  );

const navigationBottomRowRequiredWidth = (labels: string[]) => {
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

const navigationWindows = (labels: string[]) => {
  const windowItems = navigation.bottomWindowItems;
  if (labels.length <= windowItems) return [labels];
  return Array.from({ length: labels.length - windowItems + 1 }, (_, start) =>
    labels.slice(start, start + windowItems),
  );
};

export const navigationRequiredWidth = (labels: string[], windowed = false) =>
  Math.max(
    0,
    ...(windowed ? navigationWindows(labels) : [labels]).map((row) =>
      windowed ? navigationBottomRowRequiredWidth(row) : navigationRowRequiredWidth(row),
    ),
  );

export const navigationAvailableWidth = videoLayout.width;
export const navigationEdgeInset = navigation.edgeInset;
export const navigationItemGap = navigation.itemGap;
export const navigationBottomWindowItems = navigation.bottomWindowItems;
export const navigationBottomInactiveFontSize =
  navigation.bottomInactiveFontSize;
export const navigationBottomActiveFontSize = navigation.bottomActiveFontSize;
export const navigationBottomHorizontalPadding =
  navigation.bottomHorizontalPadding;
export const navigationBottomActiveExtraGap = navigation.bottomActiveExtraGap;

export const mergeAdjacentNavigationLabels = (labels: string[]) =>
  labels.filter((label, index) => index === 0 || label !== labels[index - 1]);
