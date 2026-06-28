import {existsSync} from "node:fs";
import {mkdir, readdir, readFile, unlink, writeFile} from "node:fs/promises";
import {dirname, extname, resolve, sep} from "node:path";
import {
  collectTabIconEntries,
  defaultIconPathForTab,
  ICON_PATTERN,
  MAX_SVG_BYTES,
  validateReportIcons,
} from "./icon-validation.mjs";
import {dataDir as defaultDataDir, rawDataPath as defaultRawDataPath} from "./paths.mjs";

export const GENERATE_SVG_PAYLOAD_START = "BEGIN_GENERATE_SVG_JSON";
export const GENERATE_SVG_PAYLOAD_END = "END_GENERATE_SVG_JSON";

const SAFE_ICON_PATH = /^icons\/[A-Za-z0-9_.-]+\.svg$/;
const PRUNABLE_ICON_EXTENSIONS = new Set([".svg", ".png"]);

function safeIconPath(iconPath, dataDir = defaultDataDir) {
  if (typeof iconPath !== "string" || !SAFE_ICON_PATH.test(iconPath)) return null;
  const absolute = resolve(dataDir, iconPath);
  if (!absolute.startsWith(dataDir + sep)) return null;
  return iconPath;
}

function siblingContext(story) {
  return (story.tabs ?? []).map((tab) => ({
    id: tab.id,
    title: tab.title,
    summary: tab.summary,
    icon: typeof tab.icon === "string" ? tab.icon : undefined,
  }));
}

function addEntry(targetsByPath, iconPath, entry, story, dataDir) {
  const safePath = safeIconPath(iconPath, dataDir);
  if (!safePath) return;

  if (!targetsByPath.has(safePath)) {
    targetsByPath.set(safePath, {
      path: safePath,
      storyId: entry.storyId,
      storyTitle: story.contentTitle ?? story.bottomTitle ?? story.topTitle ?? story.id,
      storyTopTitle: story.topTitle,
      storyBottomTitle: story.bottomTitle,
      tabs: [],
      siblingTabs: siblingContext(story),
    });
  }

  targetsByPath.get(safePath).tabs.push({
    id: entry.tab.id,
    title: entry.tab.title,
    summary: entry.tab.summary,
    jsonPath: entry.jsonPath,
  });
}

export function buildGenerateSvgTargetPlan(report, {force = false, dataDir = defaultDataDir} = {}) {
  const validation = validateReportIcons(report, {
    dataDir,
    includeOrphanWarnings: false,
  });
  const targetPaths = new Set(force ? [] : validation.iconTargets);
  const targetsByPath = new Map();
  const timelineEntries = [
    ...(report.intro ? [{story: report.intro, path: "intro"}] : []),
    ...(report.stories ?? []).map((story, index) => ({
      story,
      path: `stories[${index}]`,
    })),
  ];

  for (const {story, path: storyPath} of timelineEntries) {
    if (!Array.isArray(story.tabs)) continue;

    for (const [tabIndex, tab] of story.tabs.entries()) {
      const entry = {
        tab,
        storyId: story.id,
        jsonPath: `${storyPath}.tabs[${tabIndex}]`,
      };
      const defaultIcon = defaultIconPathForTab(story.id, tab.id);

      if (force) {
        addEntry(targetsByPath, defaultIcon, entry, story, dataDir);
        continue;
      }

      const existingIcon = typeof tab.icon === "string" && ICON_PATTERN.test(tab.icon) ? tab.icon : null;
      if (existingIcon && targetPaths.has(existingIcon)) {
        addEntry(targetsByPath, existingIcon, entry, story, dataDir);
      } else if (defaultIcon && targetPaths.has(defaultIcon)) {
        addEntry(targetsByPath, defaultIcon, entry, story, dataDir);
      }
    }
  }

  return {
    validation,
    targets: [...targetsByPath.values()],
    targetPaths: [...targetsByPath.keys()],
  };
}

