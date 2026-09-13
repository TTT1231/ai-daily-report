import {readFileSync, existsSync} from "node:fs";
import {resolve, sep} from "node:path";
import {sha256File, sha256Text} from "./evidence-review.mjs";

export const assetChecks = ["upright", "readable", "sourceIdentifiable", "unobstructed"];
const nonempty = (value) => typeof value === "string" && value.trim().length > 0;

// Content identity, not filenames or a whole-report hash, determines which
// judgements survive an edit. TTS timing and icon edits do not change facts.
export function buildEvidencePreflight(report, {dataDir, previous = null} = {}) {
  const errors = [];
  const assets = new Map();
  const scenes = [];
  const ids = new Set();
  const oldAssets = new Map((previous?.assets ?? []).map((asset) => [asset.sha256, asset]));
  const oldScenes = new Map((previous?.scenes ?? []).map((scene) => [scene.key, scene]));
  for (const story of report.stories ?? []) {
    for (const scene of story.scenes ?? []) {
      const label = `${story.id}/${scene.id}`;
      if (ids.has(label)) errors.push(`${label}: duplicate scene identity`);
      ids.add(label);
      const path = scene.overlayImg;
      if (!nonempty(path) || !path.startsWith("images/")) {
        errors.push(`${label}: missing evidence image`);
        continue;
      }
      const absolute = resolve(dataDir, path);
      if (!absolute.startsWith(resolve(dataDir) + sep) || !existsSync(absolute)) {
        errors.push(`${label}: image missing or outside data directory: ${path}`);
        continue;
      }
      const sha256 = sha256File(absolute);
      if (!assets.has(sha256)) {
        const old = oldAssets.get(sha256);
        assets.set(sha256, {
          sha256, paths: [], source: old?.source ?? "",
          checks: Object.fromEntries(assetChecks.map((key) => [key, old?.checks?.[key] ?? null])),
          notes: old?.notes ?? "",
        });
      }
      const asset = assets.get(sha256);
      if (!asset.paths.includes(path)) asset.paths.push(path);
      const identity = {storyId: story.id, sceneId: scene.id,
        title: story.contentTitle, subtitle: scene.subtitle, assetSha256: sha256};
      const key = sha256Text(JSON.stringify(identity));
      const old = oldScenes.get(key);
      scenes.push({...identity, key, supportsSubtitle: old?.supportsSubtitle ?? null,
        supportNotes: old?.supportNotes ?? ""});
    }
  }
  if (scenes.length === 0) errors.push("No evidence scenes to review.");
  return {errors, review: {schemaVersion: 1, assets: [...assets.values()], scenes}};
}

export function validateEvidencePreflight(report, {dataDir, review} = {}) {
  const {errors, review: current} = buildEvidencePreflight(report, {dataDir});
  if (review?.schemaVersion !== 1) errors.push("Evidence preflight is missing or unsupported; run evidence:prepare-review.");
  const indexed = (items, field, label) => {
    const map = new Map();
    for (const item of items ?? []) {
      if (map.has(item[field])) errors.push(`${label}: duplicate ${item[field]}`);
      map.set(item[field], item);
    }
    return map;
  };
  const assets = indexed(review?.assets, "sha256", "asset");
  const scenes = indexed(review?.scenes, "key", "scene");
  for (const asset of current.assets) {
    const checked = assets.get(asset.sha256);
    const label = asset.paths.join(", ");
    if (!nonempty(checked?.source)) errors.push(`${label}: source URL or original local source path required`);
    for (const key of assetChecks) {
      if (checked?.checks?.[key] !== true) errors.push(`${label}: ${key} failed/pending (or image changed)`);
    }
  }
  for (const scene of current.scenes) {
    const checked = scenes.get(scene.key);
    const label = `${scene.storyId}/${scene.sceneId}`;
    if (!checked || ["storyId", "sceneId", "title", "subtitle", "assetSha256"].some((key) => checked[key] !== scene[key])) {
      errors.push(`${label}: evidence-to-narration mapping is missing/stale; prepare and review again`);
    } else if (checked.supportsSubtitle !== true || !nonempty(checked.supportNotes)) {
      errors.push(`${label}: approve factual support with specific visible facts/locations in supportNotes`);
    }
  }
  return {errors, assets: current.assets.length, scenes: current.scenes.length};
}

export function readEvidencePreflight(path) {
  if (!existsSync(path)) return null;
  const review = JSON.parse(readFileSync(path, "utf8"));
  if (review?.schemaVersion !== 1 || !Array.isArray(review.assets) || !Array.isArray(review.scenes)) {
    throw new Error(`Invalid evidence preflight: ${path}`);
  }
  return review;
}
