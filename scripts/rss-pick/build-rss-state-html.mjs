#!/usr/bin/env bun
// build-rss-state-html.mjs  →  bun run rss:pick
//
// 起 Bun.serve 本地服务，把 rss-state.json / data.json / picks.json 注入 template.html，
// 浏览器里勾选后点「保存并关闭」直接写 picks.json 并自动关服务（不再走复制 JSONC 贴对话的弯路）。
//
// 路由：
//   GET  /          → 注入运行期数据后返回页面
//   POST /picks     → 写 ingest/picks.json，回 200 后 server.stop()（保存并关闭）
//   POST /shutdown  → server.stop()（关闭不保存）

import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));   // scripts/rss-pick/
const TEMPLATE = join(HERE, "template.html");
const PORT = Number(process.env.RSS_PICK_PORT) || 7788;

// 项目根：本脚本在 scripts/rss-pick/ 下，向上两级即项目根
function projectRootFromHere() {
  return dirname(dirname(HERE)); // scripts/rss-pick -> scripts -> <root>
}

// 接受可选参数显式指定项目根，否则按脚本自身位置推算；
// 显式传了路径但缺少 .agents 标记时打印说明，不再静默回退。
let projectRoot;
if (process.argv[2] && existsSync(join(process.argv[2], ".agents"))) {
  projectRoot = process.argv[2];
} else {
  projectRoot = projectRootFromHere();
  if (process.argv[2]) {
    console.warn(`[rss:pick] 未识别的项目根：${process.argv[2]}（缺少 .agents），实际使用：${projectRoot}`);
  }
}

const RSS_STATE = join(projectRoot, "ingest", "rss-state.json");
const REPORT_JSON = join(projectRoot, "data-scheme", "data.json");
const PICKS_JSON = join(projectRoot, "ingest", "picks.json");

if (!existsSync(RSS_STATE)) {
  console.error(`[rss:pick] 找不到 ${RSS_STATE}`);
  console.error("先跑一次 `bun run rss`（go -C ingest run . fetch）生成 RSS 快照。");
  process.exit(1);
}
if (!existsSync(TEMPLATE)) {
  console.error(`[rss:pick] 模板缺失：${TEMPLATE}`);
  process.exit(1);
}

// 模板读一次缓存：每个请求复用，只替换占位符。
const templateSource = readFileSync(TEMPLATE, "utf8");
if (!templateSource.includes("__RSS_STATE__") || !templateSource.includes("__REPORT_STORIES__") || !templateSource.includes("__PICKS__")) {
  console.error("[rss:pick] 模板缺少占位符 __RSS_STATE__ / __REPORT_STORIES__ / __PICKS__。");
  process.exit(1);
}

// ---- 读 RSS state ----
let rssState;
try {
  rssState = JSON.parse(readFileSync(RSS_STATE, "utf8"));
} catch (e) {
  console.error(`[rss:pick] 解析 rss-state.json 失败：${e.message}`);
  process.exit(1);
}
// 标准化为 { items: { hash: {...} } }
const items = rssState && rssState.items ? rssState.items : (rssState || {});
const itemCount = Object.keys(items).length;

// ---- 读本期 data.json（可选，用于"已收录"标记）----
let stories = [];
const hasReport = existsSync(REPORT_JSON);
if (hasReport) {
  try {
    const report = JSON.parse(readFileSync(REPORT_JSON, "utf8"));
    stories = Array.isArray(report.stories) ? report.stories : [];
  } catch (e) {
    console.error(`[rss:pick] 解析 data.json 失败（将忽略"已收录"标记）：${e.message}`);
    stories = [];
  }
}
const acceptedCount = stories.filter((s) => typeof s?.id === "string" && /^topic-\d+$/.test(s.id)).length;

// ---- 读 picks.json（可选，用于回显已勾选）----
let savedPicks = {};
if (existsSync(PICKS_JSON)) {
  try {
    savedPicks = JSON.parse(readFileSync(PICKS_JSON, "utf8")) || {};
  } catch (e) {
    console.error(`[rss:pick] 解析 picks.json 失败（将忽略已勾选回显）：${e.message}`);
    savedPicks = {};
  }
}
const pickedCount = Object.keys(savedPicks).filter((h) => savedPicks[h]).length;