export function buildGenerateSvgPayloadPrompt({
  promptPrefix,
  targets,
  preflightErrors = [],
  automation = false,
  theme = "dark",
} = {}) {
  const promptLines = Array.isArray(promptPrefix) ? [...promptPrefix] : [promptPrefix ?? ""];
  const compactTargets = targets.map((target) => ({
    path: target.path,
    storyId: target.storyId,
    storyTitle: target.storyTitle,
    storyTopTitle: target.storyTopTitle,
    storyBottomTitle: target.storyBottomTitle,
    targetTabs: target.tabs,
    siblingTabs: target.siblingTabs,
  }));

  promptLines.push(
    "",
    "Structured payload mode:",
    "- Do not call tools. Do not read or write files. Do not run shell commands.",
    "- Generate every SVG in one response. The Node wrapper will write files, update JSON, and run validation.",
    "- Return only the marked JSON payload. No Markdown, no prose outside the markers.",
    "- Each SVG must be a compact string with escaped double quotes, include xmlns and viewBox=\"0 0 96 96\", and use a transparent canvas.",
    "- Keep each SVG under about 1800 UTF-8 bytes. Avoid <style>, <script>, <text>, external assets, animation, or a full-canvas background shape.",
    "- Use sibling variety: target icons from the same story should have distinct silhouettes and colors.",
    "- Paths must exactly match the requested target paths. Do not add, remove, rename, or reassign paths.",
    "",
    `Current report theme: ${theme}`,
  );

  if (automation) {
    promptLines.push("", "Automation constraint: no preview, no render, no dev server.");
  }

  if (preflightErrors.length > 0) {
    promptLines.push("", "Preflight issues to fix:", ...preflightErrors.map((error) => `- ${error}`));
  }

  promptLines.push(
    "",
    "Target icon context JSON:",
    JSON.stringify(compactTargets, null, 2),
    "",
    "Output schema:",
    `${GENERATE_SVG_PAYLOAD_START}`,
    '{"icons":[{"path":"icons/example.svg","concept":"short semantic concept","svg":"<svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"0 0 96 96\\" fill=\\"none\\">...</svg>"}]}',
    `${GENERATE_SVG_PAYLOAD_END}`,
  );

  return promptLines.join("\n");
}

function extractJsonPayload(output) {
  const startIndex = output.indexOf(GENERATE_SVG_PAYLOAD_START);
  const endIndex = output.indexOf(GENERATE_SVG_PAYLOAD_END);

  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    return output.slice(startIndex + GENERATE_SVG_PAYLOAD_START.length, endIndex).trim();
  }

  const trimmed = output.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

export function parseGenerateSvgPayload(output) {
  let parsed;
  try {
    parsed = JSON.parse(extractJsonPayload(output));
  } catch (error) {
    throw new Error(`Claude did not return valid generate-svg JSON: ${error.message}`);
  }

  if (!parsed || !Array.isArray(parsed.icons)) {
    throw new Error('Claude payload must be an object with an "icons" array.');
  }

  return parsed;
}

function validatePayloadIcons(payload, expectedPaths, {dataDir = defaultDataDir} = {}) {
  const expected = new Set(expectedPaths);
  const seen = new Set();

  for (const [index, icon] of payload.icons.entries()) {
    if (!icon || typeof icon !== "object") {
      throw new Error(`Claude payload icons[${index}] must be an object.`);
    }

    const path = safeIconPath(icon.path, dataDir);
    if (!path || !expected.has(path)) {
      throw new Error(`Claude payload contains unexpected icon path: ${icon.path}`);
    }
    if (seen.has(path)) {
      throw new Error(`Claude payload contains duplicate icon path: ${path}`);
    }
    seen.add(path);

    if (typeof icon.svg !== "string" || !icon.svg.trim().startsWith("<svg")) {
      throw new Error(`Claude payload for ${path} must include an SVG string.`);
    }
    validateSvgString(path, icon.svg);
  }

  const missing = [...expected].filter((path) => !seen.has(path));
  if (missing.length > 0) {
    throw new Error(`Claude payload is missing icon(s): ${missing.join(", ")}`);
  }
}

