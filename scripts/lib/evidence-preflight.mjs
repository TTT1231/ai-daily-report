import {readFileSync, existsSync} from "node:fs";
import {resolve, sep} from "node:path";
import {sha256File, sha256Text} from "./evidence-review.mjs";

export const assetChecks = ["upright", "readable", "sourceIdentifiable", "unobstructed"];
const nonempty = (value) => typeof value === "string" && value.trim().length > 0;
const sceneIdentity = (item) => `${item.storyId}/${item.sceneId}`;
const factContent = (fact) => ({id: fact.id, storyId: fact.storyId, source: fact.source,
  excerpt: fact.excerpt, statement: fact.statement, qualifiers: fact.qualifiers});

function sourceFacts(report, ledger, previous, errors) {
  const storyIds = new Set((report.stories ?? []).map((story) => story.id));
  const supplied = ledger === undefined ? previous?.facts ?? [] : ledger?.facts;
  if (!Array.isArray(supplied)) {
    errors.push("facts: must be an array of sourced statements");
    return [];
  }
  const facts = [];
  const ids = new Set();
  for (const fact of supplied) {
    // Removed stories do not leave stale facts in an incremental review.
    if (ledger === undefined && !storyIds.has(fact?.storyId)) continue;
    if (!fact || ["id", "storyId", "source", "excerpt", "statement"].some((field) => !nonempty(fact[field])) ||
        !Array.isArray(fact.qualifiers) || fact.qualifiers.some((text) => !nonempty(text))) {
      errors.push(`facts/${fact?.id ?? "?"}: id, storyId, source, excerpt, statement and an explicit qualifiers array required`);
      continue;
    }
    if (ids.has(fact.id)) errors.push(`facts: duplicate id ${fact.id}`);
    if (!storyIds.has(fact.storyId)) errors.push(`facts/${fact.id}: unknown story ${fact.storyId}`);
    ids.add(fact.id);
    facts.push(factContent(fact));
  }
  return facts;
}

// Content identity, not filenames or a whole-report hash, determines which
// judgements survive an edit. TTS timing and icon edits do not change facts.
export function buildEvidencePreflight(report, {dataDir, previous = null, factLedger, schemaVersion = 2} = {}) {
  const errors = [];
  const assets = new Map();
  const scenes = [];
  const editorial = [];
  const ids = new Set();
  const oldAssets = new Map((previous?.assets ?? []).map((asset) => [asset.sha256, asset]));
  const oldScenes = new Map((previous?.scenes ?? []).map((scene) => [scene.key, scene]));
  const oldEditorial = new Map((previous?.editorial ?? []).map((item) => [item.key, item]));
  const facts = schemaVersion === 2 ? sourceFacts(report, factLedger, previous, errors) : [];
  const factById = new Map(facts.map((fact) => [fact.id, fact]));
  const mappings = factLedger === undefined ? previous?.scenes ?? [] : factLedger?.scenes;
  if (!Array.isArray(mappings)) errors.push("facts.scenes: narration mappings must be an array");
  const refs = new Map();
  for (const mapping of Array.isArray(mappings) ? mappings : []) {
    if (!mapping || !nonempty(mapping.storyId) || !nonempty(mapping.sceneId)) {
      errors.push("facts.scenes: storyId and sceneId required");
      continue;
    }
    const label = sceneIdentity(mapping);
    if (refs.has(label)) errors.push(`${label}: duplicate fact mapping`);
    refs.set(label, mapping.factIds ?? []);
  }
  const factKeys = (factIds) => factIds.map((id) => sha256Text(JSON.stringify(factById.get(id) ?? {missingFact: id})));
  for (const story of report.stories ?? []) {
    if (schemaVersion === 2) {
      const factIds = facts.filter((fact) => fact.storyId === story.id).map((fact) => fact.id);
      const content = {title: story.contentTitle, introTitle: story.introTitle ?? null,
        tabs: (story.tabs ?? []).map((tab) => ({id: tab.id, title: tab.title, summary: tab.summary}))};
      const key = sha256Text(JSON.stringify({storyId: story.id, content, factKeys: factKeys(factIds)}));
      const old = oldEditorial.get(key);
      editorial.push({storyId: story.id, content, factIds, key,
        supportsEditorial: old?.supportsEditorial ?? null,
        qualifiersPreserved: old?.qualifiersPreserved ?? null, supportNotes: old?.supportNotes ?? ""});
    }
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
      if (schemaVersion === 2) {
        const factIds = refs.get(label) ?? [];
        if (!Array.isArray(factIds) || factIds.some((id) => !nonempty(id))) {
          errors.push(`${label}: factIds must be an array of fact identifiers`);
          continue;
        }
        if (new Set(factIds).size !== factIds.length) errors.push(`${label}: duplicate fact reference`);
        for (const id of factIds) {
          if (!factById.has(id)) errors.push(`${label}: unknown fact ${id}`);
          else if (factById.get(id).storyId !== story.id) errors.push(`${label}: fact ${id} belongs to another story`);
        }
        identity.factIds = factIds;
        identity.factKeys = factKeys(factIds);
      }
      // v1's key remains stable for already-delivered reports. In v2, editorial
      // wording has its own review, so a title edit must not reset narration.
      const keyContent = schemaVersion === 1 ? identity : {
        storyId: identity.storyId, sceneId: identity.sceneId, subtitle: identity.subtitle,
        assetSha256: identity.assetSha256, factIds: identity.factIds, factKeys: identity.factKeys,
      };
      const key = sha256Text(JSON.stringify(keyContent));
      const old = oldScenes.get(key);
      scenes.push({...identity, key, supportsSubtitle: old?.supportsSubtitle ?? null,
        ...(schemaVersion === 2 ? {qualifiersPreserved: old?.qualifiersPreserved ?? null} : {}),
        supportNotes: old?.supportNotes ?? ""});
    }
  }
  if (factLedger !== undefined) {
    for (const label of refs.keys()) if (!ids.has(label)) errors.push(`${label}: fact mapping has no current scene`);
  }
  if (scenes.length === 0) errors.push("No evidence scenes to review.");
  return {errors, review: {schemaVersion, assets: [...assets.values()], scenes,
    ...(schemaVersion === 2 ? {facts, editorial} : {})}};
}

