import test from "node:test";
import assert from "node:assert/strict";
import { planBiliupReadiness } from "./biliup-readiness.mjs";

// bili 命令执行前按需补齐 biliup：投稿需要 biliup.exe，发评论/置顶需要 cookies.json。
// login 必须用 biliup.exe 跑（扫码），所以「要登录但 exe 不在」时必须先下载。

test("planBiliupReadiness: exe 和 cookie 都在 → 直接就绪，不下载不登录", () => {
  assert.deepEqual(
    planBiliupReadiness({
      exeExists: true,
      cookieExists: true,
      needExe: true,
      needCookie: true,
    }),
    { download: false, login: false, ready: true },
  );
});

test("planBiliupReadiness: 需要 exe 但 exe 不在、cookie 在 → 只下载", () => {
  assert.deepEqual(
    planBiliupReadiness({
      exeExists: false,
      cookieExists: true,
      needExe: true,
      needCookie: true,
    }),
    { download: true, login: false, ready: false },
  );
});

test("planBiliupReadiness: 需要 cookie 但 cookie 不在、exe 在 → 只登录", () => {
  assert.deepEqual(
    planBiliupReadiness({
      exeExists: true,
      cookieExists: false,
      needExe: true,
      needCookie: true,
    }),
    { download: false, login: true, ready: false },
  );
});

test("planBiliupReadiness: 要登录但 exe 也不在 → 先下载再登录（login 依赖 exe）", () => {
  assert.deepEqual(
    planBiliupReadiness({
      exeExists: false,
      cookieExists: false,
      needExe: true,
      needCookie: true,
    }),
    { download: true, login: true, ready: false },
  );
});

test("planBiliupReadiness: 只需 cookie 的命令（comment/stick）、cookie 在 → 不碰 exe", () => {
  assert.deepEqual(
    planBiliupReadiness({
      exeExists: false,
      cookieExists: true,
      needExe: false,
      needCookie: true,
    }),
    { download: false, login: false, ready: true },
  );
});

test("planBiliupReadiness: 只需 cookie 的命令、cookie 不在、exe 也不在 → 下载并登录", () => {
  assert.deepEqual(
    planBiliupReadiness({
      exeExists: false,
      cookieExists: false,
      needExe: false,
      needCookie: true,
    }),
    { download: true, login: true, ready: false },
  );
});

test("planBiliupReadiness: 既不需要 exe 也不需要 cookie（meta）→ 直接就绪", () => {
  assert.deepEqual(
    planBiliupReadiness({
      exeExists: false,
      cookieExists: false,
      needExe: false,
      needCookie: false,
    }),
    { download: false, login: false, ready: true },
  );
});
