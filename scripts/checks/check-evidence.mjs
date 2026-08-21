import {validateReportEvidence} from "../lib/evidence-validation.mjs";
import {dataDir, rawDataPath, readJson} from "../lib/paths.mjs";

// 证据 overlay 质量闸。默认只对已引用的 overlay 做文件级校验（无 overlay 告警），
// 自动/原生 RSS 流程可直接使用；supplied-source/编排路径传 --require-overlay，
// 要求每个 story 至少一张来源证据图。

const requireOverlay = process.argv.includes("--require-overlay");

let report;
try {
  report = await readJson(rawDataPath, "data-scheme/data.json");
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const {errors, warnings, storyCount, checkedStories, overlayCount} =
  validateReportEvidence(report, {dataDir, requireOverlay});

// ── Report ──────────────────────────────────────────────────────────────────

if (errors.length > 0) {
  console.error(`Evidence validation failed with ${errors.length} error(s):`);
  errors.forEach((error) => console.error(`  ✗ ${error}`));
}

if (warnings.length > 0) {
  console.warn(`Evidence validation has ${warnings.length} warning(s):`);
  warnings.forEach((warning) => console.warn(`  ⚠ ${warning}`));
}

if (errors.length > 0) {
  process.exit(1);
}

console.log(
  `Evidence validation passed: ${overlayCount} overlay image(s) across ${checkedStories}/${storyCount} stories are valid${
    warnings.length > 0 ? `; ${warnings.length} story(ies) without overlay` : ""
  }.`,
);
