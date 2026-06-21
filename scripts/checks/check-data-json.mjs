import {generatedDataPath, rawDataPath, readJson} from "../lib/paths.mjs";
import {validateReport} from "../lib/report-validation.mjs";
import {validateVideoLayout} from "../lib/video-layout-validation.mjs";
import {validateVideoTimeline} from "../lib/video-timeline-validation.mjs";

const renderMode = process.argv.includes("--render");
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
  report = await readJson(renderMode ? generatedDataPath : rawDataPath, displayPath);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const {errors, navigationStats, totalDurationMs} = validateReport(report, {renderMode});
if (errors.length > 0) {
  console.error(`${displayPath} validation failed with ${errors.length} error(s):`);
  errors.forEach((error) => console.error(`- ${error}`));
  console.error(
    renderMode
      ? `\n👉 data-generate.json 是生成的、不要手改；请先修 data-scheme/data.json，再 \`bun run tts\` 重新生成。`
      : `\n👉 请按上方错误修改 data-scheme/data.json 后重试。`,
  );
  process.exit(1);
}

console.log(
  renderMode
    ? `${displayPath} is render-ready: generated intro + ${report.stories.length} stories + fixed outro, ${totalDurationMs}ms total.`
    : `${displayPath} raw content is valid: ${report.stories.length} stories.`,
);
if (navigationStats) {
  console.log(
    `Navigation capacity: top ${navigationStats.top.requiredWidth}/${navigationStats.top.availableWidth}px (${navigationStats.top.itemCount} items), bottom ${navigationStats.bottom.requiredWidth}/${navigationStats.bottom.availableWidth}px (${navigationStats.bottom.itemCount} items).`,
  );
}