export function validateEvidencePreflight(report, {dataDir, review} = {}) {
  const schemaVersion = review?.schemaVersion === 1 ? 1 : 2;
  const {errors, review: current} = buildEvidencePreflight(report, {dataDir, previous: review, schemaVersion});
  if (![1, 2].includes(review?.schemaVersion)) errors.push("Evidence preflight is missing or unsupported; run evidence:prepare-review.");
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
    const identityFields = ["storyId", "sceneId", "subtitle", "assetSha256", ...(schemaVersion === 1 ? ["title"] : [])];
    if (!checked || identityFields.some((key) => checked[key] !== scene[key])) {
      errors.push(`${label}: evidence-to-narration mapping is missing/stale; prepare and review again`);
    } else if (checked.supportsSubtitle !== true || !nonempty(checked.supportNotes)) {
      errors.push(`${label}: approve factual support with specific visible facts/locations in supportNotes`);
    }
    if (schemaVersion === 2) {
      if (!scene.factIds.length) errors.push(`${label}: source fact references required before approving narration`);
      if (checked?.qualifiersPreserved !== true) errors.push(`${label}: review whether narration preserves the source fact's identity, scope and conditions`);
    }
  }
  if (schemaVersion === 2) {
    const editorial = indexed(review?.editorial, "key", "editorial");
    for (const item of current.editorial) {
      const checked = editorial.get(item.key);
      if (!item.factIds.length) errors.push(`${item.storyId}: sourced facts required for editorial review`);
      if (!checked || checked.storyId !== item.storyId || JSON.stringify(checked.content) !== JSON.stringify(item.content)) {
        errors.push(`${item.storyId}: title/introTitle/Tabs factual review is missing/stale`);
      } else if (checked.supportsEditorial !== true || checked.qualifiersPreserved !== true || !nonempty(checked.supportNotes)) {
        errors.push(`${item.storyId}: review title/introTitle/Tabs against source facts and their qualifiers`);
      }
    }
  }
  return {errors, assets: current.assets.length, scenes: current.scenes.length, editorial: current.editorial?.length ?? 0};
}

export function readEvidencePreflight(path) {
  if (!existsSync(path)) return null;
  const review = JSON.parse(readFileSync(path, "utf8"));
  if (![1, 2].includes(review?.schemaVersion) || !Array.isArray(review.assets) || !Array.isArray(review.scenes) ||
      (review.schemaVersion === 2 && (!Array.isArray(review.facts) || !Array.isArray(review.editorial)))) {
    throw new Error(`Invalid evidence preflight: ${path}`);
  }
  return review;
}
