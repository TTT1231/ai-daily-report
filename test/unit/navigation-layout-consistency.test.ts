import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  navigationBottomItemMinimumWidth,
  navigationMinimumWidth,
} from "../../src/navigation-layout";

// 渲染侧（TS）对三语言导航宽度 fixture 的核对：期望值由 scripts/lib/
// navigation-layout.mjs 生成，scripts/lib/__test__/navigation-layout-consistency.test.mjs
// 与 ingest/navigation_layout_sync_test.go 分别核对 JS 校验侧与 Go ingest 侧。
// 测试经 `bun run test:unit` 从仓库根目录启动，fixture 用 cwd 相对定位。
const fixture = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "test/fixtures/navigation-width-cases.json"),
    "utf8",
  ),
) as {
  minimumWidth: Array<{ label: string; itemCount: number; expected: number }>;
  bottomItemMinimumWidth: Array<{
    label: string;
    active: boolean;
    expected: number;
  }>;
};

test("render-side navigationMinimumWidth matches the cross-implementation fixture", () => {
  for (const { label, itemCount, expected } of fixture.minimumWidth) {
    const actual = navigationMinimumWidth(label, itemCount);
    if (actual !== expected) {
      assert.fail(
        `minimumWidth(${JSON.stringify(label)}, ${itemCount}) = ${actual}, fixture 期望 ${expected}`,
      );
    }
  }
});

test("render-side navigationBottomItemMinimumWidth matches the cross-implementation fixture", () => {
  for (const { label, active, expected } of fixture.bottomItemMinimumWidth) {
    const actual = navigationBottomItemMinimumWidth(label, active);
    if (actual !== expected) {
      assert.fail(
        `bottomItemMinimumWidth(${JSON.stringify(label)}, ${active}) = ${actual}, fixture 期望 ${expected}`,
      );
    }
  }
});
