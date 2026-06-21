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

function readUint24LE(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function readPngDimensions(buffer) {
  if (
    buffer.length < 24 ||
    buffer.toString("hex", 0, 8) !== "89504e470d0a1a0a"
  ) {
    return null;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function readJpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset + 4 <= buffer.length) {
    while (offset < buffer.length && buffer[offset] === 0xff) offset++;
    if (offset >= buffer.length) return null;
    const marker = buffer[offset++];
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) return null;

    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) {
      return null;
    }

    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame && segmentLength >= 7) {
      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5),
      };
    }

    offset += segmentLength;
  }

  return null;
}

function readWebpDimensions(buffer) {
  if (
    buffer.length < 30 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WEBP"
  ) {
    return null;
  }

  for (let offset = 12; offset + 8 <= buffer.length;) {
    const chunk = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > buffer.length) return null;

    if (chunk === "VP8X" && size >= 10) {
      return {
        width: 1 + readUint24LE(buffer, start + 4),
        height: 1 + readUint24LE(buffer, start + 7),
      };
    }
    if (
      chunk === "VP8 " &&
      size >= 10 &&
      buffer[start + 3] === 0x9d &&
      buffer[start + 4] === 0x01 &&
      buffer[start + 5] === 0x2a
    ) {
      return {
        width: buffer.readUInt16LE(start + 6) & 0x3fff,
        height: buffer.readUInt16LE(start + 8) & 0x3fff,
      };
    }
    if (chunk === "VP8L" && size >= 5 && buffer[start] === 0x2f) {
      return {
        width: 1 + buffer[start + 1] + ((buffer[start + 2] & 0x3f) << 8),
        height:
          1 +
          (buffer[start + 2] >> 6) +
          (buffer[start + 3] << 2) +
          ((buffer[start + 4] & 0x0f) << 10),
      };
    }

    offset = end;
    if (offset % 2 === 1) offset++;
  }

  return null;
}

function numberAttribute(svg, name) {
  const match = svg.match(new RegExp(`\\s${name}=["']([0-9.]+)(?:px)?["']`, "i"));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function readSvgDimensions(buffer) {
  const head = buffer.toString("utf8", 0, Math.min(buffer.length, 4096));
  if (!/<svg[\s>]/i.test(head)) return null;

  const width = numberAttribute(head, "width");
  const height = numberAttribute(head, "height");
  if (width && height) return {width, height};

  const viewBox = head.match(/\sviewBox=["']([0-9.\s-]+)["']/i);
  if (!viewBox) return null;
  const values = viewBox[1].trim().split(/\s+/).map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    return null;
  }
  return values[2] > 0 && values[3] > 0
    ? {width: values[2], height: values[3]}
    : null;
}

function readImageDimensions(assetPath) {
  const absolute = resolve(dataDir, assetPath);
  if (!absolute.startsWith(dataDir + sep) || !existsSync(absolute)) return null;
  const buffer = readFileSync(absolute);
  return (
    readPngDimensions(buffer) ??
    readJpegDimensions(buffer) ??
    readWebpDimensions(buffer) ??
    readSvgDimensions(buffer)
  );
}

function validateOverlayImageDimensions(scene, scenePath, errors) {
  if (!scene.overlayImg) {
    if (scene.overlayImgWidth || scene.overlayImgHeight) {
      errors.push(`${scenePath}.overlayImg: is required when dimensions are set`);
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

  const dimensions = readImageDimensions(scene.overlayImg);
  if (!dimensions) return;
  if (
    scene.overlayImgWidth !== dimensions.width ||
    scene.overlayImgHeight !== dimensions.height
  ) {
    errors.push(
      `${scenePath}.overlayImg: dimensions ${scene.overlayImgWidth}x${scene.overlayImgHeight} do not match file ${dimensions.width}x${dimensions.height}`,
    );
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
      if (checkAssets) {
        validateOverlayImageDimensions(scene, scenePath, errors);
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
