import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  interpolate,
  Sequence,
  staticFile,
  useCurrentScale,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {useEffect, useRef, useState} from "react";
import {
  dailyReport,
  type DailyIntro,
  type DailyOutro,
  type DailyScene,
  type DailyStory,
} from "./daily-report-data";
import {
  getNavigationTypography,
  navigationEdgeInset,
  navigationItemGap,
  navigationMinimumWidth,
} from "./navigation-layout";
import clickSound from "./sound/click-sound.mp3";

// ── Palette & constants ──────────────────────────────────────────────────

const themes = {
  dark: {
    text: "#e5e2dc",
    muted: "#9d9c98",
    blue: "#bd745c",
    strong: "#f2eee7",
    contentTitle: "#d49376",
    canvas:
      "radial-gradient(circle at 12% -18%, rgba(91,115,135,.17), transparent 40%), radial-gradient(circle at 92% 0%, rgba(151,89,69,.10), transparent 38%), linear-gradient(180deg, #171c21 0%, #11161b 78%)",
    ambient:
      "linear-gradient(180deg, rgba(255,247,238,.022), transparent 42%)",
    nav: "rgba(24,29,34,.90)",
    navInactive: "rgba(38,44,49,.54)",
    navActive:
      "linear-gradient(to top, rgba(91,58,49,.68), rgba(52,45,43,.72))",
    border: "rgba(183,179,170,.18)",
    navActiveShadow:
      "inset 0 0 0 1px rgba(189,116,92,.42), inset 0 0 20px rgba(189,116,92,.07)",
    activeCard:
      "linear-gradient(145deg, rgba(48,46,45,.99), rgba(39,39,39,.99))",
    inactiveCard:
      "linear-gradient(145deg, rgba(37,42,46,.99), rgba(30,35,39,.99))",
    activeCardBorder: "#aa6a55",
    inactiveCardBorder: "rgba(179,184,184,.20)",
    activeCardShadow:
      "inset 0 3px 0 rgba(202,132,108,.20), 0 18px 38px rgba(0,0,0,.20), 0 0 0 1px rgba(189,116,92,.05)",
    inactiveCardShadow:
      "inset 0 1px 0 rgba(255,255,255,.025), 0 10px 24px rgba(0,0,0,.12)",
    inactiveCardText: "#d9dce0",
    activeSummary: "#e6ddd6",
    inactiveSummary: "#bfc6cc",
    emphasisText: "#efc27f",
    emphasisBackground: "rgba(202,137,67,.15)",
    emphasisBorder: "rgba(226,164,91,.58)",
    emphasisShadow:
      "inset 0 0 0 1px rgba(255,238,184,.06)",
    codeText: "#c8dce0",
    codeBackground: "rgba(81,127,137,.18)",
    codeBorder: "rgba(130,178,187,.48)",
    codeShadow:
      "inset 0 0 0 1px rgba(228,249,255,.06)",
    subtitleText: "#e9e5df",
    subtitleBackground: "rgba(34,39,43,.82)",
    subtitleBorder: "rgba(186,181,172,.16)",
    subtitleShadow: "0 8px 22px rgba(0,0,0,.14)",
    overlayShadow: "0 30px 80px rgba(0,0,0,.54)",
  },
  light: {
    text: "#2d3d4c",
    muted: "#68727c",
    blue: "#b8614b",
    strong: "#3e2d28",
    contentTitle: "#b85f49",
    canvas:
      "radial-gradient(circle at 10% -16%, rgba(90,135,182,.09), transparent 40%), radial-gradient(circle at 94% 2%, rgba(196,112,84,.08), transparent 38%), linear-gradient(180deg, #fbfaf7 0%, #f1f3f2 100%)",
    ambient:
      "linear-gradient(180deg, rgba(255,255,255,.42), transparent 42%)",
    nav: "rgba(252,251,248,.92)",
    navInactive: "rgba(241,241,237,.68)",
    navActive:
      "linear-gradient(to top, rgba(242,222,214,.96), rgba(253,248,244,.94))",
    border: "rgba(91,103,113,.19)",
    navActiveShadow:
      "inset 0 0 0 1px rgba(184,95,73,.34), inset 0 0 20px rgba(184,95,73,.06)",
    activeCard:
      "linear-gradient(145deg, rgba(255,251,247,.99), rgba(248,237,231,.99))",
    inactiveCard:
      "linear-gradient(145deg, rgba(255,255,253,.99), rgba(248,248,245,.99))",
    activeCardBorder: "#c77963",
    inactiveCardBorder: "rgba(92,104,113,.22)",
    activeCardShadow:
      "inset 0 3px 0 rgba(199,121,99,.18), 0 16px 34px rgba(109,78,67,.12), 0 0 0 1px rgba(184,95,73,.05)",
    inactiveCardShadow:
      "inset 0 1px 0 rgba(255,255,255,.88), 0 9px 22px rgba(65,72,78,.07)",
    inactiveCardText: "#344653",
    activeSummary: "#59443d",
    inactiveSummary: "#52626d",
    emphasisText: "#a83f00",
    emphasisBackground: "rgba(255,177,66,.13)",
    emphasisBorder: "rgba(200,91,14,.48)",
    emphasisShadow: "none",
    codeText: "#0759a6",
    codeBackground: "rgba(32,126,222,.09)",
    codeBorder: "rgba(22,102,190,.34)",
    codeShadow: "inset 0 0 0 1px rgba(255,255,255,.48)",
    subtitleText: "#263b4c",
    subtitleBackground: "rgba(255,254,251,.82)",
    subtitleBorder: "rgba(91,103,113,.16)",
    subtitleShadow: "0 8px 20px rgba(65,72,78,.07)",
    overlayShadow: "0 30px 72px rgba(40,62,91,.28)",
  },
};

