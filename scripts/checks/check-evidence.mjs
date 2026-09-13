import {validateReportEvidence} from "../lib/evidence-validation.mjs";
import {dataDir, rawDataPath, generatedDataPath, readJson} from "../lib/paths.mjs";

// 默认要求正文每段都携带有效证据；--require-overlay 保留为兼容旧命令的别名。
const renderMode = process.argv.includes("--render");

let report;
try {
  report = await readJson(renderMode ? generatedDataPath : rawDataPath, renderMode ? "data-scheme/data-generate.json" : "data-scheme/data.json");
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const {errors, warnings, storyCount, checkedStories, overlayCount} =
  validateReportEvidence(report, {dataDir});

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
    warnings.length > 0 ? `; ${warnings.length} warning(s)` : ""
  }.`,
);
