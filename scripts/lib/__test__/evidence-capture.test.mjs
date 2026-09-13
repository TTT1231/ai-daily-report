import {test} from "bun:test";
import assert from "node:assert/strict";
import {mkdtempSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {captureEvidenceTargets} from "../evidence-capture.mjs";

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
