import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync, spawn} from "node:child_process";
import {createServer} from "node:http";
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync} from "node:fs";
import {join, dirname, resolve} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath, pathToFileURL} from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const generateTts = resolve(__dirname, "..", "..", "scripts", "render", "generate-tts.mjs");
const mockFetchUrl = pathToFileURL(resolve(__dirname, "..", "helpers", "mock-minimax-fetch.mjs"));
const mockDir = resolve(__dirname, "..", "mock");
// raw fixture 见 test/mock/raw-report.json，不硬编码
const rawFixture = JSON.parse(readFileSync(join(mockDir, "raw-report.json"), "utf8"));
for (const story of rawFixture.stories) for (const scene of story.scenes) scene.overlayImg = "images/codex-reset.png";
const rawDataJson = JSON.stringify(rawFixture);

// 起一个带 data.json + audio/ 的临时 data-scheme（generate-tts 经 DATA_SCHEME_DIR 读它）
function seedTempDataScheme() {
  const dir = mkdtempSync(join(tmpdir(), "tts-boundary-"));
  mkdirSync(join(dir, "audio"), {recursive: true});
  writeFileSync(join(dir, "data.json"), rawDataJson);
  mkdirSync(join(dir, "images"), {recursive: true});
  writeFileSync(join(dir, "images/codex-reset.png"), readFileSync(join(mockDir, "images/codex-reset.png")));
  return dir;
}

function runTtsSync(args, envExtra) {
  const dir = seedTempDataScheme();
  const result = spawnSync(process.execPath, [generateTts, ...args], {
    env: {...process.env, DATA_SCHEME_DIR: dir, ...envExtra},
    encoding: "utf8",
  });
  return {dir, code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? ""};
}

// generate-tts 的输入输出边界（配置/失败路径，均在调用真实 MiniMax 之前或用 mock 挡住）。

// dry-run：打印计划、不调 API、不落盘、exit 0（不需要 API key）
test("generate-tts --dry-run exits 0 without calling MiniMax or writing anything", () => {
  const {dir, code, stdout, stderr} = runTtsSync(["--dry-run"], {});
  try {
    assert.equal(code, 0, `dry-run exited ${code}\nstderr: ${stderr}`);
    assert.match(stdout, /Dry run complete|Planning/);
    assert.doesNotMatch(stdout, /outro-ending/);
    assert.ok(!existsSync(join(dir, "data-generate.json")), "dry-run must not write data-generate.json");
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test("direct TTS rejects reporting scaffolding before calling MiniMax and preserves existing output", () => {
  const dir = seedTempDataScheme();
  try {
    const report = JSON.parse(rawDataJson);
    report.stories[0].scenes[0].subtitle = "Typora官方补充说明，现有V1付费用户升级至V2可免费，无需再次购买。";
    const raw = JSON.stringify(report);
    const previous = readFileSync(join(mockDir, "generated-report.json"), "utf8");
    writeFileSync(join(dir, "data.json"), raw);
    writeFileSync(join(dir, "data-generate.json"), previous);
    const noRequests = "data:text/javascript," + encodeURIComponent("globalThis.fetch = () => {throw new Error('Unexpected TTS request before copy check');};");
    const result = spawnSync(process.execPath, ["--import", noRequests, generateTts], {
      env: {...process.env, DATA_SCHEME_DIR: dir, TTS_REQUIRE: "true", MINIMAX_API_KEY: "test-key"}, encoding: "utf8",
    });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /scenes\[0\]\.subtitle: news-copy template \[supplementary-preface\]/);
    assert.doesNotMatch(result.stderr, /Unexpected TTS request/);
    assert.equal(readFileSync(join(dir, "data.json"), "utf8"), raw);
    assert.equal(readFileSync(join(dir, "data-generate.json"), "utf8"), previous);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

// 非 dry-run 缺 API key：exit 2（发生在调用 MiniMax 之前，不消耗配额）
test("disabled TTS ignores voice configuration", () => {
  const {dir, code, stdout} = runTtsSync([], {
    TTS_REQUIRE: "false",
    MINIMAX_TTS_SPEED: "invalid",
  });
  try {
    assert.equal(code, 0);
    assert.match(stdout, /skipping TTS/);
    assert.ok(!existsSync(join(dir, "data-generate.json")));
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test("generate-tts exits 2 when MINIMAX_API_KEY is missing, before any MiniMax call", () => {
  const {dir, code, stderr} = runTtsSync([], {MINIMAX_API_KEY: ""});
  try {
    assert.equal(code, 2, `expected exit 2, got ${code}\nstderr: ${stderr}`);
    assert.match(stderr, /MINIMAX_API_KEY is required/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

// MiniMax 非法响应（base_resp.status_code != 0）：generate-tts 失败、abort 事务、exit 非零、不发布 manifest。
// 用 async spawn + 本地 mock server（spawnSync 会阻塞本进程事件循环，mock 收不到请求）。
test("generate-tts aborts and exits non-zero when MiniMax returns a non-zero status_code", async () => {
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({base_resp: {status_code: 1001, status_msg: "test failure"}}));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const {port} = server.address();
  const mockImport = new URL(mockFetchUrl);
  mockImport.searchParams.set("endpoint", `http://127.0.0.1:${port}`);
  const dir = seedTempDataScheme();
  try {
    const result = await new Promise((resolve) => {
      const child = spawn(process.execPath, ["--import", mockImport.href, generateTts], {
        env: {
          ...process.env,
          DATA_SCHEME_DIR: dir,
          MINIMAX_API_KEY: "test-key",
          REQUIRE_VOICE_QUALITY_FFMPEG: "false",
          TTS_REQUIRE: "true",
        },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => {
        stdout += d;
      });
      child.stderr.on("data", (d) => {
        stderr += d;
      });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve({status: null, stdout, stderr});
      }, 120000);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({status: code, stdout, stderr});
      });
    });
    assert.notEqual(result.status, 0, `expected non-zero exit, got ${result.status}\nstderr: ${result.stderr}`);
    assert.match(result.stderr, /MiniMax/i);
    assert.ok(
      !existsSync(join(dir, "data-generate.json")),
      "failed run must abort the transaction and not publish data-generate.json",
    );
  } finally {
    server.close();
    rmSync(dir, {recursive: true, force: true});
  }
});


test("TTS rejects a text-only continuation before generating audio", () => {
  const dir = seedTempDataScheme();
  try {
    const report = JSON.parse(rawDataJson);
    delete report.stories[0].scenes[1].overlayImg;
    writeFileSync(join(dir, "data.json"), JSON.stringify(report));
    const result = spawnSync(process.execPath, [generateTts, "--dry-run"], {
      env: {...process.env, DATA_SCHEME_DIR: dir, TTS_REQUIRE: "true"}, encoding: "utf8",
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /every narration scene requires evidence/);
    assert.ok(!existsSync(join(dir, "data-generate.json")));
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
