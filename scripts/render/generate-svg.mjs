// generate-svg 的 npm 手动入口 wrapper。
//
// Claude 只负责一次性产出 SVG JSON payload；Node 本地负责写 SVG、更新 icon 字段和校验。
// 这样保留模型的语义/审美判断，同时避免让 agent 逐文件读写带来的分钟级工具往返。
import {spawn, spawnSync} from "node:child_process";
import {existsSync} from "node:fs";
import {readFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {buildGenerateSvgPayloadArgs} from "../lib/claude-allowlist.mjs";
import {getGenerateSvgPreflight, printGenerateSvgPreflight} from "../lib/generate-svg-preflight.mjs";
import {
  applyGenerateSvgPayload,
  buildGenerateSvgPayloadPrompt,
  buildGenerateSvgTargetPlan,
  formatRetryReason,
  parseGenerateSvgPayload,
} from "../lib/generate-svg-payload.mjs";
import {terminateProcessTree} from "../lib/process-tree.mjs";
import {withTransactionLock} from "../lib/generated-output.mjs";
import {dataDir, generatedDataPath, rawDataPath, readJson, rootDir} from "../lib/paths.mjs";

// 20 图标一次性生成实测 ~140s（首 token ~105s）。给 claude.exe 留足完成空间，同时防止
// API 偶发卡死让 generate-svg 无限挂起、阻塞整个 video 流水线。可用环境变量覆盖：
// AI_DAILY_REPORT_SVG_TIMEOUT_MS（旧名 AI_DAILY_SVG_TIMEOUT_MS 仍兼容，命名向
// 其它 AI_DAILY_REPORT_* 变量看齐）。0 = 禁用超时；非法值直接报错退出，
// 不静默回退默认——那会让"调大超时"的意图悄悄失效。
const RAW_TIMEOUT_MS =
  process.env.AI_DAILY_REPORT_SVG_TIMEOUT_MS ?? process.env.AI_DAILY_SVG_TIMEOUT_MS;
let CLAUDE_PAYLOAD_TIMEOUT_MS = 5 * 60 * 1000;
if (RAW_TIMEOUT_MS !== undefined) {
  const value = Number(RAW_TIMEOUT_MS);
  if (!Number.isInteger(value) || value < 0) {
    console.error(
      `AI_DAILY_REPORT_SVG_TIMEOUT_MS 必须是非负整数（毫秒，0 表示不设超时），当前值: ${RAW_TIMEOUT_MS}`,
    );
    process.exit(2);
  }
  CLAUDE_PAYLOAD_TIMEOUT_MS = value;
}

const args = process.argv.slice(2);
const automation = args.includes("--automation");
const force = args.includes("--force") || process.env.AI_DAILY_REPORT_FORCE_GENERATE_SVG === "1";
const preflight = await getGenerateSvgPreflight({force});
printGenerateSvgPreflight(preflight);

if (preflight.skip) {
  process.exit(0);
}

function whereExecutable(name) {
  const result = spawnSync("where.exe", [name], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function addDirectory(directories, directory) {
  if (!directory || !existsSync(directory)) return;
  directories.push(directory);
}

function buildClaudeEnv() {
  const env = {...process.env, PYTHONUTF8: "1"};
  if (process.platform !== "win32") return env;

  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "Path";
  const preferredDirectories = [];

  for (const executable of [...whereExecutable("python3"), ...whereExecutable("python")]) {
    if (/\\Microsoft\\WindowsApps\\/i.test(executable)) continue;
    addDirectory(preferredDirectories, dirname(executable));
  }

  for (const executable of whereExecutable("bash")) {
    if (/\\Microsoft\\WindowsApps\\/i.test(executable)) continue;
    if (/\\Windows\\System32\\bash\.exe$/i.test(executable)) continue;
    addDirectory(preferredDirectories, dirname(executable));
  }

  for (const executable of whereExecutable("git")) {
    const gitDir = dirname(executable);
    addDirectory(preferredDirectories, gitDir);
    if (/\\cmd$/i.test(gitDir)) {
      addDirectory(preferredDirectories, resolve(gitDir, "..", "bin"));
    }
  }

  const pathEntries = [...preferredDirectories, ...(env[pathKey] ?? "").split(";")];
  const seen = new Set();
  env[pathKey] = pathEntries
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => {
      const key = entry.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(";");

  return env;
}

function buildBareSettingsArgs() {
  const homeDir = process.env.USERPROFILE || process.env.HOME;
  if (!homeDir) return ["--bare"];

  const settingsPath = resolve(homeDir, ".claude", "settings.json");
  if (!existsSync(settingsPath)) return ["--bare"];

  return ["--bare", "--settings", settingsPath];
}

async function readGenerateSvgSkillPrompt() {
  const skillDir = resolve(rootDir, ".agents", "skills", "generate-svg");
  const files = [
    ["SKILL.md", resolve(skillDir, "SKILL.md")],
    ["rules/design.md", resolve(skillDir, "rules", "design.md")],
    ["rules/semantics.md", resolve(skillDir, "rules", "semantics.md")],
    ["rules/theme.md", resolve(skillDir, "rules", "theme.md")],
    ["rules/data-workflow.md", resolve(skillDir, "rules", "data-workflow.md")],
  ];

  const sections = [
    "Run the generate-svg skill inline.",
    "Claude is started with --bare for this automation, so do not rely on slash commands, plugins, hooks, or MCP servers.",
    "Follow these project skill instructions exactly:",
  ];

  for (const [displayPath, filePath] of files) {
    sections.push("", `## ${displayPath}`, await readFile(filePath, "utf8"));
  }

  return sections;
}

const claudeCommand = process.platform === "win32" ? "claude.exe" : "claude";

function requestClaudePayload(prompt) {
  if (typeof prompt !== "string" || prompt.trim() === "") {
    return Promise.reject(new Error("requestClaudePayload requires a non-empty prompt."));
  }

  return new Promise((resolve, reject) => {
    const child = spawn(
      claudeCommand,
      [
        ...buildBareSettingsArgs(),
        ...buildGenerateSvgPayloadArgs(),
      ],
      {
        cwd: rootDir,
        env: buildClaudeEnv(),
        // prompt 走 stdin（非 argv），绕开 Windows ~32K 命令行上限，避免 spawn ENAMETOOLONG。
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
      },
    );

    let stdout = "";
    let stderr = "";
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      // claude CLI 可能派生子进程；用进程树终止，避免 Windows 上只杀直连进程留下后代。
      try {
        terminateProcessTree(child);
      } catch {
        // 子进程可能已退出；忽略清理错误。
      }
      reject(error);
    };

    // CLAUDE_PAYLOAD_TIMEOUT_MS === 0 表示显式禁用超时。
    const timer = CLAUDE_PAYLOAD_TIMEOUT_MS > 0
      ? setTimeout(() => {
          const error = new Error(`claude payload 超过 ${CLAUDE_PAYLOAD_TIMEOUT_MS}ms 无响应`);
          error.kind = "claude-timeout";
          fail(error);
        }, CLAUDE_PAYLOAD_TIMEOUT_MS)
      : null;

    // 子进程提前退出会让 stdin 写入抛 EPIPE/ERR_STREAM_DESTROYED；挂个 error 监听吸收掉，
    // 真正的退出语义由 close 事件接管。
    child.stdin.on("error", () => {});
    child.stdin.write(prompt);
    child.stdin.end();

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      process.stderr.write(text);
    });

    child.on("error", (error) => {
      const wrapped = new Error(`无法启动 claude (${claudeCommand}): ${error.message}`);
      wrapped.kind = "claude-spawn";
      fail(wrapped);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
        return;
      }
      const wrapped = new Error(`claude payload exited ${code ?? "null"}${stderr ? `\n${stderr}` : ""}`);
      wrapped.kind = "claude-exit";
      reject(wrapped);
    });
  });
}

