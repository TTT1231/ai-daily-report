#!/usr/bin/env node

/**
 * ensure-biliup.mjs
 *
 * bili 命令执行前按需补齐 biliup：缺 biliup.exe 就下载，缺登录态就扫码登录。
 * 替代旧的 postinstall（每次 bun install 都联网下载）——只在真正要发 B 站时才动手，
 * 不用 B 站的用户永远不会被它打扰。
 *
 * 「要不要下载/登录」的决策是纯函数（见 ../../lib/biliup-readiness.mjs，已测），
 * 这里只做编排：spawn download-bili / spawn biliup login。
 */

import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { planBiliupReadiness } from "../../lib/biliup-readiness.mjs";

const ROOT = process.cwd();

/** 按 config.cookieFile + 平台算出 exe / cookie 的绝对路径。 */
export function biliupPaths(config, platform = process.platform) {
  const exeName = platform === "win32" ? "biliup.exe" : "biliup";
  return {
    exe: resolve(ROOT, "biliup", exeName),
    cookie: resolve(ROOT, config.cookieFile),
  };
}

/**
 * 带可注入依赖的内核（便于测试，不真去联网/扫码）。
 * ctx: { needExe, needCookie, exe, cookie, exeExists, cookieExists, isTTY, run, info, fail }
 *   run(cmd, args, opts) 同步执行子进程；info 记日志；fail(msg) 中止流程（抛错/退出）。
 */
export function ensureBiliupCore(ctx) {
  const {
    needExe,
    needCookie,
    exe,
    cookie,
    exeExists,
    cookieExists,
    isTTY,
    run,
    info,
    fail,
  } = ctx;
  const plan = planBiliupReadiness({ exeExists, cookieExists, needExe, needCookie });
  if (plan.ready) return plan;

  if (plan.download) {
    info("⬇️  biliup 未安装，按需下载…");
    run("bun", ["run", "download-bili"], { stdio: "inherit" });
  }

  if (plan.login) {
    if (!isTTY) {
      fail(
        `未检测到登录态，且当前非交互终端无法拉起交互式登录。请在交互终端手动登录后重试：
  ${exe} -u ${cookie} login  （弹出菜单选【扫码登录】，再用 B 站 App 扫码）`,
      );
      return plan; // fail 一般已抛/退出，兜底
    }
    info("🔐 未检测到登录态，启动登录（弹出菜单请选【扫码登录】，再用 B 站 App 扫码）…");
    run(exe, ["-u", cookie, "login"], { stdio: "inherit" });
  }
  return plan;
}

/** 生产入口：读 bilibili.config.json、探测文件、用真实 spawn 编排。 */
export function ensureBiliup({ needExe, needCookie } = {}) {
  const config = JSON.parse(
    readFileSync(resolve(ROOT, "bilibili.config.json"), "utf-8"),
  );
  const { exe, cookie } = biliupPaths(config);
  const plan = ensureBiliupCore({
    needExe,
    needCookie,
    exe,
    cookie,
    exeExists: existsSync(exe),
    cookieExists: existsSync(cookie),
    isTTY: Boolean(process.stdin.isTTY),
    run: (cmd, args, opts) => spawnSync(cmd, args, opts),
    info: (...a) => console.log(...a),
    fail: (msg) => {
      console.error(`❌ ${msg}`);
      process.exit(1);
    },
  });
  // 扫码登录会在 biliup/ 留下 qrcode.png（二维码图），属无用产物，清掉
  if (plan.login) {
    const qr = resolve(ROOT, "biliup", "qrcode.png");
    if (existsSync(qr)) rmSync(qr);
  }
  return plan;
}
