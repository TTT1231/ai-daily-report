import {createHash} from "node:crypto";
import {existsSync} from "node:fs";
import {resolve} from "node:path";
import {
  formatAudioQualityIssues,
  inspectAudioQuality,
} from "../lib/audio-quality.mjs";
import {
  buildGeneratedReport,
  buildVideoStoryStartMs,
  collectTimelineScenes,
} from "../lib/report-builder.mjs";
import {createGeneratedOutputTransaction} from "../lib/generated-output.mjs";
import {createMinimaxClient} from "../lib/minimax-tts.mjs";
import {sceneAudioFields, isReusable} from "../lib/tts-timeline.mjs";
import {
  dataDir,
  generatedDataPath,
  rawDataPath,
  readJson,
} from "../lib/paths.mjs";
import {validateReport} from "../lib/report-validation.mjs";

const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");
const apiKey = process.env.MINIMAX_API_KEY;
// dev.mjs 跑 tts 时透传此 flag(见 dev.mjs);据此静音 dev 下冗余日志(pacing 是每次一样的配置回显,
// 且 generated=0 时与运行无关)。单独 `bun run tts` / `tts:force` 不设它,保留完整日志。
const isDev = process.env.AI_DAILY_REPORT_DEV === "1";
const config = {
  // Master switch for the whole TTS subsystem. false => skip voice generation
  // entirely (no MiniMax, no audio, no ffmpeg quality check); every MINIMAX_* /
  // TTS_* / REQUIRE_VOICE_QUALITY_FFMPEG setting is then ignored.
  ttsEnabled: readBooleanEnv("TTS_REQUIRE", true),
  endpoint:
    process.env.MINIMAX_TTS_ENDPOINT ?? "https://api.minimaxi.com/v1/t2a_v2",
  model: process.env.MINIMAX_TTS_MODEL ?? "speech-2.8-hd",
  voiceId:
    process.env.MINIMAX_TTS_VOICE_ID ?? "Chinese (Mandarin)_Warm_Girl",
  speed: readNumberEnv("MINIMAX_TTS_SPEED", 1, 0.5, 2),
  vol: 1,
  pitch: 0,
  tailPaddingMs: readIntegerEnv("TTS_TAIL_PADDING_MS", 250, 0),
  requestIntervalMs: readIntegerEnv("MINIMAX_TTS_REQUEST_INTERVAL_MS", 2200, 0),
  maxRetries: readIntegerEnv("MINIMAX_TTS_MAX_RETRIES", 5, 0),
  rateLimitRetryMs: readIntegerEnv("MINIMAX_TTS_RATE_LIMIT_RETRY_MS", 60000, 1000),
  // ffmpeg-based voice-quality gate (isolated-burst / click detection). On by
  // default; set REQUIRE_VOICE_QUALITY_FFMPEG=false to skip it and the ffmpeg dependency.
  requireVoiceQualityFfmpeg: readBooleanEnv("REQUIRE_VOICE_QUALITY_FFMPEG", true),
};

// When the ffmpeg quality gate is on, retry MiniMax this many times before
// aborting the TTS run for a clip that still contains isolated-burst artifacts.
const QUALITY_RETRY_LIMIT = 2;

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

function readBooleanEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be either true or false.`);
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

if (!config.ttsEnabled) {
  console.log("TTS_REQUIRE=false: skipping TTS voice generation (no MiniMax calls, no audio).");
  console.log("All MINIMAX_* / TTS_* / REQUIRE_VOICE_QUALITY_FFMPEG settings are ignored in this mode.");
  process.exit(0);
}

if (!dryRun && !apiKey) {
  console.error("MINIMAX_API_KEY is required. Set it in the environment, then run bun run tts.");
  // 退出码 2 = 发生在调用 MiniMax 之前的配置/数据错误，不消耗配额；dev 据此不计入"连续失败"锁。
  process.exit(2);
}

const transaction = dryRun
  ? null
  : await createGeneratedOutputTransaction(dataDir);
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
  await transaction?.abort();
  console.error(error.message);
  process.exit(2);
}

const rawValidation = validateReport(rawReport, {
  renderMode: false,
  checkAssets: false,
});
if (rawValidation.errors.length > 0) {
  await transaction?.abort();
  console.error(
    `Raw report is invalid:\n- ${rawValidation.errors.join("\n- ")}\n\n👉 请按上方错误修改 data-scheme/data.json 后重试 \`bun run tts\`。`,
  );
  // 退出码 2 = data.json 校验失败，发生在调用 MiniMax 之前，不消耗配额；dev 据此不计入"连续失败"锁。
  process.exit(2);
}

