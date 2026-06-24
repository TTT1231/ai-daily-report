import test from "node:test";
import assert from "node:assert/strict";
import {splitSubtitleCues, subtitleVisualUnits} from "./AiDailyReport";

const MAX_SUBTITLE_VISUAL_UNITS = 44;

test("splitSubtitleCues keeps time and decimal tokens intact", () => {
  const cues = splitSubtitleCues(
    "Qwen 3.7 Plus 和 Max 在 Qoder 推出错峰折扣，每晚 22:00 至次日 08:00 自动生效，最高可节省 80%。",
  );

  assert.deepEqual(cues, [
    "Qwen 3.7 Plus 和 Max 在 Qoder 推出错峰折扣，每晚 22:00 至次日 08:00 自动生效，",
    "最高可节省 80%。",
  ]);
  assert.ok(!cues.some((cue) => cue.endsWith("08:")));
  assert.ok(cues.some((cue) => cue.includes("08:00")));
  assert.ok(cues.some((cue) => cue.includes("Qwen 3.7")));
  assert.ok(
    cues.every((cue) => subtitleVisualUnits(cue) <= MAX_SUBTITLE_VISUAL_UNITS),
  );
});

test("splitSubtitleCues keeps product names and pricing decimals intact", () => {
  const cues = splitSubtitleCues(
    "Qwen3.7-Max 享受 2 折优惠，Credits 倍率从 0.5x 降至 0.1x；Qwen3.7-Plus 享受 4 折优惠，从 0.1x 降至 0.04x。",
  );

  assert.deepEqual(cues, [
    "Qwen3.7-Max 享受 2 折优惠，Credits 倍率从 0.5x 降至 0.1x；Qwen3.7-Plus 享受 4 折优惠，",
    "从 0.1x 降至 0.04x。",
  ]);
  assert.ok(!cues.some((cue) => cue.endsWith("Qwen3.")));
  assert.ok(!cues.some((cue) => cue.startsWith("7-Plus")));
  assert.ok(!cues.some((cue) => cue.endsWith("0.")));
  assert.ok(cues.some((cue) => cue.includes("Qwen3.7-Plus")));
  assert.ok(cues.some((cue) => cue.includes("0.5x")));
  assert.ok(cues.some((cue) => cue.includes("0.04x")));
  assert.ok(
    cues.every((cue) => subtitleVisualUnits(cue) <= MAX_SUBTITLE_VISUAL_UNITS),
  );
});

test("splitSubtitleCues keeps every cue within budget when a single token exceeds it", () => {
  // 单个超长 token（极长型号/版本串）本身超过 44 视觉单位：必须被兜底硬切，
  // 保证没有任何 cue 超过预算——旧逻辑因 `chunk &&` 守卫在首 token 时短路，会整条吐出超预算、
  // 被 nowrap 容器裁剪丢内容。这是 qwe.md §7.3 标注的未决项的回归锁定。
  const oversizedToken =
    "Qwen3.7-Coder-Max-Instruct-Pro-Ultra-Preview-20260624-LongVersionTag-abcdef-1234567890";
  const cues = splitSubtitleCues(`${oversizedToken} 带来性能提升。`);

  assert.ok(cues.length > 1, "oversized token should be split into multiple cues");
  assert.ok(
    cues.every((cue) => subtitleVisualUnits(cue) <= MAX_SUBTITLE_VISUAL_UNITS),
    `every cue must be within budget; got units: ${cues.map((cue) => subtitleVisualUnits(cue)).join(", ")}`,
  );
  // 内容不丢失：所有 cue 拼接后仍包含原 token 的全部字符
  const rejoined = cues.join("").replace(/\s+/g, " ").trim();
  assert.ok(rejoined.includes(oversizedToken), "oversized token content must survive splitting");
});

test("splitSubtitleCues does not exceed budget when trailing punctuation lands on the boundary", () => {
  const subtitle = `${"一".repeat(MAX_SUBTITLE_VISUAL_UNITS)}。`;
  const cues = splitSubtitleCues(subtitle);

  assert.ok(
    cues.every((cue) => subtitleVisualUnits(cue) <= MAX_SUBTITLE_VISUAL_UNITS),
    `every cue must stay within budget; got units: ${cues.map((cue) => subtitleVisualUnits(cue)).join(", ")}`,
  );
  assert.equal(cues.join(""), subtitle);
});