export type Theme = keyof typeof themes;

const STORY_PAUSE_FRAMES = 0;
const STORY_TRANSITION_FRAMES = 18;
const IMAGE_TRANSITION_FRAMES = 16;
const IMAGE_PRE_ROLL_FRAMES = 12;
const IMAGE_POST_ROLL_FRAMES = 10;
const IMAGE_FOCUS_SCALE = 1.08;
const IMAGE_FOCUS_ZOOM_END = 0.42;
const IMAGE_FOCUS_RETURN_START = 0.72;
const IMAGE_FOCUS_RETURN_END = 0.9;
const SUBTITLE_MAX_VISUAL_UNITS = 46;

const msToFrames = (milliseconds: number, fps: number) =>
  Math.round((milliseconds / 1000) * fps);

// Keep voiceover continuous while presenting long captions as timed single lines.
const subtitleVisualUnits = (text: string) =>
  [...text].reduce((total, character) => {
    if (/\s/.test(character)) return total + 0.32;
    if ((character.codePointAt(0) ?? 0) <= 0xff) return total + 0.56;
    return total + 1;
  }, 0);

const hardSplitSubtitleSegment = (segment: string) => {
  const chunks: string[] = [];
  let chunk = "";
  let units = 0;

  for (const character of segment) {
    const characterUnits = subtitleVisualUnits(character);
    if (chunk && units + characterUnits > SUBTITLE_MAX_VISUAL_UNITS) {
      chunks.push(chunk.trim());
      chunk = "";
      units = 0;
    }
    chunk += character;
    units += characterUnits;
  }

  if (chunk.trim()) chunks.push(chunk.trim());
  return chunks;
};

const splitSubtitleCues = (subtitle: string) => {
  const normalized = subtitle.trim().replace(/\s+/g, " ");
  if (subtitleVisualUnits(normalized) <= SUBTITLE_MAX_VISUAL_UNITS) {
    return [normalized];
  }

  const segments =
    normalized.match(/[^，。！？；：,.!?;:]+[，。！？；：,.!?;:]?/g) ?? [
      normalized,
    ];
  const cues: string[] = [];
  let cue = "";

  for (const segment of segments.flatMap(hardSplitSubtitleSegment)) {
    if (
      cue &&
      subtitleVisualUnits(cue + segment) > SUBTITLE_MAX_VISUAL_UNITS
    ) {
      cues.push(cue.trim());
      cue = "";
    }
    cue += segment;
  }

  if (cue.trim()) cues.push(cue.trim());
  return cues;
};

