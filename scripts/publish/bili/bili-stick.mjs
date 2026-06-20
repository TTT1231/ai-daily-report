#!/usr/bin/env node

/**
 * bili-stick.mjs  →  bun run bili:stick
 *
 * 置顶 B 站视频下的一条评论（需指定 rpid，来自 bili:comment 的输出）。
 *
 * 用法：
 *   bili:stick -- --bvid BV1xxxx --rpid 3063...
 *   bili:stick -- --oid <aid> --rpid 3063...
 *
 * 凭据 SESSDATA / bili_jct 从 biliup/cookies.json 读取（见 ./bili-api.mjs）。置顶需 UP 主权限。
 */

import { resolveOid, pinComment } from "./bili-api.mjs";

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--bvid") out.bvid = next();
    else if (a === "--oid") out.oid = next();
    else if (a === "--rpid") out.rpid = next();
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv);
if (args.help || (!args.bvid && !args.oid) || !args.rpid) {
  console.log(`用法:
  bili:stick -- --bvid BV1xxxx --rpid 3063...   # 置顶指定评论
  bili:stick -- --oid <aid> --rpid 3063...
  # rpid 来自 bili:comment 的输出`);
  process.exit(args.help ? 0 : 1);
}

async function main() {
  // 1. 解析 oid
  const oid = await resolveOid({ bvid: args.bvid, oid: args.oid });
  console.log(`✓ oid = ${oid}${args.bvid ? ` (bvid=${args.bvid})` : ""}`);

  // 2. 置顶（带重试，应对评论刚发出未索引的 -404）
  await pinComment(oid, args.rpid);
  console.log(`✓ 已置顶 · rpid=${args.rpid}`);
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}`);
  process.exit(1);
});
