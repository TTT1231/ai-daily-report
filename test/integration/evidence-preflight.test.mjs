import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {spawnSync} from "node:child_process";

test("preflight CLI blocks missing/stale reviews and preserves untouched approvals across TTS", () => {
  const directory = mkdtempSync(join(tmpdir(), "evidence-cli-test-"));
  const path = join(directory, "evidence-preflight.json");
  const factsPath = join(directory, "facts.json");
  mkdirSync(join(directory, "images"));
  writeFileSync(join(directory, "images/a.png"), "fixture pixels");
  const report = {stories: [{id: "s", contentTitle: "fixture", scenes: [{id: "a", subtitle: "visible fact", overlayImg: "images/a.png"}]}]};
  writeFileSync(factsPath, JSON.stringify({facts: [{id: "fact", storyId: "s", source: "https://example.com/fixture",
    excerpt: "Visible fact for preview users.", statement: "visible fact", qualifiers: ["preview users"]}],
    scenes: [{storyId: "s", sceneId: "a", factIds: ["fact"]}]}));
  const saveReport = () => {
    writeFileSync(join(directory, "data.json"), JSON.stringify(report));
    writeFileSync(join(directory, "data-generate.json"), JSON.stringify(report));
  };
  const run = (...args) => spawnSync(process.execPath, [resolve("scripts/checks/evidence-preflight.mjs"), ...args],
    {env: {...process.env, DATA_SCHEME_DIR: directory}, encoding: "utf8"});
  try {
    saveReport();
    assert.equal(run("--render").status, 1);
    assert.equal(run("--prepare", `--facts=${factsPath}`).status, 0);
    assert.equal(run("--render").status, 1);
    const review = JSON.parse(readFileSync(path));
    review.assets[0].source = "https://example.com/fixture";
    for (const check of Object.keys(review.assets[0].checks)) review.assets[0].checks[check] = true;
    review.scenes[0].supportsSubtitle = true;
    review.scenes[0].qualifiersPreserved = true;
    review.scenes[0].supportNotes = "Fixture paragraph explicitly states visible fact.";
    review.editorial[0].supportsEditorial = true;
    review.editorial[0].qualifiersPreserved = true;
    review.editorial[0].supportNotes = "Title matches the sourced preview release.";
    writeFileSync(path, JSON.stringify(review));
    report.stories[0].scenes[0].timing = {startMs: 0, durationMs: 3000};
    saveReport();
    assert.equal(run("--render").status, 0);
    writeFileSync(factsPath, "null");
    const badLedger = run("--prepare", `--facts=${factsPath}`);
    assert.equal(badLedger.status, 1);
    assert.match(badLedger.stderr, /facts/);
    assert.equal(readFileSync(path, "utf8"), JSON.stringify(review));
    const changedTabs = structuredClone(report);
    changedTabs.stories[0].tabs = [{id: "new", title: "New claim", summary: "Additional factual claim."}];
    writeFileSync(join(directory, "data.json"), JSON.stringify(changedTabs));
    const staleTabs = run("--render");
    assert.equal(staleTabs.status, 1);
    assert.match(staleTabs.stderr, /Generated evidence differs from Raw/);
    saveReport();
    const changedRaw = structuredClone(report);
    changedRaw.stories[0].scenes[0].subtitle = "New unreviewed narration";
    writeFileSync(join(directory, "data.json"), JSON.stringify(changedRaw));
    const stale = run("--render");
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /Generated evidence differs from Raw/);
    saveReport();
    writeFileSync(join(directory, "images/a.png"), "cropped pixels");
    assert.equal(run("--render").status, 1);
    assert.equal(run("--prepare").status, 0);
    assert.equal(JSON.parse(readFileSync(path)).scenes[0].supportsSubtitle, null);
  } finally { rmSync(directory, {recursive: true, force: true}); }
});
