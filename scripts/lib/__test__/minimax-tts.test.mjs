import test from "node:test";
import assert from "node:assert/strict";
import { createMinimaxClient } from "../minimax-tts.mjs";

// TTS 管线串行合成很多条字幕，瞬时网络抖动（ECONNRESET/ETIMEDOUT/DNS）不应让整条管线
// 中断并回滚已合成的进度，而应像 429 一样按 maxRetries 重试后再放弃。
test("retries on network errors up to maxRetries before throwing", async () => {
  let calls = 0;
  const failingFetch = async () => {
    calls++;
    throw new Error("ECONNRESET");
  };
  const synthesize = createMinimaxClient({
    apiKey: "key",
    endpoint: "https://example.com/tts",
    model: "speech-test",
    voiceId: "voice-test",
    speed: 1,
    vol: 1,
    pitch: 0,
    requestIntervalMs: 0,
    maxRetries: 2,
    fetch: failingFetch,
  });

  await assert.rejects(synthesize("hi"), /网络请求失败|ECONNRESET/);
  assert.equal(calls, 3); // 1 次初始 + 2 次重试
});

// 瞬时 5xx 服务端错误不应让整条 TTS 管线中断（已合成 scene 全废），与 429/网络错误一样重试。
test("retries on 5xx server errors up to maxRetries before throwing", async () => {
  let calls = 0;
  const serverErrorFetch = async () => {
    calls++;
    // body 必须是合法 JSON（{}），否则会在 JSON.parse 提前抛出、绕过 5xx 重试分支。
    return new globalThis.Response("{}", { status: 502 });
  };
  const synthesize = createMinimaxClient({
    apiKey: "key",
    endpoint: "https://example.com/tts",
    model: "speech-test",
    voiceId: "voice-test",
    speed: 1,
    vol: 1,
    pitch: 0,
    requestIntervalMs: 0,
    maxRetries: 2,
    fetch: serverErrorFetch,
    sleep: async () => {}, // no-op：避免退避真睡 60s
  });

  await assert.rejects(synthesize("hi"), /MiniMax TTS request failed|502/);
  assert.equal(calls, 3); // 1 次初始 + 2 次重试
});

// 429 但缺失 Retry-After 头时，必须走递增退避（rateLimitRetryMs），而不是 Number(null)=0
// 钻进 isFinite 只等 requestIntervalMs（~2.2s）→ 立刻再撞限流。本测试用 requestIntervalMs=0
// 把 bug 放大：修复前会 sleep(0)，修复后 sleep(rateLimitRetryMs)。
test("429 without Retry-After header backs off with rateLimitRetryMs, not requestIntervalMs", async () => {
  const sleeps = [];
  const recordingSleep = async (ms) => {
    sleeps.push(ms);
  };
  const rateLimitedFetch = async () => new globalThis.Response("{}", { status: 429 }); // 无 Retry-After 头

  const synthesize = createMinimaxClient({
    apiKey: "key",
    endpoint: "https://example.com/tts",
    model: "speech-test",
    voiceId: "voice-test",
    speed: 1,
    vol: 1,
    pitch: 0,
    requestIntervalMs: 0, // 设为 0：若误走 requestIntervalMs 分支会 sleep(0)，暴露 bug
    rateLimitRetryMs: 1000,
    maxRetries: 1,
    fetch: rateLimitedFetch,
    sleep: recordingSleep,
  });

  await assert.rejects(synthesize("hi"), /429/);
  // 头缺失 → 退避分支 rateLimitRetryMs*(attempt+1) = 1000*1 = 1000ms（仅 1 次重试）。
  assert.deepEqual(sleeps, [1000]);
});
