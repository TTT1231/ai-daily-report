// 项目级布局常量与查表，集中管理原本散落在渲染组件里的魔法数字。
// 与 navigation-layout.ts 同属「布局配置层」：要调尺寸，改这里一处即可。

// ── Tabs 卡片布局 ────────────────────────────────────────────────────────
// 不同 tab 数量对应的卡片网格尺寸。数值与重构前的内联三元逐一等价，只是
// 把它们从 Tabs 组件里抽出来集中查阅，避免六七个字段各自叠一堆三元。
export interface TabLayout {
  columns: number;
  rows: number;
  isTwoCardLayout: boolean;
  isSingleRow: boolean;
  isFiveCardLayout: boolean;
  isDenseLayout: boolean;
  gap: number;
  containerWidth: string;
  containerHeight: string;
  cardPadding: string;
  titleFontSize: number;
  summaryFontSize: number;
  summaryLineHeight: number;
}

export const getTabLayout = (tabCount: number): TabLayout => {
  const isTwoCardLayout = tabCount === 2;
  const columns = isTwoCardLayout || tabCount === 4 ? 2 : 3;
  const rows = Math.ceil(tabCount / columns);
  const isSingleRow = rows === 1;
  const isDenseLayout = tabCount >= 5;
  return {
    columns,
    rows,
    isTwoCardLayout,
    isSingleRow,
    isFiveCardLayout: tabCount === 5,
    isDenseLayout,
    gap: isTwoCardLayout ? 30 : isDenseLayout ? 18 : 20,
    containerWidth: isTwoCardLayout ? "88%" : tabCount === 4 ? "76%" : "94%",
    containerHeight: isTwoCardLayout ? "58%" : isSingleRow ? "58%" : "94%",
    cardPadding: isTwoCardLayout
      ? "40px 46px"
      : isSingleRow
        ? "32px 36px"
        : isDenseLayout
          ? "22px 26px"
          : "24px 30px",
    titleFontSize: isTwoCardLayout
      ? 40
      : isSingleRow
        ? 34
        : isDenseLayout
          ? 30
          : 33,
    summaryFontSize: isTwoCardLayout
      ? 33
      : isSingleRow
        ? 29
        : isDenseLayout
          ? 26
          : 28,
    summaryLineHeight: isTwoCardLayout
      ? 1.44
      : isSingleRow
        ? 1.45
        : isDenseLayout
          ? 1.38
          : 1.42,
  };
};

// ── Overlay 图片 ────────────────────────────────────────────────────────
// 判定 overlay 图片是否按「小图」样式渲染（加底卡 / 更大放大倍数）的阈值。
export const OVERLAY_SMALL_WIDTH = 640;
export const OVERLAY_SMALL_HEIGHT = 360;
export const OVERLAY_SMALL_AREA = 260000;

// ── Intro 概览 ──────────────────────────────────────────────────────────
export const INTRO_GAP = 22;
export const INTRO_VIEWPORT_HEIGHT = 700;
