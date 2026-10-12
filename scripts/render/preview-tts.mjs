import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createMinimaxClient, MINIMAX_TTS_DEFAULTS } from "../lib/minimax-tts.mjs";
import { readSpeechSettings } from "../lib/tts-speech-settings.mjs";
import {
  inspectAudioQuality,
  formatAudioQualityIssues,
} from "../lib/audio-quality.mjs";
import { rootDir } from "../lib/paths.mjs";

// One short request per preview; never reads/writes the production report or its cache.
const voiceId =
  process.argv.find((arg) => arg.startsWith("--voice="))?.slice(8) ??
  process.env.MINIMAX_TTS_VOICE_ID ??
  "Chinese (Mandarin)_Warm_Girl";
const text =
  "微软计划从2027年1月起，调整安卓版身份验证器的个人账号备份方式。Anthropic 扩大 Mythos 的受控访问，符合条件的网络安全专业人员可以分级申请。下面测试英文专名：Dogwood Local Engine。Cyber Verification Program。Haiku 5.5。API 额度为每月100美元。";
const config = {
  endpoint: MINIMAX_TTS_DEFAULTS.endpoint,
  model: process.env.MINIMAX_TTS_MODEL ?? "speech-2.8-hd",
  voiceId,
  speed: 1,
  vol: 1,
  pitch: 0,
  ...readSpeechSettings(),
  // A preview must fail promptly instead of repeatedly charging for a bad sample.
  maxRetries: 0,
};
if (process.argv.includes("--dry-run")) {
  console.log(
    JSON.stringify({ text, ...config, playbackRates: [1, 1.5, 2] }, null, 2),
  );
} else {
  if (!process.env.MINIMAX_API_KEY)
    throw new Error("MINIMAX_API_KEY is required.");
  const dir = resolve(
    rootDir,
    "out",
    "tts-preview",
    voiceId.replace(/[^a-zA-Z0-9_-]/g, "_"),
  );
  // Match the production quality gate: installed ffmpeg, then Remotion's bundled one.
  // Verify availability before using the paid API.
  const commands = [
    { command: "ffmpeg", args: [] },
    {
      command: process.platform === "win32" ? "bunx.exe" : "bunx",
      args: ["remotion", "ffmpeg"],
    },
  ];
  const encoder = commands.find(
    ({ command, args }) =>
      spawnSync(command, [...args, "-version"], {
        windowsHide: true,
        encoding: "utf8",
        timeout: 60_000,
      }).status === 0,
  );
  if (!encoder)
    throw new Error("Preview requires ffmpeg or Remotion's bundled ffmpeg.");
  console.log(
    `Synthesizing one paid preview with ${voiceId}, speed=1, language=${config.languageBoost}.`,
  );
  const audio = await createMinimaxClient({
    ...config,
    apiKey: process.env.MINIMAX_API_KEY,
  })(text);
  const quality = await inspectAudioQuality(audio.audio);
  await mkdir(dir, { recursive: true });
  const original = resolve(dir, "1x.mp3");
  await writeFile(original, audio.audio);
  for (const rate of [1.5, 2]) {
    const output = resolve(dir, `${rate}x.mp3`);
    const result = spawnSync(
      encoder.command,
      [
        ...encoder.args,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        original,
        "-af",
        `atempo=${rate}`,
        "-codec:a",
        "libmp3lame",
        "-b:a",
        "128k",
        output,
      ],
      { windowsHide: true, encoding: "utf8", timeout: 60_000 },
    );
    if (result.status !== 0)
      throw new Error(
        `Preview conversion failed: ${result.error?.message ?? result.stderr}`,
      );
  }
  await writeFile(
    resolve(dir, "preview.json"),
    `${JSON.stringify({ text, ...config, audioLengthMs: audio.audioLengthMs, qualityIssues: quality.issues, playbackRates: [1, 1.5, 2] }, null, 2)}\n`,
  );
  console.log(`Preview saved: ${dir}`);
  if (quality.issues.length) {
    console.error(
      `Audio quality check: ${formatAudioQualityIssues(quality.issues)}`,
    );
    process.exitCode = 1;
  }
}
