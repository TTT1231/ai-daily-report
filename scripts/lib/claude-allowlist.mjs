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

const GENERATE_SVG_BASE_ALLOWED_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "Edit(data-scheme/data-generate.json)",
  "Edit(data-scheme/data.json)",
  "Bash(mkdir -p data-scheme/icons)",
  "Bash(bun run check-icons)",
  "Bash(bun run lint)",
  "Bash(bun run comment:generate)",
];

function iconToolPath(iconPath) {
  if (typeof iconPath !== "string" || !/^icons\/[A-Za-z0-9_.-]+\.svg$/.test(iconPath)) {
    return null;
  }
  return `data-scheme/${iconPath}`;
}

export function buildGenerateSvgAllowedTools({iconTargets = null} = {}) {
  if (!Array.isArray(iconTargets) || iconTargets.length === 0) {
    return GENERATE_SVG_ALLOWED_TOOLS;
  }

  const uniqueIconTargets = [...new Set(iconTargets)];
  const targetPaths = uniqueIconTargets.map(iconToolPath).filter(Boolean);
  if (targetPaths.length === 0 || targetPaths.length !== uniqueIconTargets.length) {
    return GENERATE_SVG_ALLOWED_TOOLS;
  }

  return [
    ...GENERATE_SVG_BASE_ALLOWED_TOOLS,
    ...targetPaths.flatMap((targetPath) => [`Write(${targetPath})`, `Edit(${targetPath})`]),
  ];
}

export function buildGenerateSvgArgs({
  automation = false,
  preflightErrors = [],
  iconTargets = null,
  promptPrefix = "/generate-svg",
} = {}) {
  const allowedTools = buildGenerateSvgAllowedTools({iconTargets});
  const promptLines = Array.isArray(promptPrefix) ? [...promptPrefix] : [promptPrefix];

  promptLines.push(
    "",
    "Incremental generation constraint:",
    "- Treat tabs with an existing icon field that points to a valid SVG file as locked.",
    "- Do not rewrite, redesign, delete, or reassign valid existing icons.",
    "- Only generate or fix tabs whose icon field is missing, points to a missing file, or fails SVG validation.",
    "- Preserve valid icon fields in both data-scheme/data-generate.json and data-scheme/data.json.",
  );

  if (Array.isArray(iconTargets) && iconTargets.length > 0) {
    promptLines.push("", "Writable icon targets:", ...iconTargets.map((target) => `- ${target}`));
  }

  if (preflightErrors.length > 0) {
    promptLines.push("", "Preflight issues to fix:");
    for (const error of preflightErrors) {
      promptLines.push(`- ${error}`);
    }
  }

  if (automation) {
    promptLines.push(
      "",
      "Automation constraint: finish after static SVG and data validation.",
      "Do not start bun run dev, Remotion Studio, rendering, or any other preview workflow.",
    );
  }

  const prompt = promptLines.join("\n");

  return [
    "--allowedTools",
    ...allowedTools,
    "-p",
    "--effort",
    "low",
    prompt,
  ];
}
