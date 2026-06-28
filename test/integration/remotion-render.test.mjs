import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync, readFileSync, existsSync, rmSync} from "node:fs";
import {join, dirname, resolve} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 冒烟渲染（非像素快照）：remotion still 渲染各关键帧与布局组合，断言不崩 + 1920×1080 + 非空白。
// 用「命名帧用例」而非裸数组，刻意覆盖此前漏掉的渲染路径：
//   story transition（click 音效 + 淡入淡出）、story 入场 storyPause、overlay reveal/hide 边缘、
//   第二张 overlay、无尺寸 overlay fallback（codex-reset.png）、2-tab 布局、outro，
//   以及 TwoTabLayout/FourTabLayout/FiveTabLayout 三个布局预览组合（此前完全没被 remotion still 覆盖）。
// 不做像素 baseline diff（字体 hinting/Chromium/平台漂移、维护负担高）；冒烟已能抓住「某帧整段崩渲染」
// 这一类最高价值失败（如 overlay 短场景的 interpolate 退化区间）。
// env-gated：默认 bun run test:integration 跳过（每帧要 spawn Chromium）；REMOTION_RENDER_TEST=1 才跑。
const RENDER_ENABLED = process.env.REMOTION_RENDER_TEST === "1";
const SAMPLE_DIR = resolve(__dirname, "..", "..", "demo", "data-scheme-sample-2");
const PROPS = join(SAMPLE_DIR, "data-generate.json");

function renderStill(compositionId, frame, outPath, extraArgs = []) {
  // bunx 在本机是 bunx.exe（真 exe），直接 spawn 即可，无需 shell:true（避免 DEP0190 + 注入面）。
  return spawnSync(
    "bunx",
    ["remotion", "still", compositionId, outPath, `--frame=${frame}`, ...extraArgs],
    {encoding: "utf8", timeout: 180000},
  );
}

function pngDimensions(path) {
  const buf = readFileSync(path);
  return {width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length};
}

function assertValidFrame(label, result, outPath) {
  assert.equal(
    result.status,
    0,
    `${label}: remotion still exited ${result.status}\nstderr: ${result.stderr}\nstdout: ${result.stdout}`,
  );
  assert.ok(existsSync(outPath), `${label}: output PNG not written`);
  const {width, height, bytes} = pngDimensions(outPath);
  assert.equal(width, 1920, `${label}: width`);
  assert.equal(height, 1080, `${label}: height`);
  assert.ok(bytes > 50_000, `${label}: PNG only ${bytes} bytes (may be blank)`);
}

// sample-2 时间线（30fps，已按 data-generate.json 核实）：
//   intro f0-116；story-1(topic-2419173, 4 tab) f117-：scene-1 overlay 2222x1820、scene-2 overlay 1080x1080；
//   topic-2415444(2 tab) f1092-；codex-quota-reset(无尺寸 overlay codex-reset.png) f2662-；outro f7392-7470。
const REPORT_FRAMES = [
  {frame: 0, name: "intro start"},
  {frame: 50, name: "intro scrolling (IntroOverview translate)"},
  {frame: 108, name: "story transition (click sound + fade)"},
  {frame: 122, name: "story-1 enter fade-in (storyPause)"},
  {frame: 145, name: "story-1 overlay reveal complete (2222x1820)"},
  {frame: 330, name: "story-1 overlay hide near scene end"},
  {frame: 370, name: "story-1 second overlay image (1080x1080)"},
  {frame: 1100, name: "2-tab story layout (topic-2415444)"},
  {frame: 2700, name: "overlay without dimensions fallback (codex-reset.png)"},
  {frame: 7430, name: "outro"},
];

for (const {frame, name} of REPORT_FRAMES) {
  test(
    `AiDailyReport renders: ${name} (frame ${frame})`,
    {skip: !RENDER_ENABLED ? "set REMOTION_RENDER_TEST=1 to run render smoke tests" : false},
    () => {
      const dir = mkdtempSync(join(tmpdir(), "remotion-frame-"));
      try {
        const out = join(dir, `frame-${frame}.png`);
        const result = renderStill("AiDailyReport", frame, out, [
          `--props=${PROPS}`,
          `--public-dir=${SAMPLE_DIR}`,
        ]);
        assertValidFrame(`frame ${frame} (${name})`, result, out);
      } finally {
        rmSync(dir, {recursive: true, force: true});
      }
    },
  );
}

// Root.tsx 的 Layout-Tests 三个布局预览组合：各自渲染一帧（用 defaultProps，不需 --props）。
for (const compositionId of ["TwoTabLayout", "FourTabLayout", "FiveTabLayout"]) {
  test(
    `${compositionId} layout preview renders a valid 1920x1080 frame`,
    {skip: !RENDER_ENABLED ? "set REMOTION_RENDER_TEST=1 to run render smoke tests" : false},
    () => {
      const dir = mkdtempSync(join(tmpdir(), "remotion-layout-"));
      try {
        const out = join(dir, `${compositionId}.png`);
        const result = renderStill(compositionId, 45, out, [`--public-dir=${SAMPLE_DIR}`]);
        assertValidFrame(compositionId, result, out);
      } finally {
        rmSync(dir, {recursive: true, force: true});
      }
    },
  );
}
