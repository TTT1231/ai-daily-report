import {createHash} from "node:crypto";
import {existsSync} from "node:fs";
import {mkdir, readFile, rename, writeFile} from "node:fs/promises";
import {resolve} from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageDir = resolve(root, "data-scheme");
const audioDir = resolve(packageDir, "audio");
const rawDataPath = resolve(packageDir, "data.json");
const generatedDataPath = resolve(packageDir, "data-generate.json");
const tempGeneratedDataPath = resolve(packageDir, "data-generate.json.tmp");

const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");
const apiKey = process.env.MINIMAX_API_KEY;
const endpoint =
  process.env.MINIMAX_TTS_ENDPOINT ?? "https://api.minimaxi.com/v1/t2a_v2";
const model = process.env.MINIMAX_TTS_MODEL ?? "speech-2.8-hd";
const voiceId =
  process.env.MINIMAX_TTS_VOICE_ID ?? "Chinese (Mandarin)_Warm_Girl";
const speed = readNumberEnv("MINIMAX_TTS_SPEED", 1, 0.5, 2);
const vol = readNumberEnv("MINIMAX_TTS_VOLUME", 1, Number.EPSILON, 10);
const pitch = readNumberEnv("MINIMAX_TTS_PITCH", 0, -12, 12);
const tailPaddingMs = readIntegerEnv("TTS_TAIL_PADDING_MS", 250, 0);

function readNumberEnv(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a number between ${min} and ${max}.`);
  }
  return value;
}

function readIntegerEnv(name, fallback, min) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${name} must be an integer greater than or equal to ${min}.`);
  }
  return value;
}

function getSceneHash(text) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        provider: "minimax",
        endpoint,
        model,
        voiceId,
        speed,
        vol,
        pitch,
        text,
      }),
    )
    .digest("hex");
}

function isReusable(scene, cachedScene, hash, outputPath) {
  return (
    !force &&
    existsSync(outputPath) &&
    cachedScene?.audioSrc === `audio/${scene.id}.mp3` &&
    cachedScene?.tts?.hash === hash &&
    Number.isInteger(cachedScene.tts.audioLengthMs) &&
    cachedScene.tts.audioLengthMs > 0
  );
}

async function synthesize(text) {
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
    throw new Error(`MiniMax returned non-JSON response (${response.status}): ${raw.slice(0, 300)}`);
  }

  if (!response.ok || result.base_resp?.status_code !== 0) {
    const message =
      result.base_resp?.status_msg ?? result.message ?? `HTTP ${response.status}`;
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
    throw new Error("MiniMax response did not contain a valid extra_info.audio_length.");
  }

  return {
    audio: Buffer.from(audioHex, "hex"),
    audioLengthMs,
  };
}

if (!dryRun && !apiKey) {
  console.error(
    "MINIMAX_API_KEY is required. Set it in the environment, then run npm run tts.",
  );
  process.exit(1);
}

const report = JSON.parse(await readFile(rawDataPath, "utf8"));
const previousReport = existsSync(generatedDataPath)
  ? JSON.parse(await readFile(generatedDataPath, "utf8"))
  : null;
const cachedScenes = new Map(
  (previousReport?.stories ?? []).flatMap((story) =>
    story.scenes.map((scene) => [scene.id, scene]),
  ),
);
const scenes = report.stories.flatMap((story) => story.scenes);
const sceneIds = new Set();

for (const scene of scenes) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(scene.id ?? "")) {
    throw new Error(`Scene id "${scene.id}" must contain only lowercase letters, numbers, and hyphens.`);
  }
  if (sceneIds.has(scene.id)) {
    throw new Error(`Scene id "${scene.id}" is duplicated. Scene ids must be globally unique.`);
  }
  if (typeof scene.subtitle !== "string" || scene.subtitle.trim().length === 0) {
    throw new Error(`Scene "${scene.id}" must have a non-empty subtitle.`);
  }
  if (scene.subtitle.length >= 10000) {
    throw new Error(`Scene "${scene.id}" subtitle must contain fewer than 10000 characters.`);
  }
  sceneIds.add(scene.id);
}

await mkdir(audioDir, {recursive: true});

console.log(
  `${dryRun ? "Planning" : "Generating"} ${scenes.length} scene voiceover(s) with ${model} / ${voiceId}.`,
);

let cursorMs = 0;
let generated = 0;
let reused = 0;

for (const scene of scenes) {
  const outputPath = resolve(audioDir, `${scene.id}.mp3`);
  const hash = getSceneHash(scene.subtitle);
  const cachedScene = cachedScenes.get(scene.id);
  const reusable = isReusable(scene, cachedScene, hash, outputPath);

  if (dryRun) {
    console.log(
      `- ${scene.id}: ${reusable ? "reuse" : "generate"} (${scene.subtitle.length} chars)`,
    );
    continue;
  }

  let audioLengthMs;
  if (reusable) {
    audioLengthMs = cachedScene.tts.audioLengthMs;
    reused++;
    console.log(`- ${scene.id}: reused ${audioLengthMs}ms`);
  } else {
    const result = await synthesize(scene.subtitle);
    audioLengthMs = result.audioLengthMs;
    await writeFile(outputPath, result.audio);
    generated++;
    console.log(`- ${scene.id}: generated ${audioLengthMs}ms`);
  }

  scene.audioSrc = `audio/${scene.id}.mp3`;
  scene.timing = {
    startMs: cursorMs,
    durationMs: audioLengthMs + tailPaddingMs,
  };
  scene.tts = {
    provider: "minimax",
    hash,
    model,
    voiceId,
    speed,
    vol,
    pitch,
    audioLengthMs,
    tailPaddingMs,
  };
  cursorMs += scene.timing.durationMs;
}

if (dryRun) {
  console.log("Dry run complete. No API requests were sent and no files were changed.");
  process.exit(0);
}

await writeFile(tempGeneratedDataPath, `${JSON.stringify(report, null, 2)}\n`);
await rename(tempGeneratedDataPath, generatedDataPath);
console.log(
  `TTS complete: generated ${generated}, reused ${reused}, total timeline ${cursorMs}ms.`,
);
