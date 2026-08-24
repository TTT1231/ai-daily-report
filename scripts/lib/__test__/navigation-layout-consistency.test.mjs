import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  navigationBottomItemMinimumWidth,
  navigationMinimumWidth,
} from "../navigation-layout.mjs";

// 导航宽度算法在 JS（校验）/ TS（渲染）/ Go（ingest）三处手工维护，是最容易
// 漂移的地方。test/fixtures/navigation-width-cases.json 钉住「同一输入 → 同一宽度」：
// 本文件核对 JS 校验侧；test/unit/navigation-layout-consistency.test.ts 核对 TS
// 渲染侧；ingest/navigation_layout_sync_test.go 核对 Go ingest 侧。任一实现漂移
// 都会在对应测试失败，逼迫三处一起改。
const fixture = JSON.parse(
  readFileSync(
    resolve(
      import.meta.dirname,
      "../../../test/fixtures/navigation-width-cases.json",
    ),
    "utf8",
  ),
);

test("navigationMinimumWidth matches the cross-implementation fixture", () => {
  for (const { label, itemCount, expected } of fixture.minimumWidth) {
    const actual = navigationMinimumWidth(label, itemCount);
    if (actual !== expected) {
      assert.fail(
        `minimumWidth(${JSON.stringify(label)}, ${itemCount}) = ${actual}, fixture 期望 ${expected}`,
      );
    }
  }
});

test("navigationBottomItemMinimumWidth matches the cross-implementation fixture", () => {
  for (const { label, active, expected } of fixture.bottomItemMinimumWidth) {
    const actual = navigationBottomItemMinimumWidth(label, active);
    if (actual !== expected) {
      assert.fail(
        `bottomItemMinimumWidth(${JSON.stringify(label)}, ${active}) = ${actual}, fixture 期望 ${expected}`,
      );
    }
  }
});
