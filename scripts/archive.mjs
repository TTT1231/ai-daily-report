import {mkdirSync, renameSync} from "node:fs";
import {resolve} from "node:path";
import {readJson} from "./lib/paths.mjs";

const root = resolve(import.meta.dirname, "..");
const srcDir = resolve(root, "data-scheme");
const dailyDatesDir = resolve(root, "daily-dates");

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
