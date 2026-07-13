import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dailyReportSchema } from "../../src/daily-report-data";
// @ts-expect-error report-validation is a plain ESM module without a declaration file.
import { validateReport } from "../../scripts/lib/report-validation.mjs";

const projectRoot = resolve(__dirname, "../..");

for (const sample of [1, 2]) {
  for (const filename of ["data.json", "data-generate.json"] as const) {
    test(`demo sample-${sample}/${filename} stays within current report limits`, () => {
      const path = resolve(
        projectRoot,
        `demo/data-scheme-sample-${sample}/${filename}`,
      );
      const report = JSON.parse(readFileSync(path, "utf8"));
      const renderMode = filename === "data-generate.json";
      if (renderMode) dailyReportSchema.parse(report);

      // validateReport's production schema reference is relative to data-scheme/;
      // demo fixtures live one directory deeper but use the same schema file.
      const validationInput = structuredClone(report);
      validationInput.$schema = "../config/data.schema.json";
      const result = validateReport(validationInput, {
        renderMode,
        checkAssets: false,
      });
      assert.deepEqual(result.errors, []);
    });
  }
}
