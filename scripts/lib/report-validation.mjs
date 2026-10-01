import { existsSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { dataDir, schemaPath } from "./paths.mjs";
import {
  reportUsesEvidenceOnly,
  storyShowsTabCards,
} from "./story-presentation.mjs";
import {
  asciiWidthFactor,
  maxTopCategories,
  navigationCapacity,
  reportNavigationLabels,
  topNavigationComfortFillRatio,
} from "./navigation-layout.mjs";

const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const validateSchema = new Ajv2020({ allErrors: true }).compile(schema);
const MAX_TAB_SUMMARY_VISIBLE_CHARACTERS = 110;

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const arrayOrEmpty = (value) => (Array.isArray(value) ? value : []);
const isText = (value) => typeof value === "string" && value.trim().length > 0;
const tabSummaryVisibleLength = (value) =>
  Array.from(
    String(value ?? "")
      .replaceAll("**", "")
      .replaceAll("`", ""),
  ).length;

function tabSummaryMarkdownStats(value) {
  const parts = String(value ?? "")
    .split(/(\*\*.*?\*\*|`.*?`)/g)
    .filter(Boolean);
  let visualUnits = 0;
  let boldSpans = 0;
  const unitsFor = (content, multiplier) =>
    Array.from(content).reduce(
      (total, character) =>
        // ASCII 视觉宽度系数与渲染/导航侧同源（video-layout.json）。
        total +
        (character.codePointAt(0) <= 0x7f ? asciiWidthFactor : 1) * multiplier,
      0,
    );
  for (const part of parts) {
    if (part.startsWith("**") && part.endsWith("**")) {
      boldSpans++;
      visualUnits += unitsFor(part.slice(2, -2), 1.08) + 0.35;
    } else if (part.startsWith("`") && part.endsWith("`")) {
      visualUnits += unitsFor(part.slice(1, -1), 1.02) + 0.55;
    } else {
      visualUnits += unitsFor(part, 1);
    }
  }
  return { boldSpans, visualUnits };
}

function tabSummaryMarkdownIssue(value) {
  const text = String(value ?? "");
  const boldSpans = [...text.matchAll(/\*\*[^*]+\*\*/g)];
  const codeSpans = [...text.matchAll(/`[^`]+`/g)];
  if ((text.match(/\*\*/g) ?? []).length !== boldSpans.length * 2) {
    return "bold markers must be paired and must not contain nested asterisks";
  }
  if ((text.match(/`/g) ?? []).length !== codeSpans.length * 2) {
    return "inline-code markers must be paired";
  }

  for (const bold of boldSpans) {
    const boldStart = bold.index;
    const boldEnd = boldStart + bold[0].length;
    const content = bold[0].slice(2, -2).trim();
    if (/[“‘（(《【]$/.test(content) || /^[”’）)》】]/.test(content)) {
      return "bold boundaries must not split paired punctuation";
    }
    for (const code of codeSpans) {
      const codeStart = code.index;
      const codeEnd = codeStart + code[0].length;
      if (boldStart < codeEnd && codeStart < boldEnd) {
        return "bold and inline-code spans must not overlap or nest";
      }
    }
  }

  for (const code of codeSpans) {
    const start = code.index;
    const end = start + code[0].length;
    const previous = start > 0 ? text[start - 1] : "";
    const next = end < text.length ? text[end] : "";
    if (/[A-Za-z0-9_.+-]/.test(previous) || /[A-Za-z0-9_.+-]/.test(next)) {
      return "inline code must not split one English identifier";
    }
  }
  return "";
}

