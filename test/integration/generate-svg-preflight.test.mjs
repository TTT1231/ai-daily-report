import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync} from "node:fs";
import {join, dirname, resolve} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath, pathToFileURL} from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mockDir = resolve(__dirname, "..", "mock");
const preflightModule = resolve(__dirname, "..", "..", "scripts", "lib", "generate-svg-preflight.mjs");
// ESM import 在 Windows 上要求 file:// URL，不能是裸 C:\ 路径。
const preflightModuleUrl = pathToFileURL(preflightModule).href;

// generated-icons.json 是带 tab.icon 引用 icons/*.svg 的最小 generate 形态报告。
const generatedIconsJson = readFileSync(join(mockDir, "generated-icons.json"), "utf8");

// 临时 data-scheme 镜像："mock:<file>" 从 test/mock 拷真实素材。
function seedDataScheme(files) {
  const dir = mkdtempSync(join(tmpdir(), "svg-preflight-"));
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

// getGenerateSvgPreflight 在 import 时就通过 paths.mjs 锁定 dataDir（读 DATA_SCHEME_DIR），
// 所以每个用例必须在独立子进程里跑，env 指向各自的临时目录。runner 是一段固定 ESM，
// 从 env 读 force 标志，import 目标模块，调用并打印 JSON 结果到 stdout。
const runner = `
import {getGenerateSvgPreflight} from ${JSON.stringify(preflightModuleUrl)};
const force = process.env.PREFLIGHT_FORCE === "1";
try {
  const result = await getGenerateSvgPreflight({force});
  process.stdout.write("JSON\\n" + JSON.stringify(result));
} catch (error) {
  process.stdout.write("ERROR\\n" + (error && error.stack ? error.stack : String(error)));
  process.exitCode = 1;
}
`;

function runPreflight(dataSchemeDir, {force = false} = {}) {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", runner], {
    env: {...process.env, DATA_SCHEME_DIR: dataSchemeDir, PREFLIGHT_FORCE: force ? "1" : "0"},
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`runner exited ${result.status}\nstderr: ${result.stderr}`);
  }
  const out = result.stdout ?? "";
  const nl = out.indexOf("\n");
  const tag = nl === -1 ? out : out.slice(0, nl);
  const body = nl === -1 ? "" : out.slice(nl + 1);
  if (tag === "ERROR") {
    throw new Error(`runner threw:\n${body}`);
  }
  return JSON.parse(body);
}

// ---------- 用例 1：force 恒跑 ----------
test("getGenerateSvgPreflight({force:true}) returns skip:false", () => {
  // 即便没有任何 data-scheme 内容，force 也短路返回 skip:false，不读 data-generate.json。
  const dir = seedDataScheme({});
  try {
    const result = runPreflight(dir, {force: true});
    assert.equal(result.skip, false);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

// ---------- 用例 2：data-generate.json 不存在 → 无法 preflight，跑生成 ----------
test("getGenerateSvgPreflight returns skip:false (cannot be preflighted) when data-generate.json is missing", () => {
  const dir = seedDataScheme({});
  try {
    const result = runPreflight(dir, {force: false});
    assert.equal(result.skip, false);
    assert.match(result.reason, /cannot be preflighted/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

// ---------- 用例 3：所有 icon 齐全 → skip ----------
test("getGenerateSvgPreflight returns skip:true with empty iconTargets when every referenced icon exists", () => {
  const dir = seedDataScheme({
    "data-generate.json": generatedIconsJson,
    // generated-icons.json 里 tab.icon 全指向 icons/test-icon-sample-1.svg，铺一份即覆盖所有引用。
    "icons/test-icon-sample-1.svg": "mock:test-icon-sample-1.svg",
  });
  try {
    const result = runPreflight(dir, {force: false});
    assert.equal(result.skip, true, `expected skip:true, reason: ${result.reason}`);
    assert.deepEqual(result.iconTargets, []);
    assert.equal(result.errors.length, 0);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

// ---------- 用例 4：有 icon 缺失 → 不 skip，带 errors 与 iconTargets ----------
test("getGenerateSvgPreflight returns skip:false with errors and iconTargets when icons are missing", () => {
  // 用 generated-icons.json 但故意不铺任何 svg 文件 → 所有引用都缺失。
  const dir = seedDataScheme({
    "data-generate.json": generatedIconsJson,
  });
  try {
    const result = runPreflight(dir, {force: false});
    assert.equal(result.skip, false);
    assert.ok(result.errors.length > 0, `expected errors, got: ${JSON.stringify(result.errors)}`);
    assert.ok(result.iconTargets.length > 0, `expected iconTargets, got: ${JSON.stringify(result.iconTargets)}`);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

// ---------- 防御性自检：fixture 仍指向预期的单一 svg ----------
test("generated-icons.json fixture references test-icon-sample-1.svg", () => {
  const fixture = JSON.parse(generatedIconsJson);
  const icons = new Set();
  for (const story of [fixture.intro, ...(fixture.stories ?? [])]) {
    for (const tab of story.tabs ?? []) icons.add(tab.icon);
  }
  assert.ok(icons.has("icons/test-icon-sample-1.svg"), "fixture drift: expected test-icon-sample-1.svg reference");
  // 用例 4 依赖「不铺 svg 即全缺」，确认 fixture 只引用这一个文件。
  assert.equal(icons.size, 1);
});
