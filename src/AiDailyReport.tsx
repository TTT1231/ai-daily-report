import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  dailyReport,
  type DailyIntro,
  type DailyOutro,
  type DailyScene,
  type DailyStory,
} from "./daily-report-data";
import clickSound from "./sound/click-sound.mp3";

// ── Palette & constants ──────────────────────────────────────────────────

const themes = {
  dark: {
    text: "#f3f6ff",
    muted: "#8f9abb",
    blue: "#70adff",
    strong: "#ffffff",
    canvas:
      "radial-gradient(circle at 12% -18%, rgba(41,111,226,.34), transparent 36%), radial-gradient(circle at 92% 0%, rgba(117,72,214,.20), transparent 34%), linear-gradient(180deg, #0a1023 0%, #060814 72%)",
    ambient:
      "linear-gradient(rgba(120,155,220,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(120,155,220,.035) 1px, transparent 1px)",
    nav: "rgba(8,13,31,.86)",
    navInactive: "rgba(13,20,43,.46)",
    navActive:
      "linear-gradient(to top, rgba(51,118,237,.38), rgba(30,56,112,.28))",
    border: "rgba(113,140,198,.27)",
    navActiveShadow:
      "inset 0 0 0 1px rgba(112,173,255,.78), inset 0 0 28px rgba(65,135,255,.18), 0 0 22px rgba(38,103,225,.12)",
    activeCard:
      "linear-gradient(145deg, rgba(21,104,190,.98), rgba(23,61,130,.98))",
    inactiveCard:
      "linear-gradient(145deg, rgba(22,30,58,.96), rgba(12,17,38,.98))",
    activeCardBorder: "#58a5ff",
    inactiveCardBorder: "rgba(101,125,181,.34)",
    activeCardShadow:
      "0 18px 48px rgba(0,0,0,.30), 0 0 0 1px rgba(112,173,255,.16), 0 0 34px rgba(40,115,240,.14)",
    inactiveCardShadow: "0 12px 30px rgba(0,0,0,.16)",
    inactiveCardText: "#e2e9ff",
    activeSummary: "#ffffff",
    inactiveSummary: "#d3ddfa",
    pattern: "rgba(116,157,224,.18)",
    emphasisText: "#ffe08a",
    emphasisBackground: "rgba(255,180,42,.26)",
    emphasisBorder: "#ffbf47",
    emphasisShadow:
      "inset 0 0 0 1px rgba(255,238,184,.18), 0 0 12px rgba(255,183,50,.16)",
    codeText: "#d9f6ff",
    codeBackground: "rgba(21,151,218,.34)",
    codeBorder: "#63d7ff",
    codeShadow:
      "inset 0 0 0 1px rgba(228,249,255,.18), 0 0 12px rgba(57,191,245,.18)",
    subtitleTextShadow:
      "0 2px 2px rgba(0,0,0,.98), 0 4px 12px rgba(0,0,0,.98)",
    overlayShadow: "0 30px 80px rgba(0,0,0,.64)",
  },
  light: {
    text: "#12233d",
    muted: "#5d6d83",
    blue: "#1769d2",
    strong: "#0a1a32",
    canvas:
      "radial-gradient(circle at 10% -16%, rgba(71,142,236,.20), transparent 38%), radial-gradient(circle at 94% 2%, rgba(140,114,213,.12), transparent 36%), linear-gradient(180deg, #f7f9fc 0%, #edf2f8 100%)",
    ambient:
      "linear-gradient(rgba(35,92,161,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(35,92,161,.035) 1px, transparent 1px)",
    nav: "rgba(250,252,255,.90)",
    navInactive: "rgba(232,239,248,.60)",
    navActive:
      "linear-gradient(to top, rgba(202,225,255,.96), rgba(239,246,255,.92))",
    border: "rgba(62,95,139,.20)",
    navActiveShadow:
      "inset 0 0 0 1px rgba(23,105,210,.50), inset 0 0 24px rgba(47,124,219,.10), 0 4px 14px rgba(39,83,136,.08)",
    activeCard:
      "linear-gradient(145deg, rgba(224,239,255,.99), rgba(198,224,255,.99))",
    inactiveCard:
      "linear-gradient(145deg, rgba(255,255,255,.98), rgba(242,246,251,.99))",
    activeCardBorder: "#2779db",
    inactiveCardBorder: "rgba(78,105,143,.28)",
    activeCardShadow:
      "0 18px 42px rgba(47,91,143,.18), 0 0 0 1px rgba(39,121,219,.10)",
    inactiveCardShadow: "0 12px 30px rgba(47,73,108,.09)",
    inactiveCardText: "#243955",
    activeSummary: "#183a62",
    inactiveSummary: "#465d79",
    pattern: "rgba(39,105,187,.20)",
    emphasisText: "#a83f00",
    emphasisBackground: "rgba(255,177,66,.18)",
    emphasisBorder: "rgba(200,91,14,.62)",
    emphasisShadow: "none",
    codeText: "#0759a6",
    codeBackground: "rgba(32,126,222,.13)",
    codeBorder: "rgba(22,102,190,.48)",
    codeShadow: "inset 0 0 0 1px rgba(255,255,255,.54)",
    subtitleTextShadow:
      "0 2px 2px rgba(0,0,0,.96), 0 4px 12px rgba(0,0,0,.88)",
    overlayShadow: "0 30px 72px rgba(40,62,91,.28)",
  },
};

