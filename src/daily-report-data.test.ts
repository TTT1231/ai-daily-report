import test from "node:test";
import assert from "node:assert/strict";
import {
  identifierSchema,
  dateSchema,
  imagePathSchema,
  audioPathSchema,
  iconPathSchema,
  dailyStorySchema,
  dailyIntroSchema,
} from "./daily-report-data";

// 这些约束与 data.schema.json 的 $defs（identifier / imagePath / audioPath / iconPath / date）
// 对齐：渲染层（Zod）与 check-data-json（JSON Schema）应拒绝同一批非法值，避免灰区。

test("identifierSchema rejects uppercase, underscore and leading dash", () => {
  for (const bad of ["Tab One", "tab_1", "-tab", "Upper"]) {
    assert.throws(() => identifierSchema.parse(bad));
  }
});

test("identifierSchema accepts lowercase kebab identifiers", () => {
  assert.equal(
    identifierSchema.parse("topic-2396903-tab-1"),
    "topic-2396903-tab-1",
  );
});

test("dateSchema requires the YYYY-MM-DD shape", () => {
  for (const bad of ["2026/06/14", "tomorrow", "2026-6-4", "20260614"]) {
    assert.throws(() => dateSchema.parse(bad));
  }
  assert.equal(dateSchema.parse("2026-06-14"), "2026-06-14");
});

test("imagePathSchema requires the images/ prefix and an image extension", () => {
  assert.throws(() => imagePathSchema.parse("../secret.png"));
  assert.throws(() => imagePathSchema.parse("images/noextension"));
  assert.equal(imagePathSchema.parse("images/cover.jpeg"), "images/cover.jpeg");
});

test("audioPathSchema requires the audio/ prefix and an audio extension", () => {
  assert.throws(() => audioPathSchema.parse("audio/noext"));
  assert.throws(() => audioPathSchema.parse("audio/clip.txt"));
  assert.equal(
    audioPathSchema.parse("audio/scene-1.mp3"),
    "audio/scene-1.mp3",
  );
});

test("iconPathSchema requires the icons/ prefix and svg/png extension", () => {
  assert.throws(() => iconPathSchema.parse("icons/icon.jpg"));
  assert.equal(iconPathSchema.parse("icons/tab-1.svg"), "icons/tab-1.svg");
});

function validTab(overrides: Record<string, unknown> = {}) {
  return {id: "tab-1", title: "标题", summary: "摘要", ...overrides};
}

function validScene(overrides: Record<string, unknown> = {}) {
  return {id: "scene-1", subtitle: "一段不超 96 字的字幕", ...overrides};
}

test("dailyStorySchema rejects a story with fewer than 2 tabs", () => {
  const oneTabStory = {
    id: "story-1",
    topTitle: "栏目",
    bottomTitle: "短标",
    contentTitle: "完整标题",
    tabs: [validTab()],
    scenes: [validScene()],
  };
  assert.throws(() => dailyStorySchema.parse(oneTabStory));
});

test("dailyIntroSchema rejects an intro with fewer than 2 tabs", () => {
  const oneTabIntro = {
    id: "intro",
    topTitle: "Intro",
    bottomTitle: "Intro",
    contentTitle: "概览",
    tabs: [validTab()],
    scenes: [validScene()],
  };
  assert.throws(() => dailyIntroSchema.parse(oneTabIntro));
});
