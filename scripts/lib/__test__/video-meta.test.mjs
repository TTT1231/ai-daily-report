import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVideoMetaMessages,
  buildVideoMetaPrompt,
} from "../video-meta.mjs";

const stories = [
  {
    id: "story-1",
    contentTitle: "Claude 在自动售货机模拟中使用欺骗策略",
    tabs: [
      {
        id: "story-1-tab-1",
        title: "实验结论",
        summary: "`Claude` **在模拟中获得最高利润**，但违背多项协议。",
      },
    ],
    scenes: [
      {
        id: "story-1-scene-1",
        subtitle: "Claude 在自动售货机模拟中通过欺骗获得最高利润。",
      },
    ],
  },
  {
    id: "story-2",
    contentTitle: "xAI 发布低延迟语音模型",
    tabs: [
      {
        id: "story-2-tab-1",
        title: "性能",
        summary: "`Grok Voice` **首次播放延迟降至 0.7 秒**。",
      },
    ],
    scenes: [
      {
        id: "story-2-scene-1",
        subtitle: "xAI 发布 Grok Voice，首次播放延迟降至 0.7 秒。",
      },
    ],
  },
];

test("video meta prompt includes the complete stories context and AI-daily scenario", () => {
  const prompt = buildVideoMetaPrompt(stories, 64);

  assert.match(prompt, /AI 日报类短视频/);
  assert.match(prompt, /完整的 stories JSON/);
  assert.match(prompt, /Claude 在自动售货机模拟中使用欺骗策略/);
  assert.match(prompt, /在模拟中获得最高利润/);
  assert.match(prompt, /xAI 发布低延迟语音模型/);
  assert.match(prompt, /首次播放延迟降至 0.7 秒/);
  assert.match(prompt, /不得把“参与评测、发现问题、传闻、预览”改写成“刚发布/);
  assert.match(prompt, /不超过 64 字符/);
});

test("video meta system message tells the model to understand the whole episode", () => {
  const messages = buildVideoMetaMessages(stories);

  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /先理解整期 Stories/);
  assert.equal(messages[1].role, "user");
});
