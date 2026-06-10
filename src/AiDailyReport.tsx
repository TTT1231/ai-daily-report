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
import {dailyReport, type DailyScene, type DailyStory} from "./daily-report-data";
import clickSound from "./sound/click-sound.mp3";

const palette = {
  bg: "#070916",
  panel: "#11172e",
  panelAlt: "#171f3c",
  line: "#2c3761",
  text: "#f5f7ff",
  muted: "#929dc1",
  blue: "#68a4ff",
  cyan: "#53d8dc",
};

const STORY_PAUSE_FRAMES = 9;
const IMAGE_TRANSITION_FRAMES = 16;

const msToFrames = (milliseconds: number, fps: number) =>
  Math.round((milliseconds / 1000) * fps);

export const getReportDurationInFrames = (fps: number) =>
  dailyReport.stories.reduce(
    (total, story) =>
      total +
      story.scenes.reduce(
        (storyTotal, scene) => storyTotal + msToFrames(scene.durationMs, fps),
        0,
      ),
    0,
  );

const getStoryDurationMs = (story: DailyStory) =>
  story.scenes.reduce((total, scene) => total + scene.durationMs, 0);

const getStoryStartFrames = (fps: number) => {
  let cursor = 0;
  return dailyReport.stories.map((story) => {
    const start = cursor;
    cursor += msToFrames(getStoryDurationMs(story), fps);
    return start;
  });
};

const getTimelineState = (frame: number, fps: number) => {
  let cursor = 0;

  for (let storyIndex = 0; storyIndex < dailyReport.stories.length; storyIndex++) {
    const story = dailyReport.stories[storyIndex];
    for (let sceneIndex = 0; sceneIndex < story.scenes.length; sceneIndex++) {
      const scene = story.scenes[sceneIndex];
      const duration = msToFrames(scene.durationMs, fps);
      if (frame < cursor + duration) {
        return {
          story,
          scene,
          storyIndex,
          sceneIndex,
          sceneFrame: frame - cursor,
          sceneDuration: duration,
          storyFrame:
            frame -
            dailyReport.stories
              .slice(0, storyIndex)
              .reduce((total, item) => total + msToFrames(getStoryDurationMs(item), fps), 0),
        };
      }
      cursor += duration;
    }
  }

  const storyIndex = dailyReport.stories.length - 1;
  const story = dailyReport.stories[storyIndex];
  const sceneIndex = story.scenes.length - 1;
  const scene = story.scenes[sceneIndex];
  return {
    story,
    scene,
    storyIndex,
    sceneIndex,
    sceneFrame: msToFrames(scene.durationMs, fps) - 1,
    sceneDuration: msToFrames(scene.durationMs, fps),
    storyFrame: msToFrames(getStoryDurationMs(story), fps) - 1,
  };
};

