import {existsSync, statSync} from "node:fs";
import {resolve, sep} from "node:path";
import {readImageDimensions, readImageOrientation} from "./image-dims.mjs";

// 所有生产路径都要求正文逐段有证据。Intro / Outro 不参与此检查。
// 图像可连续跨多个口播段复用；数量限制针对不同证据，不限制讲解句数。
const minOverlayBytes = 1024;
const minOverlayWidth = 120;
const minOverlayHeight = 120;
const maxEvidenceImages = 5;

export function validateEvidenceCoverage(report) {
  const errors = [];
  for (const story of report?.stories ?? []) {
    const scenes = story.scenes ?? [];
    const images = new Set(scenes.map((scene) => scene.overlayImg).filter(Boolean));
    if (images.size === 0) {
      errors.push(`story "${story.id}": has no evidence overlay — exclude this story from production`);
      continue;
    }
    for (const scene of scenes) {
      if (typeof scene.overlayImg !== "string" || !scene.overlayImg.trim()) {
        errors.push(`story ${story.id}/${scene.id}: every narration scene requires evidence; attach the corresponding source image or remove unsupported content`);
      }
    }
    if (images.size > maxEvidenceImages) {
      errors.push(`story "${story.id}": ${images.size} distinct evidence images exceed the maximum of ${maxEvidenceImages}`);
    }
  }
  return errors;
}

export function validateReportEvidence(report, {dataDir}) {
  const errors = validateEvidenceCoverage(report);
  const warnings = [];
  const stories = Array.isArray(report?.stories) ? report.stories : [];
  let overlayCount = 0;
  let checkedStories = 0;

  for (const story of stories) {
    const scenes = Array.isArray(story?.scenes) ? story.scenes : [];
    const overlayScenes = scenes.filter(
      (scene) => typeof scene?.overlayImg === "string" && scene.overlayImg.length > 0,
    );

    if (overlayScenes.length === 0) continue;

    checkedStories++;
    for (const scene of overlayScenes) {
      overlayCount++;
      const label = `${story.id}/${scene.id ?? "?"} (${scene.overlayImg})`;

      const absolute = resolve(dataDir, scene.overlayImg);
      if (!absolute.startsWith(dataDir + sep)) {
        errors.push(`${label}: path escapes the data-scheme directory`);
        continue;
      }
      if (!existsSync(absolute)) {
        errors.push(`${label}: file does not exist`);
        continue;
      }
      // existsSync→statSync 间隙文件可能被删（TOCTOU），按不存在处理而不是抛堆栈。
      let size;
      try {
        size = statSync(absolute).size;
      } catch {
        errors.push(`${label}: file does not exist`);
        continue;
      }
      if (size < minOverlayBytes) {
        errors.push(
          `${label}: file is only ${size} bytes — placeholder or truncated download`,
        );
        continue;
      }
      const dimensions = readImageDimensions(scene.overlayImg, dataDir);
      if (!dimensions) {
        errors.push(
          `${label}: not a valid PNG/JPEG/WebP/GIF/AVIF/SVG image — an HTML or challenge page saved as an image?`,
        );
        continue;
      }
      if (dimensions.width < minOverlayWidth || dimensions.height < minOverlayHeight) {
        errors.push(
          `${label}: image is ${dimensions.width}x${dimensions.height}px, too small to be readable at 1920x1080`,
        );
      }
      const orientation = readImageOrientation(scene.overlayImg, dataDir);
      if (orientation !== null && orientation !== 1) {
        errors.push(
          `${label}: EXIF orientation is ${orientation} — Chromium renders it rotated while the size gate reads unrotated pixels; auto-orient (bake the rotation in and strip EXIF) before adding it to data-scheme/images/`,
        );
      }
    }
  }

  if (
    stories.length >= 3 &&
    stories.every((story) => {
      const scenes = Array.isArray(story?.scenes) ? story.scenes : [];
      return (
        scenes.length === 1 &&
        typeof scenes[0]?.overlayImg === "string" &&
        scenes[0].overlayImg.length > 0
      );
    })
  ) {
    warnings.push(
      `all ${stories.length} supplied-source stories use exactly one scene with one overlay — this is contract-valid but looks like a fixed template; confirm that every source's full candidate-image set was audited and that distinct, important visual facts were not discarded`,
    );
  }

  return {errors, warnings, storyCount: stories.length, checkedStories, overlayCount};
}
