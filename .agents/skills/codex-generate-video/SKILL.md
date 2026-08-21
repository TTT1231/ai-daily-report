---
name: codex-generate-video
description: "Orchestrate the ai-daily-report project from mixed user inputs into a rendered, evidence-backed report video. Use when the user invokes /codex-generate-video or $codex-generate-video, or asks Codex to turn JSON objects, URLs, raw HTML, pasted text, or local files into AI Daily Report stories with rich tabs, source-evidence overlay images, TTS, directly authored SVG icons, validation, and MP4 rendering."
---

# Codex Generate Video

Thin wrapper over the real production layer. All sourcing, content-density, evidence, and
keyword rules live in `$ai-daily-report`; this skill only adds three things:

1. Route the mixed invocation inputs into the real layer's supplied-source workflow.
2. Author SVG tab icons directly with Codex file-editing tools instead of running
   `bun run generate-svg`.
3. Run the real layer's existing validation and MP4 rendering, then report.

Why this skill exists: the fully-automatic and native half-auto paths run under a
text-only model, where `bun run generate-svg` is slow and image understanding has to go
through MCP vision tooling, which is slower still. Codex is multimodal — it reads evidence
images and writes SVGs directly, so this path exists to keep that speed advantage. Keep
the wrapper thin; never let content-production rules grow back into it, and never route
SVG generation or image understanding back through the text-model commands.

Do not reimplement or bypass project validation, and do not grow content-production rules
back into this skill.

## Hard rules

1. Activate `$ai-daily-report` first and follow its production and safety rules. Read its
   `rules/supplied-source-mode.md` in full — it owns input routing (RSS state first),
   source-quality and link-chasing decisions, screenshot/evidence rules, single-image
   inputs, story/tab scaling, and the keyword-replacement floor. Also read
   `rules/images.md` for overlay display rules. When anything here seems to conflict with
   those files, they win; only the direct-SVG exception below is unique to this skill.
2. Never run `bun run generate-svg`, invoke `$generate-svg`, or use a command that calls it
   indirectly. Forbidden aggregate commands include `bun run video`,
   `bun run video:auto-generate`, and `bun run video:half-auto` — besides SVG they would
   re-ingest and overwrite `data.json`.
3. Generate and edit every required SVG directly with Codex file-editing tools.
4. Follow the real layer's evidence floor: every story carries at least one source-derived
   `overlayImg`; a source that cannot be retrieved or faithfully represented is reported
   as blocked, never silently rendered evidence-free.
5. Default "generate video" to producing `out/AiDailyReport.mp4`. Stop earlier only when
   the user explicitly asks for data preparation, icons, TTS, or preview without rendering.
6. Never publish or upload to any platform; publishing stays fully manual outside this skill.

## Production flow

1. Inspect the current `data-scheme/`. If it contains a different report, preserve it with
   `bun run archive` before replacing Raw; do not use `reset` as a shortcut.
2. Execute `rules/supplied-source-mode.md` end to end for the invocation inputs: classify
   each source unit, resolve it against `ingest/rss-state.json` before browsing anything,
   gather and visually verify evidence images, then write the complete
   `data-scheme/data.json` plus assets in `data-scheme/images/`. Every story must follow
   the evidence→narration structure the validator enforces: a short image-backed evidence
   scene (only facts visible in the image, ~25-40 units of narration) followed by a short
   overlay-free narration scene (~20-35 units, one key takeaway; details live on Tabs).
   The last scene of a story never carries an overlay.
3. Run `bun run check-data-json` and `bun run check-evidence --require-overlay`. Fix the
   first error and repeat until both pass.
4. State that TTS may use the configured paid API, then run `bun run tts` once. Do not use
   `bun run video:render`, because it repeats TTS.
5. Read `data-scheme/data-generate.json` and collect all `intro.tabs` and `stories[].tabs`.
   Directly create or repair an SVG for every referenced icon (see below). Add only
   missing `icon` fields to Generated and mirror story icon fields to Raw; never edit
   unrelated generated fields.
6. Run the keyword scan from `rules/supplied-source-mode.md`,
   `bun run check-data-json:render`, and `bun run check-icons`. Fix every error before
   continuing.
7. Run `bun run render:mp4` and confirm that `out/AiDailyReport.mp4` exists and is
   non-empty.
8. Report the number of source units, stories, tabs, evidence overlays, generated icons,
   any blocked sources, and the final MP4 path. Mention any explicit merge/split override
   the user requested.

## Author SVGs directly

For each tab, design one distinct semantic icon that remains legible at small size:

- Write a self-contained SVG with `xmlns="http://www.w3.org/2000/svg"`,
  `viewBox="0 0 96 96"`, and a transparent canvas.
- Prefer bold geometric shapes, rounded strokes, and 2-4 harmonious colors. Make sibling icons
  visually consistent but conceptually distinct.
- Derive each glyph from that tab's title and summary (or the tab-specific semantic suffix). Never
  feed the full story-prefixed tab ID into a broad keyword matcher: shared story words can collapse
  every sibling into the same glyph.
- Treat recolored copies as duplicates. Before rendering, ensure no two tabs in one story have
  the same canonical SVG artwork; `bun run check-icons` must fail when sibling artwork repeats.
- Give sibling tabs clearly different dominant palettes so viewers can distinguish them by both
  silhouette and color at a glance. Keep stroke weight and overall rendering style consistent, but
  do not reuse one complete palette across a story.
- Avoid a full-size background rectangle, `<style>`, `<script>`, and preferably `<text>`.
- Keep the file below 2048 bytes when practical.
- Use exactly the path stored in the tab's `icon` field. For generated intro tabs, use
  `icons/{tabId}.svg`; for story tabs, retain the semantic Raw path.
- Preserve a valid existing icon only when its tab meaning and theme are unchanged. Remove obsolete
  references and repair missing or invalid files directly.

Do not hand this step to another SVG skill or wrapper. `bun run check-icons` is the final authority on
the file and reference contract.

## Invocation examples

`/codex-generate-video {objectA} https://example.com/story <html>...</html>` creates three stories in
that order.

`/codex-generate-video 把网站 1 和网站 2 合成一个 story：https://a.example https://b.example`
creates one combined story because the user explicitly requested the merge.
