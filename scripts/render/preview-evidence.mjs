import {mkdtempSync, mkdirSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {bundle} from "@remotion/bundler";
import {openBrowser, renderStill, selectComposition} from "@remotion/renderer";
import {enableTailwind} from "@remotion/tailwind-v4";
import {dataDir, generatedDataPath, readJson, rootDir} from "../lib/paths.mjs";
import {buildEvidencePreviewPlan} from "../lib/evidence-preview-plan.mjs";

const option = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
let browser;
try {
  const started = Date.now();
  const report = await readJson(generatedDataPath, "Generated report");
  const {fps} = await readJson(join(rootDir, "config/video-timeline.json"), "timeline config");
  const plan = buildEvidencePreviewPlan(report, {fps, sceneIds: option("scenes")?.split(",")});
  if (plan.errors.length) throw new Error(plan.errors.join("\n"));
  const directory = option("output-dir") ? resolve(option("output-dir")) : mkdtempSync(join(tmpdir(), "evidence-preview-"));
  mkdirSync(directory, {recursive: true});
  // Bundle once and reuse one browser for the entire batch. No MP4 encoding,
  // audio synthesis or per-frame CLI/browser startup.
  const serveUrl = await bundle({entryPoint: join(rootDir, "src/index.ts"), publicDir: dataDir,
    outDir: join(directory, "bundle"), webpackOverride: enableTailwind});
  browser = await openBrowser("chrome");
  const composition = await selectComposition({serveUrl, id: "AiDailyReport", inputProps: report, puppeteerInstance: browser});
  for (const target of plan.frames) {
    target.outputPath = join(directory, target.fileName);
    await renderStill({serveUrl, composition, inputProps: report, puppeteerInstance: browser,
      frame: target.frame, output: target.outputPath, imageFormat: "png", logLevel: "error"});
    console.log(`Preview: ${target.storyId}/${target.sceneId} (${target.frame})`);
  }
  writeFileSync(join(directory, "manifest.json"), `${JSON.stringify({schemaVersion: 1, elapsedMs: Date.now() - started,
    note: "Layout preview only; does not approve evidence or replace final MP4 review.", frames: plan.frames}, null, 2)}\n`);
  console.log(`Rendered ${plan.frames.length} representative PNGs in ${Date.now() - started}ms. ${directory}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close({silent: true});
}
