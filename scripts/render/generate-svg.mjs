// generate-svg 的 npm 手动入口 wrapper。
//
// 原先 package.json 的 generate-svg 脚本是把整条 claude 命令（含 allowlist）以 shell 字符串
// 内联，与 prepare-video.mjs 自动流程用的是同一份 allowlist 的两份拷贝，靠注释同步、容易漂移。
// 这里改成由 node 构造命令：allowlist 从 scripts/lib/claude-allowlist.mjs（单一数据源）取，
// 与 prepare-video.mjs 的 generate-svg 步骤同源；对外仍是 `bun run generate-svg`，行为不变。
//
// 不使用 --dangerously-skip-permissions：generate-svg 处理的是 RSS 抓来的不可信标题/描述，
// 精确 allowlist 即便在提示注入下也能把越界操作拦在权限层。
import {spawn, spawnSync} from "node:child_process";
import {existsSync} from "node:fs";
import {readFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {buildGenerateSvgArgs} from "../lib/claude-allowlist.mjs";
import {getGenerateSvgPreflight, printGenerateSvgPreflight} from "../lib/generate-svg-preflight.mjs";
import {rootDir} from "../lib/paths.mjs";

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

const promptPrefix = await readGenerateSvgSkillPrompt();
const claudeCommand = process.platform === "win32" ? "claude.exe" : "claude";
const child = spawn(
  claudeCommand,
  [
    ...buildBareSettingsArgs(),
    ...buildGenerateSvgArgs({
      automation,
      preflightErrors: preflight.errors,
      iconTargets: preflight.iconTargets,
      promptPrefix,
    }),
  ],
  {
    cwd: rootDir,
    env: buildClaudeEnv(),
    stdio: "inherit",
    shell: false,
  },
);

child.on("error", (error) => {
  console.error(`无法启动 claude (${claudeCommand}): ${error.message}`);
  console.error("请确认 Claude CLI 已安装并在 PATH 中。");
  process.exitCode = 1;
});

child.on("close", (code) => {
  process.exitCode = code ?? 1;
});
