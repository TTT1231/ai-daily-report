import {MINIMAX_TTS_DEFAULTS} from "../../scripts/lib/minimax-tts.mjs";

// 仅在测试子进程预加载：保留生产节流策略，将 HTTP 边界注入为本地 mock。
const endpoint = new URL(import.meta.url).searchParams.get("endpoint");
if (new URL(endpoint).hostname !== "127.0.0.1") {
  throw new Error("Mock TTS endpoint must be a local test server.");
}
const realFetch = globalThis.fetch;
globalThis.fetch = (url, options) => {
  if (url !== MINIMAX_TTS_DEFAULTS.endpoint) {
    throw new Error(`Unexpected TTS request endpoint: ${url}`);
  }
  return realFetch(endpoint, options);
};
