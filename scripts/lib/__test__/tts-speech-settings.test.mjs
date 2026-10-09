import test from "node:test";
import assert from "node:assert/strict";
import {
  readSpeechSettings,
  speechOptionsForText,
  getSceneHash,
} from "../tts-speech-settings.mjs";
import { createMinimaxClient } from "../minimax-tts.mjs";

const config = {
  endpoint: "https://example.com/tts",
  model: "speech-2.8-hd",
  voiceId: "test",
  speed: 1,
  vol: 1,
  pitch: 0,
  ...readSpeechSettings({}),
};

test("mixed-language defaults and dictionary preserve subtitle text", async () => {
  const subtitle =
    "Dogwood Local Engine 通过 Cyber Verification Program 校验。";
  let request;
  const synthesize = createMinimaxClient({
    ...config,
    apiKey: "test",
    requestIntervalMs: 0,
    fetch: async (_url, options) => {
      request = JSON.parse(options.body);
      return new Response(
        JSON.stringify({
          base_resp: { status_code: 0 },
          data: { audio: "aabb" },
          extra_info: { audio_length: 1234 },
        }),
      );
    },
  });
  await synthesize(subtitle);
  assert.equal(request.text, subtitle);
  assert.equal(request.language_boost, "auto");
  assert.equal(request.voice_setting.speed, 1);
  assert.equal(request.voice_setting.text_normalization, true);
  assert.equal(request.pronunciation_dict.tone.length, 3);
});

test("language, normalization, speed, voice and relevant pronunciations invalidate audio cache", () => {
  const text = "Dogwood 本地引擎。";
  const original = getSceneHash(text, config);
  for (const change of [
    { languageBoost: "Chinese" },
    { textNormalization: false },
    { speed: 1.18 },
    { voiceId: "other" },
    { pronunciationTone: ["Dogwood/dog wood"] },
  ])
    assert.notEqual(getSceneHash(text, { ...config, ...change }), original);
  assert.equal(
    getSceneHash(text, {
      ...config,
      pronunciationTone: [...config.pronunciationTone, "Other/other"],
    }),
    original,
  );
  assert.deepEqual(
    speechOptionsForText("普通中文。", config).pronunciationTone,
    [],
  );
});

test("invalid speech settings fail before requesting paid synthesis", () => {
  assert.throws(
    () => readSpeechSettings({ MINIMAX_TTS_LANGUAGE_BOOST: "typo" }),
    /LANGUAGE_BOOST/,
  );
  assert.throws(
    () => readSpeechSettings({ MINIMAX_TTS_TEXT_NORMALIZATION: "yes" }),
    /TEXT_NORMALIZATION/,
  );
});
