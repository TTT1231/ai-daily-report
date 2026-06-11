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

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// ── 路径 ──────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = resolve(__dirname, "..", "data-scheme", "data-generate.json");
const OUTPUT_PATH = resolve(__dirname, "..", "data-scheme", "comments.txt");

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

/** 收集所有场景（按播放顺序：intro.scenes → stories[].scenes → outro.scenes） */
function collectScenes(data) {
  const ordered = [];

  if (data.intro?.scenes) {
    ordered.push(...data.intro.scenes);
  }

  if (data.stories) {
    for (const story of data.stories) {
      if (story.scenes) {
        ordered.push(...story.scenes);
      }
    }
  }

  if (data.outro?.scenes) {
    ordered.push(...data.outro.scenes);
  }

  return ordered;
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
  const isWindows = process.platform === "win32";
  const isMac = process.platform === "darwin";

  if (isWindows) {
    execFileSync("clip", { input: text });
  } else if (isMac) {
    execFileSync("pbcopy", { input: text });
  } else {
    execFileSync("xclip", ["-selection", "clipboard"], { input: text });
  }
}

// ── 主流程 ────────────────────────────────────────────

function main() {
  // 1. 读取数据
  const raw = readFileSync(DATA_PATH, "utf-8");
  const data = JSON.parse(raw);

  // 2. 收集所有场景
  const scenes = collectScenes(data);

  if (scenes.length === 0) {
    console.log("⚠️  未找到任何场景数据");
    process.exit(1);
  }

  // 3. 生成评论（跳过 intro 和 outro 的场景）
  const contentScenes = scenes.filter((scene) => {
    const id = scene.id || "";
    return !id.startsWith("intro-") && !id.startsWith("outro-");
  });

  const comments = contentScenes.map((scene) => {
    const timestamp = msToTimestamp(scene.timing.startMs);
    const content = stripMarkdown(scene.subtitle || "");
    return `${timestamp}  ${content}`;
  });

  // 4. 组装输出文件
  const dateStr = data.date || "unknown";
  const totalMs = scenes.reduce(
    (max, s) => Math.max(max, s.timing.startMs + s.timing.durationMs),
    0,
  );
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
  console.log(`✅ 已生成 ${scenes.length} 条评论 → data-scheme/comments.txt`);

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

main();