const InlineMarkup: React.FC<{text: string}> = ({text}) => {
  const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={index} style={{color: "#fff", fontWeight: 850}}>
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code
              key={index}
              style={{
                padding: "2px 8px",
                color: "#f4f8ff",
                background: "rgba(219,233,255,.22)",
                border: "1px solid rgba(219,233,255,.24)",
                borderRadius: 5,
                fontFamily: '"Cascadia Code", Consolas, monospace',
                fontSize: ".92em",
                fontWeight: 750,
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

const Navigation: React.FC<{
  items: {label: string; duration: number; active: boolean}[];
}> = ({items}) => (
  <div style={{display: "flex", gap: 12, height: "100%", alignItems: "stretch"}}>
    {items.map((item) => (
      <div
        key={item.label}
        style={{
          flex: `${item.duration} 1 0`,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: item.active ? palette.text : palette.muted,
          borderBottom: `4px solid ${item.active ? palette.blue : "transparent"}`,
          background: item.active
            ? "linear-gradient(to top, rgba(68,125,239,.24), transparent)"
            : "transparent",
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

const Tabs: React.FC<{
  story: DailyStory;
  scene: DailyScene;
}> = ({story, scene}) => {
  const isCompact = story.tabs.length <= 4;
  const columns = isCompact ? 2 : 3;
  const gap = 22;

  return (
    <div
      style={{
        width: isCompact ? "72%" : "94%",
        height: isCompact ? "88%" : "96%",
        display: "flex",
        flexWrap: "wrap",
        alignContent: "stretch",
        alignItems: "stretch",
        justifyContent: "center",
        gap,
        opacity: scene.overlay ? 0.18 : 1,
        filter: scene.overlay ? "saturate(.55)" : "none",
      }}
    >
      {story.tabs.map((tab, index) => {
        const active = tab.id === scene.activeTab;
        return (
          <div
            key={tab.id}
            style={{
              flex: `0 0 calc((100% - ${(columns - 1) * gap}px) / ${columns})`,
              minWidth: 0,
              padding: isCompact ? "38px 40px" : "30px 34px",
              borderRadius: 12,
              color: active ? "#fff" : "#d6dcf4",
              border: `2px solid ${active ? "#318be2" : "rgba(86,102,153,.42)"}`,
              background: active
                ? "linear-gradient(145deg, rgba(22,110,185,.96), rgba(26,68,139,.98))"
                : "linear-gradient(145deg, rgba(24,31,60,.95), rgba(15,20,43,.98))",
              overflow: "hidden",
            }}
          >
            <div style={{fontSize: 30, lineHeight: 1.2, fontWeight: 800, marginBottom: 18}}>
              <span style={{color: active ? "#fff" : palette.blue, marginRight: 12}}>
                {String(index + 1).padStart(2, "0")}
              </span>
              {tab.title}
            </div>
            <div
              style={{
                color: active ? "#e8f4ff" : "#b6c0df",
                fontSize: 23,
                lineHeight: 1.5,
                fontWeight: 540,
              }}
            >
              <InlineMarkup text={tab.summary} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

const SourceOverlay: React.FC<{
  scene: DailyScene;
  sceneFrame: number;
  sceneDuration: number;
}> = ({scene, sceneFrame, sceneDuration}) => {
  if (!scene.overlay) return null;

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
  const scale = 0.95 + reveal * 0.05 - exitProgress * 0.025;

  return (
    <div
      style={{
        position: "absolute",
        height: "92%",
        maxWidth: "96%",
        aspectRatio: "16 / 9",
        opacity,
        transform: `translateY(${translateY}px) scale(${scale})`,
        borderRadius: 10,
        overflow: "hidden",
        boxShadow: "0 30px 80px rgba(0,0,0,.64)",
        backgroundColor: "#f5f7fb",
      }}
    >
      <Img src={staticFile(scene.overlay.src)} style={{width: "100%", height: "100%"}} />
      <div
        style={{
          position: "absolute",
          top: 18,
          right: 18,
          padding: "8px 14px",
          color: "#dbe9ff",
          background: "rgba(5,10,23,.84)",
          border: "1px solid rgba(104,164,255,.45)",
          borderRadius: 8,
          fontSize: 18,
          letterSpacing: ".05em",
        }}
      >
        {scene.overlay.caption}
      </div>
    </div>
  );
};

export const AiDailyReport: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const state = getTimelineState(frame, fps);
  const {story, scene, sceneFrame, sceneDuration, storyFrame, storyIndex} = state;

  const storyPause =
    storyIndex === 0
      ? 1
      : interpolate(storyFrame, [STORY_PAUSE_FRAMES, STORY_PAUSE_FRAMES + 10], [0, 1], {
          easing: Easing.bezier(0.16, 1, 0.3, 1),
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
  const sceneEnter = interpolate(sceneFrame, [0, 12], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const categoryDurations = Array.from(new Set(dailyReport.stories.map((item) => item.topTitle))).map(
    (label) => ({
      label,
      duration: dailyReport.stories
        .filter((item) => item.topTitle === label)
        .reduce((total, item) => total + getStoryDurationMs(item), 0),
      active: story.topTitle === label,
    }),
  );

  const storyDurations = dailyReport.stories.map((item) => ({
    label: item.bottomTitle,
    duration: getStoryDurationMs(item),
    active: item.id === story.id,
  }));
  const storyStartFrames = getStoryStartFrames(fps);

  return (
    <AbsoluteFill
      style={{
        color: palette.text,
        background:
          "radial-gradient(circle at 15% -10%, rgba(56,102,221,.25), transparent 35%), radial-gradient(circle at 95% 12%, rgba(107,64,200,.18), transparent 32%), #070916",
        fontFamily: 'Inter, "Microsoft YaHei", "PingFang SC", sans-serif',
        padding: "28px 42px 24px",
      }}
    >
      {storyStartFrames.slice(1).map((startFrame, index) => (
        <Sequence key={dailyReport.stories[index + 1].id} from={startFrame} durationInFrames={30}>
          <Audio src={clickSound} volume={0.7} />
        </Sequence>
      ))}
      <div
        style={{
          height: "100%",
          display: "grid",
          gridTemplateRows: "70px 92px 1fr 70px",
          gap: 6,
        }}
      >
        <div style={{display: "grid", gridTemplateColumns: "1fr", alignItems: "center"}}>
          <Navigation items={categoryDurations} />
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            padding: "0 70px 4px",
            textAlign: "center",
            fontSize: 46,
            fontWeight: 820,
            lineHeight: 1.12,
            letterSpacing: "-.025em",
            opacity: storyPause,
            transform: `translateY(${(1 - storyPause) * 8}px)`,
          }}
        >
          {story.contentTitle}
        </div>

        <div
          style={{
            position: "relative",
            minHeight: 0,
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              opacity: storyPause,
            }}
          >
            <Tabs story={story} scene={scene} />
            <SourceOverlay scene={scene} sceneFrame={sceneFrame} sceneDuration={sceneDuration} />
          </div>
          <div
            style={{
              position: "absolute",
              zIndex: 5,
              left: 0,
              right: 0,
              bottom: 0,
              minHeight: "21%",
              padding: "58px 48px 22px",
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
              color: "#fff",
              textAlign: "center",
              fontSize: 31,
              lineHeight: 1.3,
              fontWeight: 650,
              textShadow: "0 3px 12px rgba(0,0,0,.98)",
              background: "linear-gradient(to bottom, transparent, rgba(2,4,12,.9) 70%)",
              opacity: sceneEnter * storyPause,
            }}
          >
            {scene.subtitle}
          </div>
        </div>

        <Navigation items={storyDurations} />
      </div>
    </AbsoluteFill>
  );
};
