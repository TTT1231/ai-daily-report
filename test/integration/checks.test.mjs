import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync} from "node:fs";
import {join, dirname, resolve} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const checkDataJson = resolve(__dirname, "..", "..", "scripts", "checks", "check-data-json.mjs");
const checkIcons = resolve(__dirname, "..", "..", "scripts", "checks", "check-icons.mjs");
const mockDir = resolve(__dirname, "..", "mock");

// mock 数据全部来自 test/mock/*.json，不在测试里硬编码
const loadJson = (name) => JSON.parse(readFileSync(join(mockDir, name), "utf8"));
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
    mkdirSync(dirname(target), {recursive: true});
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
    env: {...process.env, DATA_SCHEME_DIR: dataSchemeDir},
    encoding: "utf8",
  });
  return {code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? ""};
}

// ---------- check-data-json (raw) ----------
test("check-data-json exits 0 on a valid raw report", () => {
  const dir = seedDataScheme({"data.json": JSON.stringify(rawReport())});
  try {
    const {code, stdout, stderr} = runCli(checkDataJson, [], dir);
    assert.equal(code, 0, `expected exit 0\nstderr: ${stderr}`);
    assert.match(stdout, /valid/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test("check-data-json exits 1 on a raw report with fewer than 2 tabs (schema rejects)", () => {
  const bad = rawReport();
  bad.stories[0].tabs = [bad.stories[0].tabs[0]];
  const dir = seedDataScheme({"data.json": JSON.stringify(bad)});
  try {
    const {code, stderr} = runCli(checkDataJson, [], dir);
    assert.equal(code, 1);
    assert.match(stderr, /validation failed/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test("check-data-json exits 1 when data.json is missing", () => {
  const dir = seedDataScheme({});
  try {
    const {code, stderr} = runCli(checkDataJson, [], dir);
    assert.equal(code, 1);
    assert.match(stderr, /does not exist/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

// ---------- check-data-json --render ----------
test("check-data-json --render exits 1 when the generated report is not render-ready (no intro/timing)", () => {
  // raw 形态的报告当作 data-generate.json：renderMode 下缺 intro/outro/timing → 校验失败
  const dir = seedDataScheme({"data-generate.json": JSON.stringify(rawReport())});
  try {
    const {code, stderr} = runCli(checkDataJson, ["--render"], dir);
    assert.equal(code, 1);
    assert.match(stderr, /validation failed/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

// ---------- check-icons ----------
test("check-icons exits 0 when every referenced icon is a valid on-disk SVG", () => {
  const dir = seedDataScheme({
    "data-generate.json": JSON.stringify(generatedIcons()),
    "icons/test-icon-sample-1.svg": "mock:test-icon-sample-1.svg",
  });
  try {
    const {code, stdout, stderr} = runCli(checkIcons, [], dir);
    assert.equal(code, 0, `expected exit 0\nstderr: ${stderr}`);
    assert.match(stdout, /passed/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test("check-icons exits 1 when a referenced icon file is missing", () => {
  const report = generatedIcons();
  for (const story of [report.intro, ...report.stories]) {
    for (const tab of story.tabs) tab.icon = "icons/does-not-exist.svg";
  }
  const dir = seedDataScheme({"data-generate.json": JSON.stringify(report)});
  try {
    const {code, stderr} = runCli(checkIcons, [], dir);
    assert.equal(code, 1);
    assert.match(stderr, /not found|failed/i);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

// ---------- check-data-json --render（资产校验：renderMode 下 checkAssets 默认 true）----------
test("check-data-json --render exits 0 when the generated report is fully render-ready with audio", () => {
  const dir = seedDataScheme({"data-generate.json": JSON.stringify(generatedReport()), ...audioFiles});
  try {
    const {code, stdout, stderr} = runCli(checkDataJson, ["--render"], dir);
    assert.equal(code, 0, `expected exit 0\nstderr: ${stderr}`);
    assert.match(stdout, /render-ready/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
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
    const {code, stderr} = runCli(checkDataJson, ["--render"], dir);
    assert.equal(code, 1);
    assert.match(stderr, /not found/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test("check-data-json --render exits 1 when an overlay path escapes data-scheme/", () => {
  // "images/../../escape.png" 通过 schema 的 imagePath 正则，但 resolve 后逃出 data-scheme/
  const report = generatedReport();
  report.stories[0].scenes[0].overlayImg = "images/../../escape.png";
  const dir = seedDataScheme({"data-generate.json": JSON.stringify(report), ...audioFiles});
  try {
    const {code, stderr} = runCli(checkDataJson, ["--render"], dir);
    assert.equal(code, 1);
    assert.match(stderr, /stay inside data-scheme/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
