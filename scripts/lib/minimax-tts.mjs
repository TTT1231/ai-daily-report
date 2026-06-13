import {setTimeout as sleep} from "node:timers/promises";

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

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
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

      const raw = await response.text();
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
        const rateLimited =
          response.status === 429 || /rate limit|too many requests/i.test(message);
        if (rateLimited && attempt < maxRetries) {
          const retryAfterSeconds = Number(response.headers.get("retry-after"));
          const waitMs = Number.isFinite(retryAfterSeconds)
            ? Math.max(retryAfterSeconds * 1000, requestIntervalMs)
            : rateLimitRetryMs * (attempt + 1);
          console.warn(
            `MiniMax RPM limit reached; retrying in ${Math.ceil(waitMs / 1000)}s (${attempt + 1}/${maxRetries}).`,
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
