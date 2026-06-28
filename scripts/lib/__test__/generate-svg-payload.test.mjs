import test from "node:test";
import assert from "node:assert/strict";
import {existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {
  applyGenerateSvgPayload,
  buildGenerateSvgPayloadPrompt,
  buildGenerateSvgTargetPlan,
  parseGenerateSvgPayload,
} from "../generate-svg-payload.mjs";

const sampleSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none"><path d="M48 12L84 84H12Z" fill="#F59E0B"/></svg>';

function loadMock(name) {
  return JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "..", "test", "mock", name), "utf8"));
}

function seedDataScheme() {
  const dir = mkdtempSync(join(tmpdir(), "generate-svg-payload-"));
  mkdirSync(join(dir, "icons"), {recursive: true});
  return dir;
}

test("buildGenerateSvgTargetPlan targets missing generated icons", () => {
  const report = loadMock("generated-report.json");
  const dir = seedDataScheme();

  try {
    const plan = buildGenerateSvgTargetPlan(report, {dataDir: dir});

    assert.deepEqual(plan.targetPaths, [
      "icons/intro-i1.svg",
      "icons/intro-i2.svg",
      "icons/story-1-tab-1.svg",
      "icons/story-1-tab-2.svg",
    ]);
    assert.equal(plan.targets.length, 4);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test("buildGenerateSvgPayloadPrompt asks Claude for marked JSON only", () => {
  const report = loadMock("generated-report.json");
  const dir = seedDataScheme();

  try {
    const plan = buildGenerateSvgTargetPlan(report, {dataDir: dir});
    const prompt = buildGenerateSvgPayloadPrompt({
      promptPrefix: ["skill rules"],
      targets: plan.targets,
      theme: "dark",
      automation: true,
      preflightErrors: ['intro.tabs[0]: missing "icon" field'],
    });

    assert.match(prompt, /BEGIN_GENERATE_SVG_JSON/);
    assert.match(prompt, /END_GENERATE_SVG_JSON/);
    assert.match(prompt, /Do not call tools/);
    assert.match(prompt, /icons\/story-1-tab-1\.svg/);
    assert.match(prompt, /Current report theme: dark/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test("parseGenerateSvgPayload extracts marked JSON payload", () => {
  const payload = parseGenerateSvgPayload(
    `noise\nBEGIN_GENERATE_SVG_JSON\n{"icons":[{"path":"icons/a.svg","svg":"${sampleSvg.replaceAll('"', '\\"')}"}]}\nEND_GENERATE_SVG_JSON\n`,
  );

  assert.equal(payload.icons.length, 1);
  assert.equal(payload.icons[0].path, "icons/a.svg");
});

test("applyGenerateSvgPayload writes SVGs, updates generated data, and mirrors raw story icons", async () => {
  const report = loadMock("generated-report.json");
  const rawReport = loadMock("raw-report.json");
  const dir = seedDataScheme();
  const generatedDataPath = join(dir, "data-generate.json");
  const rawDataPath = join(dir, "data.json");

  writeFileSync(generatedDataPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(rawDataPath, `${JSON.stringify(rawReport, null, 2)}\n`);
  writeFileSync(join(dir, "icons", "orphan.svg"), sampleSvg);

  try {
    const plan = buildGenerateSvgTargetPlan(report, {dataDir: dir});
    const payload = {
      icons: plan.targetPaths.map((path) => ({
        path,
        concept: "test triangle",
        svg: sampleSvg,
      })),
    };

    const result = await applyGenerateSvgPayload({
      payload,
      report,
      targetPlan: plan,
      dataDir: dir,
      generatedDataPath,
      rawDataPath,
    });
    const updatedGenerated = JSON.parse(readFileSync(generatedDataPath, "utf8"));
    const updatedRaw = JSON.parse(readFileSync(rawDataPath, "utf8"));

    assert.equal(result.generated, 4);
    assert.deepEqual(result.prunedIcons, ["icons/orphan.svg"]);
    assert.equal(result.rawUpdated, true);
    assert.equal(updatedGenerated.intro.tabs[0].icon, "icons/intro-i1.svg");
    assert.equal(updatedGenerated.stories[0].tabs[0].icon, "icons/story-1-tab-1.svg");
    assert.equal(updatedRaw.stories[0].tabs[0].icon, "icons/story-1-tab-1.svg");
    assert.equal(updatedRaw.stories[1].tabs[0].icon, undefined);
    assert.equal(existsSync(join(dir, "icons", "orphan.svg")), false);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
