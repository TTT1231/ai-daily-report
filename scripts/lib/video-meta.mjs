#!/usr/bin/env node

/**
 * video-meta.mjs
 *
 * 读当天 data.json 的新闻，调 LLM(复用 ingest 同款 OpenAI 兼容接口)
 * 生成视频标题前缀 + 标签，拼上固定后缀，校验后写到
 * data-scheme/video-meta.json。产物是与发布平台无关的视频元数据，
 * 供投稿脚本读取。标题模型会读取完整 stories，理解整期 AI 日报后再选主打点。
 * package.json 的 video:meta 会先生成时间轴评论，再运行本文件。
 *
 * 用法：bun run video:meta（一次生成 comments.txt + video-meta.json）
 */

import { renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { dataDir, rawDataPath, readJson } from "./paths.mjs";
import { parseReportDate } from "./report-builder.mjs";

// ── LLM 配置（复用 rss 的 AI_API_KEY / AI_BASE_URL / AI_MODEL）──────────
const { AI_API_KEY: API_KEY, AI_BASE_URL: BASE_URL, AI_MODEL: MODEL } = process.env;

// ── 标题规则 ─────────────────────────────────────────────────────────
const SUFFIX_LEN = 16; // 【AI日报 - MM - DD】
const MAX_TITLE = 80; // B站标题上限：中文/字母/符号每个算 1
const PREFIX_MAX = MAX_TITLE - SUFFIX_LEN; // 前缀最多 64 字符

const buildSuffix = (date) => {
  const [, mm, dd] = String(date).split("-"); // YYYY-MM-DD
  return `【AI日报 - ${mm} - ${dd}】`;
};

function assertLlmConfig() {
  const missing = [
    !API_KEY && "AI_API_KEY",
    !BASE_URL && "AI_BASE_URL",
    !MODEL && "AI_MODEL",
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(
      `缺少环境变量 ${missing.join("、")}，请在 .env 配置（与 rss 同源）`,
    );
  }
}

// ── 调 LLM ────────────────────────────────────────────────────────────
const LLM_TIMEOUT_MS = 60000;
const LLM_MAX_ATTEMPTS = 3;

// llm 调用 OpenAI 兼容 chat/completions，带 60s 超时与瞬态错误退避重试，与 minimax-tts 的
// 超时/重试防护对齐：避免 LLM 接口挂起让 video:meta 无限阻塞，或单次 5xx/网络抖动直接失败。
// 4xx 等永久错误立即抛出（重试无意义）。
async function llm(messages) {
  const body = JSON.stringify({
    model: MODEL,
    stream: false,
    temperature: 0.85,
    messages,
  });
  let lastErr;
  for (let attempt = 1; attempt <= LLM_MAX_ATTEMPTS; attempt++) {
    let res;
    try {
      res = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
        },
        signal: globalThis.AbortSignal.timeout(LLM_TIMEOUT_MS),
        body,
      });
    } catch (err) {
      // 网络错误 / 超时（AbortError）：退避重试，单次抖动不应让 video:meta 失败。
      lastErr = err;
      if (attempt < LLM_MAX_ATTEMPTS) {
        console.warn(`[LLM] 请求失败，重试中 (${attempt}/${LLM_MAX_ATTEMPTS}): ${err.message}`);
        continue;
      }
      throw new Error(`AI 接口请求失败（已重试 ${LLM_MAX_ATTEMPTS} 次）: ${err.message}`);
    }
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      // 429 限流与 5xx 同属瞬时错误，退避重试；4xx 立即抛出。错误体限长 300 字，
      // 避免超大错误页撑爆日志。
      if ((res.status === 429 || res.status >= 500) && attempt < LLM_MAX_ATTEMPTS) {
        lastErr = new Error(`AI 接口 ${res.status}: ${errBody.slice(0, 300)}`);
        console.warn(`[LLM] 接口返回 ${res.status}，重试中 (${attempt}/${LLM_MAX_ATTEMPTS})`);
        continue;
      }
      throw new Error(`AI 接口 ${res.status}: ${errBody.slice(0, 300)}`);
    }
    let data;
    try {
      data = await res.json();
    } catch (err) {
      // 200 + 非 JSON 体（网关故障页等）：与 5xx 一样按瞬时错误重试。
      lastErr = new Error(`AI 接口返回非 JSON 响应: ${String(err?.message ?? err)}`);
      if (attempt < LLM_MAX_ATTEMPTS) {
        console.warn(`[LLM] 响应解析失败，重试中 (${attempt}/${LLM_MAX_ATTEMPTS})`);
        continue;
      }
      throw lastErr;
    }
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("AI 返回为空");
    return text;
  }
  throw lastErr ?? new Error("AI 接口请求失败");
}

// 容错解析：剥掉 ```json 围栏，取第一个 {..} 块
function parseLoose(text) {
  const cleaned = text
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("找不到 JSON 块");
  return JSON.parse(cleaned.slice(start, end + 1));
}

