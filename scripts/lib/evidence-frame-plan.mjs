function isFiniteNonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function safeFilePart(value) {
  return String(value ?? "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

// Build timestamps in rendered-video time. Scene timing.startMs is the audio timeline
// without inter-story transition gaps, while story.videoStartMs includes those gaps.
// Offsetting each scene from its story's first timing entry keeps the two clocks aligned.
export function buildEvidenceFramePlan(report) {
  const errors = [];
  const frames = [];
  const stories = Array.isArray(report?.stories) ? report.stories : [];

  for (const story of stories) {
    const scenes = Array.isArray(story?.scenes) ? story.scenes : [];
    const overlayScenes = scenes.filter(
      (scene) => typeof scene?.overlayImg === "string" && scene.overlayImg.length > 0,
    );
    if (overlayScenes.length === 0) continue;

    const storyId = story?.id ?? "?";
    const firstSceneStartMs = scenes[0]?.timing?.startMs;
    if (!isFiniteNonNegative(story?.videoStartMs)) {
      errors.push(`story "${storyId}" is missing a valid videoStartMs`);
      continue;
    }
    if (!isFiniteNonNegative(firstSceneStartMs)) {
      errors.push(`story "${storyId}" is missing first-scene timing.startMs`);
      continue;
    }

    for (const scene of overlayScenes) {
      const sceneId = scene?.id ?? "?";
      const startMs = scene?.timing?.startMs;
      const durationMs = scene?.timing?.durationMs;
      if (!isFiniteNonNegative(startMs) || !Number.isFinite(durationMs) || durationMs <= 0) {
        errors.push(`story "${storyId}" scene "${sceneId}" has invalid generated timing`);
        continue;
      }
      const relativeStartMs = startMs - firstSceneStartMs;
      if (relativeStartMs < 0) {
        errors.push(`story "${storyId}" scene "${sceneId}" starts before its first scene`);
        continue;
      }

      const timeMs = story.videoStartMs + relativeStartMs + durationMs / 2;
      frames.push({
        storyId,
        sceneId,
        overlayImg: scene.overlayImg,
        subtitle: scene.subtitle,
        timeMs,
        fileName: `${String(frames.length + 1).padStart(3, "0")}-${safeFilePart(storyId)}-${safeFilePart(sceneId)}.png`,
      });
    }
  }

  return {errors, frames};
}
