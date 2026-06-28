import {existsSync, readdirSync, readFileSync} from "node:fs";
import {resolve, sep} from "node:path";
import {dataDir as defaultDataDir} from "./paths.mjs";

export const ICON_PATTERN = /^icons\/.+\.svg$/;
export const MAX_SVG_BYTES = 2048;
const SAFE_ICON_SEGMENT = /^[A-Za-z0-9_-]+$/;

export function defaultIconPathForTab(storyId, tabId) {
  if (!SAFE_ICON_SEGMENT.test(storyId ?? "") || !SAFE_ICON_SEGMENT.test(tabId ?? "")) {
    return null;
  }

  if (storyId === "intro" && tabId.startsWith("intro-")) {
    return `icons/${tabId}.svg`;
  }

  return `icons/${storyId}-${tabId}.svg`;
}

export function collectTabIconEntries(report) {
  const allTabs = [];

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
      allTabs.push({
        tab,
        storyId: story.id,
        jsonPath: `${storyPath}.tabs[${tabIndex}]`,
      });
    }
  }

  return allTabs;
}

export function validateReportIcons(
  report,
  {dataDir = defaultDataDir, includeOrphanWarnings = true} = {},
) {
  const iconsDir = resolve(dataDir, "icons");
  const errors = [];
  const issues = [];
  const warnings = [];
  const referencedIcons = new Set();
  const svgCache = new Map();
  const allTabs = collectTabIconEntries(report);

  const fail = (path, message, details = {}) => {
    const display = `${path}: ${message}`;
    errors.push(display);
    issues.push({path, message, display, ...details});
  };
  const warn = (path, message) => warnings.push(`${path}: ${message}`);

  for (const {tab, storyId, jsonPath} of allTabs) {
    const expectedIcon = defaultIconPathForTab(storyId, tab.id);

    if (tab.icon === undefined) {
      fail(jsonPath, `missing "icon" field — icon generation did not finish`, {
        kind: "missing-icon-field",
        storyId,
        tabId: tab.id,
        targetIcon: expectedIcon,
      });
      continue;
    }

    if (typeof tab.icon !== "string" || !ICON_PATTERN.test(tab.icon)) {
      fail(jsonPath, `icon must match pattern "icons/<name>.svg", got "${tab.icon}"`, {
        kind: "invalid-icon-field",
        storyId,
        tabId: tab.id,
        targetIcon: expectedIcon,
      });
      continue;
    }

    const absolute = resolve(dataDir, tab.icon);
    if (!absolute.startsWith(dataDir + sep)) {
      fail(jsonPath, "icon path must stay inside data-scheme/", {
        kind: "icon-path-escape",
        storyId,
        tabId: tab.id,
        targetIcon: expectedIcon,
      });
      continue;
    }

    referencedIcons.add(tab.icon);

    if (!existsSync(absolute)) {
      fail(jsonPath, `icon file not found: ${tab.icon}`, {
        kind: "missing-icon-file",
        storyId,
        tabId: tab.id,
        targetIcon: tab.icon,
      });
      continue;
    }

    if (svgCache.has(tab.icon)) continue;

    try {
      const content = readFileSync(absolute, "utf8");
      svgCache.set(tab.icon, content);

      const byteLength = Buffer.byteLength(content, "utf8");
      if (byteLength > MAX_SVG_BYTES) {
        warn(tab.icon, `icon file is ${byteLength} bytes (recommended < ${MAX_SVG_BYTES} bytes)`);
      }

      if (!content.includes('viewBox="0 0 96 96"')) {
        fail(tab.icon, 'SVG must have viewBox="0 0 96 96"', {
          kind: "invalid-svg",
          storyId,
          tabId: tab.id,
          targetIcon: tab.icon,
        });
      }

      if (!content.includes("xmlns=")) {
        fail(tab.icon, "SVG must have xmlns attribute", {
          kind: "invalid-svg",
          storyId,
          tabId: tab.id,
          targetIcon: tab.icon,
        });
      }

      if (content.includes("<style") || content.includes("<script")) {
        fail(tab.icon, "SVG must not contain <style> or <script> elements", {
          kind: "invalid-svg",
          storyId,
          tabId: tab.id,
          targetIcon: tab.icon,
        });
      }

      if (content.includes("<text")) {
        warn(tab.icon, "SVG contains <text> element — consider using <path> instead for consistent rendering");
      }

      if (/<rect[^>]+(?:width="96"[^>]+height="96"|height="96"[^>]+width="96")/i.test(content)) {
        fail(tab.icon, "SVG must use a transparent canvas without a full-size background rect", {
          kind: "invalid-svg",
          storyId,
          tabId: tab.id,
          targetIcon: tab.icon,
        });
      }
    } catch (error) {
      fail(tab.icon, `failed to read SVG: ${error.message}`, {
        kind: "unreadable-svg",
        storyId,
        tabId: tab.id,
        targetIcon: tab.icon,
      });
    }
  }

  if (includeOrphanWarnings && existsSync(iconsDir)) {
    const svgFiles = readdirSync(iconsDir)
      .filter((file) => file.endsWith(".svg"))
      .map((file) => `icons/${file}`);

    const orphans = svgFiles.filter((file) => !referencedIcons.has(file));
    if (orphans.length > 0) {
      warn("icons/", `orphan files not referenced by any tab: ${orphans.join(", ")}`);
    }
  }

  return {
    errors,
    issues,
    warnings,
    allTabs,
    iconTargets: [...new Set(issues.map((issue) => issue.targetIcon).filter(Boolean))],
    referencedIcons,
    totalTabs: allTabs.length,
  };
}
