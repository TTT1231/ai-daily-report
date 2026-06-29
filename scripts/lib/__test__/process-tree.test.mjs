import test from "node:test";
import assert from "node:assert/strict";
import {collectDescendantPids} from "../process-tree.mjs";

// collectDescendantPids 的遍历逻辑是 process-tree 修复的核心：必须能走到孙进程——
// 原实现只 kill 直接子进程，孤儿化孙进程（如 Remotion Studio 派生的 Chromium）。
// 这里用注入的 childrenOf 覆盖遍历，不依赖真实 pgrep/进程，避免跨平台/时序 flaky。

test("collectDescendantPids BFS 遍历整棵后代树（含孙进程）", () => {
  // 树：1 → {2,3}，2 → {4}，3 → {}，4 → {}
  const childrenOf = (pid) => ({1: [2, 3], 2: [4], 3: [], 4: []}[pid] ?? []);
  assert.deepEqual(collectDescendantPids(1, childrenOf).sort(), [1, 2, 3, 4]);
});

test("collectDescendantPids 防御性地处理环（seen 守卫不死循环）", () => {
  // 即便 childrenOf 错误地报告了环（2→1），也不应死循环。
  const childrenOf = (pid) => (pid === 1 ? [2] : pid === 2 ? [1] : []);
  assert.deepEqual(collectDescendantPids(1, childrenOf).sort(), [1, 2]);
});

test("collectDescendantPids 无子进程时只返回 root", () => {
  assert.deepEqual(collectDescendantPids(42, () => []), [42]);
});

test("collectDescendantPids 多层深链也能走到底", () => {
  // 1→2→3→4→5
  const childrenOf = (pid) => (pid < 5 ? [pid + 1] : []);
  assert.deepEqual(collectDescendantPids(1, childrenOf), [1, 2, 3, 4, 5]);
});
