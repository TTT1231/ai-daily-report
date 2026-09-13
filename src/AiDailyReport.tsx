import {
  AbsoluteFill,
  Audio,
  cancelRender,
  continueRender,
  delayRender,
  Easing,
  Img,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { useEffect, useMemo, useRef, useState, type FC } from "react";
import {
  hasDailyReportProps,
  resolveDailyReport,
  type DailyIntro,
  type DailyOutro,
  type DailyReport,
  type DailyScene,
  type DailyStory,
  type DailyTab,
} from "./daily-report-data";
import {
  getNavigationWindow,
  getNavigationTypography,
  navigationBottomActiveExtraGap,
  navigationBottomActiveFontSize,
  navigationBottomHorizontalPadding,
  navigationBottomInactiveFontSize,
  navigationBottomItemMinimumWidth,
  navigationBottomWindowItems,
  navigationEdgeInset,
  navigationItemGap,
  navigationMinimumWidth,
} from "./navigation-layout";
import {
  getTabLayout,
  INTRO_GAP,
  INTRO_VIEWPORT_HEIGHT,
  OVERLAY_MEDIUM_SCREENSHOT_MAX_ASPECT,
  OVERLAY_MEDIUM_SCREENSHOT_MIN_AREA,
  OVERLAY_MEDIUM_SCREENSHOT_MIN_HEIGHT,
  OVERLAY_MEDIUM_SCREENSHOT_MIN_WIDTH,
  OVERLAY_SMALL_AREA,
  OVERLAY_SMALL_HEIGHT,
  OVERLAY_SMALL_WIDTH,
} from "./layout-config";
// 时间线常量的单一事实源是 video-timeline.json（与 scripts/lib/report-builder.mjs
// 评论/生成侧同源读取），改配置即两侧同步，避免此前硬编码常量漂移导致评论与画面错位。
import videoTimeline from "../config/video-timeline.json";
import { previewTabs } from "./tab-layout-preview-fixture";
import clickSound from "./sound/click-sound.mp3";

// ── Palette & constants ──────────────────────────────────────────────────

const themes = {
  // 晚间「微暖纸面」主题（原型 out/theme-review/evening-theme-preview.html 方案 B）：
  // 正极性（深字浅底）暖米画布，以横屏标准显示态为基准；mock 未覆盖的派生项
  // （导航高光、阴影、emphasis/code、overlay 卡、intro 色板）按 light 主题同构
  // 模式换暖棕色相，阴影统一走 rgba(75,63,52,*)，overlay 深影用 mock 的暖深棕。
  dark: {
    text: "#3b403f",
    muted: "#62635f",
    blue: "#a55740",
    strong: "#3b302b",
    contentTitle: "#974a34",
    activeTabTitle: "#974a34",
    canvas:
      "radial-gradient(circle at 12% -18%, rgba(100,128,137,.07), transparent 40%), radial-gradient(circle at 92% 0%, rgba(183,111,74,.10), transparent 38%), linear-gradient(180deg, #eee8dc 0%, #e0dbd1 78%)",
    ambient: "linear-gradient(180deg, rgba(255,250,235,.34), transparent 42%)",
    nav: "rgba(239,233,222,.94)",
    navChapterActive:
      "linear-gradient(90deg, transparent 0%, rgba(165,87,64,.04) 10%, rgba(165,87,64,.11) 50%, rgba(165,87,64,.04) 90%, transparent 100%)",
    navDockActive:
      "linear-gradient(90deg, transparent 0%, rgba(165,87,64,.04) 14%, rgba(165,87,64,.13) 50%, rgba(165,87,64,.04) 86%, transparent 100%)",
    navDockShadow:
      "0 -10px 28px rgba(75,63,52,.06), inset 0 1px 0 rgba(255,250,235,.66)",
    border: "rgba(91,86,79,.19)",
    activeCard:
      "linear-gradient(145deg, rgba(249,239,231,.99), rgba(239,224,214,.99))",
    inactiveCard:
      "linear-gradient(145deg, rgba(250,247,239,.99), rgba(239,235,226,.99))",
    activeCardBorder: "#b2634a",
    inactiveCardBorder: "rgba(91,86,79,.25)",
    activeCardShadow:
      "inset 0 3px 0 rgba(178,99,74,.18), 0 16px 34px rgba(75,63,52,.12), 0 0 0 1px rgba(165,87,64,.05)",
    inactiveCardShadow:
      "inset 0 1px 0 rgba(255,250,235,.88), 0 9px 22px rgba(75,63,52,.10)",
    inactiveCardText: "#3b403f",
    activeSummary: "#5c4740",
    inactiveSummary: "#535a59",
    emphasisText: "#904d36",
    emphasisBackground: "rgba(217,138,43,.13)",
    emphasisBorder: "rgba(165,87,64,.62)",
    emphasisShadow: "none",
    codeText: "#275761",
    codeBackground: "rgba(44,119,133,.10)",
    codeBorder: "rgba(40,120,138,.36)",
    codeShadow: "inset 0 0 0 1px rgba(255,255,255,.48)",
    codeFontWeight: 850,
    subtitleText: "#303a3b",
    subtitleBackground: "rgba(251,247,238,.90)",
    subtitleBorder: "rgba(98,99,95,.20)",
    subtitleShadow: "0 8px 20px rgba(75,63,52,.10)",
    subtitlePadding: "9px 24px",
    overlayShadow: "0 30px 76px rgba(39,34,29,.28)",
    overlayCardBackground: "rgba(250,247,239,.90)",
    overlayCardBorder: "rgba(91,86,79,.16)",
    introTitleColors: [
      "#a34558",
      "#2f6f9e",
      "#96690d",
      "#237a63",
      "#6c54ad",
      "#b25e1f",
    ],
  },
  // 短视频亮色：冷灰画布承托白卡，蓝色只标记当前重点；实色字幕保证扫读对比。
  light: {
    text: "#182538",
    muted: "#526174",
    blue: "#245bdb",
    strong: "#142b50",
    contentTitle: "#182538",
    activeTabTitle: "#194fbd",
    canvas: "#e9eef5",
    ambient: "none",
    nav: "#f5f7fb",
    navChapterActive:
      "linear-gradient(90deg, transparent 0%, #dce7fc 20%, #dce7fc 80%, transparent 100%)",
    navDockActive:
      "linear-gradient(90deg, transparent 0%, #dce7fc 20%, #dce7fc 80%, transparent 100%)",
    navDockShadow: "0 -2px 10px rgba(24,37,56,.05)",
    border: "#c8d3e2",
    activeCard: "#edf3ff",
    inactiveCard: "#ffffff",
    activeCardBorder: "#245bdb",
    inactiveCardBorder: "#c8d3e2",
    activeCardShadow:
      "inset 0 5px 0 #245bdb, 0 6px 16px rgba(36,91,219,.10)",
    inactiveCardShadow: "0 2px 6px rgba(24,37,56,.04)",
    inactiveCardText: "#182538",
    activeSummary: "#203653",
    inactiveSummary: "#36465a",
    emphasisText: "#173b79",
    emphasisBackground: "#dce8ff",
    emphasisBorder: "#6991df",
    emphasisShadow: "none",
    codeText: "#36465a",
    codeBackground: "rgba(24,37,56,.035)",
    codeBorder: "transparent",
    codeShadow: "none",
    codeFontWeight: 650,
    subtitleText: "#ffffff",
    subtitleBackground: "#182538",
    subtitleBorder: "#182538",
    subtitleShadow: "none",
    subtitlePadding: "6px 18px",
    overlayShadow: "0 16px 40px rgba(24,37,56,.22)",
    overlayCardBackground: "#ffffff",
    overlayCardBorder: "#c8d3e2",
    introTitleColors: [
      "#194fbd",
      "#087267",
      "#873ca6",
      "#9c4b1b",
      "#3453a4",
      "#a13659",
    ],
  },
};

export type Theme = keyof typeof themes;

const STORY_ENTER_DELAY_FRAMES = 0; // story 入场淡入开始前停留的帧数（0 = 立即开始淡入）
const STORY_ENTER_FADE_FRAMES = 10; // story 入场淡入持续的帧数
const STORY_TRANSITION_FRAMES = videoTimeline.storyTransitionFrames;
// 横屏证据舞台的可用区域为 1836×760。宽图尽量吃满宽度，网页截图则受高度
// 约束，始终留在标题和字幕之间，不再靠动画放大越界。
const OVERLAY_MAX_WIDTH = 1836;
const OVERLAY_MAX_HEIGHT = 760;
const OVERLAY_MAX_UPSCALE = 2.25;
const OVERLAY_SMALL_MAX_WIDTH = 980;
const OVERLAY_SMALL_MAX_HEIGHT = 560;
const OVERLAY_SMALL_MAX_UPSCALE = 3.6;
const OVERLAY_PORTRAIT_MAX_HEIGHT = 740;
const SUBTITLE_MAX_VISUAL_UNITS = 44;
const SUBTITLE_FONT_SIZE = 36;
const SUBTITLE_TOKEN_PATTERN =
  /[A-Za-z][A-Za-z0-9]*(?:\s+\d+(?:\.\d+)+)(?:\s+[A-Za-z][A-Za-z0-9-]*)+|[A-Za-z0-9]+(?:[._:/+-][A-Za-z0-9]+)+(?:[A-Za-z%]*)?|[A-Za-z0-9]+(?:[A-Za-z%]*)?|\s+|./gu;
const SUBTITLE_TRAILING_PUNCTUATION_PATTERN = /^[，。！？；,!?;]$/u;

const msToFrames = (milliseconds: number, fps: number) =>
  Math.round((milliseconds / 1000) * fps);

// Keep voiceover continuous while presenting long captions as timed single lines.
export const subtitleVisualUnits = (text: string) =>
  [...text].reduce((total, character) => {
    if (/\s/.test(character)) return total + 0.32;
    if ((character.codePointAt(0) ?? 0) <= 0xff) return total + 0.56;
    return total + 1;
  }, 0);

// splitOversizedToken 把单个超过字幕宽度预算的 token（如极长型号/版本串、长 URL）按视觉单位
// 边界硬切成多条 ≤ 预算的片段。仅在 token 本身超预算时作为兜底：此情形下「不拆 token」会让整条
// cue 超 SUBTITLE_MAX_VISUAL_UNITS，而渲染容器 nowrap 且无 overflow 规则会被裁剪丢内容，拆开至少能完整显示。
const splitOversizedToken = (token: string) => {
  const pieces: string[] = [];
  let piece = "";
  let units = 0;
  for (const character of token) {
    const characterUnits = subtitleVisualUnits(character);
    if (units + characterUnits > SUBTITLE_MAX_VISUAL_UNITS && piece) {
      pieces.push(piece);
      piece = "";
      units = 0;
    }
    piece += character;
    units += characterUnits;
  }
  if (piece) pieces.push(piece);
  return pieces;
};

const hardSplitSubtitleSegment = (segment: string) => {
  const chunks: string[] = [];
  let chunk = "";
  let units = 0;

  for (const token of segment.match(SUBTITLE_TOKEN_PATTERN) ?? [segment]) {
    const tokenUnits = subtitleVisualUnits(token);
    // 单个 token 本身就超过预算：先 flush 已累积的 chunk，再把该 token 硬切后逐段入列，
    // 保证没有任何 chunk 超过预算（旧逻辑因 `chunk &&` 守卫在首 token 时短路，会整条吐出超预算）。
    if (tokenUnits > SUBTITLE_MAX_VISUAL_UNITS) {
      if (chunk.trim()) {
        chunks.push(chunk.trim());
        chunk = "";
        units = 0;
      }
      for (const piece of splitOversizedToken(token)) chunks.push(piece);
      continue;
    }
    if (chunk && units + tokenUnits > SUBTITLE_MAX_VISUAL_UNITS) {
      if (SUBTITLE_TRAILING_PUNCTUATION_PATTERN.test(token)) {
        const characters = [...chunk.trimEnd()];
        const lastCharacter = characters.pop() ?? "";
        const head = characters.join("").trim();
        if (head) chunks.push(head);
        chunk = `${lastCharacter}${token}`;
        units = subtitleVisualUnits(chunk);
        continue;
      }
      chunks.push(chunk.trim());
      chunk = token.trimStart();
      units = subtitleVisualUnits(chunk);
      continue;
    }
    chunk += token;
    units += tokenUnits;
  }

  if (chunk.trim()) chunks.push(chunk.trim());
  return chunks;
};

export const splitSubtitlePieces = (subtitle: string) => {
  const pieces: string[] = [];
  let piece = "";

  for (const token of subtitle.match(SUBTITLE_TOKEN_PATTERN) ?? [subtitle]) {
    piece += token;
    if (SUBTITLE_TRAILING_PUNCTUATION_PATTERN.test(token) && piece.trim()) {
      pieces.push(piece);
      piece = "";
    }
  }

  if (piece.trim()) pieces.push(piece);
  return pieces;
};

export const splitSubtitleCues = (subtitle: string) => {
  const normalized = subtitle
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .trim()
    .replace(/\s+/g, " ");
  if (subtitleVisualUnits(normalized) <= SUBTITLE_MAX_VISUAL_UNITS) {
    return [normalized];
  }

  const pieces = splitSubtitlePieces(normalized).reduce<string[]>(
    (chunks, piece) => chunks.concat(hardSplitSubtitleSegment(piece)),
    [],
  );
  const cues: string[] = [];
  let cue = "";

  for (const piece of pieces) {
    if (cue && subtitleVisualUnits(cue + piece) > SUBTITLE_MAX_VISUAL_UNITS) {
      cues.push(cue.trim());
      cue = "";
    }
    cue += piece;
  }

  if (cue.trim()) cues.push(cue.trim());
  return cues;
};

// 字幕切分与视觉宽度只依赖 scene.subtitle，与帧无关，按 scene 缓存一次，
// 避免每帧重复执行 regex 切分与逐字统计。
const subtitleCueCache = new WeakMap<
  DailyScene,
  { cues: string[]; totalUnits: number }
>();

const getSubtitleCueData = (scene: DailyScene) => {
  const cached = subtitleCueCache.get(scene);
  if (cached) return cached;
  const cues = splitSubtitleCues(scene.subtitle);
  const totalUnits = cues.reduce(
    (total, cue) => total + subtitleVisualUnits(cue),
    0,
  );
  const entry = { cues, totalUnits };
  subtitleCueCache.set(scene, entry);
  return entry;
};

const getSubtitleCue = (
  scene: DailyScene,
  sceneFrame: number,
  sceneDuration: number,
) => {
  const { cues, totalUnits } = getSubtitleCueData(scene);
  if (cues.length === 1) return cues[0];

  const audioDurationFrames = scene.tts
    ? sceneDuration *
      (scene.tts.audioLengthMs /
        (scene.tts.audioLengthMs + scene.tts.tailPaddingMs))
    : sceneDuration;
  const currentUnits =
    (Math.min(sceneFrame, Math.max(0, audioDurationFrames - 1)) /
      Math.max(1, audioDurationFrames)) *
    totalUnits;
  let cursor = 0;

  for (const cue of cues) {
    cursor += subtitleVisualUnits(cue);
    if (currentUnits < cursor) return cue;
  }

  return cues[cues.length - 1];
};

export const getOverlayImageLayout = (scene: DailyScene) => {
  const width = scene.overlayImgWidth;
  const height = scene.overlayImgHeight;
  if (!width || !height) return null;

  const tallNarrow =
    width / height < 0.85 &&
    height >= OVERLAY_SMALL_HEIGHT &&
    width * height >= OVERLAY_SMALL_AREA;
  const mediumScreenshot =
    width >= OVERLAY_MEDIUM_SCREENSHOT_MIN_WIDTH &&
    height >= OVERLAY_MEDIUM_SCREENSHOT_MIN_HEIGHT &&
    width * height >= OVERLAY_MEDIUM_SCREENSHOT_MIN_AREA &&
    width / height <= OVERLAY_MEDIUM_SCREENSHOT_MAX_ASPECT;
  const screenshotLike = tallNarrow || mediumScreenshot;
  const small =
    !screenshotLike &&
    (width < OVERLAY_SMALL_WIDTH ||
      height < OVERLAY_SMALL_HEIGHT ||
      width * height < OVERLAY_SMALL_AREA);
  const maxWidth = small ? OVERLAY_SMALL_MAX_WIDTH : OVERLAY_MAX_WIDTH;
  const maxHeight = small
    ? OVERLAY_SMALL_MAX_HEIGHT
    : screenshotLike
      ? OVERLAY_PORTRAIT_MAX_HEIGHT
      : OVERLAY_MAX_HEIGHT;
  const maxUpscale = small ? OVERLAY_SMALL_MAX_UPSCALE : OVERLAY_MAX_UPSCALE;
  const scale = Math.min(maxUpscale, maxWidth / width, maxHeight / height);
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
    maxWidth,
    maxHeight,
    small,
  };
};

