import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, mkdir, writeFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {collectMissingImageAssets} from "../asset-check.mjs";

// D 的核心契约：dev.mjs 在图片被删/改时，需要精确指出哪些 overlayImg/icon 引用
// 现在指向了不存在的文件（否则 Remotion <Img> 会 cancelRender 且永不自愈）。
// collectMissingImageAssets 是纯函数：吃 report + dataDir，吐 missing 列表。
test("collectMissingImageAssets reports overlayImg and icon refs that no longer exist", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "asset-check-"));
  await mkdir(join(dataDir, "images"), {recursive: true});
  await mkdir(join(dataDir, "icons"), {recursive: true});
  // 存在的资产
  await writeFile(join(dataDir, "images/present.png"), Buffer.alloc(8));
  await writeFile(join(dataDir, "icons/present.svg"), Buffer.alloc(8));

  const report = {
    intro: {
      id: "intro",
      tabs: [{id: "g1", icon: "icons/missing-intro.svg"}],
      scenes: [{id: "intro-greeting"}],
    },
    stories: [
      {
        id: "s1",
        tabs: [{id: "t1"}],
        scenes: [
          {id: "s1-scene-1", overlayImg: "images/present.png"}, // 存在
          {id: "s1-scene-2", overlayImg: "images/gone.jpg"}, // 缺失
        ],
      },
    ],
    outro: {id: "outro", scenes: [{id: "outro-ending"}]},
  };

  const missing = collectMissingImageAssets(report, dataDir);

  assert.equal(missing.length, 2, "一处 icon 缺失 + 一处 overlayImg 缺失");
  const owners = missing.map((m) => m.owner).sort();
  assert.deepEqual(owners, ["intro/g1.icon", "s1/s1-scene-2.overlayImg"]);
  const refs = missing.map((m) => m.ref).sort();
  assert.deepEqual(refs, ["icons/missing-intro.svg", "images/gone.jpg"]);

  await rm(dataDir, {recursive: true, force: true});
});

test("collectMissingImageAssets ignores assets that still exist on disk", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "asset-check-"));
  await mkdir(join(dataDir, "images"), {recursive: true});
  await writeFile(join(dataDir, "images/ok.png"), Buffer.alloc(8));

  const report = {
    stories: [
      {id: "s1", tabs: [], scenes: [{id: "s1-1", overlayImg: "images/ok.png"}]},
    ],
  };

  assert.deepEqual(collectMissingImageAssets(report, dataDir), []);

  await rm(dataDir, {recursive: true, force: true});
});

test("collectMissingImageAssets returns empty for non-report input and ignores empty refs", () => {
  assert.deepEqual(collectMissingImageAssets(null, "/tmp"), []);
  assert.deepEqual(collectMissingImageAssets({}, "/tmp"), []);
  // 没有 overlayImg/icon 字段的 scene/tab 不应报错
  assert.deepEqual(
    collectMissingImageAssets(
      {stories: [{id: "s", tabs: [{}], scenes: [{id: "s1"}]}]},
      "/tmp",
    ),
    [],
  );
});