const normalizeComparableText = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replaceAll("[", "")
    .replaceAll("]", "")
    .replace(/[\s：:，,。.！!？?【】（）()_`*-]/g, "");

function hasCompleteSummaryEnding(value) {
  const plain = String(value ?? "")
    .replaceAll("**", "")
    .replaceAll("`", "")
    .trim()
    .replace(/["'”’）》】]+$/g, "");
  return /[。！？!?；;.]$/.test(plain);
}

function overlapsSummary(candidate, existing) {
  if (Array.from(candidate).length < 25) return false;
  return existing.some(
    (previous) =>
      Array.from(previous).length >= 25 &&
      (candidate.includes(previous) || previous.includes(candidate)),
  );
}

function schemaErrors(report) {
  if (validateSchema(report)) return [];
  return validateSchema.errors.map((error) => {
    const path =
      error.instancePath.replaceAll("/", ".").replace(/^\./, "") || "$";
    return `${path}: ${error.message}`;
  });
}

function validateAsset(assetPath, jsonPath, errors) {
  if (!isText(assetPath)) return;
  const absolute = resolve(dataDir, assetPath);
  if (!absolute.startsWith(dataDir + sep)) {
    errors.push(`${jsonPath}: must stay inside data-scheme/`);
  } else if (!existsSync(absolute)) {
    errors.push(`${jsonPath}: file not found: ${assetPath}`);
  }
}

export function validateOverlayImageDimensions(scene, scenePath, errors) {
  if (!scene.overlayImg) {
    if (scene.overlayImgWidth || scene.overlayImgHeight) {
      errors.push(
        `${scenePath}.overlayImg: is required when dimensions are set`,
      );
    }
    if (scene.overlayImgScale !== undefined) {
      errors.push(`${scenePath}.overlayImg: is required when scale is set`);
    }
    return;
  }

  const hasWidth = scene.overlayImgWidth !== undefined;
  const hasHeight = scene.overlayImgHeight !== undefined;
  if (hasWidth !== hasHeight) {
    errors.push(
      `${scenePath}.overlayImgWidth/overlayImgHeight: must be set together`,
    );
    return;
  }
  if (!hasWidth) return;

  // 尺寸是否与文件一致不再校验：overlayImgWidth/Height 是 generated-only，
  // 由 report-builder 构建期按文件真相写入 data-generate.json（rss 不写、raw 不落盘）。
}

export function validateReport(
  report,
  { renderMode = false, checkAssets = true } = {},
) {
  const structureErrors = schemaErrors(report);
  const errors = [...structureErrors];
  const fail = (path, message) => errors.push(`${path}: ${message}`);

  // Schema errors own malformed values. Continue into usable sibling fields so
  // length/shape failures do not hide independent Markdown or business errors.
  if (!isRecord(report)) return { errors, totalDurationMs: 0 };
  if (report.$schema !== "../config/data.schema.json") {
    fail("$schema", 'must equal "../config/data.schema.json"');
  }
  if (renderMode && !report.intro)
    fail("intro", "is required before rendering");
  if (renderMode && !report.outro && !reportUsesEvidenceOnly(report))
    fail("outro", "is required before rendering");
  if (
    !renderMode &&
    (report.intro !== undefined || report.outro !== undefined)
  ) {
    fail(
      "intro/outro",
      "are generated automatically and must not be added to data.json",
    );
  }

  let expectedStartMs = 0;
  let timingContinuityKnown = true;
  const storyIds = new Map();
  const sceneIds = new Map();
  const closedTopTitleSegments = new Set();
  let previousTopTitle;
  let activeIntroCount = 0;
  const timelineEntries = renderMode
    ? [
        ...(report.intro ? [{ story: report.intro, path: "intro" }] : []),
        ...arrayOrEmpty(report.stories).map((story, index) => ({
          story,
          path: `stories[${index}]`,
        })),
        ...(report.outro ? [{ story: report.outro, path: "outro" }] : []),
      ]
    : arrayOrEmpty(report.stories).map((story, index) => ({
        story,
        path: `stories[${index}]`,
      }));

  for (const { story, path: storyPath } of timelineEntries) {
    if (!isRecord(story)) {
      timingContinuityKnown = false;
      continue;
    }
    if (isText(story.id) && storyIds.has(story.id)) {
      fail(
        `${storyPath}.id`,
        `duplicate id "${story.id}" (first used at ${storyIds.get(story.id)})`,
      );
    } else if (isText(story.id)) {
      storyIds.set(story.id, `${storyPath}.id`);
    }
    if (!renderMode && ["intro", "outro"].includes(story.id)) {
      fail(
        `${storyPath}.id`,
        `"${story.id}" is reserved and generated automatically`,
      );
    }
    if (story.activeIntro === true) activeIntroCount++;
    if (!["intro", "outro"].includes(story.id) && isText(story.topTitle)) {
      if (story.topTitle !== previousTopTitle) {
        if (closedTopTitleSegments.has(story.topTitle)) {
          fail(
            `${storyPath}.topTitle`,
            `category "${story.topTitle}" appears in multiple non-adjacent segments`,
          );
        }
        if (previousTopTitle !== undefined) {
          closedTopTitleSegments.add(previousTopTitle);
        }
      }
      previousTopTitle = story.topTitle;
    }

    const tabIds = new Map();
    const tabTitles = new Set();
    const tabSummaries = [];
    const isNewsStory = !["intro", "outro"].includes(story.id);
    for (const [tabIndex, tab] of arrayOrEmpty(story.tabs).entries()) {
      if (!isRecord(tab)) continue;
      const tabPath = `${storyPath}.tabs[${tabIndex}]`;
      if (isText(tab.id) && tabIds.has(tab.id)) {
        fail(
          `${tabPath}.id`,
          `duplicate id "${tab.id}" (first used at ${tabIds.get(tab.id)})`,
        );
      } else if (isText(tab.id)) {
        tabIds.set(tab.id, `${tabPath}.id`);
      }
      const hasSummary = typeof tab.summary === "string";
      const summaryLength = hasSummary
        ? tabSummaryVisibleLength(tab.summary)
        : 0;
      const markdownStats = hasSummary
        ? tabSummaryMarkdownStats(tab.summary)
        : { boldSpans: 0, visualUnits: 0 };
      const markdownIssue = hasSummary
        ? tabSummaryMarkdownIssue(tab.summary)
        : "";
      const titleKey = isText(tab.title)
        ? normalizeComparableText(tab.title)
        : null;
      const summaryKey = hasSummary ? normalizeComparableText(tab.summary) : "";
      if (titleKey !== null && tabTitles.has(titleKey)) {
        fail(`${tabPath}.title`, "must be unique within its story");
      }
      if (titleKey !== null) tabTitles.add(titleKey);
      if (
        isNewsStory &&
        titleKey !== null &&
        isText(story.contentTitle) &&
        titleKey === normalizeComparableText(story.contentTitle)
      ) {
        fail(`${tabPath}.title`, "must not copy the full story contentTitle");
      }
      if (
        isNewsStory &&
        hasSummary &&
        summaryLength > MAX_TAB_SUMMARY_VISIBLE_CHARACTERS
      ) {
        fail(
          `${tabPath}.summary`,
          `has ${summaryLength} visible characters; maximum is ${MAX_TAB_SUMMARY_VISIBLE_CHARACTERS}`,
        );
      }
      if (isNewsStory && hasSummary && markdownIssue) {
        fail(`${tabPath}.summary`, `has malformed Markdown: ${markdownIssue}`);
      } else if (isNewsStory && hasSummary && markdownStats.boldSpans === 0) {
        fail(
          `${tabPath}.summary`,
          "must use exactly one bold span for the core change, mechanism, impact, or conclusion",
        );
      } else if (isNewsStory && hasSummary && markdownStats.boldSpans > 1) {
        fail(`${tabPath}.summary`, "must use at most one bold span");
      }
      if (
        isNewsStory &&
        hasSummary &&
        markdownStats.visualUnits > MAX_TAB_SUMMARY_VISIBLE_CHARACTERS
      ) {
        fail(
          `${tabPath}.summary`,
          `uses ${markdownStats.visualUnits.toFixed(1)} visual units; maximum is ${MAX_TAB_SUMMARY_VISIBLE_CHARACTERS}`,
        );
      }
      if (isNewsStory && hasSummary && !hasCompleteSummaryEnding(tab.summary)) {
        fail(`${tabPath}.summary`, "must end as a complete sentence");
      }
      if (
        isNewsStory &&
        hasSummary &&
        overlapsSummary(summaryKey, tabSummaries)
      ) {
        fail(
          `${tabPath}.summary`,
          "must not contain or duplicate another tab summary in the same story",
        );
      }
      if (hasSummary) tabSummaries.push(summaryKey);
      if (
        checkAssets &&
        tab.icon &&
        (!isNewsStory || storyShowsTabCards(story))
      )
        validateAsset(tab.icon, `${tabPath}.icon`, errors);
    }
    if (
      isText(story.activeTab) &&
      Array.isArray(story.tabs) &&
      story.tabs.every((tab) => isRecord(tab) && isText(tab.id)) &&
      !tabIds.has(story.activeTab)
    ) {
      fail(`${storyPath}.activeTab`, `unknown tab id "${story.activeTab}"`);
    }

    if (!Array.isArray(story.scenes)) timingContinuityKnown = false;
    for (const [sceneIndex, scene] of arrayOrEmpty(story.scenes).entries()) {
      if (!isRecord(scene)) {
        timingContinuityKnown = false;
        continue;
      }
      const scenePath = `${storyPath}.scenes[${sceneIndex}]`;
      if (isText(scene.id) && sceneIds.has(scene.id)) {
        fail(
          `${scenePath}.id`,
          `duplicate global scene id "${scene.id}" (first used at ${sceneIds.get(scene.id)})`,
        );
      } else if (isText(scene.id)) {
        sceneIds.set(scene.id, `${scenePath}.id`);
      }

      if (renderMode && !scene.timing) {
        fail(`${scenePath}.timing`, "is required before rendering");
        timingContinuityKnown = false;
      } else if (renderMode && isRecord(scene.timing)) {
        if (
          timingContinuityKnown &&
          Number.isInteger(scene.timing.startMs) &&
          scene.timing.startMs >= 0 &&
          scene.timing.startMs !== expectedStartMs
        ) {
          fail(
            `${scenePath}.timing.startMs`,
            `expected ${expectedStartMs}, received ${scene.timing.startMs}`,
          );
        }
        if (
          Number.isInteger(scene.timing.durationMs) &&
          scene.timing.durationMs > 0
        ) {
          expectedStartMs += scene.timing.durationMs;
        } else {
          timingContinuityKnown = false;
        }
      } else if (renderMode) {
        timingContinuityKnown = false;
      }

      if (isRecord(scene.tts) && !scene.audioSrc) {
        fail(`${scenePath}.audioSrc`, "is required when tts metadata exists");
      }
      if (isRecord(scene.tts) && !scene.timing) {
        fail(`${scenePath}.timing`, "is required when tts metadata exists");
      }
      if (
        isRecord(scene.tts) &&
        isRecord(scene.timing) &&
        Number.isInteger(scene.timing.durationMs) &&
        Number.isInteger(scene.tts.audioLengthMs) &&
        Number.isInteger(scene.tts.tailPaddingMs) &&
        scene.timing.durationMs !==
          scene.tts.audioLengthMs + scene.tts.tailPaddingMs
      ) {
        fail(
          `${scenePath}.timing.durationMs`,
          "must equal tts.audioLengthMs + tts.tailPaddingMs",
        );
      }
      if (checkAssets && scene.overlayImg) {
        validateAsset(scene.overlayImg, `${scenePath}.overlayImg`, errors);
      }
      if (checkAssets) {
        validateOverlayImageDimensions(scene, scenePath, errors);
      }
      if (checkAssets && scene.audioSrc) {
        validateAsset(scene.audioSrc, `${scenePath}.audioSrc`, errors);
      }
    }

    // videoStartMs 是 TTS 写入的成片起始毫秒（generated-only）。raw 数据没有它，
    // 因此只在 renderMode 下做类型卫生校验；不校验它是否等于算法预期，避免与
    // 时间线算法重新耦合（算法的单一事实源是 video-timeline.json）。
    if (renderMode && story.videoStartMs !== undefined) {
      if (!Number.isInteger(story.videoStartMs) || story.videoStartMs < 0) {
        fail(
          `${storyPath}.videoStartMs`,
          "must be a non-negative integer when present",
        );
      }
    }
  }

  if (activeIntroCount > 1) {
    fail("stories", "only one story may set activeIntro to true");
  }
  const categoryCount = new Set(
    arrayOrEmpty(report.stories)
      .filter((story) => isRecord(story) && isText(story.topTitle))
      .map((story) => story.topTitle),
  ).size;
  if (categoryCount > maxTopCategories) {
    fail(
      "stories.topTitle",
      `${categoryCount} body categories exceed the maximum of ${maxTopCategories} (Intro/outro excluded); group related stories into consecutive chapters`,
    );
  }
  const hasNavigationLabels = (story) =>
    isRecord(story) && isText(story.topTitle) && isText(story.bottomTitle);
  const canCheckNavigation =
    Array.isArray(report.stories) &&
    report.stories.every(hasNavigationLabels) &&
    (report.intro === undefined || hasNavigationLabels(report.intro)) &&
    (report.outro === undefined || hasNavigationLabels(report.outro));
  const navigationLabels = canCheckNavigation
    ? reportNavigationLabels(report)
    : {};
  const navigationStats = canCheckNavigation ? {} : undefined;
  for (const [name, labels] of Object.entries(navigationLabels)) {
    const { availableWidth, requiredWidth } = navigationCapacity(labels, {
      windowed: name === "bottom",
    });
    const fillRatio = availableWidth > 0 ? requiredWidth / availableWidth : 0;
    navigationStats[name] = {
      availableWidth,
      fillRatio,
      itemCount: labels.length,
      requiredWidth,
      ...(name === "top"
        ? {
            comfortFillRatio: topNavigationComfortFillRatio,
            density:
              fillRatio > 1
                ? "overflow"
                : fillRatio > topNavigationComfortFillRatio
                  ? "dense"
                  : "comfortable",
          }
        : {}),
    };
    if (requiredWidth > availableWidth) {
      fail(
        `${name}Navigation`,
        `requires ${requiredWidth}px but only ${availableWidth}px is available across ${labels.length} labels`,
      );
    }
  }

  return {
    errors,
    navigationStats,
    totalDurationMs: timingContinuityKnown ? expectedStartMs : 0,
  };
}
