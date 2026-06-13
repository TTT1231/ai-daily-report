#!/usr/bin/env node

/**
 * generate-comment.mjs
 *
 * 从 data-generate.json 读取场景时间线，生成 B 站风格的时间戳评论。
 * 时间戳格式：MM:SS（如 01:23），点击可跳转到视频对应帧。
 *
 * 用法：
 *   bun run comment          # 生成到 comments.txt 并预览
 *   bun run comment --copy    # 同时复制到剪贴板
 */

import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { collectTimelineScenes } from "./lib/report-builder.mjs";
import { dataDir, generatedDataPath, readJson } from "./lib/paths.mjs";
import { validateReport } from "./lib/report-validation.mjs";

// ── 路径 ──────────────────────────────────────────────
const OUTPUT_PATH = resolve(dataDir, "comments.txt");

// ── 参数 ──────────────────────────────────────────────
const shouldCopy = process.argv.includes("--copy");

// ── 工具函数 ──────────────────────────────────────────

/** 毫秒 → "MM:SS" 格式 */
function msToTimestamp(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** 去除 Markdown 粗体/代码标记，生成纯文本评论 */
function stripMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .trim();
}

/** 跨平台剪贴板复制 */
function copyToClipboard(text) {
  if (process.platform === "win32") {
    execFileSync("clip", { input: text });
  } else if (process.platform === "darwin") {
    execFileSync("pbcopy", { input: text });
  } else {
    execFileSync("xclip", ["-selection", "clipboard"], { input: text });
  }
}

// ── 主流程 ────────────────────────────────────────────

async function main() {
  // 1. 读取数据
  const data = await readJson(generatedDataPath, "data-scheme/data-generate.json");
  const { errors } = validateReport(data, { renderMode: true });
  if (errors.length > 0) {
    throw new Error(`Generated report is invalid:\n- ${errors.join("\n- ")}`);
  }

  // 2. 收集所有场景（按播放顺序）
  const allScenes = collectTimelineScenes(data);

  if (allScenes.length === 0) {
    console.log("⚠️  未找到任何场景数据");
    process.exit(1);
  }

  // 3. 生成评论（仅 content stories 的场景，排除 intro/outro）
  const contentScenes = (data.stories ?? []).flatMap(
    (story) => story.scenes ?? [],
  );

  const comments = contentScenes.map((scene) => {
    const timestamp = msToTimestamp(scene.timing.startMs);
    const content = stripMarkdown(scene.subtitle || "");
    return `${timestamp}  ${content}`;
  });

  // 4. 组装输出文件
  const dateStr = data.date || "unknown";
  const lastScene = allScenes[allScenes.length - 1];
  const totalMs = lastScene.timing.startMs + lastScene.timing.durationMs;
  const duration = msToTimestamp(totalMs);

  const output = [
    `# AI 日报 ${dateStr}`,
    `# 视频总时长：${duration}`,
    "",
    ...comments,
    "",
  ].join("\n");

  // 5. 写入文件
  writeFileSync(OUTPUT_PATH, output, "utf-8");
  console.log(`✅ 已生成 ${contentScenes.length} 条评论 → data-scheme/comments.txt`);

  // 6. 可选：复制到剪贴板
  if (shouldCopy) {
    const clipboardContent = comments.join("\n");
    copyToClipboard(clipboardContent);
    console.log("📋 评论内容已复制到剪贴板");
  }

  // 7. 控制台预览
  console.log("\n── 评论预览 ──────────────────────────────");
  for (const line of comments) {
    console.log(`  ${line}`);
  }
  console.log("──────────────────────────────────────────");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
