import { spawn } from "node:child_process";
import { rootDir } from "./lib/paths.mjs";
import { classifyStepOutcome } from "./lib/step-outcome.mjs";

const bunCommand = process.platform === "win32" ? "bun.exe" : "bun";

// 按顺序执行的流程步骤。前两步是 npm scripts，通过 bun 调用；
// generate-svg 是外部 claude 命令，单独处理。
const bunSteps = ["prerss", "rss", "tts"];
const finalStep = {
  name: "generate-svg",
  command: "claude",
  args: [
    "--dangerously-skip-permissions",
    "-p",
    "--effort", "low",
    "/generate-svg",
  ],
};

function formatSeconds(ns) {
  return (Number(ns) / 1e9).toFixed(2);
}

function runStep(command, args, label) {
  return new Promise((resolve, reject) => {
    console.log(`\n▶ 开始：${label} (${command} ${args.join(" ")})`);
    const start = process.hrtime.bigint();

    const child = spawn(command, args, {
      cwd: rootDir,
      env: process.env,
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.once("error", (error) => {
      reject(new Error(`无法启动 ${label} (${command}): ${error.message}`));
    });

    child.once("close", (code, signal) => {
      const elapsed = formatSeconds(process.hrtime.bigint() - start);
      const outcome = classifyStepOutcome(code, signal);
      if (outcome.ok) {
        console.log(`✔ 完成：${label}（耗时 ${elapsed}s）`);
        resolve(elapsed);
        return;
      }
      const reason = outcome.signal
        ? `${label} 被信号 ${outcome.signal} 终止，已终止后续流程。`
        : `${label} 失败 (exit ${outcome.exitCode ?? "null"})，已终止后续流程。`;
      reject(new Error(reason));
    });
  });
}

async function main() {
  const totalStart = process.hrtime.bigint();
  const timings = [];

  try {
    for (const step of bunSteps) {
      const elapsed = await runStep(bunCommand, ["run", step], step);
      timings.push([step, elapsed]);
    }

    const finalElapsed = await runStep(
      finalStep.command,
      finalStep.args,
      finalStep.name,
    );
    timings.push([finalStep.name, finalElapsed]);

    const total = formatSeconds(process.hrtime.bigint() - totalStart);
    console.log("\n──────── 全部流程完成 ────────");
    for (const [name, elapsed] of timings) {
      console.log(`  ${name.padEnd(14)} ${elapsed}s`);
    }
    console.log(`  ${"总计".padEnd(12, "─")} ${total}s`);
  } catch (error) {
    console.error(`\n❌ ${error.message}`);
    process.exit(1);
  }
}

main();
