import {writeFileSync, renameSync} from "node:fs";
import {resolve} from "node:path";
import {dataDir, rawDataPath, generatedDataPath, readJson} from "../lib/paths.mjs";
import {buildEvidencePreflight, readEvidencePreflight, validateEvidencePreflight} from "../lib/evidence-preflight.mjs";

try {
  const path = resolve(dataDir, "evidence-preflight.json");
  const report = await readJson(process.argv.includes("--render") ? generatedDataPath : rawDataPath, "report");
  const previous = readEvidencePreflight(path);
  const factsArg = process.argv.find((arg) => arg.startsWith("--facts="));
  if (factsArg && !process.argv.includes("--prepare")) throw new Error("--facts is only accepted with --prepare.");
  if (process.argv.includes("--prepare")) {
    const factLedger = factsArg ? await readJson(resolve(factsArg.slice("--facts=".length)), "source facts") : undefined;
    const {errors, review} = buildEvidencePreflight(report, {dataDir, previous, factLedger});
    if (errors.length) throw new Error(errors.join("\n"));
    writeFileSync(`${path}.tmp`, `${JSON.stringify(review, null, 2)}\n`);
    renameSync(`${path}.tmp`, path);
    console.log(`Evidence preflight: ${review.assets.length} distinct assets, ${review.scenes.length} narration mappings, ${review.facts.length} source facts, ${review.editorial.length} editorial reviews.\nReview: ${path}`);
    console.log("Unchanged judgements retained. New/changed evidence is pending; no visual checks are auto-approved.");
  } else {
    if (process.argv.includes("--render")) {
      const raw = await readJson(rawDataPath, "Raw report");
      const options = {dataDir, previous, schemaVersion: previous?.schemaVersion ?? 2};
      const rawPlan = buildEvidencePreflight(raw, options);
      const generatedPlan = buildEvidencePreflight(report, options);
      if (rawPlan.errors.length) throw new Error(rawPlan.errors.join("\n"));
      if (JSON.stringify(rawPlan.review.scenes.map((scene) => scene.key)) !==
          JSON.stringify(generatedPlan.review.scenes.map((scene) => scene.key)) ||
          JSON.stringify(rawPlan.review.editorial?.map((item) => item.key)) !==
          JSON.stringify(generatedPlan.review.editorial?.map((item) => item.key))) {
        throw new Error("Generated evidence differs from Raw; synchronize TTS before rendering.");
      }
    }
    const result = validateEvidencePreflight(report, {dataDir, review: previous});
    if (result.errors.length) throw new Error(result.errors.join("\n"));
    console.log(`Evidence preflight passed: ${result.assets} assets, ${result.scenes} explicit factual-support reviews.`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
