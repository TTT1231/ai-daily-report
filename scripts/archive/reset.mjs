import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { dataDir, rootDir } from "../lib/paths.mjs";

const rssStatePath = resolve(rootDir, "ingest", "rss-state.json");
const rssStateTempPath = `${rssStatePath}.tmp`;
const yes = process.argv.includes("--yes") || process.argv.includes("-y");

function clearDirectory(path) {
  mkdirSync(path, { recursive: true });
  for (const entry of readdirSync(path)) {
    rmSync(resolve(path, entry), { recursive: true, force: true });
  }
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
  console.log("");
  console.log(
    "这会丢弃当前日报数据和 RSS 去重快照；下一次 bun run video:prepare 会重新抓取并生成。",
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

clearDirectory(dataDir);
const removedState = removeFile(rssStatePath);
const removedTempState = removeFile(rssStateTempPath);

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
console.log("   下一步：运行 bun run video:prepare 重新生成日报。");
