import test from "node:test";
import assert from "node:assert/strict";
import {buildGenerateSvgPayloadArgs, GENERATE_SVG_PAYLOAD_ALLOWED_TOOLS} from "../claude-allowlist.mjs";

test("generate-svg payload mode only allows read access for Claude", () => {
  assert.deepEqual(GENERATE_SVG_PAYLOAD_ALLOWED_TOOLS, ["Read"]);
});

test("buildGenerateSvgPayloadArgs omits the prompt from argv (prompt goes via stdin)", () => {
  // Windows CreateProcess 命令行上限 ~32,767 字符；31 个图标 + skill 文档会拼出
  // 40K+ 字符的 prompt，塞进 argv 会 spawn ENAMETOOLONG。prompt 必须走 stdin。
  const args = buildGenerateSvgPayloadArgs();

  // 固定 flags，prompt 绝不出现在 argv 里。
  assert.deepEqual(args, ["--allowedTools", "Read", "-p", "--effort", "low"]);
  assert.ok(!args.some((arg) => /^Write|^Edit|^Bash/.test(arg)));
});