function runCommand(command, commandArgs, name) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: rootDir,
      env: process.env,
      stdio: "inherit",
      shell: false,
    });

    child.on("error", (error) => {
      reject(new Error(`无法启动 ${name}: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${name} exited ${code ?? "null"}`));
      }
    });
  });
}

async function runPostGenerationChecks() {
  const bunCommand = process.platform === "win32" ? "bun.exe" : "bun";
  await runCommand(bunCommand, ["run", "check-icons"], "bun run check-icons");
  await runCommand(bunCommand, ["run", "lint"], "bun run lint");
}

async function runStructuredPayloadMode({promptPrefix}) {
  const report = await readJson(generatedDataPath, "data-scheme/data-generate.json");
  // preflight 已对同一份 data-generate.json 跑过 validateReportIcons；把它的
  // iconTargets 传进来复用，避免每次再全量校验一遍（force 或读取失败时为 null，
  // 照旧走内部校验）。
  const targetPlan = buildGenerateSvgTargetPlan(report, {
    dataDir,
    force,
    iconTargets: Array.isArray(preflight.iconTargets)
      ? preflight.iconTargets
      : undefined,
  });

  if (targetPlan.targets.length === 0) {
    throw new Error("no payload targets could be derived from preflight issues.");
  }

  console.log(`generate-svg: requesting one Claude SVG payload for ${targetPlan.targets.length} icon(s).`);

  const prompt = buildGenerateSvgPayloadPrompt({
    promptPrefix,
    targets: targetPlan.targets,
    preflightErrors: preflight.errors,
    automation,
    theme: report.theme ?? "dark",
  });
  // claude.exe 实测 20 图标 ~140s 且偶发非零退出（exit 1）。2 次重试不足以覆盖偶发抖动，
  // 提到 3 次；claude-spawn（CLI 缺失等）不可恢复，立即中止避免无谓重试。
  const maxPayloadAttempts = 3;
  let result;
  let lastError;
  for (let attempt = 1; attempt <= maxPayloadAttempts; attempt += 1) {
    try {
      const output = await requestClaudePayload(prompt);
      const payload = parseGenerateSvgPayload(output);
      // applyGenerateSvgPayload 会写 data-generate.json 并在失败时快照回滚；与
      // tts 事务共用 .tts.lock，避免回滚覆盖并发 tts commit 的写入（如 dev 自动同步）。
      result = await withTransactionLock(dataDir, () =>
        applyGenerateSvgPayload({
          payload,
          report,
          targetPlan,
          dataDir,
          generatedDataPath,
          rawDataPath,
        }),
      );
      break;
    } catch (error) {
      lastError = error;
      const reason = formatRetryReason(error);
      if (!reason.retryable) {
        console.error(`generate-svg: 放弃生成 — ${reason.label}`);
        throw error;
      }
      if (attempt === maxPayloadAttempts) {
        console.error(
          `generate-svg: 已重试 ${maxPayloadAttempts} 次仍失败 — ${reason.label}`,
        );
        throw error;
      }
      console.warn(
        `generate-svg: 第 ${attempt}/${maxPayloadAttempts} 次失败，将重试 — ${reason.label}`,
      );
    }
  }
  if (!result) throw lastError ?? new Error("Claude SVG payload generation failed.");

  console.log(
    `generate-svg: wrote ${result.generated} SVG icon(s) from Claude payload${result.rawUpdated ? " and mirrored data.json" : ""}.`,
  );
  if (result.prunedIcons.length > 0) {
    console.log(`generate-svg: pruned ${result.prunedIcons.length} orphan icon(s).`);
  }
  await runPostGenerationChecks();
}

async function main() {
  const promptPrefix = await readGenerateSvgSkillPrompt();
  await runStructuredPayloadMode({promptPrefix});
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  if (/无法启动 claude/.test(error.message)) {
    console.error("请确认 Claude CLI 已安装并在 PATH 中。");
  }
  process.exitCode = 1;
}