type Theme = keyof typeof themes;

const STORY_PAUSE_FRAMES = 2;
const STORY_TRANSITION_FRAMES = 18;
const IMAGE_TRANSITION_FRAMES = 16;
const IMAGE_FOCUS_SCALE = 1.08;
const IMAGE_FOCUS_ZOOM_END = 0.42;
const IMAGE_FOCUS_RETURN_START = 0.72;
const IMAGE_FOCUS_RETURN_END = 0.9;

const msToFrames = (milliseconds: number, fps: number) =>
  Math.round((milliseconds / 1000) * fps);

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
      };
    }

    // After this scene ends — check if we're in a story-transition gap
    const next = scenes[i + 1];
    if (
      next &&
      ts.storyIndex !== next.storyIndex &&
      frame < next.startFrame
    ) {
      return {
        story: ts.story,
        scene: ts.scene,
        storyIndex: ts.storyIndex,
        sceneIndex: ts.sceneIndex,
        sceneFrame: ts.durationFrames - 1,
        sceneDuration: ts.durationFrames,
        storyFrame: endFrame - storyStarts[ts.storyIndex] - 1,
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
                borderBottom: `3px solid ${palette.emphasisBorder}`,
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
                padding: "1px 9px 2px",
                margin: "0 2px",
                color: palette.codeText,
                background: palette.codeBackground,
                border: `2px solid ${palette.codeBorder}`,
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
  size?: number;
}> = ({src, active, size = 62}) => (
  <Img
    src={staticFile(src)}
    style={{
      width: size,
      height: size,
      flexShrink: 0,
      transform: active ? "scale(1.08)" : "none",
      filter: active
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
  return (
  <div
    style={{
      display: "flex",
      height: "100%",
      alignItems: "stretch",
      background: palette.nav,
      borderTop: `1px solid ${palette.border}`,
      borderBottom: `1px solid ${palette.border}`,
    }}
  >
    {items.map((item, index) => (
      <div
        key={item.label}
        style={{
          flex: `${item.duration} 1 0`,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: item.active ? palette.text : palette.muted,
          borderLeft:
            index === 0 ? "none" : `1px solid ${palette.border}`,
          borderBottom: `4px solid ${item.active ? palette.blue : "transparent"}`,
          background: item.active
            ? palette.navActive
            : palette.navInactive,
          boxShadow: item.active ? palette.navActiveShadow : "none",
          fontSize: 24,
          fontWeight: item.active ? 760 : 560,
          letterSpacing: ".02em",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          padding: "0 10px",
        }}
      >
        {item.label}
      </div>
    ))}
  </div>
  );
};

const Tabs: React.FC<{
  story: DailyStory;
  scene: DailyScene;
  theme: Theme;
}> = ({ story, scene, theme }) => {
  const palette = themes[theme];
  const tabCount = story.tabs.length;
  const columns = tabCount === 4 ? 2 : 3;
  const rows = Math.ceil(tabCount / columns);
  const isSingleRow = rows === 1;
  const isFiveCardLayout = tabCount === 5;
  const gap = 22;
  const containerWidth = tabCount === 4 ? "76%" : "94%";
  const containerHeight = isSingleRow ? "58%" : "96%";

  const getCardBackground = (active: boolean, rowIndex: number) => {
    const base = active
      ? palette.activeCard
      : palette.inactiveCard;

    if (rowIndex === 0) {
      return [
        `linear-gradient(${palette.pattern} 1px, transparent 1px)`,
        `linear-gradient(90deg, ${palette.pattern} 1px, transparent 1px)`,
        base,
      ].join(",");
    }

    return [
      `repeating-radial-gradient(ellipse at 0 50%, transparent 0 13px, ${palette.pattern} 14px 16px, transparent 17px 30px)`,
      base,
    ].join(",");
  };

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
        opacity: scene.overlay ? 0.24 : 1,
        filter: scene.overlay ? "saturate(.72)" : "none",
        transform: isSingleRow ? "translateY(-18px)" : "none",
      }}
    >
      {story.tabs.map((tab, index) => {
        const active = tab.id === story.activeTab;
        const rowIndex = Math.floor(index / columns);
        const fiveCardGridColumn = ["1 / 3", "3 / 5", "5 / 7", "2 / 4", "4 / 6"][
          index
        ];
        return (
          <div
            key={tab.id}
            style={{
              minWidth: 0,
              padding: isSingleRow ? "38px 40px" : "30px 34px",
              display: "flex",
              flexDirection: "column",
              alignItems: "stretch",
              justifyContent: "flex-start",
              textAlign: "left",
              gridColumn: isFiveCardLayout ? fiveCardGridColumn : undefined,
              borderRadius: 12,
              color: active ? palette.strong : palette.inactiveCardText,
              border: `2px solid ${
                active ? palette.activeCardBorder : palette.inactiveCardBorder
              }`,
              background: getCardBackground(active, rowIndex),
              backgroundSize:
                rowIndex === 0 ? "28px 28px, 28px 28px, auto" : "58px 36px, auto",
              boxShadow: active
                ? palette.activeCardShadow
                : palette.inactiveCardShadow,
              transform: active ? "translateY(-5px)" : "translateY(0)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                fontSize: 36,
                lineHeight: 1.18,
                fontWeight: 820,
                marginBottom: 14,
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              {tab.icon && (
                <TabIcon
                  src={tab.icon}
                  active={active}
                />
              )}
              {tab.title}
            </div>
            <div
              style={{
                color: active ? palette.activeSummary : palette.inactiveSummary,
                fontSize: 31,
                lineHeight: 1.52,
                fontWeight: active ? 590 : 520,
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
  const cardHeights = intro.tabs.map((tab) => {
    const lineCount = tab.summary
      .split("\n")
      .reduce((total, item) => total + Math.max(1, Math.ceil(item.length / 29)), 0);
    return Math.max(210, 112 + lineCount * 48);
  });
  const rowHeights = Array.from(
    {length: Math.ceil(cardHeights.length / 2)},
    (_, rowIndex) =>
      Math.max(
        cardHeights[rowIndex * 2] ?? 0,
        cardHeights[rowIndex * 2 + 1] ?? 0,
      ),
  );
  const contentHeight =
    rowHeights.reduce((total, height) => total + height, 0) +
    Math.max(0, rowHeights.length - 1) * gap;
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
      ? ["#ff6f91", "#6fd5ff", "#ffcf5a", "#79e1c4", "#b798ff", "#ff9e67"]
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
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gridTemplateRows: rowHeights.map((height) => `${height}px`).join(" "),
          gap,
          transform: `translateY(${-scrollDistance * scrollProgress}px)`,
        }}
      >
        {intro.tabs.map((tab, index) => {
          const color = titleColors[index % titleColors.length];
          return (
            <div
              key={tab.id}
              style={{
                height: "100%",
                padding: "26px 32px",
                borderRadius: 18,
                border: `1px solid ${palette.border}`,
                background:
                  tab.id === intro.activeTab
                    ? palette.activeCard
                    : palette.inactiveCard,
                boxShadow:
                  tab.id === intro.activeTab
                    ? palette.activeCardShadow
                    : palette.inactiveCardShadow,
                overflow: "hidden",
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
    </div>
  );
};

export type TabLayoutPreviewProps = {
  tabCount: 4 | 5;
  theme: Theme;
};

export const TabLayoutPreview: React.FC<TabLayoutPreviewProps> = ({
  tabCount,
  theme,
}) => {
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
    activeTab: tabs[tabCount - 1].id,
    tabs,
    scenes: [],
  };
  const scene: DailyScene = {
    id: `preview-${tabCount}-scene`,
    subtitle: `${tabCount} Tab 布局预览`,
    timing: {startMs: 0, durationMs: 3000},
  };

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
          backgroundSize: "48px 48px",
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
            fontWeight: 820,
            letterSpacing: "-.025em",
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
          <Tabs story={story} scene={scene} theme={theme} />
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontSize: 31,
            fontWeight: 650,
            textShadow: palette.subtitleTextShadow,
          }}
        >
          {scene.subtitle}
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
  if (!scene.overlay) return null;
  const palette = themes[theme];

  const reveal = interpolate(sceneFrame, [0, IMAGE_TRANSITION_FRAMES], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const hide = interpolate(
    sceneFrame,
    [sceneDuration - IMAGE_TRANSITION_FRAMES, sceneDuration],
    [1, 0],
    {
      easing: Easing.in(Easing.cubic),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  const opacity = reveal * hide;
  const exitProgress = 1 - hide;
  const translateY = (1 - reveal) * 18 - exitProgress * 14;
  const scale = interpolate(
    sceneFrame,
    [
      0,
      IMAGE_TRANSITION_FRAMES,
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
        src={staticFile(scene.overlay.src)}
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

export const AiDailyReport: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const theme = dailyReport.theme;
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

  const timelineStories = [
    dailyReport.intro,
    ...dailyReport.stories,
    dailyReport.outro,
  ];
  const categoryDurations = Array.from(
    new Set(timelineStories.map((item) => item.topTitle)),
  ).map((label) => ({
    label,
    duration: timelineStories
      .filter((item) => item.topTitle === label)
      .reduce((total, item) => total + getStoryDurationMs(item), 0),
    active: story.topTitle === label,
  }));

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
          backgroundSize: "48px 48px",
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
                  opacity: storyPause,
                }}
              >
                <div
                  style={{
                    fontSize: 58,
                    fontWeight: 860,
                    lineHeight: 1.08,
                    letterSpacing: "-.035em",
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
                  opacity: storyPause,
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
                  opacity: storyPause,
                  transform: `translateY(${(1 - storyPause) * 8}px)`,
                }}
              >
                <div
                  style={{
                    fontSize: 46,
                    fontWeight: 820,
                    lineHeight: 1.08,
                    letterSpacing: "-.025em",
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
                  bottom: 0,
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: storyPause,
                }}
              >
                {displayStory && displayScene ? (
                  <Tabs
                    story={displayStory}
                    scene={displayScene}
                    theme={theme}
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
              opacity: storyPause,
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
              width: "92%",
              padding: "8px 24px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              textAlign: "center",
              fontSize: 31,
              lineHeight: 1.3,
              fontWeight: 650,
              textShadow: palette.subtitleTextShadow,
              opacity: sceneEnter * storyPause,
              transform: `translateX(-50%) translateY(${(1 - sceneEnter) * 10}px)`,
            }}
          >
            {scene.subtitle}
          </div>
        </div>

        <Navigation items={storyDurations} theme={theme} />
      </div>
    </AbsoluteFill>
  );
};