// ── Unified timeline (single source of truth for all frame positions) ───
//
// Every consumer (duration, audio placement, visual state, click sounds)
// derives from this one walk, so rounding is consistent throughout.

type TimelineStory = DailyIntro | DailyStory | DailyOutro;

interface TimelineScene {
  story: TimelineStory;
  scene: DailyScene;
  storyIndex: number;
  sceneIndex: number;
  startFrame: number;
  durationFrames: number;
}

interface Timeline {
  scenes: TimelineScene[];
  storyStarts: number[];
  totalFrames: number;
}

const buildTimeline = (fps: number, report: DailyReport): Timeline => {
  const scenes: TimelineScene[] = [];
  const storyStarts: number[] = [];
  const stories = [report.intro, ...report.stories, report.outro];
  let cursor = 0;

  for (let si = 0; si < stories.length; si++) {
    const story = stories[si];
    storyStarts.push(cursor);

    for (let sci = 0; sci < story.scenes.length; sci++) {
      const scene = story.scenes[sci];
      const duration = msToFrames(scene.timing.durationMs, fps);
      scenes.push({
        story,
        scene,
        storyIndex: si,
        sceneIndex: sci,
        startFrame: cursor,
        durationFrames: duration,
      });
      cursor += duration;
    }

    if (si < stories.length - 1) {
      cursor += STORY_TRANSITION_FRAMES;
    }
  }

  return { scenes, storyStarts, totalFrames: cursor };
};

