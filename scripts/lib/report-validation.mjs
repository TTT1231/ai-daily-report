import { existsSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { dataDir, schemaPath } from "./paths.mjs";
import {
  navigationCapacity,
  reportNavigationLabels,
} from "./navigation-layout.mjs";

const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const validateSchema = new Ajv2020({ allErrors: true }).compile(schema);
const MAX_TAB_SUMMARY_VISIBLE_CHARACTERS = 110;

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
        total + (character.codePointAt(0) <= 0x7f ? 0.62 : 1) * multiplier,
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

  if (report.$schema !== "../config/data.schema.json") {
    fail("$schema", 'must equal "../config/data.schema.json"');
  }
  if (structureErrors.length > 0) return { errors, totalDurationMs: 0 };
  if (renderMode && !report.intro)
    fail("intro", "is required before rendering");
  if (renderMode && !report.outro)
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
  const storyIds = new Map();
  const sceneIds = new Map();
  const topTitles = new Set();
  const closedTopTitleSegments = new Set();
  let previousTopTitle;
  let activeIntroCount = 0;
  const timelineEntries = renderMode
    ? [
        ...(report.intro ? [{ story: report.intro, path: "intro" }] : []),
        ...(report.stories ?? []).map((story, index) => ({
          story,
          path: `stories[${index}]`,
        })),
        ...(report.outro ? [{ story: report.outro, path: "outro" }] : []),
      ]
    : (report.stories ?? []).map((story, index) => ({
        story,
        path: `stories[${index}]`,
      }));

  for (const { story, path: storyPath } of timelineEntries) {
    if (storyIds.has(story.id)) {
      fail(
        `${storyPath}.id`,
        `duplicate id "${story.id}" (first used at ${storyIds.get(story.id)})`,
      );
    } else {
      storyIds.set(story.id, `${storyPath}.id`);
    }
    if (!renderMode && ["intro", "outro"].includes(story.id)) {
      fail(
        `${storyPath}.id`,
        `"${story.id}" is reserved and generated automatically`,
      );
    }
    if (story.activeIntro === true) activeIntroCount++;
    if (!["intro", "outro"].includes(story.id)) {
      topTitles.add(story.topTitle);
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
    for (const [tabIndex, tab] of (story.tabs ?? []).entries()) {
      const tabPath = `${storyPath}.tabs[${tabIndex}]`;
      if (tabIds.has(tab.id)) {
        fail(
          `${tabPath}.id`,
          `duplicate id "${tab.id}" (first used at ${tabIds.get(tab.id)})`,
        );
      } else {
        tabIds.set(tab.id, `${tabPath}.id`);
      }
      const summaryLength = tabSummaryVisibleLength(tab.summary);
      const markdownStats = tabSummaryMarkdownStats(tab.summary);
      const markdownIssue = tabSummaryMarkdownIssue(tab.summary);
      const titleKey = normalizeComparableText(tab.title);
      const summaryKey = normalizeComparableText(tab.summary);
      if (tabTitles.has(titleKey)) {
        fail(`${tabPath}.title`, "must be unique within its story");
      }
      tabTitles.add(titleKey);
      if (
        isNewsStory &&
        titleKey === normalizeComparableText(story.contentTitle)
      ) {
        fail(`${tabPath}.title`, "must not copy the full story contentTitle");
      }
      if (isNewsStory && summaryLength > MAX_TAB_SUMMARY_VISIBLE_CHARACTERS) {
        fail(
          `${tabPath}.summary`,
          `has ${summaryLength} visible characters; maximum is ${MAX_TAB_SUMMARY_VISIBLE_CHARACTERS}`,
        );
      }
      if (isNewsStory && markdownIssue) {
        fail(`${tabPath}.summary`, `has malformed Markdown: ${markdownIssue}`);
      } else if (isNewsStory && markdownStats.boldSpans === 0) {
        fail(
          `${tabPath}.summary`,
          "must use exactly one bold span for the core change, mechanism, impact, or conclusion",
        );
      } else if (isNewsStory && markdownStats.boldSpans > 1) {
        fail(`${tabPath}.summary`, "must use at most one bold span");
      }
      if (
        isNewsStory &&
        markdownStats.visualUnits > MAX_TAB_SUMMARY_VISIBLE_CHARACTERS
      ) {
        fail(
          `${tabPath}.summary`,
          `uses ${markdownStats.visualUnits.toFixed(1)} visual units; maximum is ${MAX_TAB_SUMMARY_VISIBLE_CHARACTERS}`,
        );
      }
      if (isNewsStory && !hasCompleteSummaryEnding(tab.summary)) {
        fail(`${tabPath}.summary`, "must end as a complete sentence");
      }
      if (isNewsStory && overlapsSummary(summaryKey, tabSummaries)) {
        fail(
          `${tabPath}.summary`,
          "must not contain or duplicate another tab summary in the same story",
        );
      }
      tabSummaries.push(summaryKey);
      if (checkAssets && tab.icon)
        validateAsset(tab.icon, `${tabPath}.icon`, errors);
    }
    if (story.activeTab !== undefined && !tabIds.has(story.activeTab)) {
      fail(`${storyPath}.activeTab`, `unknown tab id "${story.activeTab}"`);
    }

    for (const [sceneIndex, scene] of (story.scenes ?? []).entries()) {
      const scenePath = `${storyPath}.scenes[${sceneIndex}]`;
      if (sceneIds.has(scene.id)) {
        fail(
          `${scenePath}.id`,
          `duplicate global scene id "${scene.id}" (first used at ${sceneIds.get(scene.id)})`,
        );
      } else {
        sceneIds.set(scene.id, `${scenePath}.id`);
      }

      if (renderMode && !scene.timing) {
        fail(`${scenePath}.timing`, "is required before rendering");
      } else if (renderMode && scene.timing) {
        if (scene.timing.startMs !== expectedStartMs) {
          fail(
            `${scenePath}.timing.startMs`,
            `expected ${expectedStartMs}, received ${scene.timing.startMs}`,
          );
        }
        expectedStartMs += scene.timing.durationMs;
      }

      if (scene.tts && !scene.audioSrc) {
        fail(`${scenePath}.audioSrc`, "is required when tts metadata exists");
      }
      if (scene.tts && !scene.timing) {
        fail(`${scenePath}.timing`, "is required when tts metadata exists");
      }
      if (
        scene.tts &&
        scene.timing &&
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
  if (topTitles.size > 5) {
    fail(
      "stories",
      `must use at most 5 unique topTitle categories, received ${topTitles.size}`,
    );
  }
  const navigationLabels = reportNavigationLabels(report);
  const navigationStats = {};
  for (const [name, labels] of Object.entries(navigationLabels)) {
    const { availableWidth, requiredWidth } = navigationCapacity(labels, {
      windowed: name === "bottom",
    });
    navigationStats[name] = {
      availableWidth,
      itemCount: labels.length,
      requiredWidth,
    };
    if (requiredWidth > availableWidth) {
      fail(
        `${name}Navigation`,
        `requires ${requiredWidth}px but only ${availableWidth}px is available across ${labels.length} labels`,
      );
    }
  }

  return { errors, navigationStats, totalDurationMs: expectedStartMs };
}
