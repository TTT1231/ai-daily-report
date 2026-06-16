import {existsSync, readFileSync} from "node:fs";
import {resolve, sep} from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import {dataDir, schemaPath} from "./paths.mjs";
import {
  navigationCapacity,
  reportNavigationLabels,
} from "./navigation-layout.mjs";

const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const validateSchema = new Ajv2020({allErrors: true}).compile(schema);

const isText = (value) => typeof value === "string" && value.trim().length > 0;

function schemaErrors(report) {
  if (validateSchema(report)) return [];
  return validateSchema.errors.map((error) => {
    const path = error.instancePath.replaceAll("/", ".").replace(/^\./, "") || "$";
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

export function validateReport(report, {renderMode = false, checkAssets = true} = {}) {
  const structureErrors = schemaErrors(report);
  const errors = [...structureErrors];
  const fail = (path, message) => errors.push(`${path}: ${message}`);

  if (report.$schema !== "../data.schema.json") {
    fail("$schema", 'must equal "../data.schema.json"');
  }
  if (structureErrors.length > 0) return {errors, totalDurationMs: 0};
  if (renderMode && !report.intro) fail("intro", "is required before rendering");
  if (renderMode && !report.outro) fail("outro", "is required before rendering");
  if (!renderMode && (report.intro !== undefined || report.outro !== undefined)) {
    fail("intro/outro", "are generated automatically and must not be added to data.json");
  }

  let expectedStartMs = 0;
  const storyIds = new Set();
  const sceneIds = new Set();
  const topTitles = new Set();
  const closedTopTitleSegments = new Set();
  let previousTopTitle;
  let activeIntroCount = 0;
  const timelineEntries = renderMode
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

  for (const {story, path: storyPath} of timelineEntries) {

    if (storyIds.has(story.id)) fail(`${storyPath}.id`, `duplicate id "${story.id}"`);
    storyIds.add(story.id);
    if (!renderMode && ["intro", "outro"].includes(story.id)) {
      fail(`${storyPath}.id`, `"${story.id}" is reserved and generated automatically`);
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

    const tabIds = new Set();
    for (const [tabIndex, tab] of (story.tabs ?? []).entries()) {
      const tabPath = `${storyPath}.tabs[${tabIndex}]`;
      if (tabIds.has(tab.id)) fail(`${tabPath}.id`, `duplicate id "${tab.id}"`);
      tabIds.add(tab.id);
      if (checkAssets && tab.icon) validateAsset(tab.icon, `${tabPath}.icon`, errors);
    }
    if (story.activeTab !== undefined && !tabIds.has(story.activeTab)) {
      fail(`${storyPath}.activeTab`, `unknown tab id "${story.activeTab}"`);
    }

    for (const [sceneIndex, scene] of (story.scenes ?? []).entries()) {
      const scenePath = `${storyPath}.scenes[${sceneIndex}]`;
      if (sceneIds.has(scene.id)) {
        fail(`${scenePath}.id`, `duplicate global scene id "${scene.id}"`);
      }
      sceneIds.add(scene.id);

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
      if (checkAssets && scene.audioSrc) {
        validateAsset(scene.audioSrc, `${scenePath}.audioSrc`, errors);
      }
    }
  }

  if (activeIntroCount > 1) {
    fail("stories", "only one story may set activeIntro to true");
  }
  if (topTitles.size > 5) {
    fail("stories", `must use at most 5 unique topTitle categories, received ${topTitles.size}`);
  }
  const navigationLabels = reportNavigationLabels(report);
  const navigationStats = {};
  for (const [name, labels] of Object.entries(navigationLabels)) {
    const {availableWidth, requiredWidth} = navigationCapacity(labels);
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

  return {errors, navigationStats, totalDurationMs: expectedStartMs};
}
