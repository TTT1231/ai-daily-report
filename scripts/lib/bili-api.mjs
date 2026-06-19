/**
 * lib/bili-api.mjs
 *
 * B 站评论相关 web API 封装（发评论 / 置顶）。
 * 鉴权只需 cookie 里的 SESSDATA + bili_jct(=csrf)，风控签名参数
 * (w_rid/dm_img_*) 在本场景经实测不是强制的，故不带。
 *
 * 所有函数都返回纯数据、自己不打印（重试进度除外）。
 * 凭据从 biliup/cookies.json 读取（biliup login 生成、download-bili 平铺），
 * 不再走 .env，避免重复维护。
 *
 * 重试策略：评论/置顶失败最多重试 3 次，指数回退（3s→6s…）+ 0~1s 随机抖动，
 * 更接近人类操作节奏、降低触发风控；未登录/csrf 失效这类"重试也没用"的错误
 * 直接快速失败。
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { rootDir } from "./paths.mjs";

const API = "https://api.bilibili.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

const COOKIE_FILE = resolve(rootDir, "biliup", "cookies.json");

// 评论类型固定为 1（UGC 视频，即 UP 主自己上传的那种）
const TYPE = "1";

// 重试：3 次、指数回退 + 抖动
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 3000; // 首次重试等待基准
const BACKOFF_FACTOR = 2; // 指数：3s, 6s, 12s …
const JITTER_MAX_MS = 1000; // 0~1s 随机抖动，更像人类
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let _credCache = null;

export function getCredentials() {
  if (_credCache) return _credCache;

  let raw;
  try {
    raw = readFileSync(COOKIE_FILE, "utf8");
  } catch {
    throw new Error(
      `读不到 biliup/cookies.json（${COOKIE_FILE}）。先 bun run download-bili，再 biliup.exe -u biliup/cookies.json login 扫码登录。`,
    );
  }

  let cookies;
  try {
    cookies = JSON.parse(raw)?.cookie_info?.cookies;
  } catch {
    throw new Error("biliup/cookies.json 解析失败，请重新登录生成。");
  }
  if (!Array.isArray(cookies)) {
    throw new Error("biliup/cookies.json 结构异常（缺 cookie_info.cookies）。");
  }

  // cookies.json 里的 value 是 URL 编码的（如 %2C），还原成原始值再拼 Cookie 头
  const pick = (name) => {
    const c = cookies.find((x) => x.name === name);
    return c ? decodeURIComponent(c.value) : "";
  };
  const sessdata = pick("SESSDATA");
  const csrf = pick("bili_jct");
  if (!sessdata || !csrf) {
    throw new Error("biliup/cookies.json 里没有 SESSDATA / bili_jct，请重新扫码登录。");
  }

  _credCache = { sessdata, csrf };
  return _credCache;
}

/** 第 attempt 次失败后的回退毫秒（指数 + 随机抖动）。attempt 从 1 起。 */
function backoffMs(attempt) {
  const base = BASE_BACKOFF_MS * Math.pow(BACKOFF_FACTOR, attempt - 1);
  return base + Math.floor(Math.random() * JITTER_MAX_MS);
}

/** 未登录 / csrf 失效这类错误：重试无意义且更易触发风控 → 直接失败。 */
function isPermanentError(err) {
  const code = err?.biliCode;
  return code === -101 || code === -111;
}

/** 带 3 次指数回退重试的执行器。 */
async function withRetry(label, fn) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= MAX_ATTEMPTS || isPermanentError(err)) throw err;
      const ms = backoffMs(attempt);
      const tag =
        err.biliCode !== undefined ? `code=${err.biliCode}` : (err.message || "").slice(0, 60);
      process.stdout.write(
        `  ${label} 第 ${attempt}/${MAX_ATTEMPTS - 1} 次重试（${tag}），${(ms / 1000).toFixed(1)}s 后再试…\n`,
      );
      await sleep(ms);
    }
  }
  throw lastErr;
}

async function biliFetch(pathname, { method = "GET", query, body } = {}) {
  const { sessdata, csrf } = getCredentials();
  const url = new URL(API + pathname);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

  const init = {
    method,
    headers: {
      "User-Agent": UA,
      Cookie: `SESSDATA=${sessdata}; bili_jct=${csrf}`,
      Referer: "https://www.bilibili.com/",
      Origin: "https://www.bilibili.com",
      Accept: "*/*",
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
  };
  if (body) {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) form.set(k, v);
    init.body = form.toString();
  }

  const res = await fetch(url, init);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`非 JSON 响应 (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  return { status: res.status, json };
}

/** bvid → aid（评论接口的 oid）。直接传 oid 时原样返回。 */
export async function resolveOid({ bvid, oid } = {}) {
  if (oid) return oid;
  if (!bvid) throw new Error("需要提供 --bvid 或 --oid");
  const { status, json } = await biliFetch("/x/web-interface/view", {
    query: { bvid },
  });
  if (json.code !== 0) {
    throw new Error(
      `解析 bvid→aid 失败 (HTTP ${status}, code=${json.code}): ${json.message}`,
    );
  }
  return String(json.data.aid);
}

/**
 * 发评论到 oid 对应的视频。返回新评论的 rpid（字符串）。
 * 失败自动重试 3 次（指数回退）。
 */
export async function postComment(oid, message) {
  return withRetry("发评论", async () => {
    const { status, json } = await biliFetch("/x/v2/reply/add", {
      method: "POST",
      body: {
        plat: "1",
        oid,
        type: TYPE,
        message,
        at_name_to_mid: "{}",
        gaia_source: "main_web",
        csrf: getCredentials().csrf,
        statistics: JSON.stringify({ appId: 100, platform: 5 }),
      },
    });
    if (json.code !== 0) {
      const err = new Error(
        `发评论失败 (HTTP ${status}, code=${json.code}): ${json.message}`,
      );
      err.biliCode = json.code;
      throw err;
    }
    return json.data.rpid_str || String(json.data.rpid);
  });
}

/**
 * 置顶评论。评论刚发出可能尚未索引（-404）或审核未完全通过，
 * 会自动重试 3 次（指数回退）。
 */
export async function pinComment(oid, rpid) {
  return withRetry("置顶", async () => {
    const { csrf } = getCredentials();
    const { status, json } = await biliFetch("/x/v2/reply/top", {
      method: "POST",
      body: { oid, type: TYPE, rpid, action: "1", csrf },
    });
    if (json.code === 0) return true;
    const err = new Error(`置顶失败 (HTTP ${status}, code=${json.code}): ${json.message}`);
    err.biliCode = json.code;
    throw err;
  });
}
