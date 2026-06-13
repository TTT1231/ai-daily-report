import {generatedDataPath, rawDataPath, readJson} from "./lib/paths.mjs";
import {validateReport} from "./lib/report-validation.mjs";

const renderMode = process.argv.includes("--render");
const displayPath = renderMode
  ? "data-scheme/data-generate.json"
  : "data-scheme/data.json";

let report;
try {
  report = await readJson(renderMode ? generatedDataPath : rawDataPath, displayPath);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const {errors, totalDurationMs} = validateReport(report, {renderMode});
if (errors.length > 0) {
  console.error(`${displayPath} validation failed with ${errors.length} error(s):`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log(
  renderMode
    ? `${displayPath} is render-ready: generated intro + ${report.stories.length} stories + fixed outro, ${totalDurationMs}ms total.`
    : `${displayPath} raw content is valid: ${report.stories.length} stories.`,
);
