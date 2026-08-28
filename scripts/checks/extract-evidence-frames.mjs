import {existsSync, mkdirSync, writeFileSync} from "node:fs";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {generatedDataPath, readJson, rootDir} from "../lib/paths.mjs";
import {buildEvidenceFramePlan} from "../lib/evidence-frame-plan.mjs";

function option(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

const videoPath = resolve(option("video") ?? resolve(rootDir, "out", "AiDailyReport.mp4"));
const requestedOutputDir = option("output-dir");
const outputDir = requestedOutputDir
  ? resolve(requestedOutputDir)
  : mkdtempSync(join(tmpdir(), "ai-daily-evidence-frames-"));
const ffmpeg = option("ffmpeg") ?? "ffmpeg";

if (!existsSync(videoPath)) {
  console.error(`Rendered video does not exist: ${videoPath}`);
  process.exit(1);
}

let report;
try {
  report = await readJson(generatedDataPath, "data-scheme/data-generate.json");
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const plan = buildEvidenceFramePlan(report);
if (plan.errors.length > 0) {
  console.error(`Evidence frame planning failed with ${plan.errors.length} error(s):`);
  plan.errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}
if (plan.frames.length === 0) {
  console.error("Generated report contains no overlay scenes to inspect.");
  process.exit(1);
}

mkdirSync(outputDir, {recursive: true});
for (const frame of plan.frames) {
  const outputPath = join(outputDir, frame.fileName);
  const result = spawnSync(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      (frame.timeMs / 1000).toFixed(3),
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-y",
      outputPath,
    ],
    {encoding: "utf8"},
  );
  if (result.status !== 0) {
    console.error(
      `Failed to extract ${frame.storyId}/${frame.sceneId}: ${result.stderr || result.stdout || `ffmpeg exit ${result.status}`}`,
    );
    process.exit(1);
  }
  frame.outputPath = outputPath;
}

const manifestPath = join(outputDir, "manifest.json");
writeFileSync(
  manifestPath,
  `${JSON.stringify({videoPath, generatedDataPath, frames: plan.frames}, null, 2)}\n`,
  "utf8",
);

console.log(`Extracted ${plan.frames.length} overlay midpoint frame(s) to ${outputDir}`);
console.log(`Manifest: ${manifestPath}`);
