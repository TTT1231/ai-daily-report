import {buildEvidenceFramePlan} from "./evidence-frame-plan.mjs";

export function buildEvidencePreviewPlan(report, {fps, sceneIds} = {}) {
  const {frames, errors} = buildEvidenceFramePlan(report);
  if (!Number.isFinite(fps) || fps <= 0) errors.push("Valid fps required.");
  for (const id of sceneIds ?? []) {
    if (!frames.some((frame) => frame.sceneId === id)) errors.push(`Unknown evidence scene: ${id}`);
  }
  const seen = new Set();
  const selected = [];
  for (const frame of frames) {
    if (sceneIds && !sceneIds.includes(frame.sceneId)) continue;
    const story = report.stories.find((entry) => entry.id === frame.storyId);
    const scene = story.scenes.find((entry) => entry.id === frame.sceneId);
    const key = JSON.stringify([frame.storyId, frame.overlayImg, scene.overlayImgScale ?? 1]);
    // Explicit scene selection never deduplicates: callers may be checking a
    // particular subtitle. Default batches inspect each evidence layout once.
    if (!sceneIds && seen.has(key)) continue;
    seen.add(key);
    selected.push({...frame, frame: Math.round(frame.timeMs * fps / 1000)});
  }
  if (!selected.length) errors.push("No evidence previews selected.");
  return {errors, frames: selected};
}
