import videoLayout from "../config/video-layout.json";

const navigation = videoLayout.navigation;

export const getNavigationTypography = (itemCount: number) => {
  const layout = navigation.layouts.find(({minItems}) => itemCount >= minItems);
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
  const {fontSize, horizontalPadding} = getNavigationTypography(itemCount);
  return Math.ceil(
    Math.max(
      navigation.minimumItemWidth,
      navigationLabelWidthUnits(label) * fontSize +
        horizontalPadding * 2 +
        navigation.itemChromeWidth,
    ),
  );
};

export const navigationRequiredWidth = (labels: string[]) =>
  navigation.edgeInset * 2 +
  Math.max(0, labels.length - 1) * navigation.itemGap +
  labels.reduce(
    (total, label) => total + navigationMinimumWidth(label, labels.length),
    0,
  );

export const navigationAvailableWidth = videoLayout.width;
export const navigationEdgeInset = navigation.edgeInset;
export const navigationItemGap = navigation.itemGap;

export const mergeAdjacentNavigationLabels = (labels: string[]) =>
  labels.filter((label, index) => index === 0 || label !== labels[index - 1]);
