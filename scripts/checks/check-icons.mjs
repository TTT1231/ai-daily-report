import {validateReportIcons} from "../lib/icon-validation.mjs";
import {dataDir, generatedDataPath, readJson} from "../lib/paths.mjs";

let report;
try {
  report = await readJson(generatedDataPath, "data-scheme/data-generate.json");
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const {errors, warnings, totalTabs} = validateReportIcons(report, {dataDir});

// ── Report ──────────────────────────────────────────────────────────────────

if (errors.length > 0) {
  console.error(`Icon validation failed with ${errors.length} error(s):`);
  errors.forEach((error) => console.error(`  ✗ ${error}`));
}

if (warnings.length > 0) {
  console.warn(`Icon validation has ${warnings.length} warning(s):`);
  warnings.forEach((warning) => console.warn(`  ⚠ ${warning}`));
}

if (errors.length > 0) {
  process.exit(1);
}

if (totalTabs === 0) {
  console.log("No tabs found — nothing to validate.");
} else {
  console.log(`Icon validation passed: ${totalTabs}/${totalTabs} tabs have icons.`);
}
