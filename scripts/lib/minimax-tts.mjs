import {setTimeout as defaultSleep} from "node:timers/promises";

export function createMinimaxClient({
  apiKey,
  endpoint,
  model,
  voiceId,
  speed,
  vol,
  pitch,
  requestIntervalMs = 2200,
  maxRetries = 5,
  rateLimitRetryMs = 60000,
  timeoutMs = 60000,
  fetch = globalThis.fetch,
  sleep = defaultSleep,
}) {
  let lastRequestStartedAt = 0;

  async function waitForRequestSlot() {
    const remainingMs =
      lastRequestStartedAt + requestIntervalMs - Date.now();
    if (remainingMs > 0) {
      await sleep(remainingMs);
    }
    lastRequestStartedAt = Date.now();
  }

  return async function synthesize(text) {
    for (let attempt = 0; ; attempt++) {
      await waitForRequestSlot();

      let response;
      let raw;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          // 防止 MiniMax 连接挂起导致整条 TTS 管线无限阻塞（只能 Ctrl+C 中断事务）。
          // 超时会抛出 AbortError/TimeoutError，被下方网络错误分支按 maxRetries 重试。
          signal: globalThis.AbortSignal.timeout(timeoutMs),
          body: JSON.stringify({
            model,
            text,
            stream: false,
            language_boost: "Chinese",
            voice_setting: {
              voice_id: voiceId,
              speed,
              vol,
              pitch,
            },
            audio_setting: {
              sample_rate: 32000,
              bitrate: 128000,
              format: "mp3",
              channel: 1,
            },
            subtitle_enable: false,
            output_format: "hex",
          }),
        });
        raw = await response.text();
      } catch (error) {
        // 瞬时网络抖动（ECONNRESET/ETIMEDOUT/DNS 等）不应让整条 TTS 管线中断；
        // 与 429 一样按 maxRetries 重试后再放弃，避免回滚已合成的进度。
        if (attempt < maxRetries) {
          console.warn(
            `MiniMax 网络请求失败，重试中 (${attempt + 1}/${maxRetries}): ${error.message}`,
          );
          continue;
        }
        throw new Error(
          `MiniMax TTS 网络请求失败（已重试 ${maxRetries} 次）: ${error.message}`,
        );
      }
      let result;
      try {
        result = JSON.parse(raw);
      } catch {
        throw new Error(
          `MiniMax returned non-JSON response (${response.status}): ${raw.slice(0, 300)}`,
        );
      }

      if (!response.ok || result.base_resp?.status_code !== 0) {
        const message =
          result.base_resp?.status_msg ??
          result.message ??
          `HTTP ${response.status}`;
        // 瞬时错误才重试：429 限流 + 5xx 服务端错误（含限流文案）。base_resp 业务错误码
        // （HTTP 200 内的 status_code）多为参数/内容问题，是确定性失败，不重试、直接抛出，
        // 避免对必败请求反复消耗配额。
        const transient =
          response.status === 429 ||
          response.status >= 500 ||
          /rate limit|too many requests/i.test(message);
        if (transient && attempt < maxRetries) {
          // 服务器给了 Retry-After（秒数）就遵守；头缺失或非数值（如 HTTP 日期）则走递增退避。
          // 注意：headers.get 在头缺失时返回 null，Number(null)===0 会误钻进 isFinite 分支、
          // 只等 requestIntervalMs（~2.2s）→ 立刻再撞限流。必须先用 retryAfterRaw != null 区分。
          const retryAfterRaw = response.headers.get("retry-after");
          const retryAfterSeconds = Number(retryAfterRaw);
          const waitMs =
            retryAfterRaw != null && Number.isFinite(retryAfterSeconds)
              ? Math.max(retryAfterSeconds * 1000, requestIntervalMs)
              : rateLimitRetryMs * (attempt + 1);
          console.warn(
            `MiniMax 请求失败（${message}），${Math.ceil(waitMs / 1000)}s 后重试 (${attempt + 1}/${maxRetries}).`,
          );
          await sleep(waitMs);
          continue;
        }
        throw new Error(`MiniMax TTS request failed: ${message}`);
      }

      const audioHex = result.data?.audio;
      const audioLengthMs = result.extra_info?.audio_length;
      if (
        typeof audioHex !== "string" ||
        audioHex.length === 0 ||
        audioHex.length % 2 !== 0 ||
        !/^[0-9a-f]+$/i.test(audioHex)
      ) {
        throw new Error("MiniMax response did not contain valid hex audio.");
      }
      if (!Number.isInteger(audioLengthMs) || audioLengthMs <= 0) {
        throw new Error(
          "MiniMax response did not contain a valid extra_info.audio_length.",
        );
      }

      return {
        audio: Buffer.from(audioHex, "hex"),
        audioLengthMs,
      };
    }
  };
}
