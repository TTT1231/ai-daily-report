import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const checkDataJson = resolve(
  __dirname,
  "..",
  "..",
  "scripts",
  "checks",
  "check-data-json.mjs",
);
const checkIcons = resolve(
  __dirname,
  "..",
  "..",
  "scripts",
  "checks",
  "check-icons.mjs",
);
const mockDir = resolve(__dirname, "..", "mock");

// mock 数据全部来自 test/mock/*.json，不在测试里硬编码
const loadJson = (name) =>
  JSON.parse(readFileSync(join(mockDir, name), "utf8"));
const rawReport = () => loadJson("raw-report.json");
const generatedIcons = () => loadJson("generated-icons.json");
const generatedReport = () => loadJson("generated-report.json");
// 把音频文件铺进临时 data-scheme/audio/（render 资产校验需要它们存在）
const audioFiles = {
  "audio/intro-greeting.mp3": "mock:test-audio-sample-1.mp3",
  "audio/scene-1.mp3": "mock:test-audio-sample-1.mp3",
  "audio/outro-ending.mp3": "mock:test-audio-sample-1.mp3",
};

// 把一份「data-scheme 镜像」写进临时目录；"mock:<file>" 从 test/mock 拷真实素材。
function seedDataScheme(files) {
  const dir = mkdtempSync(join(tmpdir(), "cli-checks-"));
  for (const [rel, content] of Object.entries(files)) {
    const target = join(dir, rel);
    mkdirSync(dirname(target), { recursive: true });
    if (typeof content === "string" && content.startsWith("mock:")) {
      copyFileSync(join(mockDir, content.slice(5)), target);
    } else {
      writeFileSync(target, content);
    }
  }
  return dir;
}

