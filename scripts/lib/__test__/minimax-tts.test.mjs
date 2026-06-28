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
