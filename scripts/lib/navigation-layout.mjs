import {readFileSync} from "node:fs";
import {resolve} from "node:path";

const videoLayout = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../config/video-layout.json"), "utf8"),
);
const navigation = videoLayout.navigation;

export const getNavigationTypography = (itemCount) => {
  const layout = navigation.layouts.find(({minItems}) => itemCount >= minItems);
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

export const navigationCapacity = (labels) => ({
  availableWidth: videoLayout.width,
  requiredWidth:
    navigation.edgeInset * 2 +
    Math.max(0, labels.length - 1) * navigation.itemGap +
    labels.reduce(
      (total, label) => total + navigationMinimumWidth(label, labels.length),
      0,
    ),
});

export const mergeAdjacentNavigationLabels = (labels) =>
  labels.filter((label, index) => index === 0 || label !== labels[index - 1]);

export const reportNavigationLabels = (report) => {
  const intro = report.intro ?? {topTitle: "Intro", bottomTitle: "Intro"};
  const outro = report.outro ?? {topTitle: "结语", bottomTitle: "再见"};
  const timeline = [intro, ...(report.stories ?? []), outro];
  return {
    bottom: timeline.map(({bottomTitle}) => bottomTitle),
    top: mergeAdjacentNavigationLabels(
      timeline.map(({topTitle}) => topTitle),
    ),
  };
};
