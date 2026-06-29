import {existsSync, readFileSync, watch} from "node:fs";
import {spawn} from "node:child_process";
import {delimiter, extname, resolve} from "node:path";
import {clearTimeout, setTimeout} from "node:timers";
import {dataDir, generatedDataPath, rawDataPath, rootDir} from "../lib/paths.mjs";
import {terminateProcessTree} from "../lib/process-tree.mjs";
import {collectMissingImageAssets} from "../lib/asset-check.mjs";

if (process.env.AI_DAILY_REPORT_RUN_ALL === "1") {
  throw new Error(
    "bun run dev cannot start during the bun run video:prepare production phase.",
  );
}

// 标记「子进程是在 dev 里跑的」:runScript 经 childEnv 透传,generate-tts 据此静音 dev 下冗余的
// 日志(如每次都一样的 MiniMax pacing 配置回显)。单独 `bun run tts` / `tts:force` 不经 dev.mjs,
// 不设此 flag,保留完整日志。
process.env.AI_DAILY_REPORT_DEV = "1";

const debounceMs = 700;
const rawDataName = "data.json";
const imageExtensions = new Set([".avif", ".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"]);

let syncProcess = null;
let studioProcess = null;
let syncQueued = false;
let syncTimer = null;
let assetCheckTimer = null;
let shuttingDown = false;
let inputWatchers = [];
const maxConsecutiveFailures = 3;
let consecutiveFailures = 0;

// 直接 spawn package.json 里的脚本命令、不走 `bun run`——`bun run` 每次会先打印一行
// "$ <命令>" 回显（如 "$ node ... generate-tts.mjs" / "$ remotion studio ..."），零信息量。
// 命令仍以 package.json 为单一事实源；本地 CLI（remotion）靠把 node_modules/.bin 塞进 PATH
// 解析，shell:true 让 Windows 走 .bin/*.cmd。已在 Windows 验证此机制能解析 .cmd、透传 stdout、
// 并按子进程退出码收尾（含 tts 赖以区分校验失败的 code===2），故 runSync 的退出码分支不受影响。
const pkgScripts = JSON.parse(
  readFileSync(resolve(rootDir, "package.json"), "utf8"),
).scripts;
const childEnv = {
  ...process.env,
  PATH: `${resolve(rootDir, "node_modules", ".bin")}${delimiter}${process.env.PATH ?? ""}`,
};
function runScript(name) {
  const child = spawn(pkgScripts[name], {
    cwd: rootDir,
    env: childEnv,
    stdio: "inherit",
    shell: true,
  });
  child.once("error", (error) => {
    console.error(`无法运行 ${name}: ${error.message}`);
  });
  return child;
}

function startStudio() {
  if (studioProcess || shuttingDown) return;
  console.log("\n🎬 正在启动 Remotion Studio...\n");
  studioProcess = runScript("dev:studio");
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
  syncProcess = runScript("tts");
  syncProcess.once("close", (code) => {
    syncProcess = null;
    if (code === 0) {
      consecutiveFailures = 0;
      // 不再打印 "✅ 已更新"：tts 末尾的 "TTS complete: generated X, reused Y" 已是成功信号，
      // 每次保存都和它重复。失败路径（code 2 的 ⚠️ / 其它的 ❌）仍保留明确提示。
      startStudio();
    } else if (code === 2) {
      // 退出码 2 = tts 在调用 MiniMax 之前就失败（data.json 校验/JSON 语法/缺 API Key）。
      // 这种失败不消耗 MiniMax 配额，因此不计入"连续失败"锁：改好 data.json 保存即自动重试。
      console.error(
        "⚠️ data.json 校验或配置失败（未调用 MiniMax，不消耗配额）。按上方错误修正后保存即可自动重试。",
      );
    } else {
      consecutiveFailures += 1;
      console.error("❌ 自动同步失败。修正 data.json 或环境配置后再次保存即可重试。");
    }

    if (syncQueued && !shuttingDown) {
      syncQueued = false;
      // 连续失败时停止自动重跑：对持续坏掉的 data.json 反复跑完整 TTS 会烧 MiniMax 配额，
      // 用户应先修正数据/配置再手动保存触发一次新的同步。
      if (consecutiveFailures >= maxConsecutiveFailures) {
        console.error(
          `⛔ 已连续失败 ${consecutiveFailures} 次自动同步，暂停自动重试。修正 data.json 或 .env 后保存一次即可重新触发。`,
        );
      } else {
        runSync("同步期间检测到新的数据变化");
      }
    }
  });
}