// 注入 JSON 的转义：script 数据块里 "</script" 之后的任意分隔符（空格/斜杠/大于号）都会提前结束脚本块，
// 所以只替换字面 </script> 不够（H1）。对 stringify 结果整体转义 < > & 为 \u003c/\u003e/\u0026，
// JSON.parse 会原样还原，而 HTML 解析器再也看不到尖括号。
const esc = (obj) =>
  JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

function renderHtml() {
  return templateSource
    // 函数形式替换：字符串形式的替换串里 $&、$`、$'、$$ 是特殊模式，RSS 标题含这些序列会
    // 损坏注入的 JSON；函数返回值按字面插入，且不会命中注入数据里出现的字面占位符。
    .replace("__RSS_STATE__", () => esc(rssState))
    .replace("__REPORT_STORIES__", () => esc(stories))
    .replace("__PICKS__", () => esc(savedPicks))
    // CSP nonce：模板只有这一个裸 <script>（数据块带 id/type 属性不执行），加 nonce 后
    // script-src 'nonce-...' 即可禁止任何未授权（注入出来的）内联脚本执行。
    .replace("<script>", () => `<script nonce="${CSP_NONCE}">`);
}

// ---- 每次运行的随机凭据与安全头（M1：无鉴权 0.0.0.0 绑定 + CSRF）----
// RUN_TOKEN：每次启动随机生成，GET / 通过 HttpOnly+SameSite=Strict Cookie 下发给本页面，
//   变更端点（POST /picks、POST /shutdown）必须回带；跨站页面/其它 Origin 既拿不到也带不上。
//   也接受 X-Pick-Token 请求头（等价通道，便于脚本化调用）。
const RUN_TOKEN = randomUUID();
const CSP_NONCE = randomUUID().replace(/-/g, "");
const TOKEN_COOKIE = `rss_pick_token=${RUN_TOKEN}; Path=/; HttpOnly; SameSite=Strict`;

