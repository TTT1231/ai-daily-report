// generate-svg 的 npm 手动入口 wrapper。
//
// 原先 package.json 的 generate-svg 脚本是把整条 claude 命令（含 allowlist）以 shell 字符串
// 内联，与 prepare-video.mjs 自动流程用的是同一份 allowlist 的两份拷贝，靠注释同步、容易漂移。
// 这里改成由 node 构造命令：allowlist 从 scripts/lib/claude-allowlist.mjs（单一数据源）取，
// 与 prepare-video.mjs 的 generate-svg 步骤同源；对外仍是 `bun run generate-svg`，行为不变。
//
// 不使用 --dangerously-skip-permissions：generate-svg 处理的是 RSS 抓来的不可信标题/描述，
// 精确 allowlist 即便在提示注入下也能把越界操作拦在权限层。
import { spawn } from "node:child_process";
import { buildGenerateSvgArgs } from "../lib/claude-allowlist.mjs";
import { rootDir } from "../lib/paths.mjs";

const claudeCommand = process.platform === "win32" ? "claude.exe" : "claude";
const child = spawn(claudeCommand, buildGenerateSvgArgs(), {
  cwd: rootDir,
  env: process.env,
  stdio: "inherit",
  shell: false,
});

child.on("error", (error) => {
  console.error(`无法启动 claude (${claudeCommand}): ${error.message}`);
  console.error("请确认 Claude CLI 已安装并在 PATH 中。");
  process.exitCode = 1;
});

child.on("close", (code) => {
  process.exitCode = code ?? 1;
});
