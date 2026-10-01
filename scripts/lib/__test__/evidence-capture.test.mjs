import {test} from "bun:test";
import assert from "node:assert/strict";
import {copyFileSync, mkdtempSync, readFileSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {captureEvidenceTargets, prepareCaptureRegion} from "../evidence-capture.mjs";
import {sha256File} from "../evidence-review.mjs";

const fixture = (name) => join(import.meta.dirname, "fixtures/evidence-capture", name);

test("capture caches unchanged work, detects identical retries and persists target budgets", async () => {
  const directory = mkdtempSync(join(tmpdir(), "capture-test-"));
  let screenshots = 0;
  const plan = {url: "https://example.com/article", targets: [{fact: "SIM options", selector: "#sim", expectedText: ["eSIM"]}]};
  const run = async (args) => {
    if (args[0] === "screenshot") { screenshots++; writeFileSync(args[2], "same pixels"); }
  };
  try {
    const first = await captureEvidenceTargets({plan, directory, run});
    assert.equal(first.results[0].status, "captured");
    const cached = await captureEvidenceTargets({plan, directory, run});
    assert.equal(cached.results[0].cached, true); assert.equal(screenshots, 1);
    const retry = await captureEvidenceTargets({plan, directory, run, retryFact: "SIM options", retryReason: "cookie covered the text"});
    assert.equal(retry.results[0].status, "unchanged");
    const exhausted = await captureEvidenceTargets({plan, directory, run, retryFact: "SIM options", retryReason: "still covered"});
    assert.equal(exhausted.results[0].status, "exhausted"); assert.equal(screenshots, 2);
  } finally { rmSync(directory, {recursive: true, force: true}); }
});
test("different factual regions on one page do not consume each other's capture budget", async () => {
  const directory = mkdtempSync(join(tmpdir(), "capture-test-"));
  const plan = {url: "https://example.com/article", targets: ["workspace", "pipeline", "platforms"].map((fact) => ({fact, selector: `#${fact}`, expectedText: [fact]}))};
  let captures = 0;
  try {
    const result = await captureEvidenceTargets({plan, directory, run: async (args) => {
      if (args[0] === "screenshot") { captures++; writeFileSync(args[2], args[1]); }
    }});
    assert.equal(captures, 3);
    assert.ok(result.results.every((item) => item.status === "captured"));
  } finally { rmSync(directory, {recursive: true, force: true}); }
});
test("failed capture is durable and cannot silently loop after a restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "capture-test-"));
  const plan = {url: "https://example.com/article", targets: [{fact: "release", selector: "#wrong", expectedText: ["version"]}]};
  try {
    const failed = await captureEvidenceTargets({plan, directory, run: async () => { throw new Error("missing target"); }});
    assert.equal(failed.results[0].status, "failed");
    const next = await captureEvidenceTargets({plan, directory, run: async () => { assert.fail("must not retry without a decision"); }});
    assert.equal(next.results[0].status, "needs-decision");
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test("real small blank PNGs need triage while paragraphs and sparse source branding stay usable", async () => {
  const directory = mkdtempSync(join(tmpdir(), "capture-png-test-"));
  const cases = [
    ["blank-paragraph.png", "suspect-blank"], // Real 540x98 / 445-byte element screenshot.
    ["blank-quote.png", "suspect-blank"], // Real 540x173 / 707-byte element screenshot.
    ["text-paragraph.png", "captured"],
    ["source-logo.png", "captured"], // Mostly white, <0.008 bytes/pixel, with readable source text.
  ];
  const plan = {url: "https://example.com/article", targets: cases.map(([name]) =>
    ({fact: name, selector: `#${name}`, expectedText: ["source text"]}))};
  try {
    const result = await captureEvidenceTargets({plan, directory, run: async (args) => {
      if (args[0] === "screenshot") copyFileSync(fixture(args[1].slice(1)), args[2]);
    }});
    assert.deepEqual(result.results.map((entry) => entry.status), cases.map(([, status]) => status));
    for (const entry of result.results.slice(0, 2)) {
      assert.match(entry.error, /Inspect it; if blank/);
      assert.ok(entry.path && entry.sha256);
    }
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test("old captured blank images are reclassified without spending another screenshot attempt", async () => {
  const directory = mkdtempSync(join(tmpdir(), "capture-legacy-test-"));
  const plan = {url: "https://example.com/article", targets: [{fact: "cutoff", selector: "#cutoff", expectedText: ["October 29"]}]};
  try {
    const initial = await captureEvidenceTargets({plan, directory, run: async (args) => {
      if (args[0] === "screenshot") copyFileSync(fixture("text-paragraph.png"), args[2]);
    }});
    const ledger = JSON.parse(readFileSync(initial.ledgerPath, "utf8"));
    const attempts = Object.values(ledger.targets)[0].attempts;
    copyFileSync(fixture("blank-paragraph.png"), attempts[0].path);
    attempts[0].sha256 = sha256File(attempts[0].path);
    delete attempts[0].planFingerprint; // Ledger written before plan-aware caching.
    writeFileSync(initial.ledgerPath, JSON.stringify(ledger));
    const reused = await captureEvidenceTargets({plan, directory, run: async () => {
      assert.fail("Old blank capture must be inspected, not recaptured automatically.");
    }});
    assert.equal(reused.results[0].status, "suspect-blank");
    assert.equal(Object.values(JSON.parse(readFileSync(initial.ledgerPath, "utf8")).targets)[0].attempts.length, 1);
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test("changed capture plans require an explicit retry and keep the original fact budget", async () => {
  const changes = [
    (plan) => { plan.targets[0].expectedText.push("Work and Codex only"); },
    (plan) => { plan.targets[0].selector = "#new-region"; },
    (plan) => { plan.hideSelectors = ["#cookie-banner"]; },
    (plan, ledger) => { delete Object.values(ledger.targets)[0].attempts[0].planFingerprint; },
  ];
  for (const change of changes) {
    const directory = mkdtempSync(join(tmpdir(), "capture-plan-test-"));
    const plan = {url: "https://example.com/article", targets: [{fact: "quota", selector: "#quota", expectedText: ["10x"]}]};
    let screenshots = 0;
    const run = async (args) => {
      if (args[0] === "screenshot") {
        screenshots++;
        copyFileSync(fixture(screenshots === 1 ? "text-paragraph.png" : "source-logo.png"), args[2]);
      }
    };
    try {
      const initial = await captureEvidenceTargets({plan, directory, run});
      const ledger = JSON.parse(readFileSync(initial.ledgerPath, "utf8"));
      change(plan, ledger);
      writeFileSync(initial.ledgerPath, JSON.stringify(ledger));
      const changed = await captureEvidenceTargets({plan, directory, run});
      assert.equal(changed.results[0].status, "needs-decision");
      assert.match(changed.results[0].reason, /fingerprint|changed/);
      assert.equal(screenshots, 1);
      const corrected = await captureEvidenceTargets({plan, directory, run,
        retryFact: "quota", retryReason: "Capture the corrected fact scope."});
      assert.equal(corrected.results[0].status, "captured");
      const cached = await captureEvidenceTargets({plan, directory, run});
      assert.equal(cached.results[0].cached, true);
      const exhausted = await captureEvidenceTargets({plan, directory, run,
        retryFact: "quota", retryReason: "Try a third capture."});
      assert.equal(exhausted.results[0].status, "exhausted");
      assert.equal(screenshots, 2);
    } finally { rmSync(directory, {recursive: true, force: true}); }
  }
});

test("capture preparation waits for paint and rejects targets hidden by CSS", async () => {
  const saved = Object.fromEntries(["window", "document", "location"].map((name) => [name, globalThis[name]]));
  let frames = 0;
  let visible = true;
  let scrolled = false;
  const element = {
    textContent: "Required fact", innerText: "Required fact",
    scrollIntoView: () => { scrolled = true; },
    getBoundingClientRect: () => ({width: 540, height: 98}),
    checkVisibility: (options) => { assert.equal(options.checkOpacity, true); return visible; },
  };
  globalThis.document = {querySelectorAll: () => [element]};
  globalThis.location = {href: "https://example.com/article"};
  globalThis.window = {
    setTimeout, clearTimeout,
    requestAnimationFrame: (callback) => { frames++; Promise.resolve().then(callback); },
  };
  try {
    const target = {selector: "#fact", expectedText: ["Required fact"]};
    const prepared = await prepareCaptureRegion(target, []);
    assert.equal(scrolled, true);
    assert.equal(frames, 2);
    assert.equal(prepared.text, "Required fact");
    visible = false;
    await assert.rejects(prepareCaptureRegion(target, []), /has not painted visibly/);
    visible = true;
    globalThis.window.requestAnimationFrame = () => {}; // A background tab need not deliver frames.
    await prepareCaptureRegion(target, []); // The bounded timer still completes.
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
    }
  }
});
