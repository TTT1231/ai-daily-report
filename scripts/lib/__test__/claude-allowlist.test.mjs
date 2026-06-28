import test from "node:test";
import assert from "node:assert/strict";
import {buildGenerateSvgPayloadArgs, GENERATE_SVG_PAYLOAD_ALLOWED_TOOLS} from "../claude-allowlist.mjs";

test("generate-svg payload mode only allows read access for Claude", () => {
  assert.deepEqual(GENERATE_SVG_PAYLOAD_ALLOWED_TOOLS, ["Read"]);
});

test("buildGenerateSvgPayloadArgs builds a single prompt call without write or bash tools", () => {
  const args = buildGenerateSvgPayloadArgs({prompt: "return SVG payload"});

  assert.deepEqual(args.slice(0, 3), ["--allowedTools", "Read", "-p"]);
  assert.ok(args.includes("--effort"));
  assert.equal(args.at(-1), "return SVG payload");
  assert.ok(!args.some((arg) => /^Write|^Edit|^Bash/.test(arg)));
});
