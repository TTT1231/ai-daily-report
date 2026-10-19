import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {newsCopyTemplateIssues} from "../news-copy.mjs";
import {validateTone} from "../tone-validation.mjs";
import {validateReport} from "../report-validation.mjs";

const cases = JSON.parse(readFileSync(new URL("../../../test/fixtures/news-copy-cases.json", import.meta.url), "utf8"));

for (const {name, text, codes} of cases) {
  test(`spoken copy: ${name}`, () => {
    assert.deepEqual(newsCopyTemplateIssues(text).map(({code}) => code), codes);
    const report = {stories: [{tabs: [{summary: text}], scenes: [{subtitle: text}]}]};
    const original = JSON.stringify(report);
    const {errors} = validateTone(report);
    const rawErrors = validateReport(report, {checkAssets: false}).errors;
    if (codes.length === 0) assert.deepEqual(errors, [], "necessary attribution and real source events remain valid");
    for (const code of codes) {
      assert.ok(errors.some((error) => error.includes(`tabs[0].summary: news-copy template [${code}]`)));
      assert.ok(errors.some((error) => error.includes(`scenes[0].subtitle: news-copy template [${code}]`)));
      assert.ok(rawErrors.some((error) => error.includes(`scenes[0].subtitle: news-copy template [${code}]`)), "ordinary Raw validation must also block the draft");
    }
    assert.equal(JSON.stringify(report), original, "checks must not rewrite facts");
  });
}