// 用子进程跑 CLI，DATA_SCHEME_DIR 指向临时目录 → hermetic，不碰真实 data-scheme/。
function runCli(script, args, dataSchemeDir) {
  const result = spawnSync(process.execPath, [script, ...args], {
    env: { ...process.env, DATA_SCHEME_DIR: dataSchemeDir },
    encoding: "utf8",
  });
  return {
    code: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

// ---------- check-data-json (raw) ----------
test("check-data-json exits 0 on a valid raw report", () => {
  const dir = seedDataScheme({ "data.json": JSON.stringify(rawReport()) });
  try {
    const { code, stdout, stderr } = runCli(checkDataJson, [], dir);
    assert.equal(code, 0, `expected exit 0\nstderr: ${stderr}`);
    assert.match(stdout, /valid/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-data-json accepts a one-fact brief and rejects an empty tab list", () => {
  const bad = rawReport();
  bad.stories[0].tabs = [bad.stories[0].tabs[0]];
  const dir = seedDataScheme({ "data.json": JSON.stringify(bad) });
  try {
    assert.equal(runCli(checkDataJson, [], dir).code, 0);
    bad.stories[0].tabs = [];
    writeFileSync(join(dir, "data.json"), JSON.stringify(bad));
    const { code, stderr } = runCli(checkDataJson, [], dir);
    assert.equal(code, 1);
    assert.match(stderr, /validation failed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- scenes 容量上限（AJV/JSON Schema 层，与 Zod 单测互为双实现防漂移） ----------
// Scene ID 全部唯一且不与 story-2 的 scene-3 冲突，避免先撞全局重复 ID 校验。
const sixSceneStory = (count) =>
  Array.from({ length: count }, (_, i) => ({
    id: `scene-1-${i + 1}`,
    subtitle: "一句足够长的旁白口播文案内容。",
  }));

test("check-data-json accepts a story with six scenes (schema capacity 1-6)", () => {
  const report = rawReport();
  report.stories[0].scenes = sixSceneStory(6);
  const dir = seedDataScheme({ "data.json": JSON.stringify(report) });
  try {
    const { code, stdout, stderr } = runCli(checkDataJson, [], dir);
    assert.equal(code, 0, `expected exit 0\nstderr: ${stderr}`);
    assert.match(stdout, /valid/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-data-json exits 1 on a story with seven scenes (schema capacity 1-6)", () => {
  const report = rawReport();
  report.stories[0].scenes = sixSceneStory(7);
  const dir = seedDataScheme({ "data.json": JSON.stringify(report) });
  try {
    const { code, stderr } = runCli(checkDataJson, [], dir);
    assert.equal(code, 1);
    assert.match(stderr, /validation failed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-data-json exits 1 when data.json is missing", () => {
  const dir = seedDataScheme({});
  try {
    const { code, stderr } = runCli(checkDataJson, [], dir);
    assert.equal(code, 1);
    assert.match(stderr, /does not exist/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- check-data-json --render ----------
test("check-data-json --render exits 1 when the generated report is not render-ready (no intro/timing)", () => {
  // raw 形态的报告当作 data-generate.json：renderMode 下缺 intro/outro/timing → 校验失败
  const dir = seedDataScheme({
    "data-generate.json": JSON.stringify(rawReport()),
  });
  try {
    const { code, stderr } = runCli(checkDataJson, ["--render"], dir);
    assert.equal(code, 1);
    assert.match(stderr, /validation failed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- check-data-json --strict-tone（supplied 专用口吻闸）----------
function rawReportWithMediumNarration() {
  const report = rawReport();
  report.stories[0].scenes[0].subtitle =
    "截图显示，企业的 Token 消耗记录正在被纳入贷款评估。";
  return report;
}

test("check-data-json --strict-tone exits 1 on medium-reference narration with field path", () => {
  const dir = seedDataScheme({
    "data.json": JSON.stringify(rawReportWithMediumNarration()),
  });
  try {
    const { code, stderr } = runCli(checkDataJson, ["--strict-tone"], dir);
    assert.equal(code, 1);
    assert.match(stderr, /strict-tone validation failed/);
    assert.match(stderr, /stories\[0\]\.scenes\[0\]\.subtitle/);
    assert.match(stderr, /截图显示/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("strict tone reports source-reading prose in both summaries and subtitles without rewriting input", () => {
  const report = rawReport();
  report.stories[0].tabs[0].summary =
    "页面说明这些新应用**仅创建者本人可见并能安装**，其他用户无法直接访问个人应用库。";
  report.stories[0].scenes[0].subtitle =
    "Anthropic 的基准图显示，开发环境拉取最新代码用时由 Git 的 87 秒降至新系统的 3.5 秒。";
  const raw = JSON.stringify(report);
  const dir = seedDataScheme({ "data.json": raw });
  try {
    const { code, stderr } = runCli(checkDataJson, ["--strict-tone"], dir);
    assert.equal(code, 1);
    assert.match(stderr, /stories\[0\]\.tabs\[0\]\.summary:.*页面说明/);
    assert.match(stderr, /stories\[0\]\.scenes\[0\]\.subtitle:.*基准图显示/);
    assert.equal(readFileSync(join(dir, "data.json"), "utf8"), raw);
    assert.equal(runCli(checkDataJson, [], dir).code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ordinary Raw validation blocks reporting scaffolding and accepts direct news without rewriting its input", () => {
  const report = rawReport();
  report.stories[0].scenes[0].subtitle = "韩国财长预计半导体景气持续到2027年；2029年内存供需走向属于行业预测。";
  report.stories[0].tabs[0].summary = "`Typora`称**现有V1付费用户可免费升级至V2**，无需再次购买。";
  report.stories[1].scenes = [
    {id: "copy-1", subtitle: "Kotaku报道，创作者称使用Claude制作了这个游戏项目，在收到律师函后停止开发。"},
    {id: "copy-2", subtitle: "仓库将它描述为面向开放任务的递归智能体框架，并称模型权重保持不变。"},
    {id: "copy-3", subtitle: "Typora官方补充说明，现有V1付费用户升级至V2可免费，无需再次购买。"},
    {id: "copy-4", subtitle: "团队演示了利用AI生成游戏内容的项目；报道没有显示厂商宣布新的防作弊方案。"},
  ];
  const original = JSON.stringify(report);
  const dir = seedDataScheme({"data.json": original});
  try {
    const failed = runCli(checkDataJson, [], dir);
    assert.equal(failed.code, 1, failed.stderr);
    for (const code of ["claim-classification", "attribution-stack", "source-as-actor", "supplementary-preface", "evidence-absence", "product-policy-preface"]) {
      assert.match(failed.stderr, new RegExp(`news-copy template \\[${code}\\]`));
    }
    assert.equal(readFileSync(join(dir, "data.json"), "utf8"), original);
    assert.deepEqual(readdirSync(dir), ["data.json"]);

    report.stories[0].scenes[0].subtitle = "韩国财长预计，半导体景气至少持续到2027年。行业预计，2029年内存市场可能进入红海竞争。";
    report.stories[0].tabs[0].summary = "现有`Typora V1`付费用户**可免费升级至V2**，无需再次购买软件许可证。";
    const subtitles = [
      "创作者介绍，自己用Claude制作了这个游戏项目，收到律师函后决定停止开发。",
      "这是面向开放任务的递归智能体框架，递归编排时模型权重保持不变。",
      "现有Typora V1付费用户可免费升级至V2，无需再次购买软件许可证。",
      "这款AI游戏项目收到版权方的律师函，创作者随后决定停止继续开发。",
    ];
    report.stories[1].scenes.forEach((scene, index) => {scene.subtitle = subtitles[index];});
    const revised = JSON.stringify(report);
    writeFileSync(join(dir, "data.json"), revised);
    const passed = runCli(checkDataJson, [], dir);
    assert.equal(passed.code, 0, passed.stderr);
    assert.equal(readFileSync(join(dir, "data.json"), "utf8"), revised);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test("one check reports length, Markdown, tone and missing evidence together without writing files", () => {
  const report = rawReportWithMediumNarration();
  report.stories[0].contentTitle = "字".repeat(31);
  report.stories[0].tabs[0].summary = "**`Model` 已更新**。";
  report.stories[0].scenes[0].overlayImg = "images/does-not-exist.png";
  const original = JSON.stringify(report);
  const dir = seedDataScheme({ "data.json": original });
  try {
    const { code, stderr, stdout } = runCli(
      checkDataJson,
      ["--strict-tone", "--evidence"],
      dir,
    );
    assert.equal(code, 1);
    assert.match(stderr, /more than 30 characters/);
    assert.match(stderr, /bold and inline-code spans must not overlap or nest/);
    assert.match(stderr, /strict-tone validation failed/);
    assert.match(stderr, /截图显示/);
    assert.match(stderr, /Evidence validation failed/);
    assert.match(stderr, /file does not exist/);
    assert.doesNotMatch(
      stdout,
      /raw content is valid|Evidence validation passed/,
    );
    assert.equal(readFileSync(join(dir, "data.json"), "utf8"), original);
    assert.deepEqual(readdirSync(dir), ["data.json"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("combined checks preserve healthy sibling diagnostics despite invalid shapes", () => {
  const report = rawReportWithMediumNarration();
  report.stories[0].tabs[0].summary = "**`Model` 已更新**。";
  report.stories.unshift(null, { tabs: "invalid", scenes: "invalid" });
  const dir = seedDataScheme({ "data.json": JSON.stringify(report) });
  try {
    const { code, stderr } = runCli(
      checkDataJson,
      ["--strict-tone", "--evidence"],
      dir,
    );
    assert.equal(code, 1);
    assert.match(stderr, /stories\.0: must be object/);
    assert.match(
      stderr,
      /stories\[2\]\.tabs\[0\]\.summary: has malformed Markdown/,
    );
    assert.match(
      stderr,
      /stories\[2\]\.scenes\[0\]\.subtitle: narrates the evidence medium/,
    );
    assert.match(stderr, /Evidence validation failed/);
    assert.doesNotMatch(stderr, /TypeError|at file:|NaN/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("combined checks report a null root as a schema failure without a stack trace", () => {
  const dir = seedDataScheme({ "data.json": "null" });
  try {
    const { code, stderr } = runCli(
      checkDataJson,
      ["--strict-tone", "--evidence"],
      dir,
    );
    assert.equal(code, 1);
    assert.match(stderr, /must be object/);
    assert.doesNotMatch(stderr, /TypeError|at file:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("combined checks accept a valid evidence report without preparing reviews or generating assets", () => {
  const report = rawReport();
  for (const story of report.stories) {
    for (const scene of story.scenes)
      scene.overlayImg = "images/codex-reset.png";
  }
  const dir = seedDataScheme({
    "data.json": JSON.stringify(report),
    "images/codex-reset.png": "mock:images/codex-reset.png",
  });
  try {
    const { code, stdout, stderr } = runCli(
      checkDataJson,
      ["--strict-tone", "--evidence"],
      dir,
    );
    assert.equal(code, 0, stderr);
    assert.match(stdout, /raw content is valid/);
    assert.match(
      stdout,
      /Evidence validation passed: 3 overlay image\(s\) across 2\/2 stories/,
    );
    assert.deepEqual(readdirSync(dir).sort(), ["data.json", "images"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("supplied-source medium checks still require --strict-tone", () => {
  const dir = seedDataScheme({
    "data.json": JSON.stringify(rawReportWithMediumNarration()),
  });
  try {
    const { code, stdout } = runCli(checkDataJson, [], dir);
    assert.equal(code, 0, `expected exit 0\nstdout: ${stdout}`);
    assert.match(stdout, /valid/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-data-json --strict-tone warns on anonymous attribution and filler but exits 0", () => {
  const report = rawReport();
  report.stories[0].tabs[0].summary =
    "消息称额度**已完整重置一次**，这不代表长期规则改变。";
  const dir = seedDataScheme({ "data.json": JSON.stringify(report) });
  try {
    const { code, stderr, stdout } = runCli(
      checkDataJson,
      ["--strict-tone"],
      dir,
    );
    assert.equal(code, 0, `expected exit 0\nstderr: ${stderr}`);
    assert.match(stdout, /valid/);
    assert.match(stderr, /warning: .*消息称/);
    assert.match(stderr, /warning: .*这不代表/);
    assert.match(stderr, /non-blocking/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-data-json --strict-tone does not flag legal impact wording", () => {
  const report = rawReport();
  report.stories[1].tabs[1].summary =
    "自研芯片**可能影响未来推理成本**，意味着供应格局或将调整。";
  const dir = seedDataScheme({ "data.json": JSON.stringify(report) });
  try {
    const { code, stderr } = runCli(checkDataJson, ["--strict-tone"], dir);
    assert.equal(code, 0, `expected exit 0\nstderr: ${stderr}`);
    assert.doesNotMatch(stderr, /warning|strict-tone/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--strict-tone is skipped in --render mode (generated derives from raw)", () => {
  const report = generatedReport();
  report.stories[0].scenes[0].subtitle = "截图显示，事实成立。";
  const dir = seedDataScheme({
    "data-generate.json": JSON.stringify(report),
    ...audioFiles,
  });
  try {
    const { code, stderr } = runCli(
      checkDataJson,
      ["--render", "--strict-tone"],
      dir,
    );
    assert.equal(code, 0, `expected exit 0\nstderr: ${stderr}`);
    assert.match(stderr, /skipped in --render mode/);
    assert.doesNotMatch(stderr, /strict-tone validation failed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- check-icons ----------
test("check-icons exits 0 when every referenced icon is a valid on-disk SVG", () => {
  const dir = seedDataScheme({
    "data-generate.json": JSON.stringify(generatedIcons()),
    "icons/test-icon-sample-1.svg": "mock:test-icon-sample-1.svg",
    "icons/test-icon-sample-2.svg": "mock:test-icon-sample-2.svg",
  });
  try {
    const { code, stdout, stderr } = runCli(checkIcons, [], dir);
    assert.equal(code, 0, `expected exit 0\nstderr: ${stderr}`);
    assert.match(stdout, /passed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-icons exits 1 when a referenced icon file is missing", () => {
  const report = generatedIcons();
  for (const story of [report.intro, ...report.stories]) {
    for (const tab of story.tabs) tab.icon = "icons/does-not-exist.svg";
  }
  const dir = seedDataScheme({ "data-generate.json": JSON.stringify(report) });
  try {
    const { code, stderr } = runCli(checkIcons, [], dir);
    assert.equal(code, 1);
    assert.match(stderr, /not found|failed/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- check-data-json --render（资产校验：renderMode 下 checkAssets 默认 true）----------
test("check-data-json --render exits 0 when the generated report is fully render-ready with audio", () => {
  const dir = seedDataScheme({
    "data-generate.json": JSON.stringify(generatedReport()),
    ...audioFiles,
  });
  try {
    const { code, stdout, stderr } = runCli(checkDataJson, ["--render"], dir);
    assert.equal(code, 0, `expected exit 0\nstderr: ${stderr}`);
    assert.match(stdout, /render-ready/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-data-json --render exits 1 when a referenced audio file is missing", () => {
  // 只铺 intro/outro 音频，缺 scene-1.mp3
  const dir = seedDataScheme({
    "data-generate.json": JSON.stringify(generatedReport()),
    "audio/intro-greeting.mp3": "mock:test-audio-sample-1.mp3",
    "audio/outro-ending.mp3": "mock:test-audio-sample-1.mp3",
  });
  try {
    const { code, stderr } = runCli(checkDataJson, ["--render"], dir);
    assert.equal(code, 1);
    assert.match(stderr, /not found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-data-json --render exits 1 when an overlay path escapes data-scheme/", () => {
  // "images/../../escape.png" 通过 schema 的 imagePath 正则，但 resolve 后逃出 data-scheme/
  const report = generatedReport();
  report.stories[0].scenes[0].overlayImg = "images/../../escape.png";
  const dir = seedDataScheme({
    "data-generate.json": JSON.stringify(report),
    ...audioFiles,
  });
  try {
    const { code, stderr } = runCli(checkDataJson, ["--render"], dir);
    assert.equal(code, 1);
    assert.match(stderr, /stay inside data-scheme/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
