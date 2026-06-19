#!/usr/bin/env node

/**
 * generate-bili-meta.mjs
 *
 * 读当天 data-generate.json 的新闻，调 LLM(复用 rss 同款 OpenAI 兼容接口)
 * 生成 B站 短视频标题前缀 + 标签，拼上固定后缀，校验后写到
 * data-scheme/bilibili-meta.json，供 upload-bilibili.mjs 读取。
 *
 * 用法：bun run bili:meta   (package.json 已带 --env-file-if-exists=.env)
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { dataDir, generatedDataPath, readJson } from "./lib/paths.mjs";

// ── LLM 配置（复用 rss 的 AI_API_KEY / AI_BASE_URL / AI_MODEL）──────────
const BASE_URL = (process.env.AI_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
const MODEL = process.env.AI_MODEL || "deepseek-v4-flash";
const API_KEY = process.env.AI_API_KEY;
if (!API_KEY) {
  console.error("❌ 缺少 AI_API_KEY，请在 .env 配置（与 rss 同源）");
  process.exit(1);
}

// ── 标题规则 ─────────────────────────────────────────────────────────
const SUFFIX_LEN = 16; // 【AI日报 - MM - DD】
const MAX_TITLE = 80; // B站标题上限：中文/字母/符号每个算 1
const PREFIX_MAX = MAX_TITLE - SUFFIX_LEN; // 前缀最多 64 字符

const buildSuffix = (date) => {
  const [, mm, dd] = String(date).split("-"); // YYYY-MM-DD
  return `【AI日报 - ${mm} - ${dd}】`;
};

// ── 调 LLM ────────────────────────────────────────────────────────────
async function llm(messages) {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: MODEL, stream: false, temperature: 0.85, messages }),
  });
  if (!res.ok) throw new Error(`AI 接口 ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("AI 返回为空");
  return text;
}

// 容错解析：剥掉 ```json 围栏，取第一个 {..} 块
function parseLoose(text) {
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("找不到 JSON 块");
  return JSON.parse(cleaned.slice(start, end + 1));
}

// ── 主流程 ────────────────────────────────────────────────────────────
async function main() {
  const report = await readJson(generatedDataPath, "data-scheme/data-generate.json");
  const { date, stories = [] } = report;
  if (!date) throw new Error("data-generate.json 缺 date");
  if (!stories.length) throw new Error("data-generate.json 没有 stories");

  const newsList = stories
    .map((s, i) => `${i + 1}. ${s.contentTitle || s.introTitle || ""}`)
    .join("\n");

  const prompt = `你是B站短视频运营，擅长写手机信息流里高点击的标题。

以下是今日的 AI 新闻：
${newsList}

请据此输出：
1. 标题【前缀】（后缀【AI日报 - MM - DD】会由程序自动拼接，你只写前缀）。
   要求：这是手机竖屏信息流里展示的标题——必须让人停下划动；让人一眼看懂今天最重要的点；
   可以适度夸张、渲染情绪、制造冲击感来吸引点击，但绝不能编造事实或与新闻内容矛盾。
2. 前缀 ≤ ${PREFIX_MAX} 字符（中文 / 字母 / 标点每个都算 1 个字符）。
3. 再给最多 10 个相关标签，逗号分隔，不要带 #。

只返回 JSON，不要任何多余解释：{"titlePrefix":"标题前缀","tag":"标签1,标签2,标签3"}`;

  console.log(`[LLM] 模型 ${MODEL}，生成标题/标签 …`);
  const raw = await llm([
    { role: "system", content: "你是B站短视频标题写手，严格遵守字符限制，只输出 JSON。" },
    { role: "user", content: prompt },
  ]);

  let parsed;
  try {
    parsed = parseLoose(raw);
  } catch {
    throw new Error(`LLM 返回无法解析为 JSON:\n${raw}`);
  }

  // ── 组装 + 强制校验 ────────────────────────────────────────────────
  let titlePrefix = String(parsed.titlePrefix || "").trim();
  const tagRaw = String(parsed.tag || "");

  // 前缀超长就截断（BMP 字符按 UTF-16 码元算，中文各占 1）
  if (titlePrefix.length > PREFIX_MAX) titlePrefix = titlePrefix.slice(0, PREFIX_MAX);

  const title = titlePrefix + buildSuffix(date);
  if (title.length > MAX_TITLE) {
    throw new Error(`标题仍超长（${title.length} > ${MAX_TITLE}）: ${title}`);
  }

  const tags = tagRaw
    .split(/[,，]/)
    .map((t) => t.trim().replace(/^#/, ""))
    .filter(Boolean);
  if (!tags.length) throw new Error("标签为空");
  if (tags.length > 10) tags.length = 10;

  // ── 写出 ───────────────────────────────────────────────────────────
  const out = {
    title,
    tag: tags.join(","),
    date,
    generatedAt: new Date().toISOString(),
    model: MODEL,
  };
  const outPath = resolve(dataDir, "bilibili-meta.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf-8");

  console.log(`✅ 已生成 ${outPath}`);
  console.log(`标题 (${title.length}/80 字): ${title}`);
  console.log(`标签 (${tags.length}/10 个): ${tags.join(", ")}`);
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
