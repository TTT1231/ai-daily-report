import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { rootDir } from "./paths.mjs";

export const MINIMAX_SPEECH_DEFAULTS = Object.freeze({
  languageBoost: "auto",
  textNormalization: true,
});

// Centralize request-affecting settings so previews, production, and cache keys agree.
export function readSpeechSettings(
  dictionaryPath = resolve(rootDir, "config/tts-pronunciation.json"),
) {
  const dictionary = JSON.parse(readFileSync(dictionaryPath, "utf8"));
  if (!Array.isArray(dictionary.tone)) {
    throw new Error("TTS pronunciation dictionary must contain a tone array.");
  }
  const originals = new Set();
  for (const entry of dictionary.tone) {
    const slash = typeof entry === "string" ? entry.indexOf("/") : -1;
    if (
      slash < 1 ||
      !entry.slice(slash + 1).trim() ||
      !entry.slice(0, slash).trim()
    ) {
      throw new Error(
        "TTS pronunciation entries must use original/replacement format.",
      );
    }
    const original = entry.slice(0, slash);
    if (originals.has(original))
      throw new Error(`Duplicate TTS pronunciation: ${original}`);
    originals.add(original);
  }
  return {
    ...MINIMAX_SPEECH_DEFAULTS,
    pronunciationTone: dictionary.tone,
  };
}

export function speechOptionsForText(text, config) {
  return {
    languageBoost: config.languageBoost ?? MINIMAX_SPEECH_DEFAULTS.languageBoost,
    textNormalization: config.textNormalization ?? MINIMAX_SPEECH_DEFAULTS.textNormalization,
    // An unrelated dictionary correction must not regenerate the whole report.
    pronunciationTone: (config.pronunciationTone ?? []).filter((entry) =>
      text.includes(entry.slice(0, entry.indexOf("/"))),
    ),
  };
}

export function getSceneHash(text, config) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        provider: "minimax",
        endpoint: config.endpoint,
        model: config.model,
        voiceId: config.voiceId,
        speed: config.speed,
        vol: config.vol,
        pitch: config.pitch,
        ...speechOptionsForText(text, config),
        text,
      }),
    )
    .digest("hex");
}
