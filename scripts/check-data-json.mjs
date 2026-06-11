import {existsSync, readFileSync} from "node:fs";
import {resolve, sep} from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageDir = resolve(root, "data-scheme");
const renderMode = process.argv.includes("--render");
const dataFile = renderMode ? "data-generate.json" : "data.json";
const dataPath = resolve(packageDir, dataFile);
const schemaPath = resolve(root, "data-schema.json");
const errors = [];

const fail = (path, message) => errors.push(`${path}: ${message}`);
const isText = (value) => typeof value === "string" && value.trim().length > 0;
const isPositive = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;
const isNonNegative = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const validateAsset = (assetPath, jsonPath) => {
  if (!isText(assetPath)) {
    fail(jsonPath, "must be a non-empty relative path");
    return;
  }

  const absolute = resolve(packageDir, assetPath);
  if (!absolute.startsWith(packageDir + sep)) {
    fail(jsonPath, "must stay inside data-scheme/");
    return;
  }
  if (!existsSync(absolute)) fail(jsonPath, `file not found: ${assetPath}`);
};

if (!existsSync(dataPath)) {
  console.error(`data-scheme/${dataFile} does not exist.`);
  process.exit(1);
}

if (!existsSync(schemaPath)) {
  console.error("data-scheme/data-schema.json does not exist.");
  process.exit(1);
}

let report;
try {
  report = JSON.parse(readFileSync(dataPath, "utf8"));
} catch (error) {
  console.error(`data-scheme/${dataFile} is invalid JSON: ${error.message}`);
  process.exit(1);
}

if (report.$schema !== "../data-schema.json") {
  fail("$schema", 'must equal "../data-schema.json"');
}
if (report.theme !== undefined && !["light", "dark"].includes(report.theme)) {
  fail("theme", 'must equal "light" or "dark"');
}
if (!isText(report.date)) fail("date", "is required");
if (!Array.isArray(report.stories) || report.stories.length === 0) {
  fail("stories", "must contain at least one story");
}
if (renderMode && !report.intro) fail("intro", "is required before rendering");
if (renderMode && !report.outro) fail("outro", "is required before rendering");
if (!renderMode && (report.intro !== undefined || report.outro !== undefined)) {
  fail("intro/outro", "are generated automatically and must not be added to data.json");
}

let expectedStartMs = 0;
let timelineIsContinuous = true;
const storyIds = new Set();
const sceneIds = new Set();
let activeIntroCount = 0;

const timelineStories = renderMode
  ? [
      ...(report.intro ? [{story: report.intro, path: "intro"}] : []),
      ...(report.stories ?? []).map((story, index) => ({
        story,
        path: `stories[${index}]`,
      })),
      ...(report.outro ? [{story: report.outro, path: "outro"}] : []),
    ]
  : (report.stories ?? []).map((story, index) => ({
      story,
      path: `stories[${index}]`,
    }));

