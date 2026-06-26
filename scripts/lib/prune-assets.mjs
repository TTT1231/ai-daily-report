// 归档前清理 data-scheme/ 下未被引用的 images / icons / audio。
//
// 引用来源：
//   images（scene.overlayImg）、icons（tab.icon）—— data.json 与 data-generate.json 都可能有；
//   audio（scene.audioSrc）—— 仅 data-generate.json。
// 取两份 JSON 的并集作为"被引用集合"，更抗漂移（用户改了 data.json 还没重跑 tts 时不误删）。
//
// 安全栅栏：
//   - 只有读到引用来源才清理对应目录；audio 仅当读到 data-generate.json 时才清理，
//     否则跳过 audio（绝不在无依据时清空 audio）。两份 JSON 都缺 → 整体跳过。
//   - 仅删除扩展名白名单内的文件（与 schema 一致），不动 .gitkeep / README / 未知扩展名。
//   - 删除目标只可能来自 readdirSync(dir)，天然被限制在目录内部，不会越界。
import {existsSync, readdirSync, readFileSync, statSync, unlinkSync} from "node:fs";
import {extname, join, resolve} from "node:path";

const RAW_NAME = "data.json";
const GENERATED_NAME = "data-generate.json";

const ALLOWLISTS = {
  images: ["svg", "png", "jpg", "jpeg", "webp", "gif", "avif"],
  icons: ["svg", "png"],
  audio: ["mp3", "wav", "m4a", "aac", "ogg"],
};

// 纯函数：从若干 report 汇总被引用的资源路径（并集）。非字符串/空值跳过。
export function collectReferencedAssets(reports) {
  const images = new Set();
  const icons = new Set();
  const audio = new Set();
  const add = (set, ref) => {
    if (typeof ref === "string" && ref.length > 0) set.add(ref);
  };
  for (const report of (Array.isArray(reports) ? reports : []).filter(Boolean)) {
    const stories = [
      report.intro,
      ...(Array.isArray(report.stories) ? report.stories : []),
      report.outro,
    ].filter(Boolean);
    for (const story of stories) {
      for (const tab of story.tabs ?? []) add(icons, tab.icon);
      for (const scene of story.scenes ?? []) {
        add(images, scene.overlayImg);
        add(audio, scene.audioSrc);
      }
    }
  }
  return {images, icons, audio};
}

// 纯函数（只读磁盘）：返回 dir 下"扩展名在白名单内、且未被引用"的文件。
// prefix 形如 "images"，ref 即 `${prefix}/${filename}`；跳过子目录与点文件。
export function findUnreferenced(dir, prefix, referenced, allowlist) {
  if (!existsSync(dir)) return [];
  const allow = new Set(allowlist.map((e) => e.toLowerCase()));
  const orphans = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue; // 跳过 .gitkeep 等点文件
    const abs = join(dir, entry);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (!st.isFile()) continue; // 跳过子目录
    const ext = extname(entry).slice(1).toLowerCase();
    if (!allow.has(ext)) continue; // 非资产扩展名，留着
    const ref = `${prefix}/${entry}`;
    if (!referenced.has(ref)) orphans.push({ref, abs});
  }
  return orphans;
}

// best-effort 读取 data.json / data-generate.json；缺失或解析失败则视为该来源不可用。
function readReportsBestEffort(dataDir) {
  const reports = [];
  let rawRead = false;
  let genRead = false;
  for (const [name, flag] of [[RAW_NAME, "raw"], [GENERATED_NAME, "gen"]]) {
    const abs = resolve(dataDir, name);
    if (!existsSync(abs)) continue;
    try {
      reports.push(JSON.parse(readFileSync(abs, "utf8")));
      if (flag === "raw") rawRead = true;
      else genRead = true;
    } catch {
      // 损坏的 JSON：忽略该来源，交由上游 check-data-json 报错；这里只做清理兜底。
    }
  }
  return {reports, rawRead, genRead};
}

function pruneCategory(dir, prefix, referenced, allowlist, {dryRun}) {
  if (!existsSync(dir)) return {deleted: [], kept: 0};
  const orphan = findUnreferenced(dir, prefix, referenced, allowlist);
  const deleted = orphan.map((o) => o.ref).sort();
  // kept = 白名单资产文件中未被删除的数量
  const assetFiles = readdirSync(dir).filter((entry) => {
    if (entry.startsWith(".")) return false;
    const ext = extname(entry).slice(1).toLowerCase();
    return allowlist.map((e) => e.toLowerCase()).includes(ext);
  });
  const kept = assetFiles.length - orphan.length;
  if (!dryRun) {
    for (const {abs} of orphan) {
      try {
        unlinkSync(abs);
      } catch {
        // 单文件删除失败（如 Windows 偶发句柄占用）不阻断其余清理。
      }
    }
  }
  return {deleted, kept};
}

// 编排：读引用 → 收集并集 → 逐目录清理。返回 summary（dryRun 时只列出、不删除）。
export async function pruneUnreferencedAssets({dataDir, dryRun = false} = {}) {
  const root = resolve(typeof dataDir === "string" ? dataDir : "");
  const {reports, rawRead, genRead} = readReportsBestEffort(root);
  const refs = collectReferencedAssets(reports);

  const canPruneImagesIcons = rawRead || genRead;
  const canPruneAudio = genRead; // audio 仅在 data-generate.json
  const skipped = [];

  if (!canPruneImagesIcons && !canPruneAudio) {
    skipped.push("无 data.json / data-generate.json，跳过全部清理");
    return {dryRun, images: null, icons: null, audio: null, skipped};
  }

  const images = canPruneImagesIcons
    ? pruneCategory(join(root, "images"), "images", refs.images, ALLOWLISTS.images, {dryRun})
    : null;
  const icons = canPruneImagesIcons
    ? pruneCategory(join(root, "icons"), "icons", refs.icons, ALLOWLISTS.icons, {dryRun})
    : null;
  const audio = canPruneAudio
    ? pruneCategory(join(root, "audio"), "audio", refs.audio, ALLOWLISTS.audio, {dryRun})
    : null;
  if (!canPruneAudio) skipped.push("未找到 data-generate.json，跳过 audio 清理");

  return {dryRun, images, icons, audio, skipped};
}
