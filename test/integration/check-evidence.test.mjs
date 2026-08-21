import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync} from "node:fs";
import {join, dirname, resolve} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const checkEvidence = resolve(__dirname, "..", "..", "scripts", "checks", "check-evidence.mjs");
const mockDir = resolve(__dirname, "..", "mock");

const loadJson = (name) => JSON.parse(readFileSync(join(mockDir, name), "utf8"));

// seedDataScheme 把一份「data-scheme 镜像」写进临时目录；"mock:<file>" 从 test/mock
// 拷真实素材。DATA_SCHEME_DIR 指向它 → hermetic，不碰真实 data-scheme/。
function seedDataScheme(files) {
  const dir = mkdtempSync(join(tmpdir(), "cli-evidence-"));
  for (const [rel, content] of Object.entries(files)) {
    const target = join(dir, rel);
    mkdirSync(dirname(target), {recursive: true});
    if (typeof content === "string" && content.startsWith("mock:")) {
      copyFileSync(join(mockDir, content.slice(5)), target);
    } else {
      writeFileSync(target, content);
    }
  }
  return dir;
}

function runCli(args, dataSchemeDir) {
  const result = spawnSync(process.execPath, [checkEvidence, ...args], {
    env: {...process.env, DATA_SCHEME_DIR: dataSchemeDir},
    encoding: "utf8",
  });
  return {code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? ""};
}

function rawReportWithOverlay(overlayRef) {
  const report = loadJson("raw-report.json");
  report.stories[0].scenes[0].overlayImg = overlayRef;
  return report;
}

// 一份文件层完全合法（图片存在且魔数正确）、只违反 supplied-source 结构约定的报告。
function structurallyValidReport() {
  const report = loadJson("raw-report.json");
  report.stories[0].scenes[0].overlayImg = "images/topic-2419173-e551af32e2.jpg";
  report.stories[0].scenes[0].subtitle =
    "官方公告显示接口不再面向新用户开放使用。";
  report.stories[0].scenes[1].subtitle = "历史付费用户不受这次调整影响。";
  // story-2 只有单 scene：配一张图且口播在 30 单位内，走单 scene 例外。
  report.stories[1].scenes[0].overlayImg = "images/codex-reset.png";
  report.stories[1].scenes[0].subtitle = "官方页面展示完整调整公告内容。";
  return report;
}

function seedValidReport() {
  return seedDataScheme({
    "data.json": JSON.stringify(structurallyValidReport()),
    "images/topic-2419173-e551af32e2.jpg": "mock:images/topic-2419173-e551af32e2.jpg",
    "images/codex-reset.png": "mock:images/codex-reset.png",
  });
}

