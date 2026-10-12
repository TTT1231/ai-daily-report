import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
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
  ...readSpeechSettings(),
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

test("invalid pronunciation dictionaries fail before requesting paid synthesis", () => {
  const dir = mkdtempSync(join(tmpdir(), "tts-pronunciation-"));
  const dictionaryPath = join(dir, "pronunciation.json");
  try {
    for (const [dictionary, message] of [
      [{}, /tone array/],
      [{tone: ["missing replacement"]}, /original\/replacement/],
      [{tone: ["Dogwood/one", "Dogwood/two"]}, /Duplicate TTS pronunciation/],
    ]) {
      writeFileSync(dictionaryPath, JSON.stringify(dictionary));
      assert.throws(() => readSpeechSettings(dictionaryPath), message);
    }
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