for (const {story, path: storyPath} of timelineStories) {
  if (!isText(story.id)) fail(`${storyPath}.id`, "is required");
  if (storyIds.has(story.id)) fail(`${storyPath}.id`, `duplicate id "${story.id}"`);
  storyIds.add(story.id);
  if (!renderMode && ["intro", "outro"].includes(story.id)) {
    fail(`${storyPath}.id`, `"${story.id}" is reserved and generated automatically`);
  }
  if (story.activeIntro !== undefined) {
    if (story.activeIntro !== true) fail(`${storyPath}.activeIntro`, "must equal true when present");
    activeIntroCount++;
  }

  for (const field of ["topTitle", "bottomTitle"]) {
    if (!isText(story[field])) fail(`${storyPath}.${field}`, "is required");
  }

  if (story.id === "outro") {
    if (story.contentTitle !== undefined) fail(`${storyPath}.contentTitle`, "must be omitted");
    if (story.tabs !== undefined) fail(`${storyPath}.tabs`, "must be omitted");
    if (story.activeTab !== undefined) fail(`${storyPath}.activeTab`, "must be omitted");
    if (story.activeIntro !== undefined) fail(`${storyPath}.activeIntro`, "must be omitted");
  } else {
    if (!isText(story.contentTitle)) fail(`${storyPath}.contentTitle`, "is required");
    const tooManyTabs = story.id !== "intro" && story.tabs?.length > 6;
    if (!Array.isArray(story.tabs) || story.tabs.length === 0 || tooManyTabs) {
      fail(
        `${storyPath}.tabs`,
        story.id === "intro" ? "must contain at least one tab" : "must contain between 1 and 6 tabs",
      );
    }

    const tabIds = new Set();
    for (const [tabIndex, tab] of (story.tabs ?? []).entries()) {
      const tabPath = `${storyPath}.tabs[${tabIndex}]`;
      if (!isText(tab.id)) fail(`${tabPath}.id`, "is required");
      if (tabIds.has(tab.id)) fail(`${tabPath}.id`, `duplicate id "${tab.id}"`);
      tabIds.add(tab.id);
      if (!isText(tab.title)) fail(`${tabPath}.title`, "is required");
      if (!isText(tab.summary)) fail(`${tabPath}.summary`, "is required");
    }
    if (story.activeTab !== undefined && !tabIds.has(story.activeTab)) {
      fail(`${storyPath}.activeTab`, `unknown tab id "${story.activeTab}"`);
    }
  }

  if (!Array.isArray(story.scenes) || story.scenes.length === 0) {
    fail(`${storyPath}.scenes`, "must contain at least one scene");
  }

  for (const [sceneIndex, scene] of (story.scenes ?? []).entries()) {
    const scenePath = `${storyPath}.scenes[${sceneIndex}]`;
    if (!isText(scene.id)) fail(`${scenePath}.id`, "is required for TTS output mapping");
    if (sceneIds.has(scene.id)) fail(`${scenePath}.id`, `duplicate global scene id "${scene.id}"`);
    sceneIds.add(scene.id);
    if (!isText(scene.subtitle)) fail(`${scenePath}.subtitle`, "is required for human review and TTS");

    if (!scene.timing) {
      timelineIsContinuous = false;
      if (renderMode) fail(`${scenePath}.timing`, "is required before rendering");
    } else if (!isNonNegative(scene.timing.startMs) || !isPositive(scene.timing.durationMs)) {
      timelineIsContinuous = false;
      fail(`${scenePath}.timing`, "must contain non-negative startMs and positive durationMs");
    } else {
      if (timelineIsContinuous && scene.timing.startMs !== expectedStartMs) {
        fail(
          `${scenePath}.timing.startMs`,
          `expected ${expectedStartMs}, received ${scene.timing.startMs}`,
        );
      }
      if (timelineIsContinuous) expectedStartMs += scene.timing.durationMs;
    }

    if (scene.overlay) validateAsset(scene.overlay.src, `${scenePath}.overlay.src`);
    if (scene.audioSrc) validateAsset(scene.audioSrc, `${scenePath}.audioSrc`);
    if (scene.tts) {
      if (scene.tts.provider !== "minimax") {
        fail(`${scenePath}.tts.provider`, 'must equal "minimax"');
      }
      if (typeof scene.tts.hash !== "string" || !/^[a-f0-9]{64}$/.test(scene.tts.hash)) {
        fail(`${scenePath}.tts.hash`, "must be a SHA-256 hex digest");
      }
      if (!isText(scene.tts.model)) fail(`${scenePath}.tts.model`, "is required");
      if (!isText(scene.tts.voiceId)) fail(`${scenePath}.tts.voiceId`, "is required");
      if (!isPositive(scene.tts.audioLengthMs)) {
        fail(`${scenePath}.tts.audioLengthMs`, "must be positive");
      }
      if (!isNonNegative(scene.tts.tailPaddingMs)) {
        fail(`${scenePath}.tts.tailPaddingMs`, "must be non-negative");
      }
      if (!scene.audioSrc) fail(`${scenePath}.audioSrc`, "is required when tts metadata exists");
      if (!scene.timing) {
        fail(`${scenePath}.timing`, "is required when tts metadata exists");
      } else if (
        isPositive(scene.tts.audioLengthMs) &&
        isNonNegative(scene.tts.tailPaddingMs) &&
        scene.timing.durationMs !== scene.tts.audioLengthMs + scene.tts.tailPaddingMs
      ) {
        fail(
          `${scenePath}.timing.durationMs`,
          "must equal tts.audioLengthMs + tts.tailPaddingMs",
        );
      }
    }
  }
}

if (activeIntroCount > 1) {
  fail("stories", "only one story may set activeIntro to true");
}

if (errors.length > 0) {
  console.error(`data-scheme/${dataFile} validation failed with ${errors.length} error(s):`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log(
  renderMode
    ? `data-scheme/data-generate.json is render-ready: generated intro + ${report.stories.length} stories + fixed outro, ${expectedStartMs}ms total.`
    : `data-scheme/data.json raw content is valid: ${report.stories.length} stories.`,
);