test("check-evidence exits 0 when every overlay file is a valid image", () => {
  const report = rawReportWithOverlay("images/topic-2419173-e551af32e2.jpg");
  const dir = seedDataScheme({
    "data.json": JSON.stringify(report),
    "images/topic-2419173-e551af32e2.jpg": "mock:images/topic-2419173-e551af32e2.jpg",
  });
  try {
    const {code, stdout, stderr} = runCli([], dir);
    assert.equal(code, 0, `expected exit 0\nstderr: ${stderr}`);
    assert.match(stdout, /passed/);
    // 无 overlay 的 story-2 默认只告警，不失败。
    assert.match(stdout, /story\(ies\) without overlay/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test("check-evidence exits 1 when an overlay file is missing on disk", () => {
  const report = rawReportWithOverlay("images/missing.png");
  const dir = seedDataScheme({"data.json": JSON.stringify(report)});
  try {
    const {code, stderr} = runCli([], dir);
    assert.equal(code, 1);
    assert.match(stderr, /does not exist/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test("check-evidence exits 1 when an HTML challenge page is saved as .png", () => {
  const report = rawReportWithOverlay("images/micron-evidence-1.png");
  const challengePage = `<!DOCTYPE html><html><head><title>Just a moment...</title></head>
<body>正在进行安全验证，请稍候…</body></html>`;
  // 补足字节数越过大小下限，确保失败原因确实是魔数校验而不是尺寸过小。
  const padded = challengePage + "<!--".padEnd(2048, "-") + "-->";
  const dir = seedDataScheme({
    "data.json": JSON.stringify(report),
    "images/micron-evidence-1.png": padded,
  });
  try {
    const {code, stderr} = runCli([], dir);
    assert.equal(code, 1);
    assert.match(stderr, /not a valid PNG/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test("check-evidence --require-overlay fails a story without any overlay", () => {
  const report = loadJson("raw-report.json");
  const dir = seedDataScheme({
    "data.json": JSON.stringify(report),
    "images/topic-2419173-e551af32e2.jpg": "mock:images/topic-2419173-e551af32e2.jpg",
  });
  try {
    const {code, stderr} = runCli(["--require-overlay"], dir);
    assert.equal(code, 1);
    assert.match(stderr, /no evidence overlay/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test("check-evidence exits 1 when data.json is missing", () => {
  const dir = seedDataScheme({});
  try {
    const {code, stderr} = runCli([], dir);
    assert.equal(code, 1);
    assert.match(stderr, /does not exist/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

// ---------- supplied-source 结构闸（仅 --require-overlay 模式） ----------

test("check-evidence --require-overlay passes a valid evidence→narration structure", () => {
  const dir = seedValidReport();
  try {
    const {code, stdout, stderr} = runCli(["--require-overlay"], dir);
    assert.equal(code, 0, `expected exit 0\nstderr: ${stderr}`);
    assert.match(stdout, /passed/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test("check-evidence --require-overlay fails when the last scene still carries an overlay", () => {
  const report = structurallyValidReport();
  report.stories[0].scenes[1].overlayImg = "images/codex-reset.png";
  const dir = seedDataScheme({
    "data.json": JSON.stringify(report),
    "images/topic-2419173-e551af32e2.jpg": "mock:images/topic-2419173-e551af32e2.jpg",
    "images/codex-reset.png": "mock:images/codex-reset.png",
  });
  try {
    const {code, stderr} = runCli(["--require-overlay"], dir);
    assert.equal(code, 1);
    assert.match(stderr, /last scene .* must not carry an overlay/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test("check-evidence --require-overlay fails an over-long evidence-scene narration", () => {
  const report = structurallyValidReport();
  report.stories[0].scenes[0].subtitle =
    "官方公告详细说明了接口调整的完整背景、适用范围、时间节点以及历史付费用户和新用户分别适用的过渡安排细则说明。";
  const dir = seedDataScheme({
    "data.json": JSON.stringify(report),
    "images/topic-2419173-e551af32e2.jpg": "mock:images/topic-2419173-e551af32e2.jpg",
  });
  try {
    const {code, stderr} = runCli(["--require-overlay"], dir);
    assert.equal(code, 1);
    assert.match(stderr, /evidence scene narration is/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test("check-evidence --require-overlay fails an over-long narration scene", () => {
  const report = structurallyValidReport();
  report.stories[0].scenes[1].subtitle =
    "这次调整对历史付费用户几乎没有影响，他们可以继续按原有方式使用接口，同时官方也给出了完整的迁移时间线和替代方案说明。";
  const dir = seedDataScheme({
    "data.json": JSON.stringify(report),
    "images/topic-2419173-e551af32e2.jpg": "mock:images/topic-2419173-e551af32e2.jpg",
  });
  try {
    const {code, stderr} = runCli(["--require-overlay"], dir);
    assert.equal(code, 1);
    assert.match(stderr, /narration scene is/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test("check-evidence --require-overlay fails a single long overlay-only scene instead of splitting", () => {
  const report = structurallyValidReport();
  report.stories[0].scenes = [
    {
      ...report.stories[0].scenes[0],
      subtitle:
        "官方公告说明接口自下月起不再面向新用户开放，历史付费用户可以继续使用现有服务并获得维护支持。",
    },
  ];
  const dir = seedDataScheme({
    "data.json": JSON.stringify(report),
    "images/topic-2419173-e551af32e2.jpg": "mock:images/topic-2419173-e551af32e2.jpg",
  });
  try {
    const {code, stderr} = runCli(["--require-overlay"], dir);
    assert.equal(code, 1);
    assert.match(stderr, /single-scene story with an overlay/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test("structure gate stays silent in default mode for native RSS flows", () => {
  // 原生自动流程允许整条新闻口播 + 全程带图，默认模式只查文件层，不做结构判定。
  const report = structurallyValidReport();
  report.stories[0].scenes[1].overlayImg = "images/codex-reset.png";
  report.stories[0].scenes[0].subtitle =
    "官方公告详细说明了接口调整的完整背景、适用范围、时间节点以及历史付费用户和新用户分别适用的过渡安排细则说明。";
  const dir = seedDataScheme({
    "data.json": JSON.stringify(report),
    "images/topic-2419173-e551af32e2.jpg": "mock:images/topic-2419173-e551af32e2.jpg",
    "images/codex-reset.png": "mock:images/codex-reset.png",
  });
  try {
    const {code, stderr} = runCli([], dir);
    assert.equal(code, 0, `expected exit 0\nstderr: ${stderr}`);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
