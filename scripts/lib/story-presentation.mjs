// Shared by the renderer and production asset planning. Legacy card previews
// still need icons; evidence-only stories do not display their editorial tabs.
export const sceneHasEvidence = (scene) =>
  typeof scene?.overlayImg === "string" && scene.overlayImg.trim().length > 0;

export const storyShowsTabCards = (story) =>
  !Array.isArray(story?.scenes) || story.scenes.length === 0 ||
  story.scenes.some((scene) => !sceneHasEvidence(scene));