export function buildVideoMetaPrompt(stories, prefixMax = PREFIX_MAX) {
  return `你在为一期“AI 日报类短视频”制作发布元数据。视频用 1 分钟左右快速播报多条 AI/科技新闻，面向手机信息流用户；当前发布到 B站，但标题和标签应描述整期内容，而不是假装成单条新闻。

下面是本期 data.json 中完整的 stories JSON，数组顺序就是视频播放顺序。你必须先理解全部 Story 的标题、Tabs 事实卡和 Scenes 口播，再判断整期最值得主打的内容。图标、图片路径和 id 只是制作字段，不是新闻事实：

${JSON.stringify(stories, null, 2)}

请输出：
1. 标题【前缀】（后缀【AI日报 - MM - DD】由程序自动拼接，你只写前缀）。
   要求：
   - 这是 AI 日报短视频标题，要让观众知道“本期最重要的 AI 动态是什么”，不能写成单一产品发布会标题。
   - 通读全部 Stories 后只挑 1~2 个最重磅、最有冲击力的点主打；标题可以聚焦，但不能与整期内容或具体事实矛盾。
   - 只能使用 Tabs/Scenes 明确提供的事实。不得把“参与评测、发现问题、传闻、预览”改写成“刚发布、正式上线、官方确认”等更强结论。
   - 严禁用顿号或逗号堆砌三条以上新闻；宁可把 1~2 个强点写透。
   - 适合手机信息流：主体明确、事件明确、自然有冲击力，不写空泛的“AI 又有大动作”。
2. 前缀不超过 ${prefixMax} 字符（中文、字母、标点每个都算 1 个字符）。
3. 给 5~8 个相关标签，逗号分隔，不带 #。
   - 标签要覆盖整期的主要内容与 AI 日报应用场景，至少包含一个宽主题词（如 AI日报、人工智能、大模型、AI工具）。
   - 合并同主体/同公司的标签；同系产品只保留一个最有搜索价值的写法。
   - 冷门跑分、内部代号、过细平台名，除非是标题主打点，否则不要单独成标签。

只返回 JSON，不要解释：{"titlePrefix":"标题前缀","tag":"标签1,标签2,标签3"}`;
}

export function buildVideoMetaMessages(stories, prefixMax = PREFIX_MAX) {
  return [
    {
      role: "system",
      content:
        "你是 AI 日报类短视频的资深内容运营。先理解整期 Stories，再写准确、有点击力的标题和标签；严格遵守事实边界与字符限制，只输出 JSON。",
    },
    { role: "user", content: buildVideoMetaPrompt(stories, prefixMax) },
  ];
}

// ── 主流程 ────────────────────────────────────────────────────────────
async function main() {
  assertLlmConfig();
  const report = await readJson(rawDataPath, "data-scheme/data.json");
  const { date, stories = [] } = report;
  if (!date) throw new Error("data.json 缺 date");
  if (!stories.length) throw new Error("data.json 没有 stories");
  // 后缀按月/日拼接，先拒绝"2026-13-45"这类形状合法但语义错误的日期，
  // 否则会产出【AI日报 - 13 - 45】这种坏标题。
  if (!parseReportDate(date)) {
    throw new Error(`data.json 的 date 不是有效日期: ${date}`);
  }

  console.log(`[LLM] 模型 ${MODEL}，生成标题/标签 …`);
  const raw = await llm(buildVideoMetaMessages(stories));

  let parsed;
  try {
    parsed = parseLoose(raw);
  } catch {
    throw new Error(`LLM 返回无法解析为 JSON:\n${raw}`);
  }

  // ── 组装 + 强制校验 ────────────────────────────────────────────────
  let titlePrefix = String(parsed.titlePrefix || "").trim();
  const tagRaw = String(parsed.tag || "");

  if (!titlePrefix) throw new Error("AI 返回的标题前缀为空");
  if (titlePrefix.length > PREFIX_MAX) {
    throw new Error(
      `AI 返回的标题前缀超长（${titlePrefix.length} > ${PREFIX_MAX}），为避免硬截断坏标题，已停止写入，请重试`,
    );
  }

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
  const outPath = resolve(dataDir, "video-meta.json");
  // 原子写：投稿脚本可能随时读该文件，直接覆盖在崩溃/断电时会留下半截 JSON。
  const stagingPath = resolve(dataDir, ".video-meta.json.staging");
  writeFileSync(stagingPath, JSON.stringify(out, null, 2) + "\n", "utf-8");
  renameSync(stagingPath, outPath);

  console.log(`✅ 已生成 ${outPath}`);
  console.log(`标题 (${title.length}/80 字): ${title}`);
  console.log(`标签 (${tags.length}/10 个): ${tags.join(", ")}`);
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectRun) {
  main().catch((err) => {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  });
}
