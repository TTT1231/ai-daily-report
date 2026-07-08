import {cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync} from "node:fs";
import {resolve} from "node:path";
import {readJson} from "../lib/paths.mjs";
import {pruneUnreferencedAssets} from "../lib/prune-assets.mjs";

const root = resolve(import.meta.dirname, "../..");
const srcDir = resolve(root, "data-scheme");
const dailyDatesDir = resolve(root, "daily-dates");

const dryRun = process.argv.slice(2).includes("--dry-run");

// Windows 下「重命名含打开文件的目录」会被内核拒（EPERM/EACCES/EBUSY）——
// 任何常驻进程（编辑器文件监视、Remotion Studio、Defender 实时扫描）持有目录内某文件句柄即触发。
// rename 失败时退到 cpSync(recursive) + rmSync(force)：Node 以 FILE_SHARE_WRITE|FILE_SHARE_DELETE
// 打开文件，持句柄仍可复制/解链。与 scripts/publish/bili/download-bili.mjs 同一兜底形态。
function moveDir(src, dst) {
  try {
    renameSync(src, dst);
  } catch (error) {
    if (!["EACCES", "EBUSY", "EPERM"].includes(error.code)) throw error;
    cpSync(src, dst, {recursive: true});
    rmSync(src, {recursive: true, force: true});
  }
}

// 同日期重复归档时加序号（沿用已有的 data-scheme-{date}-01 约定），保留历史副本不覆盖。
function resolveArchiveName(baseName) {
  if (!existsSync(resolve(dailyDatesDir, baseName))) return baseName;
  const prefix = `${baseName}-`;
  let maxSeq = 0;
  for (const entry of readdirSync(dailyDatesDir)) {
    if (!entry.startsWith(prefix)) continue;
    const seq = Number(entry.slice(prefix.length));
    if (Number.isInteger(seq) && seq > maxSeq) maxSeq = seq;
  }
  return `${baseName}-${String(maxSeq + 1).padStart(2, "0")}`;
}

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

// 2. Atomic protection: move → recreate source
const archiveName = resolveArchiveName(`data-scheme-${date}`);
const dst = resolve(dailyDatesDir, archiveName);

// 安全栅栏：resolveArchiveName 已选不冲突的名，若这里仍撞已有目标，说明状态异常
// （如 junction、并发、外部改名），cpSync 会把内容合并进旧目录造成覆盖。直接中止保全数据。
if (existsSync(dst)) {
  console.error(`Archive target already exists: ${dst}. Aborting to prevent overwrite.`);
  process.exit(1);
}

mkdirSync(dailyDatesDir, {recursive: true});

try {
  moveDir(srcDir, dst);
} catch (e) {
  console.error(`Failed to archive ${srcDir} → ${dst}:`, e.message);
  process.exit(1);
}

try {
  mkdirSync(srcDir);
} catch (e) {
  console.error(`Archive moved but failed to recreate ${srcDir}:`, e.message);
  console.error(`Data is preserved at ${dst}`);
  process.exit(1);
}

console.log(`Archived → daily-dates/${archiveName}`);
