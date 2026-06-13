import {createHash} from "node:crypto";
import {existsSync} from "node:fs";
import {resolve} from "node:path";
import {buildGeneratedReport, collectTimelineScenes} from "./lib/report-builder.mjs";
import {createGeneratedOutputTransaction} from "./lib/generated-output.mjs";
import {createMinimaxClient} from "./lib/minimax-tts.mjs";
import {
  dataDir,
  generatedDataPath,
  rawDataPath,
  readJson,
} from "./lib/paths.mjs";
import {validateReport} from "./lib/report-validation.mjs";

const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");
const apiKey = process.env.MINIMAX_API_KEY;
const config = {
  endpoint:
    process.env.MINIMAX_TTS_ENDPOINT ?? "https://api.minimaxi.com/v1/t2a_v2",
  model: process.env.MINIMAX_TTS_MODEL ?? "speech-2.8-hd",
  voiceId:
    process.env.MINIMAX_TTS_VOICE_ID ?? "Chinese (Mandarin)_Warm_Girl",
  speed: readNumberEnv("MINIMAX_TTS_SPEED", 1, 0.5, 2),
  vol: readNumberEnv("MINIMAX_TTS_VOLUME", 1, Number.EPSILON, 10),
  pitch: readNumberEnv("MINIMAX_TTS_PITCH", 0, -12, 12),
  tailPaddingMs: readIntegerEnv("TTS_TAIL_PADDING_MS", 250, 0),
  requestIntervalMs: readIntegerEnv("MINIMAX_TTS_REQUEST_INTERVAL_MS", 2200, 0),
  maxRetries: readIntegerEnv("MINIMAX_TTS_MAX_RETRIES", 5, 0),
  rateLimitRetryMs: readIntegerEnv("MINIMAX_TTS_RATE_LIMIT_RETRY_MS", 60000, 1000),
};

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
        endpoint: config.endpoint,
        model: config.model,
        voiceId: config.voiceId,
        speed: config.speed,
        vol: config.vol,
        pitch: config.pitch,
        text,
      }),
    )
    .digest("hex");
}

function createSceneCache(previousReport) {
  return new Map(
    collectTimelineScenes(previousReport ?? {}).map((scene) => [scene.id, scene]),
  );
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

if (!dryRun && !apiKey) {
  console.error("MINIMAX_API_KEY is required. Set it in the environment, then run bun run tts.");
  process.exit(1);
}

let rawReport;
let previousReport = null;
try {
  rawReport = await readJson(rawDataPath, "data-scheme/data.json");
  if (existsSync(generatedDataPath)) {
    previousReport = await readJson(
      generatedDataPath,
      "data-scheme/data-generate.json",
    );
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const rawValidation = validateReport(rawReport, {
  renderMode: false,
  checkAssets: false,
});
if (rawValidation.errors.length > 0) {
  throw new Error(`Raw report is invalid:\n- ${rawValidation.errors.join("\n- ")}`);
}

const report = buildGeneratedReport(rawReport, previousReport);
const scenes = collectTimelineScenes(report);
const cachedScenes = createSceneCache(previousReport);
const synthesize = createMinimaxClient({...config, apiKey});
const transaction = dryRun
  ? null
  : await createGeneratedOutputTransaction(dataDir);

console.log(
  `${dryRun ? "Planning" : "Generating"} ${scenes.length} scene voiceover(s) with ${config.model} / ${config.voiceId}.`,
);
if (!dryRun) {
  console.log(
    `MiniMax pacing: ${config.requestIntervalMs}ms between requests, up to ${config.maxRetries} retries.`,
  );
}

let cursorMs = 0;
let generated = 0;
let reused = 0;

try {
  for (const scene of scenes) {
    const hash = getSceneHash(scene.subtitle);
    const cachedScene = cachedScenes.get(scene.id);
    const existingAudioPath = dryRun
      ? resolve(dataDir, "audio", `${scene.id}.mp3`)
      : transaction.existingAudioPath(scene.id);
    const reusable = isReusable(scene, cachedScene, hash, existingAudioPath);

    if (dryRun) {
      console.log(
        `- ${scene.id}: ${reusable ? "reuse" : "generate"} (${scene.subtitle.length} chars)`,
      );
      continue;
    }

    let audioLengthMs;
    if (reusable) {
      audioLengthMs = cachedScene.tts.audioLengthMs;
      await transaction.stageExistingAudio(scene.id);
      reused++;
      console.log(`- ${scene.id}: reused ${audioLengthMs}ms`);
    } else {
      const result = await synthesize(scene.subtitle);
      audioLengthMs = result.audioLengthMs;
      await transaction.stageGeneratedAudio(scene.id, result.audio);
      generated++;
      console.log(`- ${scene.id}: generated ${audioLengthMs}ms`);
    }

    scene.audioSrc = `audio/${scene.id}.mp3`;
    scene.timing = {
      startMs: cursorMs,
      durationMs: audioLengthMs + config.tailPaddingMs,
    };
    scene.tts = {
      provider: "minimax",
      hash,
      model: config.model,
      voiceId: config.voiceId,
      speed: config.speed,
      vol: config.vol,
      pitch: config.pitch,
      audioLengthMs,
      tailPaddingMs: config.tailPaddingMs,
    };
    cursorMs += scene.timing.durationMs;
  }

  if (dryRun) {
    console.log("Dry run complete. No API requests were sent and no files were changed.");
    process.exit(0);
  }

  const generatedValidation = validateReport(report, {
    renderMode: true,
    checkAssets: false,
  });
  if (generatedValidation.errors.length > 0) {
    throw new Error(
      `Generated report is invalid:\n- ${generatedValidation.errors.join("\n- ")}`,
    );
  }

  await transaction.stageReport(report);
  await transaction.commit();
} catch (error) {
  await transaction?.abort();
  throw error;
}

console.log(
  `TTS complete: generated ${generated}, reused ${reused}, total timeline ${cursorMs}ms.`,
);
