// generate-svg 只让 Claude 产出结构化 SVG payload；文件写入、JSON 修改和校验全部由
// Node wrapper 本地执行。RSS 标题/描述来自互联网，所以 Claude CLI 权限保持最小。
export const GENERATE_SVG_PAYLOAD_ALLOWED_TOOLS = [
  "Read",
];

export function buildGenerateSvgPayloadArgs() {
  // prompt 不走 argv（Windows CreateProcess 命令行上限 ~32,767 字符，大量图标会拼出
  // 40K+ 字符的 prompt 触发 spawn ENAMETOOLONG）。调用方需把 prompt 通过 stdin 喂给 claude。
  return [
    "--allowedTools",
    ...GENERATE_SVG_PAYLOAD_ALLOWED_TOOLS,
    "-p",
    "--effort",
    "low",
  ];
}
