#!/usr/bin/env node
// build-rss-state-html.mjs
//
// 把 ingest/rss-state.json 渲染成按 sourceId 分类的 HTML 挑选页，并自动打开浏览器。
// CSS/JS 固定在同目录 template.html，本脚本只往两个占位符里注入运行期数据。
// 用法：bun run rss:vision-pick  （或 node scripts/rss-pick/build-rss-state-html.mjs）

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));   // scripts/rss-pick/
const TEMPLATE = join(HERE, "template.html");

// 项目根：本脚本在 scripts/rss-pick/ 下，向上两级即项目根
function projectRootFromHere() {
  return dirname(dirname(HERE)); // scripts/rss-pick -> scripts -> <root>
}

// 接受可选参数显式指定项目根，否则按脚本自身位置推算
let projectRoot = process.argv[2] && existsSync(join(process.argv[2], ".agents"))
  ? process.argv[2]
  : projectRootFromHere();

const RSS_STATE = join(projectRoot, "ingest", "rss-state.json");
const REPORT_JSON = join(projectRoot, "data-scheme", "data.json");
const OUT_HTML = join(projectRoot, "ingest", "rss-state.html");

if (!existsSync(RSS_STATE)) {
  console.error(`[rss:vision-pick] 找不到 ${RSS_STATE}`);
  console.error("先跑一次 `bun run rss`（go -C ingest run .）生成 RSS 快照。");
  process.exit(1);
}
if (!existsSync(TEMPLATE)) {
  console.error(`[rss:vision-pick] 模板缺失：${TEMPLATE}`);
  process.exit(1);
}

// ---- 读 RSS state ----
let rssState;
try {
  rssState = JSON.parse(readFileSync(RSS_STATE, "utf8"));
} catch (e) {
  console.error(`[rss:vision-pick] 解析 rss-state.json 失败：${e.message}`);
  process.exit(1);
}
// 标准化为 { items: { hash: {...} } }
const items = rssState && rssState.items ? rssState.items : (rssState || {});
const itemCount = Object.keys(items).length;

// ---- 读本期 data.json（可选，用于“已收录”标记）----
let stories = [];
const hasReport = existsSync(REPORT_JSON);
if (hasReport) {
  try {
    const report = JSON.parse(readFileSync(REPORT_JSON, "utf8"));
    stories = Array.isArray(report.stories) ? report.stories : [];
  } catch (e) {
    console.error(`[rss:vision-pick] 解析 data.json 失败（将忽略“已收录”标记）：${e.message}`);
    stories = [];
  }
}
const acceptedCount = stories.filter((s) => typeof s?.id === "string" && /^topic-\d+$/.test(s.id)).length;

// ---- 注入模板（替换两个占位符；模板其余内容保持不动）----
let template = readFileSync(TEMPLATE, "utf8");
if (!template.includes("__RSS_STATE__") || !template.includes("__REPORT_STORIES__")) {
  console.error("[rss:vision-pick] 模板缺少占位符 __RSS_STATE__ / __REPORT_STORIES__。");
  process.exit(1);
}
// 注入 JSON：需转义 </script>，避免提前结束脚本块
const rssJson = JSON.stringify(items).replace(/<\/script>/gi, "<\\/script>");
const storiesJson = JSON.stringify(stories).replace(/<\/script>/gi, "<\\/script>");
const out = template
  .replace("__RSS_STATE__", rssJson)
  .replace("__REPORT_STORIES__", storiesJson);

// ---- 写出 ----
try {
  writeFileSync(OUT_HTML, out, "utf8");
} catch (e) {
  console.error(`[rss:vision-pick] 写出失败：${OUT_HTML} — ${e.message}`);
  process.exit(1);
}

const rel = (p) => p.replace(projectRoot + "/", "").replace(/\\/g, "/");

console.log(`[rss:vision-pick] 已生成 ${rel(OUT_HTML)}`);
console.log(`  RSS 条目：${itemCount}  |  本期 data.json 已收录：${acceptedCount}${hasReport ? "" : "（未找到 data.json，无“已收录”标记）"}`);
console.log(`  提示：浏览器里勾选 → 点「复制选中为 JSONC」→ 贴回对话，agent 会按 rss-pick-mode 补选。`);

// ---- 跨平台开浏览器 ----
if (process.env.RSS_PICK_NO_OPEN === "1") {
  process.exit(0);
}
const fileUrl = "file:///" + OUT_HTML.replace(/\\/g, "/");
const platform = process.platform;
let cmd, args;
if (platform === "win32") {
  cmd = "cmd"; args = ["/c", "start", "", fileUrl];
} else if (platform === "darwin") {
  cmd = "open"; args = [fileUrl];
} else {
  cmd = "xdg-open"; args = [fileUrl];
}
try {
  spawnSync(cmd, args, { stdio: "ignore", shell: false });
} catch (e) {
  console.error(`[rss:vision-pick] 无法自动打开浏览器（${cmd}）：${e.message}`);
  console.error(`  手动打开：${fileUrl}`);
}