function validateSvgString(path, svg) {
  const content = svg.trim();
  const byteLength = Buffer.byteLength(content, "utf8");

  if (byteLength > MAX_SVG_BYTES) {
    throw new Error(`${path} SVG is ${byteLength} bytes; keep generated icons under ${MAX_SVG_BYTES} bytes.`);
  }
  if (!content.includes('viewBox="0 0 96 96"')) {
    throw new Error(`${path} SVG must have viewBox="0 0 96 96".`);
  }
  if (!content.includes("xmlns=")) {
    throw new Error(`${path} SVG must have an xmlns attribute.`);
  }
  if (content.includes("<style") || content.includes("<script")) {
    throw new Error(`${path} SVG must not contain <style> or <script> elements.`);
  }
  if (content.includes("<text")) {
    throw new Error(`${path} SVG must not contain <text>; use paths/shapes for reliable rendering.`);
  }
  if (/<rect[^>]+(?:width="96"[^>]+height="96"|height="96"[^>]+width="96")/i.test(content)) {
    throw new Error(`${path} SVG must use a transparent canvas without a full-size background rect.`);
  }
}

function updateGeneratedReportIcons(report, targetPlan) {
  for (const target of targetPlan.targets) {
    for (const entry of collectTabIconEntries(report)) {
      if (entry.storyId !== target.storyId) continue;
      if (!target.tabs.some((tab) => tab.id === entry.tab.id)) continue;
      entry.tab.icon = target.path;
    }
  }
}

function mirrorRawStoryIcons(rawReport, targetPlan) {
  if (!rawReport || typeof rawReport !== "object") return false;
  let changed = false;
  const targetsByStory = new Map();

  for (const target of targetPlan.targets) {
    if (!targetsByStory.has(target.storyId)) targetsByStory.set(target.storyId, new Map());
    const tabs = targetsByStory.get(target.storyId);
    for (const tab of target.tabs) tabs.set(tab.id, target.path);
  }

  for (const story of rawReport.stories ?? []) {
    const tabs = targetsByStory.get(story.id);
    if (!tabs || !Array.isArray(story.tabs)) continue;

    for (const tab of story.tabs) {
      const iconPath = tabs.get(tab.id);
      if (!iconPath || tab.icon === iconPath) continue;
      tab.icon = iconPath;
      changed = true;
    }
  }

  return changed;
}

function collectReferencedIconPaths(reports) {
  const icons = new Set();

  for (const report of reports.filter(Boolean)) {
    for (const entry of collectTabIconEntries(report)) {
      if (typeof entry.tab.icon === "string") icons.add(entry.tab.icon);
    }
  }

  return icons;
}

async function pruneIconOrphans({dataDir, reports}) {
  const iconsDir = resolve(dataDir, "icons");
  const referencedIcons = collectReferencedIconPaths(reports);
  const deleted = [];

  if (!existsSync(iconsDir)) return deleted;

  for (const entry of await readdir(iconsDir, {withFileTypes: true})) {
    if (!entry.isFile() || entry.name.startsWith(".")) continue;
    if (!PRUNABLE_ICON_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;

    const ref = `icons/${entry.name}`;
    if (referencedIcons.has(ref)) continue;

    try {
      await unlink(resolve(iconsDir, entry.name));
      deleted.push(ref);
    } catch {
      // Best effort: a locked orphan should not fail icon generation.
    }
  }

  return deleted.sort();
}

async function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, "utf8"));
}

export async function applyGenerateSvgPayload({
  payload,
  report,
  targetPlan,
  dataDir = defaultDataDir,
  generatedDataPath,
  rawDataPath = defaultRawDataPath,
}) {
  validatePayloadIcons(payload, targetPlan.targetPaths, {dataDir});

  for (const icon of payload.icons) {
    const svg = `${icon.svg.trim()}\n`;
    const absolute = resolve(dataDir, icon.path);
    await mkdir(dirname(absolute), {recursive: true});
    await writeFile(absolute, svg, "utf8");
  }

  updateGeneratedReportIcons(report, targetPlan);
  await writeFile(generatedDataPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const rawReport = await readJsonIfExists(rawDataPath);
  const rawUpdated = mirrorRawStoryIcons(rawReport, targetPlan);
  if (rawUpdated) {
    await writeFile(rawDataPath, `${JSON.stringify(rawReport, null, 2)}\n`, "utf8");
  }
  const prunedIcons = await pruneIconOrphans({dataDir, reports: [report, rawReport]});

  const validation = validateReportIcons(report, {dataDir, includeOrphanWarnings: false});
  if (validation.errors.length > 0) {
    throw new Error(`Generated SVG payload failed icon validation:\n${validation.errors.join("\n")}`);
  }

  return {
    generated: payload.icons.length,
    prunedIcons,
    rawUpdated,
    validation,
  };
}
