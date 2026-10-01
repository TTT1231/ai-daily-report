import {
  dataDir,
  generatedDataPath,
  rawDataPath,
  readJson,
} from "../lib/paths.mjs";
import { validateReport } from "../lib/report-validation.mjs";
import { validateTone } from "../lib/tone-validation.mjs";
import { validateReportEvidence } from "../lib/evidence-validation.mjs";
import { validateVideoLayout } from "../lib/video-layout-validation.mjs";
import { validateVideoTimeline } from "../lib/video-timeline-validation.mjs";

const renderMode = process.argv.includes("--render");
const strictTone = process.argv.includes("--strict-tone");
const checkEvidence = process.argv.includes("--evidence");
const displayPath = renderMode
  ? "data-scheme/data-generate.json"
  : "data-scheme/data.json";

const layoutValidation = validateVideoLayout();
if (layoutValidation.errors.length > 0) {
  console.error(
    `video-layout.json validation failed with ${layoutValidation.errors.length} error(s):`,
  );
  layoutValidation.errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

const timelineValidation = validateVideoTimeline();
if (timelineValidation.errors.length > 0) {
  console.error(
    `video-timeline.json validation failed with ${timelineValidation.errors.length} error(s):`,
  );
  timelineValidation.errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

let report;
try {
  report = await readJson(
    renderMode ? generatedDataPath : rawDataPath,
    displayPath,
  );
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const { errors, navigationStats, totalDurationMs } = validateReport(report, {
  renderMode,
});
const tone =
  strictTone && !renderMode
    ? validateTone(report)
    : { errors: [], warnings: [] };
const evidence = checkEvidence
  ? validateReportEvidence(report, { dataDir })
  : { errors: [], warnings: [] };

// strict-tone 只针对 Raw：Generated 文案由 Raw 派生，重复检查只制造噪声。
// 作用域仿照 check-evidence --require-overlay：不带 flag 的原生/手动流程完全不受影响。
if (strictTone) {
  if (renderMode) {
    console.error(
      "strict-tone applies to data.json only; skipped in --render mode (generated content derives from Raw).",
    );
  } else {
    for (const warning of tone.warnings) {
      console.error(`- warning: ${warning}`);
    }
    if (tone.warnings.length > 0) {
      console.error(
        `strict-tone: ${tone.warnings.length} warning(s), non-blocking.`,
      );
    }
  }
}

for (const warning of evidence.warnings) console.error(`- warning: ${warning}`);
const groups = [
  { label: displayPath, errors },
  { label: "strict-tone", errors: tone.errors },
  { label: "Evidence", errors: evidence.errors },
];
const errorCount = groups.reduce(
  (count, group) => count + group.errors.length,
  0,
);
if (errorCount > 0) {
  console.error(`${displayPath} checks failed with ${errorCount} error(s):`);
  for (const group of groups) {
    if (group.errors.length === 0) continue;
    console.error(
      `${group.label} validation failed with ${group.errors.length} error(s):`,
    );
    group.errors.forEach((error) => console.error(`- ${error}`));
  }
  console.error(
    renderMode
      ? `\n👉 data-generate.json 是生成的、不要手改；请先修 data-scheme/data.json，再 \`bun run tts\` 重新生成。`
      : `\n👉 请按上方错误修改 data-scheme/data.json 后重试。`,
  );
  if (tone.errors.length > 0)
    console.error(
      `👉 直接播报来源事实：不描述「截图/图片/画面/配图」媒介，不用匿名归因，不补评价、建议或免责。`,
    );
  process.exit(1);
}

console.log(
  renderMode
    ? `${displayPath} is render-ready: generated intro + ${report.stories.length} stories${report.outro ? " + outro" : ""}, ${totalDurationMs}ms total.`
    : `${displayPath} raw content is valid: ${report.stories.length} stories.`,
);
if (checkEvidence)
  console.log(
    `Evidence validation passed: ${evidence.overlayCount} overlay image(s) across ${evidence.checkedStories}/${evidence.storyCount} stories are valid.`,
  );
if (navigationStats) {
  console.log(
    `Navigation capacity: top ${navigationStats.top.requiredWidth}/${navigationStats.top.availableWidth}px (${navigationStats.top.itemCount} items), bottom ${navigationStats.bottom.requiredWidth}/${navigationStats.bottom.availableWidth}px (${navigationStats.bottom.itemCount} items).`,
  );
  if (navigationStats.top.density === "dense") {
    console.error(
      `- warning: top navigation is dense at ${(navigationStats.top.fillRatio * 100).toFixed(1)}% ` +
        `(comfort target ${(navigationStats.top.comfortFillRatio * 100).toFixed(0)}%). ` +
        `Prefer shorter topTitle labels; merge only adjacent, genuinely related categories.`,
    );
  }
}
