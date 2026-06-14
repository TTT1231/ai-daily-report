import test from "node:test";
import assert from "node:assert/strict";
import {classifyStepOutcome} from "./step-outcome.mjs";

// run-all 串行执行多个子流程：任意一步异常终止都应中止后续步骤，
// 而不是把被信号杀死误判为成功继续往下跑。
test("classifyStepOutcome treats a clean exit 0 as success", () => {
  assert.deepEqual(classifyStepOutcome(0, null), {ok: true});
});

test("classifyStepOutcome treats a non-zero exit as failure", () => {
  assert.deepEqual(classifyStepOutcome(1, null), {ok: false, exitCode: 1});
});

test("classifyStepOutcome treats a signal termination as failure", () => {
  assert.deepEqual(classifyStepOutcome(null, "SIGTERM"), {
    ok: false,
    signal: "SIGTERM",
  });
  assert.deepEqual(classifyStepOutcome(null, "SIGKILL"), {
    ok: false,
    signal: "SIGKILL",
  });
});
