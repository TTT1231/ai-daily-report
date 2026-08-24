import {cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync} from "node:fs";
import {resolve} from "node:path";
import {dataDir, readJson, rootDir} from "../lib/paths.mjs";
import {pruneUnreferencedAssets} from "../lib/prune-assets.mjs";

const dailyDatesDir = resolve(rootDir, "daily-dates");

const dryRun = process.argv.slice(2).includes("--dry-run");

// Windows 下「重命名含打开文件的目录」会被内核拒（EPERM/EACCES/EBUSY）——
// 任何常驻进程（编辑器文件监视、Remotion Studio、Defender 实时扫描）持有目录内某文件句柄即触发。
// rename 失败时退到 cpSync(recursive) + rmSync(force)：Node 以 FILE_SHARE_WRITE|FILE_SHARE_DELETE
// 打开文件，持句柄仍可复制/解链。cpSync 成功后 rmSync 仍可能因句柄占用失败——副本已完整
// 保存到目标，只告警残留待手动清理，不阻断归档，后续照常重建 dataDir。
function moveDir(src, dst) {
  try {
    renameSync(src, dst);
    return;
  } catch (error) {
    if (!["EACCES", "EBUSY", "EPERM"].includes(error.code)) throw error;
  }
  cpSync(src, dst, {recursive: true});
  try {
    rmSync(src, {recursive: true, force: true});
  } catch (error) {
    console.warn(`⚠️ 数据副本已完整保存到 ${dst}，源目录有残留待手动清理：${error.message}`);
  }
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
    // 删除失败（Windows 句柄占用等）：孤儿文件会随目录一起归档，无害但要让用户知情。
    if (result?.failed?.length > 0) {
      lines.push(
        `  ${cat}/: ⚠️ ${result.failed.length} 个删除失败、将随归档保留（${result.failed.join(", ")}）`,
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

const dataPath = resolve(dataDir, "data.json");
let date;
try {
  const report = await readJson(dataPath, "data-scheme/data.json");
  if (typeof report.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(report.date)) {
    date = report.date;
  }
} catch {
  // data.json 缺失或不可读 → 视为全新工作区，无需归档或清空，放行让 ingest 从零抓。
}

// 全新工作区（无有效 date）：直接放行，不归档不清空。
if (!date) {
  console.log("data-scheme/data.json 无有效 date，视为全新工作区，跳过归档。");
  process.exit(0);
}

// 该 date 已归档过：当前 data-scheme 是上一轮残留，清空它让 ingest 从零生成。
const archivePath = resolve(dailyDatesDir, `data-scheme-${date}`);
if (existsSync(archivePath)) {
  const failed = [];
  if (existsSync(dataDir)) {
    for (const entry of readdirSync(dataDir)) {
      try {
        rmSync(resolve(dataDir, entry), { recursive: true, force: true });
      } catch (e) {
        failed.push(`${entry}（${e.message}）`);
      }
    }
  }
  if (failed.length > 0) {
    console.error("❌ 清空 data-scheme/ 失败，请先关闭 Remotion Studio / 占用文件的程序后重试：");
    for (const item of failed) console.error(`  · ${item}`);
    process.exit(1);
  }
  console.log(`${date} 已归档过，已清空 data-scheme/，ingest 将生成全新数据。`);
  process.exit(0);
}

// 归档前清理未引用的 images / icons / audio，让归档副本干净、自洽。
// 清理是锦上添花：失败只告警，绝不阻断归档（归档本身是数据保全）。
try {
  const summary = await pruneUnreferencedAssets({dataDir, dryRun});
  logPruneSummary(summary);
} catch (e) {
  console.warn(`⚠️ 资源清理失败，继续归档：${e.message}`);
}

// dry-run：只预览清理结果，不执行归档改名。
if (dryRun) {
  process.exit(0);
}

// 2. Atomic protection: move → recreate source
// 安全栅栏：上方已确认该 date 未归档，若这里仍撞同名目标，说明是竞态或外部改名，
// cpSync 会把内容合并进旧目录造成覆盖。直接中止保全数据。
if (existsSync(archivePath)) {
  console.error(`Archive target already exists: ${archivePath}. Aborting to prevent overwrite.`);
  process.exit(1);
}

mkdirSync(dailyDatesDir, {recursive: true});

try {
  moveDir(dataDir, archivePath);
} catch (e) {
  console.error(`Failed to archive ${dataDir} → ${archivePath}:`, e.message);
  process.exit(1);
}

// recursive：正常路径 dataDir 已被整体移走，等价于新建；若 moveDir 走 cp 回退且
// rm 留有残留，目录已存在时 no-op 通过，避免 EEXIST 误报「failed to recreate」。
try {
  mkdirSync(dataDir, {recursive: true});
} catch (e) {
  console.error(`Archive moved but failed to recreate ${dataDir}:`, e.message);
  console.error(`Data is preserved at ${archivePath}`);
  process.exit(1);
}

console.log(`Archived → daily-dates/data-scheme-${date}`);
