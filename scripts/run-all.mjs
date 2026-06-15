import { spawn } from "node:child_process";
import {createInterface} from "node:readline";
import {clearInterval, setInterval} from "node:timers";
import ora from "ora";
import { rootDir } from "./lib/paths.mjs";
import { terminateProcessTree } from "./lib/process-tree.mjs";
import { classifyStepOutcome } from "./lib/step-outcome.mjs";

const bunCommand = process.platform === "win32" ? "bun.exe" : "bun";
const claudeCommand = process.platform === "win32" ? "claude.exe" : "claude";
const productionEnv = {...process.env, AI_DAILY_REPORT_RUN_ALL: "1"};

const productionSteps = [
  {
    name: "prerss",
    command: bunCommand,
    args: ["run", "prerss"],
  },
  {
    name: "rss",
    command: "go",
    args: ["-C", "rss", "run", "."],
  },
  {
    name: "tts",
    command: bunCommand,
    args: ["run", "tts"],
  },
  {
    name: "generate-svg",
    command: claudeCommand,
    args: [
      "--dangerously-skip-permissions",
      "-p",
      "--effort", "low",
      [
        "/generate-svg",
        "",
        "Automation constraint: finish after static SVG and data validation.",
        "Do not start bun run dev, Remotion Studio, rendering, or any other preview workflow.",
      ].join("\n"),
    ],
  },
];

let activeChild = null;
let interrupted = false;
let productionSpinner = null;

function formatSeconds(ns) {
  return (Number(ns) / 1e9).toFixed(2);
}

function formatElapsed(ns) {
  const totalSeconds = Math.floor(Number(ns) / 1e9);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function writeChildLine(line) {
  productionSpinner?.clear();
  process.stdout.write(`${line}\n`);
}

function forwardChildOutput(stream) {
  const lines = createInterface({input: stream, crlfDelay: Infinity});
  lines.on("line", writeChildLine);
}

function runProductionStep({command, args, name}, index) {
  return new Promise((resolve, reject) => {
    if (interrupted) {
      reject(new Error("流程已被用户中断。"));
      return;
    }

    const start = process.hrtime.bigint();
    const status = () =>
      `[${index + 1}/${productionSteps.length}] ${name} 执行中 · ${formatElapsed(process.hrtime.bigint() - start)}`;
    productionSpinner.text = status();
    productionSpinner.start();
    const statusTimer = setInterval(() => {
      productionSpinner.text = status();
      productionSpinner.render();
    }, 1000);

    const child = spawn(command, args, {
      cwd: rootDir,
      env: productionEnv,
      stdio: ["inherit", "pipe", "pipe"],
      shell: false,
    });
    activeChild = child;
    forwardChildOutput(child.stdout);
    forwardChildOutput(child.stderr);

    child.once("error", (error) => {
      clearInterval(statusTimer);
      if (activeChild === child) activeChild = null;
      reject(new Error(`无法启动 ${name} (${command}): ${error.message}`));
    });

    child.once("close", (code, signal) => {
      clearInterval(statusTimer);
      if (activeChild === child) activeChild = null;
      const elapsed = formatSeconds(process.hrtime.bigint() - start);
      const outcome = classifyStepOutcome(code, signal);
      if (outcome.ok) {
        productionSpinner.stopAndPersist({
          symbol: "✔",
          text: `[${index + 1}/${productionSteps.length}] ${name} 完成 · ${elapsed}s`,
        });
        resolve(elapsed);
        return;
      }
      const reason = outcome.signal
        ? `${name} 被信号 ${outcome.signal} 终止，已终止后续流程。`
        : `${name} 失败 (exit ${outcome.exitCode ?? "null"})，已终止后续流程。`;
      reject(new Error(reason));
    });
  });
}

function runDev() {
  return new Promise((resolve, reject) => {
    if (interrupted) {
      resolve();
      return;
    }

    console.log("\n──────── 进入预览模式 ────────");
    console.log("  bun run dev 已启动；按 Ctrl+C 停止预览并释放端口。\n");

    const child = spawn(bunCommand, ["run", "dev"], {
      cwd: rootDir,
      env: {...process.env, AI_DAILY_REPORT_SKIP_INITIAL_SYNC: "1"},
      stdio: "inherit",
      shell: false,
    });
    activeChild = child;

    child.once("error", (error) => {
      if (activeChild === child) activeChild = null;
      reject(new Error(`无法启动 bun run dev: ${error.message}`));
    });

    child.once("close", (code, signal) => {
      if (activeChild === child) activeChild = null;
      if (interrupted || code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          signal
            ? `bun run dev 被信号 ${signal} 终止。`
            : `bun run dev 失败 (exit ${code ?? "null"})。`,
        ),
      );
    });
  });
}

function interrupt(signal) {
  if (interrupted) return;
  interrupted = true;
  productionSpinner?.stop();
  console.error(`\n收到 ${signal}，正在终止当前步骤及其子进程...`);
  terminateProcessTree(activeChild);
  process.exitCode = 130;
}

const shutdownSignals = ["SIGINT", "SIGTERM", "SIGHUP"];
if (process.platform === "win32") shutdownSignals.push("SIGBREAK");

for (const signal of shutdownSignals) {
  process.on(signal, () => interrupt(signal));
}

async function main() {
  const totalStart = process.hrtime.bigint();

  try {
    console.log("──────── 生产阶段 ────────");
    productionSpinner = ora({
      text: "正在准备生产流程...",
      discardStdin: false,
      stream: process.stdout,
    });

    for (const [index, step] of productionSteps.entries()) {
      await runProductionStep(step, index);
    }

    const total = formatSeconds(process.hrtime.bigint() - totalStart);
    console.log(`✔ 生产完成 · ${total}s`);
    productionSpinner = null;

    await runDev();
  } catch (error) {
    productionSpinner?.fail("生产失败");
    productionSpinner = null;
    console.error(`\n❌ ${error.message}`);
    process.exitCode = interrupted ? 130 : 1;
  }
}

main();
