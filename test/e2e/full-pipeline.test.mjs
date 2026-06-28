import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync, spawn} from "node:child_process";
import {createServer} from "node:http";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import {join, dirname, resolve} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 端到端验收：整条 JS 流程一条跑完 ——
// fixture raw data.json → generate-tts（mock MiniMax）产出 data-generate.json → remotion still 验收渲染。
// 这是真正的 e2e：跨多个真实模块（report-builder / tts-timeline / generated-output / validateReport / Remotion），
// 用 mock 挡住唯一的外部付费边界（MiniMax），remotion still 与实际渲染等效。
const generateTts = resolve(__dirname, "..", "..", "scripts", "render", "generate-tts.mjs");
const mockDir = resolve(__dirname, "..", "mock");
// 用真实 mp3 的字节作 mock 音频（合法 hex），让落盘的 audio/*.mp3 是有效文件、remotion 不报缺文件
const audioHex = readFileSync(join(mockDir, "test-audio-sample-1.mp3")).toString("hex");

// mock 数据见 test/mock/raw-report.json（不硬编码）
const RAW_DATA_JSON = readFileSync(join(mockDir, "raw-report.json"), "utf8");

function pngDimensions(path) {
  const buf = readFileSync(path);
  return {width: buf.readUInt32BE(16), height: buf.readUInt32BE(20)};
}

test(
  "e2e: data.json → tts → data-generate.json → remotion still renders a 1920x1080 frame",
  async () => {
    // 1) mock MiniMax t2a_v2：对所有 POST 返回固定 hex 音频 + audio_length
    const server = createServer((_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          base_resp: {status_code: 0},
          data: {audio: audioHex},
          extra_info: {audio_length: 1500},
        }),
      );
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const {port} = server.address();

    const dir = mkdtempSync(join(tmpdir(), "e2e-pipeline-"));
    try {
      mkdirSync(join(dir, "audio"), {recursive: true});
      writeFileSync(join(dir, "data.json"), RAW_DATA_JSON);

      // 2) 跑 generate-tts：DATA_SCHEME_DIR 指向临时目录，MiniMax 指向 mock，关 ffmpeg/限速。
      //    用 spawn（非 spawnSync）：mock server 跑在本测试进程里，spawnSync 会阻塞事件循环，
      //    导致 mock 收不到子进程的请求、fetch 挂满 60s 超时（进程内 HTTP mock + spawnSync 不兼容）。
      const tts = await new Promise((resolve) => {
        const child = spawn(process.execPath, [generateTts], {
          env: {
            ...process.env,
            DATA_SCHEME_DIR: dir,
            MINIMAX_TTS_ENDPOINT: `http://127.0.0.1:${port}`,
            MINIMAX_API_KEY: "e2e-test-key",
            MINIMAX_TTS_REQUEST_INTERVAL_MS: "0",
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
      assert.equal(
        tts.status,
        0,
        `generate-tts exited ${tts.status}\nstderr: ${tts.stderr}\nstdout: ${tts.stdout}`,
      );

      // 3) 验收 data-generate.json：结构完整、每个 scene 都写入了 timing + audioSrc
      const genPath = join(dir, "data-generate.json");
      assert.ok(existsSync(genPath), "generate-tts did not write data-generate.json");
      const gen = JSON.parse(readFileSync(genPath, "utf8"));
      assert.ok(gen.intro && gen.outro, "generated report missing intro/outro");
      const scenes = [gen.intro, ...gen.stories, gen.outro].flatMap((s) => s.scenes);
      assert.ok(scenes.length >= 4, "expected intro + story + outro scenes");
      for (const scene of scenes) {
        assert.ok(scene.timing && Number.isInteger(scene.timing.startMs), `${scene.id} missing timing`);
        assert.ok(scene.audioSrc, `${scene.id} missing audioSrc`);
        assert.ok(scene.tts && scene.tts.audioLengthMs === 1500, `${scene.id} tts.audioLengthMs`);
      }

      // 4) 验收渲染：remotion still 出 intro 帧 + 一个 story 帧。
      //    story 帧覆盖 nav active / 字幕进度 / audio 引用，不只 intro。
      const fps = 30;
      const introDurMs = gen.intro.scenes.reduce((a, s) => a + s.timing.durationMs, 0);
      const storyFrame = Math.round((introDurMs / 1000) * fps) + 18 + 30; // intro + 过渡 + 1s 进首个 story
      for (const [label, frame] of [["intro", 0], ["story", storyFrame]]) {
        const out = join(dir, `frame-${label}.png`);
        const render = spawnSync(
          "bunx",
          ["remotion", "still", "AiDailyReport", out, `--frame=${frame}`, `--props=${genPath}`, `--public-dir=${dir}`],
          {encoding: "utf8", timeout: 180000},
        );
        assert.equal(
          render.status,
          0,
          `${label}: remotion still exited ${render.status}\nstderr: ${render.stderr}\nstdout: ${render.stdout}`,
        );
        assert.ok(existsSync(out), `${label}: frame not written`);
        const {width, height} = pngDimensions(out);
        assert.equal(width, 1920, `${label}: width`);
        assert.equal(height, 1080, `${label}: height`);
      }
    } finally {
      server.close();
      rmSync(dir, {recursive: true, force: true});
    }
  },
);
