#!/usr/bin/env node

/**
 * biliup-prepare.mjs  →  bun run biliup:prepare
 *
 * bili 前置准备阶段：确保 biliup.exe 已下载、登录态就绪、清理扫码产物 qrcode.png。
 * 幂等——都齐就跳过。这是 ensure-biliup 的显式入口，用于换机器/重装后主动把工具备齐。
 * bili:upload / comment / stick 执行时也会自动触发同一套 ensure 逻辑。
 * 只有这个阶段就绪，bili 发布相关命令才能正常工作。
 */
import { ensureBiliup } from "./ensure-biliup.mjs";

const plan = ensureBiliup({ needExe: true, needCookie: true });
if (plan.ready) {
  console.log("✅ biliup 已就绪（biliup.exe + 登录态都在）");
} else {
  console.log("✅ biliup 前置准备完成");
}
