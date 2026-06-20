#!/usr/bin/env node

/**
 * download-bili.mjs  →  bun run download-bili
 * 也在 `bun install` 时经 postinstall 自动触发。
 *
 * 把 biliup-rs 最新版下载/更新到 ./biliup/，跨平台：
 *   1. 递归备份 biliup/ 下已有的 cookies.json（保住登录态，升级免重扫）
 *   2. 清空 biliup/（旧文件）
 *   3. 查 biliup-rs 最新版，按本机 系统/架构 挑对应 zip 下载
 *   4. 解压 → 把版本子目录里的内容平铺到 biliup/ → 删子目录 → 删 zip
 *   5. 还原 cookies.json → biliup/cookies.json
 *
 * best-effort：任何失败只警告、退出码 0（不搞坏 bun install）。
 */

import {
  mkdirSync,
  rmSync,
  readdirSync,
  existsSync,
  writeFileSync,
  readFileSync,
  renameSync,
  cpSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { rootDir } from "../../lib/paths.mjs";

const ROOT = rootDir;
const BILIUP_DIR = resolve(ROOT, "biliup");
const UA = "ai-daily-report-installer";
const log = (...a) => console.log("[download-bili]", ...a);
const warn = (...a) => console.warn("[download-bili] ⚠️", ...a);

/** 递归找 cookies.json */
function findCookie(dir) {
  if (!existsSync(dir)) return null;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isFile() && e.name === "cookies.json") return p;
    if (e.isDirectory()) {
      const f = findCookie(p);
      if (f) return f;
    }
  }
  return null;
}

/** 跨平台解压 zip */
function extract(zip, dest) {
  if (process.platform === "win32") {
    const r = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dest}' -Force`],
      { encoding: "utf8" },
    );
    if (r.status !== 0) throw new Error("Expand-Archive 失败: " + (r.stderr || r.stdout));
  } else {
    const r = spawnSync("unzip", ["-o", zip, "-d", dest], { encoding: "utf8" });
    if (r.status !== 0) {
      const r2 = spawnSync("tar", ["-xf", zip, "-C", dest], { encoding: "utf8" });
      if (r2.status !== 0) throw new Error("unzip/tar 均失败，请先安装 unzip");
    }
  }
}

/** 把唯一一个版本子目录的内容上移到 dir，再删空目录 */
function flatten(dir) {
  const subdirs = readdirSync(dir, { withFileTypes: true }).filter((e) =>
    e.isDirectory(),
  );
  if (subdirs.length !== 1) return null;
  const sub = join(dir, subdirs[0].name);
  for (const e of readdirSync(sub, { withFileTypes: true })) {
    const from = join(sub, e.name);
    const to = join(dir, e.name);
    try {
      renameSync(from, to);
    } catch {
      cpSync(from, to, { recursive: true });
      rmSync(from, { recursive: true, force: true });
    }
  }
  rmSync(sub, { recursive: true, force: true });
  return subdirs[0].name;
}

async function main() {
  // 1. 备份现有 cookie（任意层级）
  let cookie = null;
  const ck = findCookie(BILIUP_DIR);
  if (ck) {
    cookie = readFileSync(ck, "utf8");
    log(`备份登录态：${ck}`);
  }

  // 2. 清空 + 重建 biliup/
  rmSync(BILIUP_DIR, { recursive: true, force: true });
  mkdirSync(BILIUP_DIR, { recursive: true });
  log("已清空 biliup/");

  // 3. 查最新版 + 挑对应 asset
  const api = await fetch("https://api.github.com/repos/biliup/biliup-rs/releases/latest", {
    headers: { "User-Agent": UA },
  });
  if (!api.ok) throw new Error(`GitHub API ${api.status}`);
  const rel = await api.json();

  const platKey =
    process.platform === "win32" ? ["windows"]
    : process.platform === "darwin" ? ["darwin", "apple", "macos"]
    : ["linux"];
  const archKey = process.arch === "arm64" ? ["aarch64", "arm64"] : ["x86_64", "x64"];
  const has = (name, keys) => keys.some((k) => name.toLowerCase().includes(k));
  const asset = (rel.assets || []).find(
    (a) => a.name.toLowerCase().endsWith(".zip") && has(a.name, platKey) && has(a.name, archKey),
  );
  if (!asset) {
    throw new Error(
      `未找到 ${platKey.join("/")}/${archKey.join("/")} 对应的 zip。可选: ${(rel.assets || [])
        .map((a) => a.name)
        .join(", ")}`,
    );
  }
  log(`最新版 ${rel.tag_name}，下载 ${asset.name}`);

  // 4. 下载 zip
  const zipPath = join(BILIUP_DIR, "biliup.zip");
  const dl = await fetch(asset.browser_download_url, { headers: { "User-Agent": UA } });
  if (!dl.ok) throw new Error(`下载失败 HTTP ${dl.status}`);
  const buf = Buffer.from(await dl.arrayBuffer());
  writeFileSync(zipPath, buf);
  log(`下载完成 ${(buf.length / 1048576).toFixed(1)} MB`);

  // 5. 解压
  extract(zipPath, BILIUP_DIR);
  log("解压完成");

  // 6. 删 zip（先删再 flatten，flatten 就不必排除 zip）
  rmSync(zipPath, { force: true });

  // 7. 平铺版本子目录 → biliup/
  const sub = flatten(BILIUP_DIR);
  if (sub) log(`已平铺 ${sub}/ → biliup/`);

  // 8. 还原 cookie 到平铺位置
  if (cookie != null) {
    writeFileSync(join(BILIUP_DIR, "cookies.json"), cookie, "utf8");
    log("已还原登录态 → biliup/cookies.json");
  }

  log("✅ biliup 就绪: " + readdirSync(BILIUP_DIR).join(", "));
}

main().catch((e) => {
  warn(e.message || String(e));
  warn("biliup 本次未更新（不影响 install）。可稍后 `bun run download-bili` 重试。");
  process.exit(0); // best-effort：绝不搞坏 bun install
});
