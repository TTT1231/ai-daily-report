#!/usr/bin/env node

/**
 * generate-comment.mjs
 *
 * 从 data-generate.json 读取场景时间线，生成 B 站风格的时间戳评论。
 * 时间戳格式：MM:SS（如 01:23），点击可跳转到视频对应帧。
 *
 * 用法：
 *   bun run comment:generate          # 生成到 comments.txt 并预览
 *   bun run comment:generate --copy    # 同时复制到剪贴板
 */

import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import {collectTimelineScenes} from "../../lib/report-builder.mjs";
import { dataDir, generatedDataPath, readJson } from "../../lib/paths.mjs";
import { validateReport } from "../../lib/report-validation.mjs";

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

  // 3. 评论时间戳直接读 generated 数据里 story.videoStartMs，不再自行重算。
  //    该值由 TTS 流程用与渲染侧同源的时间线（含 story 间过渡帧）一次性写入，
  //    避免此前评论侧独立计算导致与画面错位。
  const missingStartMs = (data.stories ?? []).filter(
    (story) => !Number.isFinite(story.videoStartMs),
  );
  if (missingStartMs.length > 0) {
    console.warn(
      `⚠️  有 ${missingStartMs.length} 条 story 缺少 videoStartMs（data-generate.json 可能是旧的）。时间戳将回退为 00:00，请重新 bun run tts。`,
    );
  }

  // 4. 生成评论（每条新闻一条：序号 + 内容 + 【时间】）
  //    时间戳取该 story 的成片起始毫秒，正文用 contentTitle 概括
  const items = (data.stories ?? []).map((story) => {
    const timestamp = msToTimestamp(story.videoStartMs ?? 0);
    const content = stripMarkdown(story.contentTitle || story.introTitle || "");
    return `${content} 【${timestamp}】`;
  });

  const numberedLines = items.map((line, idx) => `${idx + 1}. ${line}`);
  const commentBlock = ["今日日报：", ...numberedLines].join("\n");

  // 5. 写入文件（直接输出评论块）
  writeFileSync(OUTPUT_PATH, `${commentBlock}\n`, "utf-8");
  console.log(`✅ 已生成 ${items.length} 条评论 → data-scheme/comments.txt`);

  // 6. 可选：复制到剪贴板
  if (shouldCopy) {
    copyToClipboard(commentBlock);
    console.log("📋 评论内容已复制到剪贴板");
  }

  // 7. 控制台预览
  console.log("\n── 评论预览 ──────────────────────────────");
  console.log(commentBlock);
  console.log("──────────────────────────────────────────");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
