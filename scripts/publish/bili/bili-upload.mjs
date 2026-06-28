#!/usr/bin/env node

/**
 * bili-upload.mjs  →  bili:upload（纯投稿） / bili:full（投稿+评论+置顶 全套）
 *
 * 同一个脚本两种用法：
 *   bili:upload    命令已带 --no-comment，只投稿、不发评论/置顶（适合测试稿、只发视频）
 *   bili:full   默认全套：投稿 → 等审核 → 发评论 → 置顶
 *
 * 流程：
 *   1. 读 video-meta.json(LLM 标题/标签) + bilibili.config.json(固定参数) + mp4 + cover
 *   2. 校验：标题 ≤80、标签 ≤10
 *   3. 调 biliup.exe 投稿 → 从输出抓 bvid
 *   4. (bili:full，即未指定 --no-comment 时) 等审核 → 发评论 → 置顶
 *
 * 评论/置顶失败只警告、不判整体失败（视频已发布，可手动补）。
 * 加 --dry-run 只做全量校验、不真正投稿（发布前确认 meta/产物就绪）。
 *
 * 用法：
 *   bun run bili:upload                  # 纯投稿
 *   bun run bili:full                 # 投稿 + 评论 + 置顶
 *   bun run bili:upload -- --dry-run     # 只校验，不真发
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { dataDir, rootDir } from "../../lib/paths.mjs";
import { resolveOid, postComment, pinComment } from "./bili-api.mjs";
import { ensureBiliup } from "./ensure-biliup.mjs";

// 用 paths.mjs 的 rootDir 而非 process.cwd()：其余脚本统一用 rootDir 锚定项目根，
// 用 cwd 会在从子目录/异常 cwd 运行时把所有路径解析到错误位置。
const ROOT = rootDir;
const NO_COMMENT = process.argv.includes("--no-comment");
const DRY_RUN = process.argv.includes("--dry-run");

const fail = (msg) => {
  console.error(`❌ ${msg}`);
  process.exit(1);
};

// ── 跑子进程：捕获输出(用于解析 bvid/rpid) 同时回显到终端 ──────────────
function runCapture(cmd, args, opts = {}) {
  return new Promise((res) => {
    const child = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const fwd = (chunk) => {
      out += chunk.toString();
      process.stdout.write(chunk);
    };
    child.stdout.on("data", fwd);
    child.stderr.on("data", fwd);
    // 用 close 而非 exit：exit 在 stdio 流关闭前触发，biliup 在退出最后一刻吐出的含 bvid
    // 那一行可能还没被 stdout "data" 累积进 out，导致 match 不到 bvid、误判"投稿疑似成功"
    // 并跳过评论/置顶（视频已发、评论静默丢失）。close 在所有流结束后才触发。
    child.on("close", (code) => res({ code, out }));
    child.on("error", (err) => res({ code: 1, out: out + String(err) }));
  });
}

// ── 读配置 + meta ─────────────────────────────────────────────────────
const config = JSON.parse(readFileSync(resolve(ROOT, "config", "bilibili.config.json"), "utf-8"));

const metaPath = resolve(dataDir, "video-meta.json");
if (!existsSync(metaPath)) {
  fail("缺少 data-scheme/video-meta.json，先跑: bun run video:meta");
}
const meta = JSON.parse(readFileSync(metaPath, "utf-8"));

// ── 强制校验 ──────────────────────────────────────────────────────────
const { title, tag } = meta;
if (!title || title.length > 80) {
  fail(`标题非法(长度 ${title?.length ?? 0}): ${title}`);
}
const tags = String(tag)
  .split(/[,，]/)
  .map((t) => t.trim())
  .filter(Boolean);
if (!tags.length || tags.length > 10) {
  fail(`标签非法(数量 ${tags.length})，需 1~10 个`);
}

// ── 检查产物 ──────────────────────────────────────────────────────────
const mp4 = resolve(ROOT, "out/AiDailyReport.mp4");
const cover = resolve(ROOT, "out/cover.png");
const commentsPath = resolve(dataDir, "comments.txt");
for (const [p, hint] of [
  [mp4, "bun run video:render"],
  [cover, "bun run render:cover"],
]) {
  if (!existsSync(p)) fail(`缺少 ${p}，先跑: ${hint}`);
}
// biliup.exe / cookie 路径（真实存在性由下方 ensureBiliup 按需补齐后校验，取代旧 postinstall）
const exeName = process.platform === "win32" ? "biliup.exe" : "biliup";
const exe = resolve(ROOT, "biliup", exeName);
const cookie = resolve(ROOT, config.cookieFile);

// ── 1) 投稿 ───────────────────────────────────────────────────────────
const extraFields = JSON.stringify({ creation_statement: { id: config.creationStatementId ?? 1 } });
const uploadArgs = [
  "-u", cookie, "upload", mp4,
  "--title", title,
  "--tid", String(config.tid),
  "--tag", tags.join(","),
  "--copyright", String(config.copyright),
  "--cover", cover,
  "--submit", config.submit || "app",
  "--extra-fields", extraFields,
];

console.log("===== 1/3 投稿 B站 =====");
console.log(`标题 (${title.length}/80): ${title}`);
console.log(`标签 (${tags.length}): ${tags.join(", ")}  | tid ${config.tid}  | 创作声明 id ${config.creationStatementId ?? 1}`);
console.log("--------------------");

if (DRY_RUN) {
  // 校验全部通过，但不真正投稿：用于发布前确认标题/标签/封面/视频都就绪。
  console.log("\n🧪 --dry-run：校验通过，未执行真实投稿/评论/置顶。去掉 --dry-run 后才会真正发布。");
  console.log(`   mp4: ${mp4}\n   cover: ${cover}\n   cookie: ${cookie}`);
  process.exit(0);
}

// 按需补齐 biliup：缺 exe 自动下载、缺登录态自动扫码登录（替代旧 postinstall，不发 B 站就不触发）
ensureBiliup({ needExe: true, needCookie: true });
// download-bili-tool 是 best-effort，补齐后再确认一次真实存在性
if (!existsSync(exe)) fail(`biliup.exe 仍不在: ${exe}（下载可能失败，可手动 \`bun run download-bili-tool\`）`);
if (!existsSync(cookie)) fail(`cookie 仍不在: ${cookie}，先扫码登录`);

const up = await runCapture(exe, uploadArgs);
if (up.code !== 0) {
  console.error(`\n❌ 投稿失败，biliup 退出码 ${up.code}`);
  process.exit(up.code);
}

// bvid 形如 BV + 10 位，biliup 日志里出现（带 ANSI 也无所谓，正则只匹字母数字）
const bvid = (up.out.match(/BV[0-9A-Za-z]{10}/) || [])[0];
if (!bvid) {
  console.warn("\n⚠️  投稿疑似成功，但未能从输出解析到 bvid（请到创作中心核对）。跳过评论/置顶。");
  process.exit(0);
}
console.log(`\n✅ 投稿成功 · bvid=${bvid}`);

if (NO_COMMENT) {
  console.log("ℹ️  --no-comment 已指定，跳过评论/置顶。");
  process.exit(0);
}
if (!existsSync(commentsPath)) {
  console.warn(`⚠️  没有 ${commentsPath}，跳过评论/置顶（视频已发布）。`);
  process.exit(0);
}

// ── 1.5) 等审核 ───────────────────────────────────────────────────────
// 视频刚发布需先过审核才能评论，否则评论接口会失败。等 commentDelaySec（默认 180s=3 分钟）。
// commentDelaySec 必须是有限数字：写成 "3min" 之类时 Number() 得 NaN，NaN > 0 为 false，
// 会跳过审核等待直接发评论，导致评论接口几乎必失败。非法值回退默认 180s。
const parsedDelay = Number(config.commentDelaySec ?? 180);
const delaySec = Number.isFinite(parsedDelay) ? parsedDelay : 180;
if (delaySec > 0) {
  console.log(`\n⏳ 等 ${delaySec}s 再评论（视频需先通过审核）…`);
  let remain = delaySec;
  while (remain > 0) {
    process.stdout.write(`\r  剩余 ${remain}s …    `);
    const step = Math.min(10, remain);
    await new Promise((r) => setTimeout(r, step * 1000));
    remain -= step;
  }
  process.stdout.write("\r  等待完成，开始评论。        \n");
}

// ── 2/3 发评论 + 3/3 置顶 ────────────────────────────────────────────
// 视频已发布，整个评论/置顶流程包在一个 try/catch 里：resolveOid / 读 comments / 发评论 /
// 置顶任一异常都只警告并给出 bvid 与恢复命令、exit 0，绝不以裸栈 + 非零退出码收场——
// 此时副作用已发生（视频已上线），最该给的是清晰、可恢复的错误信息。
let oid;
let rpid;
try {
  // 直接复用 ./bili-api.mjs（已内置重试），不再 spawn 子进程并抓 stdout。
  console.log("\n===== 2/3 发表评论 =====");
  const message = readFileSync(commentsPath, "utf-8").trim();
  if (!message) {
    console.warn(`\n⚠️  ${commentsPath} 为空，跳过评论/置顶（视频已发布）。`);
    process.exit(0);
  }
  oid = await resolveOid({ bvid });
  rpid = await postComment(oid, message);
  console.log(`\n✅ 评论已发 · rpid=${rpid}`);

  console.log("\n===== 3/3 置顶评论 =====");
  await pinComment(oid, rpid);
  console.log(`\n🎉 全部完成 · ${bvid}（视频 + 评论 + 置顶）`);
} catch (err) {
  console.warn(`\n⚠️  评论/置顶流程异常：${err?.message || err}`);
  if (rpid) {
    console.warn(
      `   视频 ${bvid} 已发布，评论 rpid=${rpid} 已发。可手动置顶：bun run bili:stick -- --bvid ${bvid} --rpid ${rpid}`,
    );
  } else {
    console.warn(`   视频 ${bvid} 已发布。可手动补评论/置顶（bvid=${bvid}）。`);
  }
  process.exit(0); // 视频已发，不算整体失败
}
