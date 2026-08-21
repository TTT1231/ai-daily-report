import {existsSync, statSync} from "node:fs";
import {resolve, sep} from "node:path";
import {readImageDimensions} from "./image-dims.mjs";

// 证据 overlay 的最小质量闸（可自动判断的部分）：覆盖、存在性、格式与可读尺寸。
// 复用 image-dims.mjs 的魔数/尺寸解析——文件不是可识别的 PNG/JPEG/WebP/GIF/AVIF/SVG
// 时 readImageDimensions 返回 null，正好拦住「把 HTML/Cloudflare challenge 页存成
// .png」这类错位文件。图片内容是否真的支撑该 scene（广告页、泛化首页等）仍需
// agent 逐张目视复核，本闸不替代人工确认。
//
// requireOverlay=false（默认）：story 无任何 overlay 只告警——自动/原生 RSS 流程
// 允许视觉失败后保留纯文字 Story；结构规则（末段无图、口播长度）也不检查，
// 因为原生 scene 是整条新闻口播，不适用证据段/讲解段的拆分结构。
//
// requireOverlay=true（supplied-source/编排路径）：除覆盖硬性化外，同时强制
// rules/supplied-source-mode.md 的 Story 结构——最后一段必须无图（Tabs 阅读段），
// 证据段（带图）与讲解段（无图）口播不得超过各自上限，防止 overlay 长时间遮挡
// Tabs、单个 story 口播过长。阈值与规则文档保持一致。

const minOverlayBytes = 1024;
const minOverlayWidth = 120;
const minOverlayHeight = 120;
// 与 .agents/skills/ai-daily-report/rules/supplied-source-mode.md 的长度标准对应：
// 证据段 25-40 字（图内可见事实），讲解段 20-35 字（一句影响/衔接）；上限留少量余量。
const maxEvidenceSubtitleUnits = 45;
const maxNarrationSubtitleUnits = 40;
const shortSingleSceneUnits = 30;

// 可见口播长度按"视觉单位"计：CJK 全角算 1，其它（ASCII/数字/空格）算 0.5，
// 与导航宽度的记法一致——纯中文句与规则文档里的"字数"对齐，混排英文不至于虚高。
function countSubtitleUnits(subtitle) {
  let units = 0;
  for (const char of subtitle) {
    units += /[\u2e80-\ua4cf\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/.test(char)
      ? 1
      : 0.5;
  }
  return units;
}

// validateStoryStructure 强制 supplied-source 的「证据段 → 讲解段」结构。
function validateStoryStructure(story, errors) {
  const scenes = Array.isArray(story?.scenes) ? story.scenes : [];
  if (scenes.length === 0) return;
  const storyId = story?.id ?? "?";

  const lastScene = scenes[scenes.length - 1];
  if (lastScene?.overlayImg && scenes.length > 1) {
    errors.push(
      `story "${storyId}": last scene "${lastScene.id ?? "?"}" must not carry an overlay image — the final beat belongs to unobstructed Tabs reading (see rules/supplied-source-mode.md)`,
    );
  }
  if (scenes.length === 1 && lastScene?.overlayImg) {
    const units = countSubtitleUnits(lastScene.subtitle ?? "");
    if (units > shortSingleSceneUnits) {
      errors.push(
        `story "${storyId}": single-scene story with an overlay runs ${units} units of narration — split into a short evidence scene plus an overlay-free narration scene instead`,
      );
    }
  }

  scenes.forEach((scene) => {
    if (!scene?.subtitle) return;
    const units = countSubtitleUnits(scene.subtitle);
    const label = `${storyId}/${scene.id ?? "?"}`;
    if (scene.overlayImg && units > maxEvidenceSubtitleUnits) {
      errors.push(
        `story ${label}: evidence scene narration is ${units} units (max ${maxEvidenceSubtitleUnits}) — keep the overlay scene to what is visible in the image and move the rest to the overlay-free scene`,
      );
    }
    if (!scene.overlayImg && scenes.length > 1 && units > maxNarrationSubtitleUnits) {
      errors.push(
        `story ${label}: narration scene is ${units} units (max ${maxNarrationSubtitleUnits}) — keep it to one key takeaway; details belong on Tabs`,
      );
    }
  });
}

export function validateReportEvidence(report, {dataDir, requireOverlay = false}) {
  const errors = [];
  const warnings = [];
  const stories = Array.isArray(report?.stories) ? report.stories : [];
  let overlayCount = 0;
  let checkedStories = 0;

  for (const story of stories) {
    const scenes = Array.isArray(story?.scenes) ? story.scenes : [];
    const overlayScenes = scenes.filter(
      (scene) => typeof scene?.overlayImg === "string" && scene.overlayImg.length > 0,
    );

    if (overlayScenes.length === 0) {
      const message = `story "${story?.id ?? "?"}" has no evidence overlay on any scene`;
      if (requireOverlay) {
        errors.push(message);
      } else {
        warnings.push(message);
      }
      continue;
    }

    if (requireOverlay) {
      validateStoryStructure(story, errors);
    }

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
      const size = statSync(absolute).size;
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
    }
  }

  return {errors, warnings, storyCount: stories.length, checkedStories, overlayCount};
}
