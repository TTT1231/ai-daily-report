import {buildEvidenceFramePlan} from "./evidence-frame-plan.mjs";

function bookendFrames(report, fps, errors) {
  const result = {intro: [], outro: []};
  for (const name of ["intro", "outro"]) {
    const story = report?.[name];
    if (!story) continue;
    const firstStartMs = story.scenes?.[0]?.timing?.startMs;
    if (!Number.isFinite(story.videoStartMs) || !Number.isFinite(firstStartMs)) {
      errors.push(`${name} is missing render timing for preview.`);
      continue;
    }
    for (const scene of story.scenes) {
      const startMs = scene.timing?.startMs;
      const durationMs = scene.timing?.durationMs;
      if (!Number.isFinite(startMs) || !Number.isFinite(durationMs) || durationMs <= 0) {
        errors.push(`${name}/${scene.id}: invalid render timing for preview.`);
        continue;
      }
      const timeMs = story.videoStartMs + startMs - firstStartMs + durationMs / 2;
      const safeId = String(scene.id).toLowerCase().replace(/[^a-z0-9.-]+/g, "-");
      result[name].push({storyId: story.id, sceneId: scene.id,
        overlayImg: scene.overlayImg ?? null, subtitle: scene.subtitle,
        timeMs, fileName: `preview-${name}-${safeId}.png`, frame: Math.round(timeMs * fps / 1000)});
    }
  }
  return result;
}

export function buildEvidencePreviewPlan(report, {fps, sceneIds, allScenes = false} = {}) {
  const {frames, errors} = buildEvidenceFramePlan(report);
  if (!Number.isFinite(fps) || fps <= 0) errors.push("Valid fps required.");
  const bookends = allScenes || sceneIds ? bookendFrames(report, fps, errors) : {intro: [], outro: []};
  for (const id of sceneIds ?? []) {
    if (![...bookends.intro, ...frames, ...bookends.outro].some((frame) => frame.sceneId === id)) {
      errors.push(`Unknown preview scene: ${id}`);
    }
  }
  const seen = new Set();
  const selected = bookends.intro.filter((frame) => allScenes || sceneIds?.includes(frame.sceneId));
  for (const frame of frames) {
    if (sceneIds && !sceneIds.includes(frame.sceneId)) continue;
    const story = report.stories.find((entry) => entry.id === frame.storyId);
    const scene = story.scenes.find((entry) => entry.id === frame.sceneId);
    const key = JSON.stringify([frame.storyId, frame.overlayImg, scene.overlayImgScale ?? 1]);
    // Explicit or all-scene selection keeps every subtitle; the default
    // batch inspects each evidence layout once.
    if (!sceneIds && !allScenes && seen.has(key)) continue;
    seen.add(key);
    selected.push({...frame, frame: Math.round(frame.timeMs * fps / 1000)});
  }
  selected.push(...bookends.outro.filter((frame) => allScenes || sceneIds?.includes(frame.sceneId)));
  if (!selected.length) errors.push("No evidence previews selected.");
  return {errors, frames: selected};
}