function scheduleSync(reason) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => runSync(reason), debounceMs);
}

function readReportSafe(path) {
  try {
    return {ok: true, report: JSON.parse(readFileSync(path, "utf8"))};
  } catch (error) {
    return {ok: false, error};
  }
}

// 图片被删/改后，检查 raw + generated 里是否出现悬空的 overlayImg/icon 引用。
// tts 用 checkAssets:false、图片变化也不触发 tts，否则死引用会一直留在
// data-generate.json，让 Remotion <Img> cancelRender 且永不自愈。这里只做诊断、
// 不静默改 data.json：精确告诉用户哪条引用悬空、怎么修（删字段后保存触发 tts 自愈）。
function runImageAssetCheck({silentWhenClean = false} = {}) {
  const missing = [];

  // data.json 读失败（手改拼错/半写入）不能静默：否则 readReportSafe→null→"无缺失"，
  // 再被 silentWhenClean 当成"没问题"吞掉，用户既看不到 asset 提示，也得不到
  // "data.json 解析失败"的任何线索。这里强制报一行。
  const raw = readReportSafe(rawDataPath);
  if (!raw.ok) {
    console.error(
      `⚠️ 无法读取 data.json（${raw.error.code ?? raw.error.message}），图片引用检查已跳过。请确认 data-scheme/data.json 语法正确。`,
    );
    return;
  }
  for (const m of collectMissingImageAssets(raw.report, dataDir)) {
    missing.push({...m, source: "data.json"});
  }

  // data-generate.json 是生成文件、可能正被 tts 重命名中，读失败属正常瞬态；
  // 且 overlayImg 已由上面的 raw 覆盖，icons 缺失下次 tts 会重建。静默跳过即可。
  if (existsSync(generatedDataPath)) {
    const generated = readReportSafe(generatedDataPath);
    if (generated.ok) {
      for (const m of collectMissingImageAssets(generated.report, dataDir)) {
        missing.push({...m, source: "data-generate.json"});
      }
    }
  }
  // overlayImg 同时存在于 raw 和 generated，按 ref+owner 去重（保留 raw 来源）。
  const seen = new Set();
  const deduped = missing.filter((m) => {
    const key = `${m.ref}|${m.owner}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (deduped.length === 0) {
    if (!silentWhenClean) {
      console.log("✅ 图片引用完整，交由 Remotion Studio 刷新。");
    }
    return;
  }
  console.error(
    `⚠️ 发现 ${deduped.length} 处悬空的图片引用（Remotion <Img> 会 cancelRender）：`,
  );
  for (const m of deduped) {
    console.error(`  - ${m.ref}  → ${m.owner}（来自 ${m.source}）`);
  }
  console.error(
    "👉 修复：从 data-scheme/data.json 删除对应的 overlayImg 字段后保存（会自动重跑 TTS 自愈），或把图片放回 images/。",
  );
}

const assetCheckDebounceMs = 400;
// 图片变化时静默检查引用是否悬空：干净不报（图片变化本身已由 🔄 "重算 overlay 尺寸" 同步行确认），
// 仅当发现会导致 Remotion <Img> cancelRender 的悬空引用时才打 ⚠️。遵循"成功安静、失败响亮"——
// 否则每次批量落图都会刷一片"检查中 / 引用完整"的零信息行。
function scheduleImageAssetCheck() {
  clearTimeout(assetCheckTimer);
  assetCheckTimer = setTimeout(
    () => runImageAssetCheck({silentWhenClean: true}),
    assetCheckDebounceMs,
  );
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
        scheduleImageAssetCheck();
        // 图片变化也让 tts 跑一次（音频走缓存复用、不调 MiniMax），以便构建按新文件重算 overlay 尺寸。
        scheduleSync("图片素材已变化（重算 overlay 尺寸）");
      }
    }),
  );

  watchers.push(
    watch(rootDir, (eventType, filename) => {
      if (eventType !== "change" && eventType !== "rename") return;
      const name = (filename?.toString() ?? "").replace(/\\/g, "/");
      if (
        [
          "config/data.schema.json",
          "config/video-layout.json",
          "config/video-layout.schema.json",
          "config/video-timeline.json",
          "config/video-timeline.schema.json",
        ].includes(name)
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
  clearTimeout(assetCheckTimer);
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
  "👀 dev 监听已启动：data.json / Schema / 布局 / .env / 图片变化自动同步 TTS（图片仅重算 overlay、不调 MiniMax）。",
);
runImageAssetCheck({silentWhenClean: true});
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
