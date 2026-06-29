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
  parseGenerateSvgPayload,
} from "../lib/generate-svg-payload.mjs";
import {dataDir, generatedDataPath, rawDataPath, readJson, rootDir} from "../lib/paths.mjs";

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
      reject(new Error(`无法启动 claude (${claudeCommand}): ${error.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`claude payload exited ${code ?? "null"}${stderr ? `\n${stderr}` : ""}`));
      }
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
  await runCommand(bunCommand, ["run", "comment:generate"], "bun run comment:generate");
}

async function runStructuredPayloadMode({promptPrefix}) {
  const report = await readJson(generatedDataPath, "data-scheme/data-generate.json");
  const targetPlan = buildGenerateSvgTargetPlan(report, {
    dataDir,
    force,
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
  const output = await requestClaudePayload(prompt);
  const payload = parseGenerateSvgPayload(output);
  const result = await applyGenerateSvgPayload({
    payload,
    report,
    targetPlan,
    dataDir,
    generatedDataPath,
    rawDataPath,
  });

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
