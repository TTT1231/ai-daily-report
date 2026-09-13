import {test} from "bun:test";
import assert from "node:assert/strict";
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {assetChecks, buildEvidencePreflight, validateEvidencePreflight} from "../evidence-preflight.mjs";

function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), "evidence-preflight-test-"));
  mkdirSync(join(dataDir, "images"));
  writeFileSync(join(dataDir, "images/a.png"), "fixture image a");
  writeFileSync(join(dataDir, "images/b.png"), "fixture image b");
  const report = {stories: [{id: "s", contentTitle: "A release", scenes: [
    {id: "one", subtitle: "Version one", overlayImg: "images/a.png"},
    {id: "two", subtitle: "Two platforms", overlayImg: "images/a.png"},
    {id: "three", subtitle: "Release date", overlayImg: "images/b.png"},
  ]}]};
  const build = (previous) => buildEvidencePreflight(report, {dataDir, previous}).review;
  const check = (review) => validateEvidencePreflight(report, {dataDir, review});
  return {dataDir, report, build, check, close: () => rmSync(dataDir, {recursive: true, force: true})};
}
const approveFixture = (review) => {
  for (const asset of review.assets) {
    asset.source = "https://example.com/fixture";
    asset.checks = Object.fromEntries(assetChecks.map((key) => [key, true]));
  }
  for (const scene of review.scenes) { scene.supportsSubtitle = true; scene.supportNotes = `Fixture visible statement: ${scene.subtitle}`; }
  return review;
};

test("preflight deduplicates assets but never merges independent narration reviews", () => {
  const f = fixture();
  try {
    const review = f.build();
    assert.equal(review.assets.length, 2); assert.equal(review.scenes.length, 3);
    assert.ok(f.check(review).errors.length > 0);
    assert.deepEqual(f.check(approveFixture(review)).errors, []);
    review.scenes[1].supportNotes = "";
    assert.match(f.check(review).errors.join("\n"), /s\/two.*supportNotes/);
  } finally { f.close(); }
});
test("image edit invalidates every dependent claim and retains other asset reviews", () => {
  const f = fixture();
  try {
    const previous = approveFixture(f.build());
    writeFileSync(join(f.dataDir, "images/a.png"), "new crop without old facts");
    assert.ok(f.check(previous).errors.length > 0);
    const next = f.build(previous);
    assert.equal(next.scenes[0].supportsSubtitle, null);
    assert.equal(next.scenes[1].supportsSubtitle, null);
    assert.equal(next.scenes[2].supportsSubtitle, true);
    assert.equal(next.assets[0].checks.unobstructed, null);
    assert.equal(next.assets[1].checks.unobstructed, true);
  } finally { f.close(); }
});
test("subtitle edits invalidate only the edited claim; timing and icons preserve reviews", () => {
  const f = fixture();
  try {
    const previous = approveFixture(f.build());
    f.report.stories[0].scenes[0].timing = {startMs: 1000, durationMs: 5000};
    f.report.stories[0].tabs = [{id: "editorial", icon: "icons/unused.svg"}];
    assert.deepEqual(f.check(previous).errors, []);
    f.report.stories[0].scenes[1].subtitle = "A different factual claim";
    const next = f.build(previous);
    assert.equal(next.scenes[0].supportsSubtitle, true);
    assert.equal(next.scenes[1].supportsSubtitle, null);
    assert.equal(next.assets[0].checks.readable, true);
  } finally { f.close(); }
});
test("renaming identical evidence preserves review; missing/forged mappings do not pass", () => {
  const f = fixture();
  try {
    const previous = approveFixture(f.build());
    copyFileSync(join(f.dataDir, "images/a.png"), join(f.dataDir, "images/c.png"));
    f.report.stories[0].scenes[0].overlayImg = "images/c.png";
    assert.deepEqual(f.check(previous).errors, []);
    previous.scenes[0].subtitle = "tampered";
    assert.ok(f.check(previous).errors.length);
    previous.scenes = [];
    assert.ok(f.check(previous).errors.length >= 3);
  } finally { f.close(); }
});
