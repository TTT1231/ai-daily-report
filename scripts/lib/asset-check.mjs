import {existsSync} from "node:fs";
import {resolve, sep} from "node:path";

// 收集 report（raw data.json 或 generated data-generate.json）里引用了、但磁盘上
// 不存在的图片/icon 资源。纯函数：传 report + dataDir，返回 missing 列表。
//
// 用途：dev.mjs 在 images/ 下图片被删/改时调用，精确提示哪些 overlayImg/icon 引用
// 现在悬空（否则 Remotion <Img> 会 cancelRender 且 dev 不会自愈——tts 用
// checkAssets:false、图片变化也不触发 tts，死引用会一直留在 data-generate.json）。
//
// 不抛错：report 结构异常或字段缺失时按"无引用"处理，返回空数组。
export function collectMissingImageAssets(report, dataDir) {
  if (!report || typeof report !== "object") return [];
  const missing = [];
  const root = typeof dataDir === "string" ? dataDir : "";

  const check = (ref, owner) => {
    if (typeof ref !== "string" || ref.length === 0) return;
    const absolute = resolve(root, ref);
    // 越界路径（../ 逃逸）不在此处理：交给 report-validation.mjs 的 validateAsset
    // （它会拒 dataDir 之外的路径）兜底；这里只查 dataDir 内的悬空引用。
    if (!absolute.startsWith(root + sep)) return;
    if (!existsSync(absolute)) missing.push({ref, owner});
  };

  const stories = [
    report.intro,
    ...(Array.isArray(report.stories) ? report.stories : []),
    report.outro,
  ].filter(Boolean);

  for (const story of stories) {
    for (const tab of story.tabs ?? []) {
      check(tab.icon, `${story.id}/${tab.id}.icon`);
    }
    for (const scene of story.scenes ?? []) {
      check(scene.overlayImg, `${story.id}/${scene.id}.overlayImg`);
    }
  }

  return missing;
}
