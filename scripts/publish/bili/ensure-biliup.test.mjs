import test from "node:test";
import assert from "node:assert/strict";
import { ensureBiliupCore } from "./ensure-biliup.mjs";

// ensureBiliupCore 是带可注入依赖的内核：把 spawn / 日志 / 退出都注入，
// 这样能测「该调什么命令、非交互终端怎么降级」而不真去联网/扫码。

function makeCtx(overrides = {}) {
  const calls = { run: [], info: [], failed: null };
  const ctx = {
    needExe: true,
    needCookie: true,
    exe: "/r/biliup/biliup.exe",
    cookie: "/r/biliup/cookies.json",
    exeExists: true,
    cookieExists: true,
    isTTY: true,
    run: (cmd, args, opts) => {
      calls.run.push({ cmd, args, opts });
      return { status: 0 };
    },
    info: (...a) => calls.info.push(a.join(" ")),
    fail: (msg) => {
      calls.failed = msg;
      throw new Error("FAIL:" + msg);
    },
    ...overrides,
  };
  return { ctx, calls };
}

test("ensureBiliupCore: 已就绪 → 不下载不登录不报错", () => {
  const { ctx, calls } = makeCtx();
  const plan = ensureBiliupCore(ctx);
  assert.equal(plan.ready, true);
  assert.equal(calls.run.length, 0);
  assert.equal(calls.failed, null);
});

test("ensureBiliupCore: 需要 exe 但 exe 不在 → 调 bun run download-bili（继承 stdio）", () => {
  const { ctx, calls } = makeCtx({ exeExists: false, cookieExists: true });
  const plan = ensureBiliupCore(ctx);
  assert.equal(plan.download, true);
  assert.deepEqual(calls.run[0], {
    cmd: "bun",
    args: ["run", "download-bili"],
    opts: { stdio: "inherit" },
  });
});

test("ensureBiliupCore: 要登录 + 交互终端 → 调 biliup.exe login（-u cookie）", () => {
  const { ctx, calls } = makeCtx({ exeExists: true, cookieExists: false, isTTY: true });
  ensureBiliupCore(ctx);
  assert.deepEqual(calls.run[0], {
    cmd: "/r/biliup/biliup.exe",
    args: ["-u", "/r/biliup/cookies.json", "login"],
    opts: { stdio: "inherit" },
  });
  assert.equal(calls.failed, null);
});

test("ensureBiliupCore: 要登录 + 非交互终端 → 不拉起 login，fail 并给出手动命令", () => {
  const { ctx, calls } = makeCtx({ exeExists: true, cookieExists: false, isTTY: false });
  assert.throws(() => ensureBiliupCore(ctx), /手动登录/);
  assert.equal(calls.run.length, 0);
  assert.match(calls.failed, /biliup\.exe -u .* login/);
});

test("ensureBiliupCore: 要下载 + 要登录 + 非交互终端 → 先下载，再 fail（不能自动扫码）", () => {
  const { ctx, calls } = makeCtx({ exeExists: false, cookieExists: false, isTTY: false });
  assert.throws(() => ensureBiliupCore(ctx), /手动登录/);
  assert.equal(calls.run.length, 1); // 只下载，login 没拉起
  assert.equal(calls.run[0].cmd, "bun");
});