export const getReportDurationInFrames = (fps: number, report: DailyReport) =>
  buildTimeline(fps, report).totalFrames;

// ── Timeline state lookup ───────────────────────────────────────────────

const getTimelineState = (frame: number, timeline: Timeline) => {
  const { scenes, storyStarts } = timeline;

  for (let i = 0; i < scenes.length; i++) {
    const ts = scenes[i];
    const endFrame = ts.startFrame + ts.durationFrames;

    if (frame < endFrame) {
      return {
        story: ts.story,
        scene: ts.scene,
        storyIndex: ts.storyIndex,
        sceneFrame: frame - ts.startFrame,
        sceneDuration: ts.durationFrames,
        storyFrame: frame - storyStarts[ts.storyIndex],
        storyExit: 1,
      };
    }

    // After this scene ends — check if we're in a story-transition gap
    const next = scenes[i + 1];
    if (next && ts.storyIndex !== next.storyIndex && frame < next.startFrame) {
      const transitionDuration = next.startFrame - endFrame;
      const transitionFrame = frame - endFrame;
      return {
        story: ts.story,
        scene: ts.scene,
        storyIndex: ts.storyIndex,
        sceneFrame: ts.durationFrames - 1,
        sceneDuration: ts.durationFrames,
        storyFrame: endFrame - storyStarts[ts.storyIndex] - 1,
        // Outro reuses the final story's content, so keep that content steady
        // instead of fading it out and immediately showing it again.
        storyExit: isOutro(next.story)
          ? 1
          : interpolate(
              transitionFrame,
              [0, Math.max(1, transitionDuration - 1)],
              [1, 0],
              {
                easing: Easing.inOut(Easing.cubic),
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              },
            ),
      };
    }
  }

  // Fallback: last frame of the last scene
  const last = scenes[scenes.length - 1];
  const lastEnd = last.startFrame + last.durationFrames;
  return {
    story: last.story,
    scene: last.scene,
    storyIndex: last.storyIndex,
    sceneFrame: last.durationFrames - 1,
    sceneDuration: last.durationFrames,
    storyFrame: lastEnd - storyStarts[last.storyIndex] - 1,
    storyExit: 1,
  };
};

