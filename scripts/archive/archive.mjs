import {mkdirSync, renameSync} from "node:fs";
import {resolve} from "node:path";
import {readJson} from "../lib/paths.mjs";
import {pruneUnreferencedAssets} from "../lib/prune-assets.mjs";

const root = resolve(import.meta.dirname, "../..");
const srcDir = resolve(root, "data-scheme");
const dailyDatesDir = resolve(root, "daily-dates");

const dryRun = process.argv.slice(2).includes("--dry-run");

// 打印清理摘要：只输出「实际有删除」的目录；无删除则整体静默（含 dry-run），不刷屏。
// skipped 是安全栅栏跳过清理的原因（如缺 data-generate.json 时不清 audio），罕见，单独提示。
function logPruneSummary(summary) {
  const lines = [];
  for (const cat of ["images", "icons", "audio"]) {
    const result = summary[cat];
    if (result && result.deleted.length > 0) {
      lines.push(
        `  ${cat}/: 删除 ${result.deleted.length} 个（${result.deleted.join(", ")}），保留 ${result.kept} 个`,
      );
    }
  }
  for (const reason of summary.skipped) lines.push(`  · ${reason}`);
  if (lines.length === 0) return; // 无删除且无跳过：静默
  console.log(
    summary.dryRun ? "🧹 清理未引用资源（dry-run 预览，未实际删除）…" : "🧹 清理未引用资源…",
  );
  for (const line of lines) console.log(line);
}

const dataPath = resolve(srcDir, "data.json");
let date;
try {
  const report = await readJson(dataPath, "data-scheme/data.json");
  if (typeof report.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(report.date)) {
    throw new Error('data-scheme/data.json "date" must use YYYY-MM-DD format.');
  }
  date = report.date;
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

// 归档前清理未引用的 images / icons / audio，让归档副本干净、自洽。
// 清理是锦上添花：失败只告警，绝不阻断归档（归档本身是数据保全）。
try {
  const summary = await pruneUnreferencedAssets({dataDir: srcDir, dryRun});
  logPruneSummary(summary);
} catch (e) {
  console.warn(`⚠️ 资源清理失败，继续归档：${e.message}`);
}

// dry-run：只预览清理结果，不执行归档改名。
if (dryRun) {
  process.exit(0);
}

// 2. Atomic protection: rename → recreate source
const archiveName = `data-scheme-${date}`;
const dst = resolve(dailyDatesDir, archiveName);

try {
  renameSync(srcDir, dst);
} catch (e) {
  if (e.code === "ENOENT") {
    try {
      mkdirSync(dailyDatesDir, {recursive: true});
      renameSync(srcDir, dst);
    } catch (retryError) {
      console.error(
        `Failed to archive ${srcDir} → ${dst}:`,
        retryError.message,
      );
      process.exit(1);
    }
  } else {
    console.error(`Failed to archive ${srcDir} → ${dst}:`, e.message);
    process.exit(1);
  }
}

try {
  mkdirSync(srcDir);
} catch (e) {
  console.error(`Archive moved but failed to recreate ${srcDir}:`, e.message);
  console.error(`Data is preserved at ${dst}`);
  process.exit(1);
}

console.log(`Archived → daily-dates/${archiveName}`);
