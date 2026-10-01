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
  const report = {stories: [{id: "s", contentTitle: "A release", introTitle: "Release overview",
    tabs: [{id: "editorial", title: "Platforms", summary: "Two supported platforms."}], scenes: [
    {id: "one", subtitle: "Version one", overlayImg: "images/a.png"},
    {id: "two", subtitle: "Two platforms", overlayImg: "images/a.png"},
    {id: "three", subtitle: "Release date", overlayImg: "images/b.png"},
  ]}]};
  const factLedger = {facts: [
    {id: "version", storyId: "s", source: "https://example.com/release", excerpt: "Version one in preview.", statement: "Version one", qualifiers: ["preview"]},
    {id: "platforms", storyId: "s", source: "https://example.com/release", excerpt: "Available on two desktop platforms.", statement: "Two platforms", qualifiers: ["desktop"]},
    {id: "date", storyId: "s", source: "https://example.com/release", excerpt: "Preview release date is next month.", statement: "Release date", qualifiers: ["preview"]},
  ], scenes: ["version", "platforms", "date"].map((id, index) => ({storyId: "s", sceneId: report.stories[0].scenes[index].id, factIds: [id]}))};
  const build = (previous) => buildEvidencePreflight(report, {dataDir, previous, factLedger}).review;
  const check = (review) => validateEvidencePreflight(report, {dataDir, review});
  return {dataDir, report, factLedger, build, check, close: () => rmSync(dataDir, {recursive: true, force: true})};
}
const approveFixture = (review) => {
  for (const asset of review.assets) {
    asset.source = "https://example.com/fixture";
    asset.checks = Object.fromEntries(assetChecks.map((key) => [key, true]));
  }
  for (const scene of review.scenes) {
    scene.supportsSubtitle = true; scene.qualifiersPreserved = true;
    scene.supportNotes = `Fixture visible statement: ${scene.subtitle}`;
  }
  for (const item of review.editorial ?? []) {
    item.supportsEditorial = true; item.qualifiersPreserved = true;
    item.supportNotes = "Fixture editorial matches the sourced release statements and their conditions.";
  }
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
    f.report.stories[0].tabs[0].icon = "icons/unused.svg";
    assert.deepEqual(f.check(previous).errors, []);
    f.report.stories[0].scenes[1].subtitle = "A different factual claim";
    const next = f.build(previous);
    assert.equal(next.scenes[0].supportsSubtitle, true);
    assert.equal(next.scenes[1].supportsSubtitle, null);
    assert.equal(next.assets[0].checks.readable, true);
  } finally { f.close(); }
});

test("source conditions and quotations invalidate only dependent narration and editorial reviews", () => {
  const f = fixture();
  try {
    const previous = approveFixture(f.build());
    f.factLedger.facts[1].qualifiers = ["desktop", "paid users"];
    f.factLedger.facts[1].excerpt = "Available on two desktop platforms for paid users.";
    const next = f.build(previous);
    assert.equal(next.scenes[0].supportsSubtitle, true);
    assert.equal(next.scenes[1].supportsSubtitle, null);
    assert.equal(next.scenes[1].qualifiersPreserved, null);
    assert.equal(next.scenes[2].supportsSubtitle, true);
    assert.equal(next.editorial[0].supportsEditorial, null);
    assert.equal(next.assets[0].checks.readable, true);
    assert.match(f.check(next).errors.join("\n"), /scope and conditions/);
  } finally { f.close(); }
});

test("tab and introTitle edits require a new editorial judgement without rereviewing identical images", () => {
  const f = fixture();
  try {
    const previous = approveFixture(f.build());
    f.report.stories[0].tabs[0].summary = "Available on every platform.";
    assert.match(f.check(previous).errors.join("\n"), /title\/introTitle\/Tabs.*stale/);
    const next = f.build(previous);
    assert.equal(next.editorial[0].qualifiersPreserved, null);
    assert.ok(next.scenes.every((scene) => scene.supportsSubtitle === true));
    assert.ok(next.assets.every((asset) => asset.checks.readable === true));
    const approved = approveFixture(next);
    f.report.stories[0].introTitle = "Available everywhere";
    assert.match(f.check(approved).errors.join("\n"), /title\/introTitle\/Tabs.*stale/);
    const beforeTitle = approveFixture(f.build(approved));
    f.report.stories[0].contentTitle = "A new editorial title";
    const titleEdit = f.build(beforeTitle);
    assert.ok(titleEdit.scenes.every((scene) => scene.supportsSubtitle === true));
    assert.equal(titleEdit.editorial[0].supportsEditorial, null);
    assert.match(f.check(beforeTitle).errors.join("\n"), /title\/introTitle\/Tabs.*stale/);
  } finally { f.close(); }
});

test("an explicitly supplied malformed ledger never falls back to previously approved facts", () => {
  const f = fixture();
  try {
    const previous = approveFixture(f.build());
    for (const factLedger of [null, {scenes: f.factLedger.scenes}, {facts: null, scenes: f.factLedger.scenes}, {facts: f.factLedger.facts}]) {
      const next = buildEvidencePreflight(f.report, {dataDir: f.dataDir, previous, factLedger});
      assert.ok(next.errors.length, "Malformed replacement ledger must be rejected");
    }
    assert.deepEqual(buildEvidencePreflight(f.report, {dataDir: f.dataDir, previous}).errors, []);
  } finally { f.close(); }
});

test("booleans alone cannot approve a new review without sourced facts and scope judgements", () => {
  const f = fixture();
  try {
    const {review} = buildEvidencePreflight(f.report, {dataDir: f.dataDir});
    const checked = f.check(approveFixture(review));
    assert.match(checked.errors.join("\n"), /source fact references required/);
    const withFacts = approveFixture(f.build());
    withFacts.scenes[0].qualifiersPreserved = null;
    assert.match(f.check(withFacts).errors.join("\n"), /scope and conditions/);
    const invalid = JSON.parse(JSON.stringify(f.factLedger));
    invalid.scenes[0].factIds = ["missing"];
    assert.match(buildEvidencePreflight(f.report, {dataDir: f.dataDir, factLedger: invalid}).errors.join("\n"), /unknown fact missing/);
    invalid.facts[0].excerpt = "";
    assert.match(buildEvidencePreflight(f.report, {dataDir: f.dataDir, factLedger: invalid}).errors.join("\n"), /excerpt/);
  } finally { f.close(); }
});

test("legacy completed reviews remain valid, but new preparation migrates them to pending factual review", () => {
  const f = fixture();
  try {
    const previous = approveFixture(buildEvidencePreflight(f.report, {dataDir: f.dataDir, schemaVersion: 1}).review);
    assert.deepEqual(f.check(previous).errors, []);
    const next = f.build(previous);
    assert.equal(next.schemaVersion, 2);
    assert.ok(next.scenes.every((scene) => scene.supportsSubtitle === null));
    assert.ok(next.assets.every((asset) => asset.checks.readable === true));
    assert.ok(f.check(next).errors.length);
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