const report = buildGeneratedReport(rawReport, previousReport);
const scenes = collectTimelineScenes(report);
const cachedScenes = createSceneCache(previousReport);
const synthesize = createMinimaxClient({...config, apiKey});

// dev 下不打 header：每次保存都打、且「Generating」在 generated=0（全量复用）时有误导性；
// 模型/音色只在 `bun run tts` / `tts:force` 直跑（isDev=false）时才需确认，那时照常打印。
if (!isDev) {
  console.log(
    `${dryRun ? "Planning" : "Generating"} ${scenes.length} scene voiceover(s) with ${config.model} / ${config.voiceId}.`,
  );
}
if (!dryRun && !isDev) {
  console.log(
    `MiniMax pacing: ${config.requestIntervalMs}ms between requests, up to ${config.maxRetries} retries.`,
  );
}

async function getAudioQualityIssues(input) {
  if (!config.requireVoiceQualityFfmpeg) return [];
  return (await inspectAudioQuality(input)).issues;
}

async function synthesizeChecked(scene) {
  for (let attempt = 0; ; attempt++) {
    const result = await synthesize(scene.subtitle);
    const issues = await getAudioQualityIssues(result.audio);
    if (issues.length === 0) {
      return result;
    }

    const summary = formatAudioQualityIssues(issues);
    if (attempt >= QUALITY_RETRY_LIMIT) {
      throw new Error(
        `${scene.id}: generated audio failed quality checks after ${attempt + 1} attempt(s): ${summary}`,
      );
    }
    console.warn(
      `- ${scene.id}: generated audio contains ${summary}; retrying (${attempt + 1}/${QUALITY_RETRY_LIMIT})`,
    );
  }
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
    let reusable = isReusable(scene, cachedScene, hash, existingAudioPath, force);
    // 复用音频不再重跑 ffmpeg 音质检：该片段首次生成时已由 synthesizeChecked 检过，
    // 哈希命中即证明是同一段已验证音频。每次保存都按 scene 数重跑 ffmpeg（约 0.14s/scene）
    // 是 dev 同步 10s+ 的主因；怀疑缓存损坏时用 `bun run tts:force` 强制重生成并复检。

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
      // 复用不逐条打印：dev 同步常命中全量缓存，逐条 reused 日志会刷屏；
      // 复用总数由末尾 "TTS complete: generated X, reused Y" 汇总给出，只打印实际调用 MiniMax 生成的片段。
    } else {
      const result = await synthesizeChecked(scene);
      audioLengthMs = result.audioLengthMs;
      await transaction.stageGeneratedAudio(scene.id, result.audio);
      generated++;
      console.log(`- ${scene.id}: generated ${audioLengthMs}ms`);
    }

    const audioFields = sceneAudioFields(scene.id, hash, audioLengthMs, cursorMs, config);
    scene.audioSrc = audioFields.audioSrc;
    scene.timing = audioFields.timing;
    scene.tts = audioFields.tts;
    cursorMs = audioFields.nextCursorMs;
  }

  if (dryRun) {
    console.log("Dry run complete. No API requests were sent and no files were changed.");
    process.exit(0);
  }

  // 把每个 story 的成片起始毫秒写回 generated 数据。评论侧和其它消费方直接读
  // story.videoStartMs，不再各自重算时间线——它由下面 buildVideoStoryStartMs
  // 这一权威实现（常量与渲染侧同源 video-timeline.json）一次性算出。
  const videoStoryStartMs = buildVideoStoryStartMs(report);
  const timelineStories = [report.intro, ...(report.stories ?? []), report.outro];
  timelineStories.forEach((story, index) => {
    if (story) story.videoStartMs = videoStoryStartMs[index] ?? 0;
  });

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
