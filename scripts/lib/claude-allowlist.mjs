// generate-svg 的精确权限 allowlist（单一数据源）。
//
// generate-svg 处理的是 RSS 抓来的标题/描述——不可信的互联网内容，存在提示注入风险。
// 因此放行范围必须最小：只允许 data-scheme 图标写入、icon 字段编辑，以及只读/校验类命令，
// 不放行任意 Bash / 任意文件写 / 任意 MCP。即便 claude 被注入内容"说服"，权限层也会拦住越界操作。
//
// 被 prepare-video.mjs（video:prepare 自动流程）和 generate-svg.mjs（npm 手动入口 wrapper）
// 共同引用，保证两条入口走同一份权限配置，不再各自维护、靠注释同步。
export const GENERATE_SVG_ALLOWED_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "Write(data-scheme/icons/**)",
  "Edit(data-scheme/icons/**)",
  "Edit(data-scheme/data-generate.json)",
  "Edit(data-scheme/data.json)",
  "Bash(mkdir -p data-scheme/icons)",
  "Bash(bun run check-icons)",
  "Bash(bun run lint)",
  "Bash(bun run comment:generate)",
];

// 构造 claude CLI 调用 /generate-svg 时的参数，复用同一份 allowlist。
// 与 prepare-video.mjs 的 generate-svg 步骤、package.json 的 generate-svg 入口保持同源。
export function buildGenerateSvgArgs() {
  return [
    "--allowedTools",
    ...GENERATE_SVG_ALLOWED_TOOLS,
    "-p",
    "--effort",
    "low",
    "/generate-svg",
  ];
}
