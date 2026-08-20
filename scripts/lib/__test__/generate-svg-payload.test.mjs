import test from "node:test";
import assert from "node:assert/strict";
import {existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {
  applyGenerateSvgPayload,
  buildGenerateSvgPayloadPrompt,
  buildGenerateSvgTargetPlan,
  formatRetryReason,
  parseGenerateSvgPayload,
} from "../generate-svg-payload.mjs";

const sampleSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none"><path d="M48 12L84 84H12Z" fill="#F59E0B"/></svg>';
const distinctSampleSvgs = [
  sampleSvg,
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><circle cx="48" cy="48" r="30" fill="#2563EB"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect x="18" y="24" width="60" height="48" rx="8" fill="#10B981"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><path d="m48 12 36 36-36 36-36-36Z" fill="#EC4899"/></svg>',
];

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

test("buildGenerateSvgPayloadPrompt asks Claude for schema-constrained JSON only", () => {
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

    assert.match(prompt, /CLI JSON schema/);
    assert.doesNotMatch(prompt, /BEGIN_GENERATE_SVG_JSON/);
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

test("parseGenerateSvgPayload reads Claude CLI structured_output envelopes", () => {
  const payload = parseGenerateSvgPayload(
    JSON.stringify({
      type: "result",
      structured_output: {
        icons: [{path: "icons/a.svg", concept: "triangle", svg: sampleSvg}],
      },
    }),
  );

  assert.equal(payload.icons[0].concept, "triangle");
  assert.equal(payload.icons[0].svg, sampleSvg);
});

test("formatRetryReason classifies spawn/timeout/exit kinds and falls back for plain errors", () => {
  const spawn = new Error("enoent");
  spawn.kind = "claude-spawn";
  assert.equal(formatRetryReason(spawn).retryable, false);
  assert.match(formatRetryReason(spawn).label, /无法启动/);

  const timeout = new Error("5min");
  timeout.kind = "claude-timeout";
  assert.equal(formatRetryReason(timeout).retryable, true);
  assert.match(formatRetryReason(timeout).label, /超时/);

  const exit = new Error("exit 1");
  exit.kind = "claude-exit";
  assert.equal(formatRetryReason(exit).retryable, true);
  assert.match(formatRetryReason(exit).label, /非零退出/);

  // payload 解析 / SVG 校验抛的是普通 Error（无 kind），视为可重试的校验失败。
  const plain = new Error("missing icon: icons/x.svg");
  assert.equal(formatRetryReason(plain).retryable, true);
  assert.match(formatRetryReason(plain).label, /校验失败/);
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
      icons: plan.targetPaths.map((path, index) => ({
        path,
        concept: "test distinct artwork",
        svg: distinctSampleSvgs[index],
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

test("applyGenerateSvgPayload splits a shared same-story icon path into independent targets", async () => {
  const report = loadMock("generated-report.json");
  report.stories = [];
  report.intro.tabs[0].icon = "icons/shared.svg";
  report.intro.tabs[1].icon = "icons/shared.svg";
  const rawReport = {stories: []};
  const dir = seedDataScheme();
  const generatedDataPath = join(dir, "data-generate.json");
  const rawDataPath = join(dir, "data.json");

  writeFileSync(generatedDataPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(rawDataPath, `${JSON.stringify(rawReport, null, 2)}\n`);

  try {
    const plan = buildGenerateSvgTargetPlan(report, {dataDir: dir});
    assert.deepEqual(plan.targetPaths, [
      "icons/shared.svg",
      "icons/intro-i2.svg",
    ]);
    assert.deepEqual(
      plan.targets.map((target) => target.tabs.map((tab) => tab.id)),
      [["i1"], ["i2"]],
    );

    const payload = {
      icons: plan.targetPaths.map((path, index) => ({
        path,
        concept: "shared-path repair fixture",
        svg: distinctSampleSvgs[index],
      })),
    };
    await applyGenerateSvgPayload({
      payload,
      report,
      targetPlan: plan,
      dataDir: dir,
      generatedDataPath,
      rawDataPath,
    });

    const updated = JSON.parse(readFileSync(generatedDataPath, "utf8"));
    assert.equal(updated.intro.tabs[0].icon, "icons/shared.svg");
    assert.equal(updated.intro.tabs[1].icon, "icons/intro-i2.svg");
    assert.notEqual(updated.intro.tabs[0].icon, updated.intro.tabs[1].icon);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test("applyGenerateSvgPayload rejects duplicate same-story palettes before touching disk", async () => {
  const report = loadMock("generated-report.json");
  const rawReport = loadMock("raw-report.json");
  const dir = seedDataScheme();
  const generatedDataPath = join(dir, "data-generate.json");
  const rawDataPath = join(dir, "data.json");

  const generatedBefore = `${JSON.stringify(report, null, 2)}\n`;
  const rawBefore = `${JSON.stringify(rawReport, null, 2)}\n`;
  writeFileSync(generatedDataPath, generatedBefore);
  writeFileSync(rawDataPath, rawBefore);
  writeFileSync(join(dir, "icons", "orphan.svg"), sampleSvg);

  try {
    const plan = buildGenerateSvgTargetPlan(report, {dataDir: dir});
    // intro 的两个 tab 使用完全相同的图形与配色：必须在校验阶段被拒，
    // 且不写入任何 SVG、不改写两份 JSON、不删除孤儿文件。
    const payload = {
      icons: plan.targetPaths.map((path, index) => ({
        path,
        concept: "duplicate palette fixture",
        svg: index < 2 ? sampleSvg : distinctSampleSvgs[index],
      })),
    };

    await assert.rejects(
      applyGenerateSvgPayload({payload, report, targetPlan: plan, dataDir: dir, generatedDataPath, rawDataPath}),
      /icon (artwork|palette) duplicates/,
    );
    for (const iconPath of plan.targetPaths) {
      assert.equal(existsSync(join(dir, iconPath)), false, `${iconPath} must not be written`);
    }
    assert.equal(readFileSync(generatedDataPath, "utf8"), generatedBefore);
    assert.equal(readFileSync(rawDataPath, "utf8"), rawBefore);
    assert.equal(existsSync(join(dir, "icons", "orphan.svg")), true);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test("applyGenerateSvgPayload rolls back written files when a later step fails", async () => {
  const report = loadMock("generated-report.json");
  const rawReport = loadMock("raw-report.json");
  const dir = seedDataScheme();
  // 指向不存在目录的 JSON 路径让"写 SVG 之后、收尾之前"的一步失败，触发回滚。
  const generatedDataPath = join(dir, "missing-dir", "data-generate.json");
  const rawDataPath = join(dir, "data.json");

  const oldIconPath = join(dir, "icons", "intro-i1.svg");
  const oldIconContent = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 96 96\"/><!--old-->";
  const rawBefore = `${JSON.stringify(rawReport, null, 2)}\n`;
  writeFileSync(oldIconPath, oldIconContent);
  writeFileSync(rawDataPath, rawBefore);
  writeFileSync(join(dir, "icons", "orphan.svg"), sampleSvg);

  try {
    const plan = buildGenerateSvgTargetPlan(report, {dataDir: dir});
    const payload = {
      icons: plan.targetPaths.map((path, index) => ({
        path,
        concept: "rollback fixture",
        svg: distinctSampleSvgs[index],
      })),
    };

    await assert.rejects(
      applyGenerateSvgPayload({payload, report, targetPlan: plan, dataDir: dir, generatedDataPath, rawDataPath}),
    );
    // 已存在的目标图标恢复旧内容，新写的目标图标被删除，孤儿与 raw JSON 保持原样。
    assert.equal(readFileSync(oldIconPath, "utf8"), oldIconContent);
    for (const iconPath of plan.targetPaths) {
      if (iconPath === "icons/intro-i1.svg") continue;
      assert.equal(existsSync(join(dir, iconPath)), false, `${iconPath} must be rolled back`);
    }
    assert.equal(existsSync(join(dir, "icons", "orphan.svg")), true);
    assert.equal(readFileSync(rawDataPath, "utf8"), rawBefore);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
