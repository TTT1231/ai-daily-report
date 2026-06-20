#!/usr/bin/env node

/**
 * bili-comment.mjs  →  bun run bili:comment
 *
 * 向 B 站视频发送一条评论（不置顶；置顶用 bun run bili:stick）。
 *
 * 用法：
 *   bili:comment -- --bvid BV1xxxx --message "今日日报：..."
 *   bili:comment -- --bvid BV1xxxx --from-file data-scheme/comments.txt
 *   bili:comment -- --oid <aid> --message "..."
 *
 * 凭据 SESSDATA / bili_jct 从 biliup/cookies.json 读取（见 ./bili-api.mjs）。
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveOid, postComment } from "./bili-api.mjs";

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--bvid") out.bvid = next();
    else if (a === "--oid") out.oid = next();
    else if (a === "--message" || a === "-m") out.message = next();
    else if (a === "--from-file") out.fromFile = next();
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv);
if (args.help || (!args.bvid && !args.oid)) {
  console.log(`用法:
  bili:comment -- --bvid BV1xxxx --message "评论正文"
  bili:comment -- --bvid BV1xxxx --from-file data-scheme/comments.txt
  bili:comment -- --oid <aid> --message "..."`);
  process.exit(args.help ? 0 : 1);
}

if (!args.message && !args.fromFile) {
  console.error("❌ 必须提供 --message 或 --from-file");
  process.exit(1);
}
if (args.message && args.fromFile) {
  console.error("❌ --message 与 --from-file 互斥");
  process.exit(1);
}

async function main() {
  // 1. 解析 oid
  const oid = await resolveOid({ bvid: args.bvid, oid: args.oid });
  console.log(`✓ oid = ${oid}${args.bvid ? ` (bvid=${args.bvid})` : ""}`);

  // 2. 读取评论正文
  let message;
  if (args.fromFile) {
    const path = resolve(process.cwd(), args.fromFile);
    message = readFileSync(path, "utf8").trim();
    console.log(`✓ 从 ${path} 读取评论 (${message.length} 字)`);
  } else {
    message = args.message;
  }
  if (!message) {
    console.error("❌ 评论正文为空");
    process.exit(1);
  }

  // 3. 发评论
  const rpid = await postComment(oid, message);
  console.log(`✓ 评论已发送 · rpid=${rpid}`);
  console.log(
    `\n💡 置顶请运行：bun run bili:stick -- --bvid ${args.bvid ?? ""} --rpid ${rpid}`,
  );
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}`);
  if (err.biliCode !== undefined) {
    console.error("   若是风控/签名类错误，需要补 WBI 签名或切到浏览器方案。");
  }
  process.exit(1);
});