// ── Helpers ──────────────────────────────────────────────────────────────

const getStoryDurationMs = (story: TimelineStory) =>
  story.scenes.reduce((total, scene) => total + scene.timing.durationMs, 0);

const isIntro = (story: TimelineStory): story is DailyIntro =>
  story.id === "intro";

const isOutro = (story: TimelineStory): story is DailyOutro =>
  story.id === "outro";

// Type guard: narrows TimelineScene to one whose scene has a non-null audioSrc
type VoiceoverEntry = TimelineScene & {
  scene: DailyScene & { audioSrc: string };
};

const hasAudio = (ts: TimelineScene): ts is VoiceoverEntry =>
  Boolean(ts.scene.audioSrc);

// ── Sub-components ───────────────────────────────────────────────────────

const InlineMarkup: FC<{
  text: string;
  theme: Theme;
  active: boolean;
}> = ({ text, theme, active }) => {
  const palette = themes[theme];
  const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong
              key={index}
              style={{
                padding: "0 5px 1px",
                color: palette.emphasisText,
                background: palette.emphasisBackground,
                borderBottom: `2px solid ${palette.emphasisBorder}`,
                borderRadius: 4,
                fontWeight: 900,
                letterSpacing: ".015em",
                textShadow: active ? "0 1px 1px rgba(0,0,0,.12)" : "none",
                boxShadow: palette.emphasisShadow,
                boxDecorationBreak: "clone",
                WebkitBoxDecorationBreak: "clone",
              }}
            >
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code
              key={index}
              style={{
                display: "inline-block",
                padding: "1px 7px 2px",
                margin: "0 2px",
                color: palette.codeText,
                background: palette.codeBackground,
                border: `1px solid ${palette.codeBorder}`,
                borderRadius: 7,
                boxShadow: palette.codeShadow,
                fontFamily: '"Cascadia Code", Consolas, monospace',
                fontSize: ".88em",
                lineHeight: 1.15,
                fontWeight: palette.codeFontWeight,
                letterSpacing: ".01em",
                whiteSpace: "nowrap",
              }}
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        return <span key={index}>{part}</span>;
      })}
    </>
  );
};

const TabIcon: FC<{
  src: string;
  active: boolean;
  theme: Theme;
  size?: number;
}> = ({ src, active, theme, size = 62 }) => (
  <Img
    src={staticFile(src)}
    style={{
      width: size,
      height: size,
      flexShrink: 0,
      transform: active ? "scale(1.08)" : "none",
      filter:
        theme === "dark"
          ? active
            ? "saturate(1.05) brightness(1.04) drop-shadow(0 3px 8px rgba(75,63,52,.24))"
            : "none"
          : active
            ? "saturate(1.2) brightness(1.12) drop-shadow(0 0 10px rgba(111,213,255,.28))"
            : "saturate(1.1) brightness(1.06) drop-shadow(0 2px 4px rgba(0,0,0,.28))",
    }}
  />
);

type NavigationItem = { label: string; duration: number; active: boolean };

