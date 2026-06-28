import {mkdirSync} from "node:fs";
import {resolve} from "node:path";
import {dataDir, generatedDataPath, readJson} from "./paths.mjs";
import {validateReportIcons} from "./icon-validation.mjs";

const generatedDataDisplayPath = "data-scheme/data-generate.json";

export async function getGenerateSvgPreflight({force = false} = {}) {
  mkdirSync(resolve(dataDir, "icons"), {recursive: true});

  if (force) {
    return {
      skip: false,
      reason: "--force requested; requesting Claude SVG payload.",
      errors: [],
      iconTargets: null,
    };
  }

  let report;
  try {
    report = await readJson(generatedDataPath, generatedDataDisplayPath);
  } catch (error) {
    return {
      skip: false,
      reason: `${generatedDataDisplayPath} cannot be preflighted (${error.message}); requesting Claude SVG payload.`,
      errors: [],
      iconTargets: null,
    };
  }

  const result = validateReportIcons(report, {
    dataDir,
    includeOrphanWarnings: false,
  });

  if (result.errors.length === 0) {
    return {
      skip: true,
      reason:
        result.totalTabs === 0
          ? "no tabs found; nothing to generate."
          : `${result.totalTabs}/${result.totalTabs} tabs already have valid SVG icons.`,
      errors: [],
      iconTargets: [],
    };
  }

  return {
    skip: false,
    reason: `${result.errors.length} icon issue(s) found; requesting Claude SVG payload for ${result.iconTargets.length || "the affected"} target icon(s).`,
    errors: result.errors,
    iconTargets: result.iconTargets,
  };
}

export function printGenerateSvgPreflight(preflight, {maxErrors = 5} = {}) {
  console.log(`generate-svg: ${preflight.reason}`);

  if (!preflight.errors?.length) return;

  for (const error of preflight.errors.slice(0, maxErrors)) {
    console.log(`  - ${error}`);
  }

  const remaining = preflight.errors.length - maxErrors;
  if (remaining > 0) {
    console.log(`  ... ${remaining} more issue(s)`);
  }
}
