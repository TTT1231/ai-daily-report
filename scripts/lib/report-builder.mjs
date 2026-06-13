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
      ? {activeTab: tabs.find((tab) => tab.title === activeTitle)?.id}
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
    bottomTitle: "再见",
    scenes: [
      {
        id: "outro-ending",
        subtitle: report.outroContent ?? "今天的资讯播送完了，再见！",
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

export function buildGeneratedReport(rawReport, previousReport, now = new Date()) {
  const report = JSON.parse(JSON.stringify(rawReport));
  report.theme ??= now.getHours() >= 6 && now.getHours() < 18 ? "light" : "dark";
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
