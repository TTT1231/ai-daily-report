function getGreeting(hour) {
  if (hour >= 5 && hour < 12) return "早上好";
  if (hour >= 12 && hour < 14) return "中午好";
  if (hour >= 14 && hour < 18) return "下午好";
  return "晚上好";
}

function buildIntro(report, hour) {
  const groups = new Map();
  let activeTitle;

  for (const story of report.stories) {
    const titles = groups.get(story.topTitle) ?? [];
    titles.push(story.introTitle ?? story.contentTitle);
    groups.set(story.topTitle, titles);
    if (story.activeIntro === true) activeTitle = story.topTitle;
  }

  const tabs = Array.from(groups, ([title, contentTitles], index) => ({
    id: `intro-group-${index + 1}`,
    title,
    summary: contentTitles.join("\n"),
  }));

  return {
    id: "intro",
    topTitle: "Intro",
    bottomTitle: "Intro",
    contentTitle: `${report.date} 资讯概览`,
    tabs,
    ...(activeTitle
      ? { activeTab: tabs.find((tab) => tab.title === activeTitle)?.id }
      : {}),
    scenes: [
      {
        id: "intro-greeting",
        subtitle:
          report.introContent ??
          `大家${getGreeting(hour)}，欢迎收看今天的 AI 日报。`,
      },
    ],
  };
}

function buildOutro(report) {
  return {
    id: "outro",
    topTitle: "结语",
    bottomTitle: "结语",
    scenes: [
      {
        id: "outro-ending",
        subtitle: report.outroContent ?? "今天的资讯播送完了，明天见！",
      },
    ],
  };
}

function restoreIcons(report, previousReport) {
  if (!previousReport) return;

  const previousIcons = new Map();
  const rememberIcons = (story) => {
    for (const tab of story?.tabs ?? []) {
      if (tab.icon) previousIcons.set(`${story.id}:${tab.id}`, tab.icon);
    }
  };

  rememberIcons(previousReport.intro);
  for (const story of previousReport.stories ?? []) rememberIcons(story);

  const applyIcons = (story) => {
    for (const tab of story?.tabs ?? []) {
      const icon = previousIcons.get(`${story.id}:${tab.id}`);
      if (icon) tab.icon = icon;
    }
  };

  applyIcons(report.intro);
  for (const story of report.stories) applyIcons(story);
}

export function buildGeneratedReport(
  rawReport,
  previousReport,
  now = new Date(),
) {
  const report = JSON.parse(JSON.stringify(rawReport));
  report.theme ??=
    now.getHours() >= 6 && now.getHours() < 18 ? "light" : "dark";
  report.intro = buildIntro(report, now.getHours());
  report.outro = buildOutro(report);
  restoreIcons(report, previousReport);
  return report;
}

export function collectTimelineScenes(report) {
  return [report.intro, ...(report.stories ?? []), report.outro]
    .filter(Boolean)
    .flatMap((story) => story.scenes ?? []);
}

// ── 视频帧时间线（与 Remotion 播放器保持一致） ─────────────────────────
//
// 评论里的时间戳必须落在播放器真实渲染故事的那一帧。成片在相邻 story 之间
// 会插入 STORY_TRANSITION_FRAMES 的过渡（点击音效），而这些过渡帧不在 TTS
// 的 startMs 时间线里。若评论直接用 startMs，每条都会偏早，且越往后偏差越大。
// 下面两个常量是 src/AiDailyReport.tsx 中 buildTimeline 的镜像：改 React 侧时
// 务必同步这里，避免评论与画面错位。

export const VIDEO_FPS = 30;
export const STORY_TRANSITION_FRAMES = 18;

/**
 * 按 Remotion 的帧时间线累计每个 story 的起始毫秒。
 * 返回数组与 [intro, ...stories, outro] 对齐：index 0 是 intro，
 * data.stories[i] 对应 index i + 1（intro / outro 在 generated 数据中始终存在）。
 */
export function buildVideoStoryStartMs(report) {
  const timelineStories = [report.intro, ...(report.stories ?? []), report.outro];
  const msToFrames = (ms) => Math.round((ms / 1000) * VIDEO_FPS);
  let cursor = 0;
  const startMs = [];
  for (let si = 0; si < timelineStories.length; si++) {
    startMs.push((cursor / VIDEO_FPS) * 1000);
    for (const scene of timelineStories[si].scenes ?? []) {
      cursor += msToFrames(scene.timing?.durationMs ?? 0);
    }
    if (si < timelineStories.length - 1) cursor += STORY_TRANSITION_FRAMES;
  }
  return startMs;
}
