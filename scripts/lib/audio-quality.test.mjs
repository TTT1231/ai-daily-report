import assert from "node:assert/strict";
import test from "node:test";
import { findIsolatedBursts, parseSilenceEvents } from "./audio-quality.mjs";

test("parses FFmpeg silence events", () => {
  const output = [
    "[silencedetect] silence_start: 1.779438",
    "[silencedetect] silence_end: 2.111125 | silence_duration: 0.331688",
    "[silencedetect] silence_start: 2.13725",
    "[silencedetect] silence_end: 2.350219 | silence_duration: 0.212969",
  ].join("\n");

  assert.deepEqual(parseSilenceEvents(output), [
    {
      startSeconds: 1.779438,
      endSeconds: 2.111125,
      durationSeconds: 0.331688,
    },
    {
      startSeconds: 2.13725,
      endSeconds: 2.350219,
      durationSeconds: 0.212969,
    },
  ]);
});

test("detects an audible isolated burst between silences", () => {
  const issues = findIsolatedBursts([
    { startSeconds: 1.779, endSeconds: 2.111, durationSeconds: 0.332 },
    { startSeconds: 2.137, endSeconds: 2.35, durationSeconds: 0.213 },
  ]);

  assert.deepEqual(issues, [
    {
      type: "isolated-burst",
      startMs: 2111,
      endMs: 2137,
      durationMs: 26,
    },
  ]);
});

test("detects a short isolated click between silences", () => {
  const issues = findIsolatedBursts([
    { startSeconds: 3.105, endSeconds: 3.416, durationSeconds: 0.311 },
    { startSeconds: 3.423, endSeconds: 3.648, durationSeconds: 0.225 },
  ]);

  assert.deepEqual(issues, [
    {
      type: "isolated-burst",
      startMs: 3416,
      endMs: 3423,
      durationMs: 7,
    },
  ]);
});

test("ignores tiny encoder blips and normal speech gaps", () => {
  const issues = findIsolatedBursts([
    { startSeconds: 1, endSeconds: 1.3, durationSeconds: 0.3 },
    { startSeconds: 1.303, endSeconds: 1.5, durationSeconds: 0.197 },
    { startSeconds: 2, endSeconds: 2.3, durationSeconds: 0.3 },
    { startSeconds: 2.36, endSeconds: 2.6, durationSeconds: 0.24 },
  ]);

  assert.deepEqual(issues, []);
});