// Host 校验：只认本机回环域名 + 实际端口（防 DNS rebinding 把别的域名解析到 127.0.0.1 复用本服务）。
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`]);
const hostAllowed = (req) => ALLOWED_HOSTS.has((req.headers.get("host") || "").toLowerCase());

// token 校验：Cookie 或 X-Pick-Token 头二选一。
function tokenAllowed(req) {
  if (req.headers.get("x-pick-token") === RUN_TOKEN) return true;
  const cookie = req.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === "rss_pick_token" && v.join("=") === RUN_TOKEN) return true;
  }
  return false;
}

const forbidden = (why) => new Response(why, { status: 403 });

// Windows 下 projectRoot 含反斜杠会让前缀匹配永不命中：双方统一成正斜杠后再做前缀替换。
const rel = (p) => p.replace(/\\/g, "/").replace(projectRoot.replace(/\\/g, "/") + "/", "");

const SECURITY_HEADERS = {
  // CSP：只放行带 nonce 的内联脚本与 Google Fonts；注入出来的 <img onerror> 等内联事件/脚本一律禁止执行。
  "Content-Security-Policy": [
    "default-src 'none'",
    `script-src 'nonce-${CSP_NONCE}'`,
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; "),
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};
// 绑定 127.0.0.1（M1）：本工具只服务本机浏览器，绝不暴露到局域网/VPN 接口；日志打印真实绑定地址。
const BIND_HOST = "127.0.0.1";
// closing：已进入关闭流程（保存成功/收到 shutdown）后置位，期间拒绝新的变更请求，
// 避免「服务已停止但还在写文件」的小竞态。
let closing = false;

let server;
try {
  server = Bun.serve({
    hostname: BIND_HOST, // M1：显式回环绑定，不再 0.0.0.0/[::] 全接口监听
    port: PORT,
    async fetch(req) {
      const url = new URL(req.url);

      // Host 校验对所有路由生效：DNS rebinding 场景下 Host 是攻击者域名，直接拒绝。
      if (!hostAllowed(req)) return forbidden("Host not allowed");

      if (url.pathname === "/" && req.method === "GET") {
        return new Response(renderHtml(), {
          headers: {
            ...SECURITY_HEADERS,
            "Content-Type": "text/html; charset=utf-8",
            // 同源页面的专用凭据：HttpOnly 防 XSS 读取，SameSite=Strict 防跨站自动携带。
            "Set-Cookie": TOKEN_COOKIE,
          },
        });
      }

      if (url.pathname === "/picks" && req.method === "POST") {
        if (!tokenAllowed(req)) return forbidden("missing or invalid pick token");
        if (closing) return new Response("server is closing", { status: 503 });
        // M1：显式要求 JSON Content-Type，拒绝 CORS 简单请求形态（text/plain/form）的跨站提交。
        const contentType = (req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
        if (contentType !== "application/json") {
          return new Response("Content-Type must be application/json", { status: 415 });
        }
        try {
          const body = await req.json();
          // 只接受 {hash: true/false}：body 必须是非数组对象；hash 必须是 64 位小写 hex，
          // 值必须是严格布尔；不满足直接 400。格式合法但不在当前 rss-state items 里的 key
          // 求交集时静默忽略（与前端「过期 pick 清理」逻辑对齐）。
          if (!body || typeof body !== "object" || Array.isArray(body)) {
            return Response.json({ ok: false, error: "body must be a JSON object" }, { status: 400 });
          }
          const knownHashes = new Set(Object.keys(items));
          const cleaned = {};
          for (const [h, v] of Object.entries(body)) {
            if (!/^[0-9a-f]{64}$/.test(h)) {
              return Response.json({ ok: false, error: `invalid key: ${h.slice(0, 12)}` }, { status: 400 });
            }
            if (v !== true && v !== false) {
              return Response.json({ ok: false, error: "values must be booleans" }, { status: 400 });
            }
            if (v && knownHashes.has(h)) cleaned[h] = true;
          }
          // 原子写：先写同目录临时文件再 rename 覆盖，避免写一半的 picks.json 被其它进程读到。
          const tmpPath = `${PICKS_JSON}.${process.pid}.tmp`;
          try {
            writeFileSync(tmpPath, JSON.stringify(cleaned, null, 2) + "\n", "utf8");
            renameSync(tmpPath, PICKS_JSON);
          } catch (e) {
            try {
              unlinkSync(tmpPath);
            } catch {
              // 临时文件可能不存在；清理失败无需处理。
            }
            throw e;
          }
          console.log(`[rss:pick] 已写入 ${Object.keys(cleaned).length} 条到 ${rel(PICKS_JSON)}`);
          // 回 200 后关服务（保存并关闭）；closing 置位，关闭窗口期内拒绝新的变更请求。
          closing = true;
          setTimeout(() => server.stop(), 200);
          return Response.json({ ok: true, count: Object.keys(cleaned).length });
        } catch (e) {
          return Response.json({ ok: false, error: e.message }, { status: 500 });
        }
      }

      if (url.pathname === "/shutdown" && req.method === "POST") {
        if (!tokenAllowed(req)) return forbidden("missing or invalid pick token");
        if (closing) return new Response("server is closing", { status: 503 });
        console.log("[rss:pick] 收到关闭请求，停止服务。");
        closing = true;
        setTimeout(() => server.stop(), 100);
        return Response.json({ ok: true });
      }

      return new Response("404", { status: 404 });
    },
  });
} catch (e) {
  // 端口被占（EADDRINUSE）等启动失败：给友好提示后非零退出，不裸抛堆栈。
  console.error(`[rss:pick] 服务启动失败（绑定 ${BIND_HOST}:${PORT}）：${e.message}`);
  console.error(`  端口可能被占用，可用 RSS_PICK_PORT 换端口重试，例如：RSS_PICK_PORT=${PORT + 1} bun run rss:pick`);
  process.exit(1);
}

console.log(`[rss:pick] 服务启动：http://${BIND_HOST}:${PORT}/ （仅本机回环，绑定 ${BIND_HOST}:${PORT}）`);
console.log(`  RSS 条目：${itemCount}  |  已收录：${acceptedCount}  |  已 pick：${pickedCount}`);
console.log(`  提示：浏览器里勾选 → 点「保存并关闭」写入 ${rel(PICKS_JSON)}，服务会自动关闭。`);


// ---- 跨平台开浏览器 ----
if (process.env.RSS_PICK_NO_OPEN !== "1") {
  const fileUrl = `http://localhost:${PORT}/`;
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
    console.error(`[rss:pick] 无法自动打开浏览器（${cmd}）：${e.message}`);
    console.error(`  手动打开：${fileUrl}`);
  }
}
