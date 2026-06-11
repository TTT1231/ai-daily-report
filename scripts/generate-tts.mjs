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
const getGreeting = (hour) => {
  if (hour >= 5 && hour < 12) return "早上好";
  if (hour >= 12 && hour < 14) return "中午好";
  if (hour >= 14 && hour < 18) return "下午好";
  return "晚上好";
};

const buildIntro = (report) => {
  const groups = new Map();
  let activeTitle;

  for (const story of report.stories) {
    const titles = groups.get(story.topTitle) ?? [];
    titles.push(story.contentTitle);
    groups.set(story.topTitle, titles);
    if (story.activeIntro === true) activeTitle = story.topTitle;
  }

  const tabs = Array.from(groups, ([title, contentTitles], index) => ({
    id: `intro-group-${index + 1}`,
    title,
    summary: contentTitles.join("\n"),
  }));

  return {
    id: "intro",
    topTitle: "Intro",
    bottomTitle: "Intro",
    contentTitle: `${report.date} 资讯概览`,
    tabs,
    ...(activeTitle
      ? {activeTab: tabs.find((tab) => tab.title === activeTitle)?.id}
      : {}),
    scenes: [
      {
        id: "intro-greeting",
        subtitle: report.introContent ?? `大家${getGreeting(new Date().getHours())}，欢迎收看今天的 AI 日报。`,
      },
    ],
  };
};

const buildOutro = (report) => ({
  id: "outro",
  topTitle: "结语",
  bottomTitle: "再见",
  scenes: [
    {
      id: "outro-ending",
      subtitle: report.outroContent ?? "今天的资讯播送完了，再见！",
    },
  ],
});

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

// 如果用户未提供 theme，根据当前小时自动推断
if (!report.theme) {
  const hour = new Date().getHours();
  report.theme = (hour >= 6 && hour < 18) ? "light" : "dark";
}

if (report.stories.some((story) => story.id === "intro" || story.id === "outro")) {
  throw new Error('Raw stories must not use the reserved ids "intro" or "outro".');
}
if (report.stories.filter((story) => story.activeIntro === true).length > 1) {
  throw new Error("Only one story may set activeIntro to true.");
}
const previousReport = existsSync(generatedDataPath)
  ? JSON.parse(await readFile(generatedDataPath, "utf8"))
  : null;
const cachedScenes = new Map(
  [
    ...(previousReport?.intro ? [previousReport.intro] : []),
    ...(previousReport?.stories ?? []),
    ...(previousReport?.outro ? [previousReport.outro] : []),
  ].flatMap((story) => story.scenes.map((scene) => [scene.id, scene])),
);
report.intro = buildIntro(report);
report.outro = buildOutro(report);
const scenes = [report.intro, ...report.stories, report.outro].flatMap(
  (story) => story.scenes,
);
const sceneIds = new Set();

for (const scene of scenes) {
  if (!/^[a-z0-9][a-z0-9-.]*$/.test(scene.id ?? "")) {
    throw new Error(`Scene id "${scene.id}" must contain only lowercase letters, numbers, hyphens, and dots.`);
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
