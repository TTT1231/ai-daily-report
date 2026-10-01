import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import {
  validateEvidenceCoverage,
  validateReportEvidence,
} from "../evidence-validation.mjs";

test("evidence checks skip malformed shapes and still report healthy sibling failures", () => {
  const report = {
    stories: [
      null,
      { scenes: "invalid" },
      {
        id: "usable",
        scenes: [
          null,
          { id: "missing-file", overlayImg: "images/does-not-exist.png" },
          { id: "missing-evidence" },
        ],
      },
    ],
  };
  const result = validateReportEvidence(report, {
    dataDir: resolve("test/mock"),
  });
  assert.ok(
    result.errors.some(
      (error) =>
        error.includes("usable/missing-file") &&
        error.includes("file does not exist"),
    ),
  );
  assert.ok(
    result.errors.some(
      (error) =>
        error.includes("usable/missing-evidence") &&
        error.includes("every narration scene"),
    ),
  );
  assert.equal(result.overlayCount, 1);
});

test("evidence checks tolerate non-object roots and non-array story lists", () => {
  for (const report of [null, [], "invalid", { stories: "invalid" }]) {
    assert.deepEqual(validateEvidenceCoverage(report), []);
    const result = validateReportEvidence(report, {
      dataDir: resolve("test/mock"),
    });
    assert.deepEqual(result.errors, []);
    assert.equal(result.overlayCount, 0);
  }
});