const Navigation: FC<{
  items: NavigationItem[];
  theme: Theme;
  windowed?: boolean;
}> = ({ items, theme, windowed = false }) => {
  const palette = themes[theme];
  const activeIndex = items.findIndex((item) => item.active);
  const visibleItems = windowed
    ? getNavigationWindow(items, activeIndex, navigationBottomWindowItems)
    : items;
  const { fontSize, horizontalPadding } = getNavigationTypography(
    visibleItems.length,
  );

  return (
    <div
      style={{
        display: "flex",
        height: "100%",
        alignItems: "stretch",
        gap: windowed ? navigationItemGap : 0,
        padding: `0 ${navigationEdgeInset}px`,
        boxSizing: "border-box",
        background: palette.nav,
        borderTop: windowed ? `1px solid ${palette.border}` : "none",
        borderBottom: windowed ? "none" : `1px solid ${palette.border}`,
        boxShadow: windowed ? palette.navDockShadow : "none",
      }}
    >
      {visibleItems.map((item) => {
        const itemIndex = items.indexOf(item);
        const minimumWidth = windowed
          ? navigationBottomItemMinimumWidth(item.label, item.active)
          : navigationMinimumWidth(item.label, visibleItems.length);
        return (
          <div
            key={`${item.label}-${itemIndex}`}
            style={{
              flexGrow: windowed ? 1 : item.duration,
              flexShrink: 0,
              flexBasis: minimumWidth,
              minWidth: minimumWidth,
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: item.active && windowed ? navigationBottomActiveExtraGap : 0,
              color: item.active
                ? windowed
                  ? palette.text
                  : palette.strong
                : palette.muted,
              borderLeft: "none",
              borderRight: "none",
              borderBottom: "none",
              background: item.active
                ? windowed
                  ? palette.navDockActive
                  : palette.navChapterActive
                : "transparent",
              boxShadow: "none",
              fontSize: windowed
                ? item.active
                  ? navigationBottomActiveFontSize
                  : navigationBottomInactiveFontSize
                : fontSize,
              fontWeight: item.active ? (windowed ? 760 : 700) : 560,
              letterSpacing: windowed ? ".005em" : ".02em",
              whiteSpace: "nowrap",
              lineHeight: 1,
              textAlign: "center",
              padding: `0 ${windowed ? navigationBottomHorizontalPadding : horizontalPadding}px`,
            }}
          >
            <span>{item.label === "Intro" ? "概览" : item.label}</span>
            {item.active && windowed ? (
              <span
                style={{
                  flexShrink: 0,
                  padding: "5px 9px",
                  color: palette.blue,
                  background: palette.canvas,
                  border: `1px solid ${palette.border}`,
                  borderRadius: 999,
                  fontSize: 15,
                  fontWeight: 760,
                  letterSpacing: ".03em",
                }}
              >
                {itemIndex + 1} / {items.length}
              </span>
            ) : null}
            {item.active ? (
              <span
                style={{
                  position: "absolute",
                  left: windowed ? "18%" : "6%",
                  right: windowed ? "18%" : "6%",
                  bottom: windowed ? 0 : -1,
                  height: windowed ? 4 : 3,
                  borderRadius: windowed ? "4px 4px 0 0" : "3px 3px 0 0",
                  background: palette.blue,
                }}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

const Tabs: FC<{
  story: DailyStory;
  theme: Theme;
}> = ({ story, theme }) => {
  const palette = themes[theme];
  const tabCount = story.tabs.length;
  const {
    columns,
    rows,
    isTwoCardLayout,
    isSingleRow,
    isFiveCardLayout,
    isDenseLayout,
    gap,
    containerWidth,
    containerHeight,
    cardPadding,
    titleFontSize,
    summaryFontSize,
    summaryLineHeight,
    summaryLineClamp,
  } = getTabLayout(tabCount);
  const hasActiveTab = story.activeTab !== undefined;
  return (
    <div
      style={{
        width: containerWidth,
        height: containerHeight,
        display: "grid",
        gridTemplateColumns: isFiveCardLayout
          ? "repeat(6, minmax(0, 1fr))"
          : `repeat(${columns}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
        gap,
        transform: isTwoCardLayout
          ? "translateY(-8px)"
          : isSingleRow
            ? "translateY(-18px)"
            : "none",
      }}
    >
      {story.tabs.map((tab, index) => {
        const active = tab.id === story.activeTab;
        const fiveCardGridColumn = [
          "1 / 3",
          "3 / 5",
          "5 / 7",
          "2 / 4",
          "4 / 6",
        ][index];
        return (
          <div
            key={tab.id}
            style={{
              minWidth: 0,
              padding: cardPadding,
              display: "flex",
              flexDirection: "column",
              alignItems: "stretch",
              justifyContent: "flex-start",
              textAlign: "left",
              gridColumn: isFiveCardLayout ? fiveCardGridColumn : undefined,
              borderRadius: 18,
              color: active ? palette.strong : palette.inactiveCardText,
              border: `1.5px solid ${
                active ? palette.activeCardBorder : palette.inactiveCardBorder
              }`,
              background: active ? palette.activeCard : palette.inactiveCard,
              boxShadow: active
                ? palette.activeCardShadow
                : palette.inactiveCardShadow,
              transform: isTwoCardLayout
                ? !hasActiveTab
                  ? "none"
                  : active
                    ? "translateY(-4px) scale(1.008)"
                    : "translateY(1px) scale(.992)"
                : active
                  ? "translateY(-3px)"
                  : "translateY(0)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                color: active ? palette.activeTabTitle : palette.text,
                fontSize: titleFontSize,
                lineHeight: 1.18,
                fontWeight: 780,
                marginBottom: isDenseLayout ? 10 : 12,
                display: "flex",
                alignItems: "center",
                gap: 12,
                minWidth: 0,
                flexShrink: 0,
                overflow: "hidden",
              }}
            >
              {tab.icon && (
                <TabIcon
                  src={tab.icon}
                  active={active}
                  theme={theme}
                  size={isDenseLayout ? 52 : 58}
                />
              )}
              <span
                style={{
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {tab.title}
              </span>
            </div>
            <div
              style={{
                color: active ? palette.activeSummary : palette.inactiveSummary,
                fontSize: summaryFontSize,
                lineHeight: summaryLineHeight,
                fontWeight: active ? 550 : 500,
                letterSpacing: ".005em",
                minHeight: 0,
                flex: 1,
                overflow: "hidden",
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: summaryLineClamp,
              }}
            >
              <InlineMarkup text={tab.summary} theme={theme} active={active} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ── Intro scroll ──────────────────────────────────────────────
//
// translateY percentages resolve against the rendered grid itself. At the
// end, `-100% + viewportHeight` aligns the real content bottom with the
// viewport bottom, including icon height and browser text wrapping. A
// viewport-sized min-height makes the same formula resolve to zero when all
// cards already fit. The estimate below balances cards between columns and
// decides whether edge fades are useful; it never controls scroll distance.
const INTRO_ICON_SIZE = 58;
const INTRO_TITLE_LINE_HEIGHT = 39; // fontSize 34 * lineHeight 1.15
const INTRO_SUMMARY_LINE_HEIGHT = 38; // fontSize 27 * lineHeight 1.42
const INTRO_CARD_PADDING_Y = 52; // 26px top + 26px bottom
const INTRO_TITLE_MARGIN_BOTTOM = 18;
const INTRO_SUMMARY_GAP = 12;
const INTRO_CARD_MIN_HEIGHT = 150;
const INTRO_CARD_BORDER_Y = 2;
const INTRO_SCROLL_END_PADDING = 24;
const INTRO_TITLE_UNITS_PER_LINE = 16;
const INTRO_SUMMARY_UNITS_PER_LINE = 24;

const estimateIntroCardHeight = (tab: DailyTab) => {
  const titleLines = Math.max(
    1,
    Math.ceil(subtitleVisualUnits(tab.title) / INTRO_TITLE_UNITS_PER_LINE),
  );
  const titleHeight = Math.max(
    tab.icon ? INTRO_ICON_SIZE : 0,
    titleLines * INTRO_TITLE_LINE_HEIGHT,
  );
  const bullets = tab.summary
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const summaryLines = bullets.reduce(
    (total, bullet) =>
      total +
      Math.max(
        1,
        Math.ceil(subtitleVisualUnits(bullet) / INTRO_SUMMARY_UNITS_PER_LINE),
      ),
    0,
  );
  const summaryHeight =
    summaryLines * INTRO_SUMMARY_LINE_HEIGHT +
    Math.max(0, bullets.length - 1) * INTRO_SUMMARY_GAP;
  return Math.max(
    INTRO_CARD_MIN_HEIGHT,
    INTRO_CARD_PADDING_Y +
      INTRO_CARD_BORDER_Y +
      titleHeight +
      INTRO_TITLE_MARGIN_BOTTOM +
      summaryHeight,
  );
};

const getIntroColumnHeight = (
  indexes: readonly number[],
  cardHeights: readonly number[],
) =>
  indexes.reduce((total, index) => total + cardHeights[index], 0) +
  Math.max(0, indexes.length - 1) * INTRO_GAP;

type IntroColumnLayout = {
  columns: [number[], number[]];
  estimatedHeights: [number, number];
};

const getIntroColumnHeights = (
  columns: IntroColumnLayout["columns"],
  cardHeights: readonly number[],
) =>
  [
    getIntroColumnHeight(columns[0], cardHeights),
    getIntroColumnHeight(columns[1], cardHeights),
  ] satisfies [number, number];

export const getBalancedIntroColumnLayout = (
  tabs: readonly DailyTab[],
): IntroColumnLayout => {
  const cardHeights = tabs.map(estimateIntroCardHeight);
  let columns: IntroColumnLayout["columns"] = [
    tabs.map((_, index) => index).filter((index) => index % 2 === 0),
    tabs.map((_, index) => index).filter((index) => index % 2 === 1),
  ];
  let estimatedHeights = getIntroColumnHeights(columns, cardHeights);

  // Start with the familiar left/right alternating order. Move only the card
  // that most reduces the imbalance, keep index 0 anchored on the left, and
  // retain source order inside each column. Stop once the remaining mismatch
  // is no larger than the normal card gap.
  while (Math.abs(estimatedHeights[0] - estimatedHeights[1]) > INTRO_GAP) {
    const currentDifference = Math.abs(
      estimatedHeights[0] - estimatedHeights[1],
    );
    let bestMove: IntroColumnLayout | null = null;
    let bestDifference = currentDifference;

    for (const sourceColumn of [0, 1] as const) {
      if (columns[sourceColumn].length <= 1) continue;
      const targetColumn = sourceColumn === 0 ? 1 : 0;

      for (const cardIndex of columns[sourceColumn]) {
        if (cardIndex === 0) continue;
        const candidateColumns: IntroColumnLayout["columns"] = [
          columns[0].filter((index) => index !== cardIndex),
          columns[1].filter((index) => index !== cardIndex),
        ];
        candidateColumns[targetColumn] = [
          ...candidateColumns[targetColumn],
          cardIndex,
        ].sort((a, b) => a - b);
        const candidateHeights = getIntroColumnHeights(
          candidateColumns,
          cardHeights,
        );
        const candidateDifference = Math.abs(
          candidateHeights[0] - candidateHeights[1],
        );

        if (candidateDifference < bestDifference) {
          bestDifference = candidateDifference;
          bestMove = {
            columns: candidateColumns,
            estimatedHeights: candidateHeights,
          };
        }
      }
    }

    if (bestMove === null) break;
    columns = bestMove.columns;
    estimatedHeights = bestMove.estimatedHeights;
  }

  return { columns, estimatedHeights };
};

export const getIntroScrollTransform = (
  scrollProgress: number,
  viewportHeight: number,
) =>
  `translateY(calc(${-scrollProgress * 100}% + ${
    scrollProgress * viewportHeight
  }px))`;

const IntroOverview: FC<{
  intro: DailyIntro;
  sceneFrame: number;
  sceneDuration: number;
  theme: Theme;
}> = ({ intro, sceneFrame, sceneDuration, theme }) => {
  const palette = themes[theme];
  const gap = INTRO_GAP;
  const viewportHeight = INTRO_VIEWPORT_HEIGHT;
  const { columns, estimatedHeights } = useMemo(
    () => getBalancedIntroColumnLayout(intro.tabs),
    [intro.tabs],
  );
  const scrollProgress = interpolate(
    sceneFrame,
    [sceneDuration * 0.18, sceneDuration * 0.86],
    [0, 1],
    {
      easing: Easing.bezier(0.42, 0, 0.18, 1),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  const scrollTransform = getIntroScrollTransform(
    scrollProgress,
    viewportHeight,
  );
  const topEdgeAlpha = interpolate(scrollProgress, [0, 0.08], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const bottomEdgeAlpha = interpolate(scrollProgress, [0.92, 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const hasOverflow =
    Math.max(...estimatedHeights) + INTRO_SCROLL_END_PADDING > viewportHeight;
  const titleColors = palette.introTitleColors;

  return (
    <div
      style={{
        width: "82%",
        height: viewportHeight,
        overflow: "hidden",
        maskImage: hasOverflow
          ? `linear-gradient(to bottom, rgba(0,0,0,${topEdgeAlpha}) 0, black 4%, black 91%, rgba(0,0,0,${bottomEdgeAlpha}) 100%)`
          : undefined,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          columnGap: gap,
          minHeight: viewportHeight,
          paddingBottom: INTRO_SCROLL_END_PADDING,
          boxSizing: "border-box",
          transform: scrollTransform,
        }}
      >
        {columns.map((indexes, columnIndex) => (
          <div
            key={`intro-column-${columnIndex}`}
            style={{
              display: "flex",
              flexDirection: "column",
              gap,
            }}
          >
            {indexes.map((index) => {
              const tab = intro.tabs[index];
              const color = titleColors[index % titleColors.length];
              return (
                <div
                  key={tab.id}
                  style={{
                    minHeight: INTRO_CARD_MIN_HEIGHT,
                    padding: "26px 32px",
                    borderRadius: 18,
                    border: `1px solid ${
                      tab.id === intro.activeTab
                        ? palette.activeCardBorder
                        : palette.inactiveCardBorder
                    }`,
                    background:
                      tab.id === intro.activeTab
                        ? palette.activeCard
                        : palette.inactiveCard,
                    boxShadow:
                      tab.id === intro.activeTab
                        ? palette.activeCardShadow
                        : palette.inactiveCardShadow,
                  }}
                >
                  <div
                    style={{
                      color,
                      fontSize: 34,
                      lineHeight: 1.15,
                      fontWeight: 850,
                      marginBottom: INTRO_TITLE_MARGIN_BOTTOM,
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                    }}
                  >
                    {tab.icon && (
                      <TabIcon
                        src={tab.icon}
                        active={tab.id === intro.activeTab}
                        theme={theme}
                        size={INTRO_ICON_SIZE}
                      />
                    )}
                    {tab.title}
                  </div>
                  <div
                    style={{
                      color: palette.inactiveCardText,
                      display: "grid",
                      gap: 12,
                      fontSize: 27,
                      lineHeight: 1.42,
                      fontWeight: 570,
                    }}
                  >
                    {tab.summary.split("\n").map((item) => (
                      <div key={item} style={{ display: "flex", gap: 14 }}>
                        <span style={{ color, fontWeight: 900 }}>•</span>
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

export type TabLayoutPreviewProps = {
  tabCount: 2 | 4 | 5 | 6;
  theme: Theme;
};

export const TabLayoutPreview: FC<TabLayoutPreviewProps> = ({
  tabCount,
  theme,
}) => {
  const frame = useCurrentFrame();
  const palette = themes[theme];
  // tabs/story/scene 只依赖 tabCount，按 tabCount 缓存；每帧只重算随帧变化的字幕。
  const { story, scene } = useMemo(() => {
    const tabs = Array.from({ length: tabCount }, (_, index) => ({
      id: `preview-${index + 1}`,
      title: previewTabs[index].title,
      summary: previewTabs[index].summary,
    }));
    const story: DailyStory = {
      id: `preview-${tabCount}`,
      topTitle: "布局测试",
      bottomTitle: `${tabCount} Tabs`,
      contentTitle: `${tabCount} Tab 布局测试`,
      ...(tabCount > 2 ? { activeTab: tabs[1]?.id } : {}),
      tabs,
      scenes: [],
    };
    const scene: DailyScene = {
      id: `preview-${tabCount}-scene`,
      subtitle: `${tabCount} Tab 布局预览`,
      timing: { startMs: 0, durationMs: 3000 },
    };
    return { story, scene };
  }, [tabCount]);
  const subtitleCue = getSubtitleCue(scene, frame, 90);

  return (
    <AbsoluteFill
      style={{
        color: palette.text,
        background: palette.canvas,
        fontFamily: 'Inter, "Microsoft YaHei", "PingFang SC", sans-serif',
      }}
    >
      <AbsoluteFill
        style={{
          backgroundImage: palette.ambient,
          backgroundSize: "100% 100%",
          maskImage:
            "linear-gradient(to bottom, rgba(0,0,0,.72), transparent 72%)",
          opacity: 0.72,
        }}
      />
      <div
        style={{
          height: "100%",
          display: "grid",
          gridTemplateRows: "120px 1fr 90px",
          position: "relative",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 46,
            color: palette.contentTitle,
            fontWeight: 780,
            letterSpacing: "-.018em",
          }}
        >
          {story.contentTitle}
        </div>
        <div
          style={{
            minHeight: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 42px",
          }}
        >
          <Tabs story={story} theme={theme} />
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            justifySelf: "center",
            alignSelf: "center",
            maxWidth: "94%",
            height: "fit-content",
            padding: palette.subtitlePadding,
            color: palette.subtitleText,
            background: palette.subtitleBackground,
            border: `1px solid ${palette.subtitleBorder}`,
            borderRadius: 12,
            boxShadow: palette.subtitleShadow,
            fontSize: SUBTITLE_FONT_SIZE,
            lineHeight: 1.22,
            fontWeight: 680,
            whiteSpace: "nowrap",
          }}
        >
          {subtitleCue}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const EvidenceStage: FC<{
  scene: DailyScene;
  theme: Theme;
}> = ({ scene, theme }) => {
  if (!scene.overlayImg) return null;
  const palette = themes[theme];
  const imageLayout = getOverlayImageLayout(scene);
  const imageScale = scene.overlayImgScale ?? 1;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        padding: "4px 42px 8px",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          padding: imageLayout?.small ? 18 : 0,
          borderRadius: imageLayout?.small ? 18 : 10,
          background: imageLayout?.small
            ? palette.overlayCardBackground
            : "transparent",
          border: imageLayout?.small
            ? `1px solid ${palette.overlayCardBorder}`
            : "none",
          filter: `drop-shadow(${palette.overlayShadow})`,
          transform: `scale(${imageScale})`,
          transformOrigin: "center center",
        }}
      >
        <Img
          src={staticFile(scene.overlayImg)}
          style={{
            width: imageLayout?.width ?? "auto",
            height: imageLayout?.height ?? "auto",
            maxWidth: imageLayout?.maxWidth ?? OVERLAY_MAX_WIDTH,
            maxHeight: imageLayout?.maxHeight ?? OVERLAY_MAX_HEIGHT,
            display: "block",
            objectFit: "contain",
            borderRadius: imageLayout?.small ? 8 : 10,
          }}
        />
      </div>
    </div>
  );
};

// ── Main component ───────────────────────────────────────────────────────

export type AiDailyReportProps = {
  themeOverride?: Theme;
} & Partial<DailyReport>;

const reportDataPath = "data-generate.json";

const useDailyReport = (props: AiDailyReportProps) => {
  const inlineReport = useMemo(
    () => (hasDailyReportProps(props) ? resolveDailyReport(props) : null),
    [props],
  );
  const [fallbackReport, setFallbackReport] = useState<DailyReport | null>(
    null,
  );
  const [delayHandle] = useState(() =>
    hasDailyReportProps(props)
      ? null
      : delayRender(`Loading ${reportDataPath} from public dir`),
  );
  const completedDelay = useRef(false);

  useEffect(() => {
    const completeDelay = () => {
      if (delayHandle === null || completedDelay.current) return;
      completedDelay.current = true;
      continueRender(delayHandle);
    };

    if (inlineReport) {
      completeDelay();
      return;
    }

    let cancelled = false;

    fetch(staticFile(reportDataPath))
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            `Failed to load ${reportDataPath}: ${response.status} ${response.statusText}`,
          );
        }
        return response.json();
      })
      .then((json) => resolveDailyReport(json))
      .then((report) => {
        if (cancelled) return;
        setFallbackReport(report);
        completeDelay();
      })
      .catch((error) => {
        if (cancelled) return;
        cancelRender(error instanceof Error ? error : new Error(String(error)));
      });

    return () => {
      cancelled = true;
    };
  }, [delayHandle, inlineReport]);

  return inlineReport ?? fallbackReport;
};

type AiDailyReportContentProps = {
  dailyReport: DailyReport;
  themeOverride?: Theme;
};

const AiDailyReportContent: FC<AiDailyReportContentProps> = ({
  dailyReport,
  themeOverride,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const theme = themeOverride ?? dailyReport.theme;
  const palette = themes[theme];
  const timeline = useMemo(
    () => buildTimeline(fps, dailyReport),
    [fps, dailyReport],
  );
  const timelineStories = useMemo(
    () => [dailyReport.intro, ...dailyReport.stories, dailyReport.outro],
    [dailyReport],
  );
  const storyDurationsMs = useMemo(
    () => timelineStories.map(getStoryDurationMs),
    [timelineStories],
  );
  const state = getTimelineState(frame, timeline);
  const {
    story,
    scene,
    sceneFrame,
    sceneDuration,
    storyFrame,
    storyIndex,
    storyExit,
  } = state;
  const displayStory: DailyStory | null = isOutro(story)
    ? dailyReport.stories[dailyReport.stories.length - 1]
    : isIntro(story)
      ? null
      : story;
  const hasEvidence =
    !isIntro(story) && !isOutro(story) && Boolean(scene.overlayImg);

  const storyPause =
    storyIndex === 0 || isOutro(story)
      ? 1
      : interpolate(
          storyFrame,
          [
            STORY_ENTER_DELAY_FRAMES,
            STORY_ENTER_DELAY_FRAMES + STORY_ENTER_FADE_FRAMES,
          ],
          [0, 1],
          {
            easing: Easing.bezier(0.16, 1, 0.3, 1),
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          },
        );
  const sceneEnter = interpolate(sceneFrame, [0, 12], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const subtitleCue = getSubtitleCue(scene, sceneFrame, sceneDuration);
  const storyVisibility = storyPause * storyExit;

  // Merge adjacent stories in the same category, while validation limits over-grouping.
  const categoryDurations = storyDurationsMs.reduce<
    { label: string; duration: number; active: boolean }[]
  >((segments, duration, index) => {
    const label = timelineStories[index].topTitle;
    const active = index === storyIndex;
    const previous = segments[segments.length - 1];
    if (previous?.label === label) {
      // 合并相邻同类栏目：用新对象替换末尾元素，避免原地修改累加器对象
      segments[segments.length - 1] = {
        label,
        duration: previous.duration + duration,
        active: previous.active || active,
      };
    } else {
      segments.push({ label, duration, active });
    }
    return segments;
  }, []);

  const storyDurations = timelineStories.map((item, index) => ({
    label: item.bottomTitle,
    duration: storyDurationsMs[index],
    active: item.id === story.id,
  }));

  const voiceoverScenes = useMemo(
    () => timeline.scenes.filter(hasAudio),
    [timeline],
  );

  return (
    <AbsoluteFill
      style={{
        color: palette.text,
        background: palette.canvas,
        fontFamily: 'Inter, "Microsoft YaHei", "PingFang SC", sans-serif',
      }}
    >
      <AbsoluteFill
        style={{
          backgroundImage: palette.ambient,
          backgroundSize: "100% 100%",
          maskImage:
            "linear-gradient(to bottom, rgba(0,0,0,.72), transparent 72%)",
          opacity: 0.72,
        }}
      />
      {timeline.storyStarts.slice(1).map((storyStart, index) => (
        <Sequence
          key={timelineStories[index + 1].id}
          from={storyStart - STORY_TRANSITION_FRAMES}
          durationInFrames={STORY_TRANSITION_FRAMES}
        >
          <Audio src={clickSound} volume={0.7} />
        </Sequence>
      ))}
      {voiceoverScenes.map((ts) => (
        <Sequence
          key={ts.scene.id}
          from={ts.startFrame}
          durationInFrames={ts.durationFrames}
        >
          <Audio src={staticFile(ts.scene.audioSrc)} />
        </Sequence>
      ))}
      <div
        style={{
          height: "100%",
          display: "grid",
          gridTemplateRows: "70px 1fr 70px",
          gap: 6,
          position: "relative",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            alignItems: "center",
          }}
        >
          <Navigation items={categoryDurations} theme={theme} />
        </div>

        <div style={{ position: "relative", minHeight: 0 }}>
          {isIntro(story) ? (
            <>
              <div
                style={{
                  position: "absolute",
                  zIndex: 2,
                  top: 0,
                  left: 0,
                  right: 0,
                  height: "14%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "0 112px",
                  textAlign: "center",
                  opacity: storyVisibility,
                }}
              >
                <div
                  style={{
                    color: palette.contentTitle,
                    fontSize: 58,
                    fontWeight: 800,
                    lineHeight: 1.08,
                    letterSpacing: "-.025em",
                  }}
                >
                  {story.contentTitle}
                </div>
              </div>
              <div
                style={{
                  position: "absolute",
                  top: "14%",
                  left: 42,
                  right: 42,
                  bottom: 0,
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "center",
                  opacity: storyVisibility,
                }}
              >
                <IntroOverview
                  intro={story}
                  sceneFrame={sceneFrame}
                  sceneDuration={sceneDuration}
                  theme={theme}
                />
              </div>
            </>
          ) : (
            <>
              <div
                style={{
                  position: "absolute",
                  zIndex: 2,
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 76,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "0 112px",
                  textAlign: "center",
                  opacity: storyVisibility,
                  transform: `translateY(${(1 - storyVisibility) * 8}px)`,
                }}
              >
                <div
                  style={{
                    color: palette.contentTitle,
                    fontSize: 42,
                    fontWeight: 780,
                    lineHeight: 1.4,
                    letterSpacing: "-.018em",
                    maxWidth: "100%",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {displayStory?.contentTitle}
                </div>
              </div>
              <div
                style={{
                  position: "absolute",
                  top: 76,
                  left: hasEvidence ? 0 : 42,
                  right: hasEvidence ? 0 : 42,
                  bottom: hasEvidence ? 80 : 68,
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: storyVisibility,
                }}
              >
                {hasEvidence ? (
                  <EvidenceStage scene={scene} theme={theme} />
                ) : displayStory ? (
                  <Tabs story={displayStory} theme={theme} />
                ) : null}
              </div>
            </>
          )}
          <div
            style={{
              position: "absolute",
              zIndex: 5,
              left: "50%",
              bottom: 16,
              width: "max-content",
              maxWidth: "94%",
              padding: palette.subtitlePadding,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: palette.subtitleText,
              background: palette.subtitleBackground,
              border: `1px solid ${palette.subtitleBorder}`,
              borderRadius: 12,
              boxShadow: palette.subtitleShadow,
              textAlign: "center",
              fontSize: SUBTITLE_FONT_SIZE,
              lineHeight: 1.22,
              fontWeight: 680,
              whiteSpace: "nowrap",
              opacity: sceneEnter * storyVisibility,
              transform: `translateX(-50%) translateY(${(1 - sceneEnter) * 10}px)`,
            }}
          >
            {subtitleCue}
          </div>
        </div>

        <Navigation items={storyDurations} theme={theme} windowed />
      </div>
    </AbsoluteFill>
  );
};

export const AiDailyReport: FC<AiDailyReportProps> = (props) => {
  const dailyReport = useDailyReport(props);

  if (!dailyReport) {
    return null;
  }

  return (
    <AiDailyReportContent
      dailyReport={dailyReport}
      themeOverride={props.themeOverride}
    />
  );
};
