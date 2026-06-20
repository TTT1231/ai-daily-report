// archive-rotate.mjs  →  bun run archive:rotate（抓取 RSS 前的归档轮转）
//
// 它不碰 RSS/ingest 抓取本身。只做两件事：
//   1. 读 data-scheme/data.json 的 date；没有就视为全新工作区，直接放行让 ingest 从零抓。
//   2. 若该 date 已归档过（daily-dates/data-scheme-{date} 存在），说明当前 data-scheme/
//      是上一轮的残留，清空它让 ingest 生成全新数据；否则先调 archive.mjs 归档当前数据。
import {existsSync, readdirSync, rmSync} from "node:fs";
import {resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {dataDir, readJson, rootDir} from "../lib/paths.mjs";

const dailyDatesDir = resolve(rootDir, "daily-dates");
const rawDataPath = resolve(dataDir, "data.json");
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

// 1. Read the current report date. No data.json or no valid date means a fresh
//    workspace — nothing to archive or clear, so let ingest build it from scratch.
let date;
try {
  const report = await readJson(rawDataPath, "data-scheme/data.json");
  if (typeof report.date === "string" && datePattern.test(report.date)) {
    date = report.date;
  }
} catch {
  // data.json missing or unreadable → treat as fresh start.
}

if (!date) {
  console.log("data-scheme/data.json 无有效 date，视为全新工作区，跳过归档检查。");
  process.exit(0);
}

// 2. If daily-dates/data-scheme-{date} already exists, this report was already
//    archived — the current data-scheme is stale leftover, clear it so ingest starts
//    clean. Otherwise the date has not been archived yet, so archive it first
//    (archive.mjs moves data-scheme into daily-dates and recreates an empty one).
const archivePath = resolve(dailyDatesDir, `data-scheme-${date}`);

if (existsSync(archivePath)) {
  for (const entry of readdirSync(dataDir)) {
    rmSync(resolve(dataDir, entry), {recursive: true, force: true});
  }
  console.log(`${date} 已归档过，已清空 data-scheme/，ingest 将生成全新数据。`);
  process.exit(0);
}

console.log(`${date} 尚未归档，先执行 archive...`);
const archiveResult = spawnSync(
  process.execPath,
  [resolve(rootDir, "scripts/archive/archive.mjs")],
  {cwd: rootDir, stdio: "inherit"},
);

if (archiveResult.status !== 0) {
  console.error(
    `❌ archive 失败 (exit ${archiveResult.status ?? "null"})，已终止以保护数据，ingest 未执行。`,
  );
  process.exit(1);
}

console.log("✅ archive 完成，data-scheme/ 已就绪，ingest 将生成全新数据。");
