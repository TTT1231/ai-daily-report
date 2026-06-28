// generate-svg 只让 Claude 产出结构化 SVG payload；文件写入、JSON 修改和校验全部由
// Node wrapper 本地执行。RSS 标题/描述来自互联网，所以 Claude CLI 权限保持最小。
export const GENERATE_SVG_PAYLOAD_ALLOWED_TOOLS = [
  "Read",
];

export function buildGenerateSvgPayloadArgs({prompt} = {}) {
  if (typeof prompt !== "string" || prompt.trim() === "") {
    throw new Error("buildGenerateSvgPayloadArgs requires a non-empty prompt.");
  }

  return [
    "--allowedTools",
    ...GENERATE_SVG_PAYLOAD_ALLOWED_TOOLS,
    "-p",
    "--effort",
    "low",
    prompt,
  ];
}
