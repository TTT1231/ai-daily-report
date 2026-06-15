import {existsSync, watch} from "node:fs";
import {spawn} from "node:child_process";
import {extname} from "node:path";
import {clearTimeout, setTimeout} from "node:timers";
import {dataDir, generatedDataPath, rootDir} from "./lib/paths.mjs";
import {terminateProcessTree} from "./lib/process-tree.mjs";

if (process.env.AI_DAILY_REPORT_RUN_ALL === "1") {
  throw new Error(
    "bun run dev cannot start during the bun run all production phase.",
  );
}

const debounceMs = 700;
const bunCommand = process.platform === "win32" ? "bun.exe" : "bun";
const rawDataName = "data.json";
const imageExtensions = new Set([".avif", ".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"]);

let syncProcess = null;
let studioProcess = null;
let syncQueued = false;
let syncTimer = null;
let shuttingDown = false;
let inputWatchers = [];

function runBunScript(name) {
  const child = spawn(bunCommand, ["run", name], {
    cwd: rootDir,
    env: process.env,
    stdio: "inherit",
  });
  child.once("error", (error) => {
    console.error(`无法运行 bun run ${name}: ${error.message}`);
  });
  return child;
}

function startStudio() {
  if (studioProcess || shuttingDown) return;
  console.log("\n🎬 数据已同步，正在启动 Remotion Studio...\n");
  studioProcess = runBunScript("dev:studio");
  studioProcess.once("close", (code, signal) => {
    studioProcess = null;
    if (!shuttingDown) {
      console.log(`Remotion Studio 已退出 (${signal ?? code ?? "unknown"})。`);
      shutdown(code ?? 0);
    }
  });
}

function runSync(reason) {
  if (syncProcess) {
    syncQueued = true;
    return;
  }

  console.log(`\n🔄 ${reason}，正在同步 data-generate.json...`);
  syncProcess = runBunScript("tts");
  syncProcess.once("close", (code) => {
    syncProcess = null;
    if (code === 0) {
      console.log("✅ data-generate.json 已更新；未变化的旁白已从缓存复用。");
      startStudio();
    } else {
      console.error("❌ 自动同步失败。修正 data.json 或环境配置后再次保存即可重试。");
    }

    if (syncQueued && !shuttingDown) {
      syncQueued = false;
      runSync("同步期间检测到新的数据变化");
    }
  });
}

function scheduleSync(reason) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => runSync(reason), debounceMs);
}

function watchInputs() {
  const watchers = [];

  watchers.push(
    watch(dataDir, {recursive: true}, (eventType, filename) => {
      if (eventType !== "change" && eventType !== "rename") return;
      const name = filename?.toString();
      if (!name) return;
      if (name === rawDataName) {
        scheduleSync(`${rawDataName} 已变化`);
        return;
      }
      if (imageExtensions.has(extname(name).toLowerCase())) {
        console.log(`🖼 图片素材已变化：${name}；交由 Remotion Studio 刷新，不运行 TTS。`);
      }
    }),
  );

  watchers.push(
    watch(rootDir, (eventType, filename) => {
      if (eventType !== "change" && eventType !== "rename") return;
      const name = filename?.toString();
      if (
        ["data.schema.json", "video-layout.json", "video-layout.schema.json"].includes(
          name,
        )
      ) {
        scheduleSync(`${name} 已变化`);
      } else if (name === ".env") {
        scheduleSync(".env 已变化，TTS 参数将重新加载");
      }
    }),
  );

  return watchers;
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(syncTimer);
  for (const watcher of inputWatchers) watcher.close();
  inputWatchers = [];
  terminateProcessTree(syncProcess);
  terminateProcessTree(studioProcess);
  process.exitCode = exitCode;
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("SIGHUP", () => shutdown(0));
if (process.platform === "win32") {
  process.on("SIGBREAK", () => shutdown(0));
}

if (!existsSync(dataDir)) {
  throw new Error(`Missing data directory: ${dataDir}`);
}

inputWatchers = watchInputs();
console.log(
  "👀 开发监听已启动：data.json、数据与布局 Schema、video-layout.json、.env 和图片素材。",
);
console.log("   数据 / Schema / 布局 / .env 变化会自动运行 TTS；图片变化不会触发 TTS。");
if (existsSync(generatedDataPath)) {
  startStudio();
}
if (process.env.AI_DAILY_REPORT_SKIP_INITIAL_SYNC !== "1") {
  runSync(
    existsSync(generatedDataPath)
      ? "启动时检查并同步原始数据"
      : "尚未生成 data-generate.json，正在执行首次生成",
  );
}
