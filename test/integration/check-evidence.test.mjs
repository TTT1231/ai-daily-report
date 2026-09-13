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

// 每个正文段都必须明确配图，连续讲解允许复用。
function structurallyValidReport() {
  const report = loadJson("raw-report.json");
  for (const story of report.stories) for (const scene of story.scenes) {
    scene.overlayImg = "images/codex-reset.png";
  }
  return report;
}
function seedValidReport() {
  return seedDataScheme({
    "data.json": JSON.stringify(structurallyValidReport()),
    "images/codex-reset.png": "mock:images/codex-reset.png",
  });
}

test("check-evidence default rejects stories with no evidence", () => {
  const dir = seedDataScheme({"data.json": JSON.stringify(loadJson("raw-report.json"))});
  try {
    const {code, stderr} = runCli([], dir);
    assert.equal(code, 1);
    assert.match(stderr, /no evidence overlay/);
  } finally { rmSync(dir, {recursive: true, force: true}); }
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

test("default and legacy --require-overlay both accept continuous same-image narration", () => {
  const dir = seedValidReport();
  try {
    for (const args of [[], ["--require-overlay"]]) {
      const {code, stderr} = runCli(args, dir);
      assert.equal(code, 0, stderr);
    }
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test("evidence narration can explain a complex image beyond the old 45-unit cap", () => {
  const report = structurallyValidReport();
  report.stories[0].scenes[0].subtitle = "官方公告详细说明了接口调整的完整背景、适用范围、时间节点以及历史付费用户和新用户分别适用的过渡安排细则说明。";
  const dir = seedDataScheme({"data.json": JSON.stringify(report), "images/codex-reset.png": "mock:images/codex-reset.png"});
  try { const result = runCli([], dir); assert.equal(result.code, 0, result.stderr); }
  finally { rmSync(dir, {recursive: true, force: true}); }
});

// ---------- 自适应证据结构（1–5 带图段、排列自由、无固定模板） ----------

// 单 story 报告：overlay 计数断言不受第二个 story 的图干扰。
function singleStoryReport(scenes) {
  const report = loadJson("raw-report.json");
  report.stories[0].scenes = scenes;
  report.stories = [report.stories[0]];
  return report;
}

test("check-evidence --require-overlay warns when a supplied batch uniformly uses one scene and one overlay", () => {
  const report = singleStoryReport([
    {
      id: "scene-uniform-1",
      subtitle: "官方页面展示这条消息的核心事实。",
      overlayImg: "images/codex-reset.png",
    },
  ]);
  const seedStory = report.stories[0];
  report.stories = Array.from({length: 3}, (_, index) => ({
    ...seedStory,
    id: `story-uniform-${index + 1}`,
    scenes: [
      {
        ...seedStory.scenes[0],
        id: `scene-uniform-${index + 1}`,
      },
    ],
  }));
  const dir = seedDataScheme({
    "data.json": JSON.stringify(report),
    "images/codex-reset.png": "mock:images/codex-reset.png",
  });
  try {
    const {code, stdout, stderr} = runCli(["--require-overlay"], dir);
    assert.equal(code, 0, `expected exit 0\nstderr: ${stderr}`);
    assert.match(stderr, /looks like a fixed template/);
    assert.match(stdout, /1 warning\(s\)/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

// 同一合法 mock 图复制为五个独立路径：计数断言精确到 5，
// 缺失负例能证明文件级校验遍历到每个独立引用（而非只查第一个）。
const fiveEvidenceFiles = () =>
  Object.fromEntries(
    Array.from({length: 5}, (_, i) => [
      `images/evidence-${i + 1}.png`,
      "mock:images/codex-reset.png",
    ]),
  );

const fiveOverlayScenes = () =>
  Array.from({length: 5}, (_, i) => ({
    id: `scene-ev-${i + 1}`,
    subtitle: `官方公告确认第${["一", "二", "三", "四", "五"][i]}项核心事实成立。`,
    overlayImg: `images/evidence-${i + 1}.png`,
  }));

test("check-evidence --require-overlay passes five image-backed scenes ending on an overlay", () => {
  const dir = seedDataScheme({
    "data.json": JSON.stringify(singleStoryReport(fiveOverlayScenes())),
    ...fiveEvidenceFiles(),
  });
  try {
    const {code, stdout, stderr} = runCli(["--require-overlay"], dir);
    assert.equal(code, 0, `expected exit 0\nstderr: ${stderr}`);
    assert.match(stdout, /passed: 5 overlay image\(s\)/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test("check-evidence --require-overlay rejects overlay-free scenes between overlays", () => {
  const report = singleStoryReport([
    {id: "scene-mixed-1", subtitle: "官方公告确认第一项核心事实成立。", overlayImg: "images/evidence-1.png"},
    {id: "scene-mixed-2", subtitle: "历史付费用户不受这次调整影响。"},
    {id: "scene-mixed-3", subtitle: "官方页面确认第二项核心事实成立。", overlayImg: "images/evidence-2.png"},
  ]);
  const dir = seedDataScheme({
    "data.json": JSON.stringify(report),
    ...fiveEvidenceFiles(),
  });
  try {
    const {code, stderr} = runCli(["--require-overlay"], dir);
    assert.equal(code, 1);
    assert.match(stderr, /every narration scene requires evidence/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test("check-evidence --require-overlay passes a single overlay scene within the 35–40-unit band", () => {
  // 旧规则曾强制单段带图 >30 单位拆出无图段；删除后单段带图与其它证据段同守 ≤45 上限。
  const report = singleStoryReport([
    {
      id: "scene-single-long",
      subtitle: "官方公告说明调整自下月起生效，历史付费用户可继续使用现有服务并获得维护支持。",
      overlayImg: "images/evidence-1.png",
    },
  ]);
  const dir = seedDataScheme({
    "data.json": JSON.stringify(report),
    ...fiveEvidenceFiles(),
  });
  try {
    const {code, stdout, stderr} = runCli(["--require-overlay"], dir);
    assert.equal(code, 0, `expected exit 0\nstderr: ${stderr}`);
    assert.match(stdout, /passed: 1 overlay image\(s\)/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test("check-evidence --require-overlay fails six distinct evidence images", () => {
  // 第六段循环引用已有路径：本用例只钉段数边界，路径复用并非生产形态。
  const report = singleStoryReport(
    Array.from({length: 6}, (_, i) => ({
      id: `scene-six-${i + 1}`,
      subtitle: "官方公告确认一项核心事实成立。",
      overlayImg: `images/evidence-${i + 1}.png`,
    })),
  );
  const dir = seedDataScheme({
    "data.json": JSON.stringify(report),
    ...fiveEvidenceFiles(),
  });
  try {
    const {code, stderr} = runCli(["--require-overlay"], dir);
    assert.equal(code, 1);
    assert.match(stderr, /distinct evidence images exceed the maximum of 5/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test("check-evidence --require-overlay accepts reusing one evidence image across scenes", () => {
  const report = singleStoryReport([
    {
      id: "scene-reuse-1",
      subtitle: "官方公告确认第一项核心事实成立。",
      overlayImg: "images/evidence-1.png",
    },
    {
      id: "scene-reuse-2",
      subtitle: "官方公告确认第二项核心事实成立。",
      overlayImg: "images/evidence-1.png",
    },
  ]);
  const dir = seedDataScheme({
    "data.json": JSON.stringify(report),
    ...fiveEvidenceFiles(),
  });
  try {
    const {code, stderr} = runCli(["--require-overlay"], dir);
    assert.equal(code, 0, stderr);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test("check-evidence --require-overlay checks every overlay reference, not just the first", () => {
  const files = fiveEvidenceFiles();
  delete files["images/evidence-2.png"];
  const dir = seedDataScheme({
    "data.json": JSON.stringify(singleStoryReport(fiveOverlayScenes())),
    ...files,
  });
  try {
    const {code, stderr} = runCli(["--require-overlay"], dir);
    assert.equal(code, 1);
    assert.match(stderr, /scene-ev-2.*does not exist/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test("six narration scenes can share five distinct evidence images", () => {
  // 六段全带图只违反 supplied 的 ≤5 带图纪律；默认（原生 RSS/手动）模式不做结构判定。
  const report = singleStoryReport(
    Array.from({length: 6}, (_, i) => ({
      id: `scene-native-${i + 1}`,
      subtitle: "一句足够长的旁白口播文案内容。",
      overlayImg: `images/evidence-${(i % 5) + 1}.png`,
    })),
  );
  const dir = seedDataScheme({
    "data.json": JSON.stringify(report),
    ...fiveEvidenceFiles(),
  });
  try {
    const {code, stderr} = runCli([], dir);
    assert.equal(code, 0, `expected exit 0\nstderr: ${stderr}`);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test("check-evidence rejects an overlay with EXIF orientation != 1 (renders rotated)", () => {
  // Chromium 按 EXIF 旋转显示而尺寸闸读未旋转像素：曾把 orientation=8 的裁剪图
  // 横倒着渲染进成片。文件级检查与模式无关，默认模式同样拒绝。
  const report = singleStoryReport([
    {
      id: "scene-rotated",
      subtitle: "官方公告确认一项核心事实成立。",
      overlayImg: "images/exif-rotated-8.png",
    },
  ]);
  const dir = seedDataScheme({
    "data.json": JSON.stringify(report),
    "images/exif-rotated-8.png": "mock:images/exif-rotated-8.png",
  });
  try {
    const {code, stderr} = runCli([], dir);
    assert.equal(code, 1);
    assert.match(stderr, /EXIF orientation is 8/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
