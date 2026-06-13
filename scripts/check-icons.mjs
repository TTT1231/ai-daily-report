import {existsSync, readdirSync, readFileSync} from "node:fs";
import {resolve, sep} from "node:path";
import {dataDir, generatedDataPath, readJson} from "./lib/paths.mjs";

const iconsDir = resolve(dataDir, "icons");
const errors = [];
const warnings = [];

const fail = (path, message) => errors.push(`${path}: ${message}`);
const warn = (path, message) => warnings.push(`${path}: ${message}`);

const ICON_PATTERN = /^icons\/.+\.svg$/;
const MAX_SVG_BYTES = 2048;

let report;
try {
  report = await readJson(generatedDataPath, "data-scheme/data-generate.json");
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

// ── Collect all tabs with their JSON paths ──────────────────────────────────

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

// ── Validate icon fields ────────────────────────────────────────────────────

const referencedIcons = new Set();
const svgCache = new Map();

for (const {tab, jsonPath} of allTabs) {
  if (tab.icon === undefined) {
    warn(jsonPath, `missing "icon" field — icon not generated yet`);
    continue;
  }

  if (typeof tab.icon !== "string" || !ICON_PATTERN.test(tab.icon)) {
    fail(jsonPath, `icon must match pattern "icons/<name>.svg", got "${tab.icon}"`);
    continue;
  }

  // Check path traversal
  const absolute = resolve(dataDir, tab.icon);
  if (!absolute.startsWith(dataDir + sep)) {
    fail(jsonPath, "icon path must stay inside data-scheme/");
    continue;
  }

  referencedIcons.add(tab.icon);

  // Check file existence
  if (!existsSync(absolute)) {
    fail(jsonPath, `icon file not found: ${tab.icon}`);
    continue;
  }

  // Read and validate SVG (once per unique file)
  if (svgCache.has(tab.icon)) continue;

  try {
    const content = readFileSync(absolute, "utf8");
    svgCache.set(tab.icon, content);

    const byteLength = Buffer.byteLength(content, "utf8");
    if (byteLength > MAX_SVG_BYTES) {
      warn(tab.icon, `icon file is ${byteLength} bytes (recommended < ${MAX_SVG_BYTES} bytes)`);
    }

    if (!content.includes('viewBox="0 0 96 96"')) {
      fail(tab.icon, 'SVG must have viewBox="0 0 96 96"');
    }

    if (!content.includes("xmlns=")) {
      fail(tab.icon, 'SVG must have xmlns attribute');
    }

    if (content.includes("<style") || content.includes("<script")) {
      fail(tab.icon, "SVG must not contain <style> or <script> elements");
    }

    if (content.includes("<text")) {
      warn(tab.icon, "SVG contains <text> element — consider using <path> instead for consistent rendering");
    }

    if (/<rect[^>]+(?:width="96"[^>]+height="96"|height="96"[^>]+width="96")/i.test(content)) {
      fail(tab.icon, "SVG must use a transparent canvas without a full-size background rect");
    }
  } catch (error) {
    fail(tab.icon, `failed to read SVG: ${error.message}`);
  }
}

// ── Check for orphan icon files ─────────────────────────────────────────────

if (existsSync(iconsDir)) {
  const svgFiles = readdirSync(iconsDir)
    .filter((file) => file.endsWith(".svg"))
    .map((file) => `icons/${file}`);

  const orphans = svgFiles.filter((file) => !referencedIcons.has(file));
  if (orphans.length > 0) {
    warn("icons/", `orphan files not referenced by any tab: ${orphans.join(", ")}`);
  }
}

// ── Report ──────────────────────────────────────────────────────────────────

if (errors.length > 0) {
  console.error(`Icon validation failed with ${errors.length} error(s):`);
  errors.forEach((error) => console.error(`  ✗ ${error}`));
}

if (warnings.length > 0) {
  console.warn(`Icon validation has ${warnings.length} warning(s):`);
  warnings.forEach((warning) => console.warn(`  ⚠ ${warning}`));
}

if (errors.length > 0) {
  process.exit(1);
}

const iconCount = allTabs.filter((t) => t.tab.icon !== undefined).length;
const totalTabs = allTabs.length;

if (totalTabs === 0) {
  console.log("No tabs found — nothing to validate.");
} else if (iconCount === totalTabs) {
  console.log(`Icon validation passed: ${iconCount}/${totalTabs} tabs have icons.`);
} else {
  console.log(`Icon validation passed with warnings: ${iconCount}/${totalTabs} tabs have icons (${totalTabs - iconCount} missing).`);
}
