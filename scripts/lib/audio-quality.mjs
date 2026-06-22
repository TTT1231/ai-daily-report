import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_OPTIONS = {
  noiseDb: -35,
  minimumDetectedSilenceMs: 80,
  minimumSurroundingSilenceMs: 120,
  minimumBurstMs: 5,
  maximumBurstMs: 45,
};

function runCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      resolve({ error, stderr });
    });
    child.on("close", (code) => {
      resolve({ code, stderr });
    });
  });
}

async function runFfmpeg(args) {
  const candidates = [
    { command: "ffmpeg", args },
    {
      command: process.platform === "win32" ? "bunx.exe" : "bunx",
      args: ["remotion", "ffmpeg", ...args],
    },
  ];

  const errors = [];
  for (const candidate of candidates) {
    const result = await runCommand(candidate.command, candidate.args);
    if (!result.error && result.code === 0) {
      return result.stderr;
    }
    errors.push(
      result.error?.message ??
        `${candidate.command} exited with code ${result.code}: ${result.stderr.slice(-300)}`,
    );
  }

  throw new Error(
    `Unable to inspect TTS audio with FFmpeg: ${errors.join("; ")}`,
  );
}

export function parseSilenceEvents(output) {
  const silences = [];
  let pendingStart = null;

  for (const line of output.split(/\r?\n/)) {
    const startMatch = line.match(/silence_start:\s*([0-9.]+)/);
    if (startMatch) {
      pendingStart = Number(startMatch[1]);
    }

    const endMatch = line.match(
      /silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/,
    );
    if (endMatch) {
      silences.push({
        startSeconds: pendingStart,
        endSeconds: Number(endMatch[1]),
        durationSeconds: Number(endMatch[2]),
      });
      pendingStart = null;
    }
  }

  return silences;
}

export function findIsolatedBursts(silences, options = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const issues = [];

  for (let index = 0; index < silences.length - 1; index++) {
    const before = silences[index];
    const after = silences[index + 1];
    if (!Number.isFinite(after.startSeconds)) continue;

    const burstMs = (after.startSeconds - before.endSeconds) * 1000;
    if (
      before.durationSeconds * 1000 >= config.minimumSurroundingSilenceMs &&
      after.durationSeconds * 1000 >= config.minimumSurroundingSilenceMs &&
      burstMs >= config.minimumBurstMs &&
      burstMs <= config.maximumBurstMs
    ) {
      issues.push({
        type: "isolated-burst",
        startMs: Math.round(before.endSeconds * 1000),
        endMs: Math.round(after.startSeconds * 1000),
        durationMs: Math.round(burstMs),
      });
    }
  }

  return issues;
}

export async function inspectAudioQuality(input, options = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };
  let temporaryDirectory = null;
  let inputPath = input;

  try {
    if (Buffer.isBuffer(input)) {
      temporaryDirectory = await mkdtemp(join(tmpdir(), "tts-quality-"));
      inputPath = join(temporaryDirectory, "voice.mp3");
      await writeFile(inputPath, input);
    }

    const output = await runFfmpeg([
      "-hide_banner",
      "-i",
      inputPath,
      "-af",
      `silencedetect=noise=${config.noiseDb}dB:d=${config.minimumDetectedSilenceMs / 1000}`,
      "-f",
      "null",
      "-",
    ]);

    return {
      issues: findIsolatedBursts(parseSilenceEvents(output), config),
    };
  } finally {
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

export function formatAudioQualityIssues(issues) {
  return issues
    .map(
      (issue) =>
        `${issue.type} ${issue.durationMs}ms at ${issue.startMs}-${issue.endMs}ms`,
    )
    .join(", ");
}
