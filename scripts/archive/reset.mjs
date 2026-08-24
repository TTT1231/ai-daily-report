import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { dataDir, rootDir } from "../lib/paths.mjs";

const rssStatePath = resolve(rootDir, "ingest", "rss-state.json");
const rssStateTempPath = `${rssStatePath}.tmp`;
const picksPath = resolve(rootDir, "ingest", "picks.json");
const yes = process.argv.includes("--yes") || process.argv.includes("-y");

function clearDirectory(path) {
  mkdirSync(path, { recursive: true });
  const failed = [];
  for (const entry of readdirSync(path)) {
    try {
      rmSync(resolve(path, entry), { recursive: true, force: true });
    } catch (e) {
      failed.push(`${entry}（${e.message}）`);
    }
  }
  return failed;
}

function removeFile(path) {
  if (!existsSync(path)) return false;
  rmSync(path, { force: true });
  return true;
}

async function confirmReset() {
  if (yes) return true;
  if (!process.stdin.isTTY) {
    console.error(
      "❌ reset 需要交互确认。自动化环境请显式使用：bun run reset -- --yes",
    );
    process.exit(1);
  }

  console.log("⚠️  reset 会清空以下内容：");
  console.log("   - data-scheme/");
  console.log("   - ingest/rss-state.json");
  console.log("   - ingest/picks.json");
  console.log("");
  console.log(
    "这会丢弃当前日报数据、RSS 快照与人工 pick；下一次 bun run video:auto-generate 会重新抓取并生成。",
  );

  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await readline.question("确认继续？请输入 yes：");
    return answer.trim().toLowerCase() === "yes";
  } finally {
    readline.close();
  }
}

if (!(await confirmReset())) {
  console.log("已取消 reset，未修改任何文件。");
  process.exit(0);
}

const clearFailed = clearDirectory(dataDir);
if (clearFailed.length > 0) {
  console.error("❌ 清空 data-scheme/ 失败，请先关闭 Remotion Studio / 占用文件的程序再 reset：");
  for (const item of clearFailed) console.error(`  · ${item}`);
  process.exit(1);
}
const removedState = removeFile(rssStatePath);
const removedTempState = removeFile(rssStateTempPath);
const removedPicks = removeFile(picksPath);

console.log("✅ reset 完成");
console.log("   已清空：data-scheme/");
console.log(
  removedState
    ? "   已删除：ingest/rss-state.json"
    : "   跳过：ingest/rss-state.json 不存在",
);
if (removedTempState) {
  console.log("   已删除：ingest/rss-state.json.tmp");
}
console.log(
  removedPicks
    ? "   已删除：ingest/picks.json"
    : "   跳过：ingest/picks.json 不存在",
);
console.log("   下一步：运行 bun run video:auto-generate 重新生成日报。");
