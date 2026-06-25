import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {Lunar} from "lunar-javascript";
import {dataDir as defaultDataDir} from "./paths.mjs";
import {readImageDimensions} from "./image-dims.mjs";

// 时间线常量的单一事实源是 video-timeline.json（与 src/AiDailyReport.tsx 渲染侧同源读取）。
// 改这里即两侧同步，避免此前硬编码常量在 JS/TS 两处各自维护导致的评论与画面错位。
const videoTimeline = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../video-timeline.json"), "utf8"),
);

function getGreeting(hour) {
  if (hour >= 5 && hour < 12) return "早上好";
  if (hour >= 12 && hour < 14) return "中午好";
  if (hour >= 14 && hour < 18) return "下午好";
  return "晚上好";
}

const weekdays = [
  "星期日",
  "星期一",
  "星期二",
  "星期三",
  "星期四",
  "星期五",
  "星期六",
];

function parseReportDate(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? "");
  if (!match) return null;
  const [, year, month, day] = match;
  const reportDate = new Date(Number(year), Number(month) - 1, Number(day));
  if (
    reportDate.getFullYear() !== Number(year) ||
    reportDate.getMonth() !== Number(month) - 1 ||
    reportDate.getDate() !== Number(day)
  ) {
    return null;
  }
  return reportDate;
}

function formatLunarDateWithWeekday(date) {
  const lunar = Lunar.fromDate(date);
  return `农历${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}，${weekdays[date.getDay()]}`;
}

function buildIntro(report, now) {
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
  const dateText = formatLunarDateWithWeekday(parseReportDate(report.date) ?? now);

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
          `大家${getGreeting(now.getHours())}，今天是${dateText}，欢迎收看今天的 AI 日报。`,
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
  dataDir = defaultDataDir,
) {
  const report = JSON.parse(JSON.stringify(rawReport));
  report.theme ??=
    now.getHours() >= 6 && now.getHours() < 18 ? "light" : "dark";
  report.intro = buildIntro(report, now);
  report.outro = buildOutro(report);
  restoreIcons(report, previousReport);
  applyOverlayDimensions(report, dataDir);
  return report;
}

// 构建期按 overlayImg 文件真实像素写入 overlayImgWidth/Height。
// raw 里的宽高只是提示；生成态先清旧值，再以文件为准。
function applyOverlayDimensions(report, dataDir) {
  for (const scene of collectTimelineScenes(report)) {
    delete scene.overlayImgWidth;
    delete scene.overlayImgHeight;
    if (!scene.overlayImg) {
      continue;
    }
    const dims = readImageDimensions(scene.overlayImg, dataDir);
    if (dims) {
      scene.overlayImgWidth = dims.width;
      scene.overlayImgHeight = dims.height;
    }
  }
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
//
// 常量不再硬编码：VIDEO_FPS / STORY_TRANSITION_FRAMES 与 src/AiDailyReport.tsx
// 渲染侧从同一份 video-timeline.json 读取（见文件顶部），改配置即两侧同步。
// buildVideoStoryStartMs 是生成侧的权威实现：generate-tts 用它把每个 story 的
// 成片起始毫秒写入 data-generate.json 的 story.videoStartMs，评论侧直接读，
// 不再各自计算。

export const VIDEO_FPS = videoTimeline.fps;
export const STORY_TRANSITION_FRAMES = videoTimeline.storyTransitionFrames;

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
    // cursor 是帧数，换算成毫秒后必须取整：videoStartMs 的 schema 要求非负整数，
    // 直接 (cursor / VIDEO_FPS) * 1000 在 fps=30 等场景下会是 33.33 这类小数。
    startMs.push(Math.round((cursor / VIDEO_FPS) * 1000));
    for (const scene of timelineStories[si].scenes ?? []) {
      cursor += msToFrames(scene.timing?.durationMs ?? 0);
    }
    if (si < timelineStories.length - 1) cursor += STORY_TRANSITION_FRAMES;
  }
  return startMs;
}
