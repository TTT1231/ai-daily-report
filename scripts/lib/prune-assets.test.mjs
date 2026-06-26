import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, mkdir, writeFile, rm} from "node:fs/promises";
import {existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {
  collectReferencedAssets,
  findUnreferenced,
  pruneUnreferencedAssets,
} from "./prune-assets.mjs";

// ── collectReferencedAssets ─────────────────────────────────────────────────

test("collectReferencedAssets gathers overlayImg / tab.icon / audioSrc across intro+stories+outro", () => {
  const report = {
    intro: {
      id: "intro",
      tabs: [{id: "g1", icon: "icons/intro-group-1.svg"}],
      scenes: [
        {id: "intro-greeting", overlayImg: "images/intro.png", audioSrc: "audio/intro-greeting.mp3"},
      ],
    },
    stories: [
      {
        id: "s1",
        tabs: [{id: "t1", icon: "icons/s1-tab-1.svg"}, {id: "t2"}],
        scenes: [
          {id: "s1c1", overlayImg: "images/a.png", audioSrc: "audio/s1c1.mp3"},
          {id: "s1c2", audioSrc: "audio/s1c2.mp3"},
        ],
      },
    ],
    outro: {
      id: "outro",
      scenes: [{id: "outro-ending", audioSrc: "audio/outro-ending.mp3"}],
    },
  };

  const refs = collectReferencedAssets([report]);

  assert.deepEqual([...refs.images].sort(), ["images/a.png", "images/intro.png"]);
  assert.deepEqual([...refs.icons].sort(), ["icons/intro-group-1.svg", "icons/s1-tab-1.svg"]);
  assert.deepEqual(
    [...refs.audio].sort(),
    ["audio/intro-greeting.mp3", "audio/outro-ending.mp3", "audio/s1c1.mp3", "audio/s1c2.mp3"],
  );
});

test("collectReferencedAssets unions multiple reports and skips falsy/non-string refs", () => {
  const refs = collectReferencedAssets([
    {
      stories: [
        {
          id: "s1",
          tabs: [{id: "t1", icon: "icons/a.svg"}, {id: "t2", icon: ""}, {id: "t3", icon: null}],
          scenes: [{id: "c1", overlayImg: "images/a.png"}],
        },
      ],
    },
    {
      stories: [
        {
          id: "s2",
          tabs: [{id: "t1", icon: "icons/b.svg"}],
          scenes: [{id: "c1", overlayImg: "images/a.png", audioSrc: "audio/b.mp3"}],
        },
      ],
    },
  ]);

  assert.deepEqual([...refs.images], ["images/a.png"]); // deduped across reports
  assert.deepEqual([...refs.icons].sort(), ["icons/a.svg", "icons/b.svg"]);
  assert.deepEqual([...refs.audio], ["audio/b.mp3"]);
});

// ── findUnreferenced ────────────────────────────────────────────────────────

test("findUnreferenced returns only allowlist orphan files, skipping dotfiles and other extensions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "prune-find-"));
  try {
    await writeFile(join(dir, "keep.png"), "x");
    await writeFile(join(dir, "orphan.png"), "x");
    await writeFile(join(dir, "ignore.txt"), "x"); // non-allowlist ext
    await writeFile(join(dir, ".gitkeep"), ""); // dotfile

    const orphan = findUnreferenced(dir, "images", new Set(["images/keep.png"]), ["png", "jpg"]);

    assert.equal(orphan.length, 1);
    assert.equal(orphan[0].ref, "images/orphan.png");
    assert.equal(orphan[0].abs, join(dir, "orphan.png"));
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test("findUnreferenced returns empty when every asset file is referenced", async () => {
  const dir = await mkdtemp(join(tmpdir(), "prune-find-"));
  try {
    await writeFile(join(dir, "a.svg"), "x");
    await writeFile(join(dir, "b.svg"), "x");
    const orphan = findUnreferenced(
      dir,
      "icons",
      new Set(["icons/a.svg", "icons/b.svg"]),
      ["svg"],
    );
    assert.deepEqual(orphan, []);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

// ── pruneUnreferencedAssets ─────────────────────────────────────────────────

async function setupDataDir({withRaw = true, withGenerated = true} = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), "prune-"));
  for (const sub of ["images", "icons", "audio"]) await mkdir(join(dataDir, sub));

  if (withRaw) {
    await writeFile(
      join(dataDir, "data.json"),
      JSON.stringify({
        date: "2026-06-26",
        stories: [
          {
            id: "s1",
            tabs: [{id: "t1", icon: "icons/keep.svg"}],
            scenes: [{id: "s1c1", overlayImg: "images/keep.png"}],
          },
        ],
      }),
    );
  }
  if (withGenerated) {
    await writeFile(
      join(dataDir, "data-generate.json"),
      JSON.stringify({
        date: "2026-06-26",
        stories: [
          {
            id: "s1",
            tabs: [{id: "t1", icon: "icons/keep.svg"}],
            scenes: [{id: "s1c1", overlayImg: "images/keep.png", audioSrc: "audio/keep.mp3"}],
          },
        ],
      }),
    );
  }
  // referenced: keep.{png,svg,mp3}; orphans below
  await writeFile(join(dataDir, "images", "keep.png"), "x");
  await writeFile(join(dataDir, "images", "orphan.png"), "x");
  await writeFile(join(dataDir, "icons", "keep.svg"), "x");
  await writeFile(join(dataDir, "icons", "orphan.svg"), "x");
  await writeFile(join(dataDir, "audio", "keep.mp3"), "x");
  await writeFile(join(dataDir, "audio", "orphan.mp3"), "x");
  // non-asset file that must always be left alone
  await writeFile(join(dataDir, "images", ".gitkeep"), "");

  return dataDir;
}

test("pruneUnreferencedAssets dry-run lists orphans but deletes nothing", async () => {
  const dataDir = await setupDataDir({withRaw: true, withGenerated: true});
  try {
    const summary = await pruneUnreferencedAssets({dataDir, dryRun: true});

    assert.equal(summary.dryRun, true);
    assert.deepEqual(summary.images.deleted, ["images/orphan.png"]);
    assert.equal(summary.images.kept, 1);
    assert.deepEqual(summary.icons.deleted, ["icons/orphan.svg"]);
    assert.deepEqual(summary.audio.deleted, ["audio/orphan.mp3"]);

    // nothing actually deleted
    assert.ok(existsSync(join(dataDir, "images", "orphan.png")));
    assert.ok(existsSync(join(dataDir, "icons", "orphan.svg")));
    assert.ok(existsSync(join(dataDir, "audio", "orphan.mp3")));
  } finally {
    await rm(dataDir, {recursive: true, force: true});
  }
});

test("pruneUnreferencedAssets deletes orphans, keeps referenced, leaves non-asset files", async () => {
  const dataDir = await setupDataDir({withRaw: true, withGenerated: true});
  try {
    const summary = await pruneUnreferencedAssets({dataDir, dryRun: false});

    assert.equal(summary.dryRun, false);
    assert.ok(!existsSync(join(dataDir, "images", "orphan.png")));
    assert.ok(!existsSync(join(dataDir, "icons", "orphan.svg")));
    assert.ok(!existsSync(join(dataDir, "audio", "orphan.mp3")));

    assert.ok(existsSync(join(dataDir, "images", "keep.png")));
    assert.ok(existsSync(join(dataDir, "icons", "keep.svg")));
    assert.ok(existsSync(join(dataDir, "audio", "keep.mp3")));

    assert.ok(existsSync(join(dataDir, "images", ".gitkeep")), "dotfile untouched");
  } finally {
    await rm(dataDir, {recursive: true, force: true});
  }
});

test("pruneUnreferencedAssets skips audio (keeps all audio files) when data-generate.json is missing", async () => {
  const dataDir = await setupDataDir({withRaw: true, withGenerated: false});
  try {
    const summary = await pruneUnreferencedAssets({dataDir, dryRun: false});

    // images/icons still pruned from data.json
    assert.deepEqual(summary.images.deleted, ["images/orphan.png"]);
    assert.deepEqual(summary.icons.deleted, ["icons/orphan.svg"]);
    // audio skipped entirely — no source for audio refs
    assert.equal(summary.audio, null);
    assert.ok(summary.skipped.length > 0);
    // ALL audio files remain (we can't judge refs without data-generate.json)
    assert.ok(existsSync(join(dataDir, "audio", "keep.mp3")));
    assert.ok(existsSync(join(dataDir, "audio", "orphan.mp3")));
  } finally {
    await rm(dataDir, {recursive: true, force: true});
  }
});

test("pruneUnreferencedAssets skips everything and deletes nothing when both JSON files are missing", async () => {
  const dataDir = await setupDataDir({withRaw: false, withGenerated: false});
  try {
    const summary = await pruneUnreferencedAssets({dataDir, dryRun: false});

    assert.equal(summary.images, null);
    assert.equal(summary.icons, null);
    assert.equal(summary.audio, null);
    assert.ok(summary.skipped.length > 0);
    assert.ok(existsSync(join(dataDir, "images", "orphan.png")));
    assert.ok(existsSync(join(dataDir, "icons", "orphan.svg")));
    assert.ok(existsSync(join(dataDir, "audio", "orphan.mp3")));
  } finally {
    await rm(dataDir, {recursive: true, force: true});
  }
});