const getSubtitleCue = (
  scene: DailyScene,
  sceneFrame: number,
  sceneDuration: number,
) => {
  const cues = splitSubtitleCues(scene.subtitle);
  if (cues.length === 1) return cues[0];

  const audioDurationFrames = scene.tts
    ? sceneDuration *
      (scene.tts.audioLengthMs /
        (scene.tts.audioLengthMs + scene.tts.tailPaddingMs))
    : sceneDuration;
  const totalUnits = cues.reduce(
    (total, cue) => total + subtitleVisualUnits(cue),
    0,
  );
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

const getOverlayAnimation = (
  scene: DailyScene,
  sceneFrame: number,
  sceneDuration: number,
) => {
  if (!scene.overlayImg) {
    return {
      reveal: 0,
      hide: 0,
      opacity: 0,
      revealStart: 0,
      revealEnd: 0,
    };
  }

  const lastSceneFrame = Math.max(1, sceneDuration - 1);
  const revealStart = Math.min(
    IMAGE_PRE_ROLL_FRAMES,
    Math.max(
      0,
      lastSceneFrame -
        IMAGE_TRANSITION_FRAMES * 2 -
        IMAGE_POST_ROLL_FRAMES,
    ),
  );
  const revealEnd = Math.min(
    lastSceneFrame,
    revealStart + IMAGE_TRANSITION_FRAMES,
  );
  const hideEnd = Math.max(
    revealEnd,
    lastSceneFrame - IMAGE_POST_ROLL_FRAMES,
  );
  const hideStart = Math.max(revealEnd, hideEnd - IMAGE_TRANSITION_FRAMES);
  const reveal = interpolate(
    sceneFrame,
    [revealStart, revealEnd],
    [0, 1],
    {
      easing: Easing.bezier(0.16, 1, 0.3, 1),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  const hide = interpolate(
    sceneFrame,
    [hideStart, hideEnd],
    [1, 0],
    {
      easing: Easing.in(Easing.cubic),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  return {reveal, hide, opacity: reveal * hide, revealStart, revealEnd};
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

const buildTimeline = (fps: number): Timeline => {
  const scenes: TimelineScene[] = [];
  const storyStarts: number[] = [];
  const stories = [dailyReport.intro, ...dailyReport.stories, dailyReport.outro];
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

export const getReportDurationInFrames = (fps: number) =>
  buildTimeline(fps).totalFrames;

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
        sceneIndex: ts.sceneIndex,
        sceneFrame: frame - ts.startFrame,
        sceneDuration: ts.durationFrames,
        storyFrame: frame - storyStarts[ts.storyIndex],
        storyExit: 1,
      };
    }

    // After this scene ends — check if we're in a story-transition gap
    const next = scenes[i + 1];
    if (
      next &&
      ts.storyIndex !== next.storyIndex &&
      frame < next.startFrame
    ) {
      const transitionDuration = next.startFrame - endFrame;
      const transitionFrame = frame - endFrame;
      return {
        story: ts.story,
        scene: ts.scene,
        storyIndex: ts.storyIndex,
        sceneIndex: ts.sceneIndex,
        sceneFrame: ts.durationFrames - 1,
        sceneDuration: ts.durationFrames,
        storyFrame: endFrame - storyStarts[ts.storyIndex] - 1,
        storyExit: interpolate(
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
    sceneIndex: last.sceneIndex,
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

const InlineMarkup: React.FC<{ text: string; theme: Theme; active: boolean }> = ({
  text,
  theme,
  active,
}) => {
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
                fontWeight: 850,
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

const TabIcon: React.FC<{
  src: string;
  active: boolean;
  theme: Theme;
  size?: number;
}> = ({src, active, theme, size = 62}) => (
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
            ? "saturate(.92) brightness(1.03) drop-shadow(0 3px 8px rgba(0,0,0,.26))"
            : "saturate(.82) brightness(.98) drop-shadow(0 2px 4px rgba(0,0,0,.24))"
          : active
            ? "saturate(1.2) brightness(1.12) drop-shadow(0 0 10px rgba(111,213,255,.28))"
            : "saturate(1.1) brightness(1.06) drop-shadow(0 2px 4px rgba(0,0,0,.28))",
    }}
  />
);

const Navigation: React.FC<{
  items: { label: string; duration: number; active: boolean }[];
  theme: Theme;
}> = ({ items, theme }) => {
  const palette = themes[theme];
  const {fontSize, horizontalPadding} = getNavigationTypography(items.length);
  return (
  <div
    style={{
      display: "flex",
      height: "100%",
      alignItems: "stretch",
      gap: navigationItemGap,
      padding: `0 ${navigationEdgeInset}px`,
      boxSizing: "border-box",
      background: palette.nav,
      borderTop: `1px solid ${palette.border}`,
      borderBottom: `1px solid ${palette.border}`,
    }}
  >
    {items.map((item, index) => {
      // Reserve readable label width first, then distribute remaining width by duration.
      const minimumWidth = navigationMinimumWidth(item.label, items.length);
      return (
        <div
          key={`${item.label}-${index}`}
          style={{
            flexGrow: item.duration,
            flexShrink: 0,
            flexBasis: minimumWidth,
            minWidth: minimumWidth,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: item.active ? palette.text : palette.muted,
            borderLeft: `1px solid ${palette.border}`,
            borderRight:
              index === items.length - 1
                ? `1px solid ${palette.border}`
                : "none",
            borderBottom: `4px solid ${item.active ? palette.blue : "transparent"}`,
            background: item.active
              ? palette.navActive
              : palette.navInactive,
            boxShadow: item.active ? palette.navActiveShadow : "none",
            fontSize,
            fontWeight: item.active ? 760 : 560,
            letterSpacing: ".02em",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            padding: `0 ${horizontalPadding}px`,
          }}
        >
          {item.label}
        </div>
      );
    })}
  </div>
  );
};

const Tabs: React.FC<{
  story: DailyStory;
  theme: Theme;
  overlayVisibility: number;
}> = ({ story, theme, overlayVisibility }) => {
  const palette = themes[theme];
  const tabCount = story.tabs.length;
  const hasActiveTab = story.activeTab !== undefined;
  const isTwoCardLayout = tabCount === 2;
  const columns = isTwoCardLayout || tabCount === 4 ? 2 : 3;
  const rows = Math.ceil(tabCount / columns);
  const isSingleRow = rows === 1;
  const isFiveCardLayout = tabCount === 5;
  const isDenseLayout = tabCount >= 5;
  const gap = isTwoCardLayout ? 30 : isDenseLayout ? 18 : 20;
  const containerWidth = isTwoCardLayout
    ? "88%"
    : tabCount === 4
      ? "76%"
      : "94%";
  const containerHeight = isTwoCardLayout
    ? "58%"
    : isSingleRow
      ? "58%"
      : "94%";
  const cardPadding = isTwoCardLayout
    ? "40px 46px"
    : isSingleRow
      ? "32px 36px"
      : isDenseLayout
        ? "22px 26px"
        : "24px 30px";
  const titleFontSize = isTwoCardLayout
    ? 40
    : isSingleRow
      ? 34
      : isDenseLayout
        ? 30
        : 33;
  const summaryFontSize = isTwoCardLayout
    ? 33
    : isSingleRow
      ? 29
      : isDenseLayout
        ? 26
        : 28;
  const summaryLineHeight = isTwoCardLayout
    ? 1.44
    : isSingleRow
      ? 1.45
      : isDenseLayout
        ? 1.38
        : 1.42;
  const backgroundOpacity = interpolate(
    overlayVisibility,
    [0, 1],
    [1, 0.24],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  const backgroundSaturation = interpolate(
    overlayVisibility,
    [0, 1],
    [1, 0.72],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
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
        opacity: backgroundOpacity,
        filter: `saturate(${backgroundSaturation})`,
        transform: isTwoCardLayout
          ? "translateY(-8px)"
          : isSingleRow
            ? "translateY(-18px)"
            : "none",
      }}
    >
      {story.tabs.map((tab, index) => {
        const active = tab.id === story.activeTab;
        const fiveCardGridColumn = ["1 / 3", "3 / 5", "5 / 7", "2 / 4", "4 / 6"][
          index
        ];
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
                color: active ? palette.contentTitle : palette.text,
                fontSize: titleFontSize,
                lineHeight: 1.18,
                fontWeight: 780,
                marginBottom: isDenseLayout ? 10 : 12,
                display: "flex",
                alignItems: "center",
                gap: 12,
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
              {tab.title}
            </div>
            <div
              style={{
                color: active ? palette.activeSummary : palette.inactiveSummary,
                fontSize: summaryFontSize,
                lineHeight: summaryLineHeight,
                fontWeight: active ? 550 : 500,
                letterSpacing: ".005em",
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

const IntroOverview: React.FC<{
  intro: DailyIntro;
  sceneFrame: number;
  sceneDuration: number;
  theme: Theme;
}> = ({intro, sceneFrame, sceneDuration, theme}) => {
  const palette = themes[theme];
  const gap = 22;
  const viewportHeight = 700;
  const scale = useCurrentScale();
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);
  const columns = [
    intro.tabs.map((_, index) => index).filter((index) => index % 2 === 0),
    intro.tabs.map((_, index) => index).filter((index) => index % 2 === 1),
  ];

  useEffect(() => {
    if (!contentRef.current) return;
    const measuredHeight = contentRef.current.getBoundingClientRect().height / scale;
    setContentHeight(measuredHeight);
  }, [intro.tabs, scale]);

  const scrollDistance = Math.max(0, contentHeight - viewportHeight);
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
  const titleColors =
    theme === "dark"
      ? ["#d98978", "#8fb3bd", "#d1ad74", "#91b3a5", "#aa9abb", "#c89876"]
      : ["#cf3f67", "#167fc0", "#b77a00", "#12826d", "#7154c7", "#c15f22"];

  return (
    <div
      style={{
        width: "82%",
        height: viewportHeight,
        overflow: "hidden",
        maskImage:
          scrollDistance > 0
            ? "linear-gradient(to bottom, transparent 0, black 4%, black 91%, transparent 100%)"
            : undefined,
      }}
    >
      <div
        ref={contentRef}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap,
          transform: `translateY(${-scrollDistance * scrollProgress}px)`,
        }}
      >
        {columns.map((indexes, columnIndex) => (
          <div
            key={`intro-column-${columnIndex}`}
            style={{display: "flex", flexDirection: "column", gap}}
          >
            {indexes.map((index) => {
              const tab = intro.tabs[index];
              const color = titleColors[index % titleColors.length];
              return (
            <div
              key={tab.id}
              style={{
                minHeight: 150,
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
                  marginBottom: 18,
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
                    size={58}
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
                  <div key={item} style={{display: "flex", gap: 14}}>
                    <span style={{color, fontWeight: 900}}>•</span>
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
  tabCount: 2 | 4 | 5;
  theme: Theme;
};

export const TabLayoutPreview: React.FC<TabLayoutPreviewProps> = ({
  tabCount,
  theme,
}) => {
  const frame = useCurrentFrame();
  const palette = themes[theme];
  const tabs = Array.from({length: tabCount}, (_, index) => ({
    id: `preview-${index + 1}`,
    title: ["核心能力", "上下文管理", "质量控制", "团队协作", "交付闭环"][
      index
    ],
    summary: [
      "拆分复杂任务，并协调多个 **Agent** 并行处理。",
      "共享任务状态，减少跨步骤的信息损耗。",
      "在提交前自动执行 `检查`、测试与评审。",
      "让团队成员清楚掌握进度、风险与下一步。",
      "串联编码、验证和提交，形成完整工作流。",
    ][index],
  }));
  const story: DailyStory = {
    id: `preview-${tabCount}`,
    topTitle: "布局测试",
    bottomTitle: `${tabCount} Tabs`,
    contentTitle: `${tabCount} Tab 布局测试`,
    ...(tabCount > 2 ? {activeTab: tabs[1]?.id} : {}),
    tabs,
    scenes: [],
  };
  const scene: DailyScene = {
    id: `preview-${tabCount}-scene`,
    subtitle: `${tabCount} Tab 布局预览`,
    timing: {startMs: 0, durationMs: 3000},
  };
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
          <Tabs
            story={story}
            theme={theme}
            overlayVisibility={0}
          />
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
            color: palette.subtitleText,
            background: palette.subtitleBackground,
            border: `1px solid ${palette.subtitleBorder}`,
            borderRadius: 12,
            boxShadow: palette.subtitleShadow,
            fontSize: 29,
            lineHeight: 1.25,
            fontWeight: 620,
            whiteSpace: "nowrap",
          }}
        >
          {subtitleCue}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const SourceOverlay: React.FC<{
  scene: DailyScene;
  sceneFrame: number;
  sceneDuration: number;
  theme: Theme;
}> = ({ scene, sceneFrame, sceneDuration, theme }) => {
  if (!scene.overlayImg) return null;
  const palette = themes[theme];

  const {reveal, hide, opacity, revealStart, revealEnd} = getOverlayAnimation(
    scene,
    sceneFrame,
    sceneDuration,
  );
  const exitProgress = 1 - hide;
  const translateY = (1 - reveal) * 18 - exitProgress * 14;
  const scale = interpolate(
    sceneFrame,
    [
      revealStart,
      revealEnd,
      sceneDuration * IMAGE_FOCUS_ZOOM_END,
      sceneDuration * IMAGE_FOCUS_RETURN_START,
      sceneDuration * IMAGE_FOCUS_RETURN_END,
    ],
    [0.95, 1, IMAGE_FOCUS_SCALE, IMAGE_FOCUS_SCALE, 1],
    {
      easing: Easing.inOut(Easing.cubic),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  return (
    <div
      style={{
        position: "absolute",
        inset: "0 18px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity,
        transform: `translateY(${translateY}px) scale(${scale})`,
      }}
    >
      <Img
        src={staticFile(scene.overlayImg)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          borderRadius: 10,
          filter: `drop-shadow(${palette.overlayShadow})`,
        }}
      />
    </div>
  );
};

// ── Main component ───────────────────────────────────────────────────────

export type AiDailyReportProps = {
  themeOverride?: Theme;
};

export const AiDailyReport: React.FC<AiDailyReportProps> = ({
  themeOverride,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const theme = themeOverride ?? dailyReport.theme;
  const palette = themes[theme];
  const timeline = buildTimeline(fps);
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
  const displayScene = isOutro(story) && displayStory
    ? displayStory.scenes[displayStory.scenes.length - 1]
    : !isIntro(story)
      ? scene
      : null;

  const storyPause =
    storyIndex === 0 || isOutro(story)
      ? 1
      : interpolate(
          storyFrame,
          [STORY_PAUSE_FRAMES, STORY_PAUSE_FRAMES + 10],
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
  const overlayVisibility = getOverlayAnimation(
    scene,
    sceneFrame,
    sceneDuration,
  ).opacity;
  const storyVisibility = storyPause * storyExit;

  const timelineStories = [
    dailyReport.intro,
    ...dailyReport.stories,
    dailyReport.outro,
  ];
  // Merge adjacent stories in the same category, while validation limits over-grouping.
  const categoryDurations = timelineStories.reduce<
    {label: string; duration: number; active: boolean}[]
  >((segments, item, index) => {
    const duration = getStoryDurationMs(item);
    const active = index === storyIndex;
    const previous = segments[segments.length - 1];
    if (previous?.label === item.topTitle) {
      previous.duration += duration;
      previous.active ||= active;
    } else {
      segments.push({label: item.topTitle, duration, active});
    }
    return segments;
  }, []);

  const storyDurations = timelineStories.map((item) => ({
    label: item.bottomTitle,
    duration: getStoryDurationMs(item),
    active: item.id === story.id,
  }));

  const voiceoverScenes = timeline.scenes.filter(hasAudio);

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

        <div style={{position: "relative", minHeight: 0}}>
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
                  height: "10%",
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
                    fontSize: 46,
                    fontWeight: 780,
                    lineHeight: 1.08,
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
                  top: "10%",
                  left: 42,
                  right: 42,
                  bottom: 68,
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: storyVisibility,
                }}
              >
                {displayStory && displayScene ? (
                  <Tabs
                    story={displayStory}
                    theme={theme}
                    overlayVisibility={overlayVisibility}
                  />
                ) : null}
              </div>
            </>
          )}
          <div
            style={{
              position: "absolute",
              zIndex: 4,
              inset: 0,
              overflow: "hidden",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              opacity: storyVisibility,
            }}
          >
            <SourceOverlay
              scene={scene}
              sceneFrame={sceneFrame}
              sceneDuration={sceneDuration}
              theme={theme}
            />
          </div>
          <div
            style={{
              position: "absolute",
              zIndex: 5,
              left: "50%",
              bottom: 12,
              width: "max-content",
              maxWidth: "94%",
              padding: "7px 20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: palette.subtitleText,
              background: palette.subtitleBackground,
              border: `1px solid ${palette.subtitleBorder}`,
              borderRadius: 12,
              boxShadow: palette.subtitleShadow,
              textAlign: "center",
              fontSize: 29,
              lineHeight: 1.25,
              fontWeight: 620,
              whiteSpace: "nowrap",
              opacity: sceneEnter * storyVisibility,
              transform: `translateX(-50%) translateY(${(1 - sceneEnter) * 10}px)`,
            }}
          >
            {subtitleCue}
          </div>
        </div>

        <Navigation items={storyDurations} theme={theme} />
      </div>
    </AbsoluteFill>
  );
};
