---
name: vision-generate-video
description: "Orchestrate the ai-daily-report project from mixed user inputs into a rendered, evidence-backed report video. Use when the user invokes /vision-generate-video or $vision-generate-video, or asks a multimodal assistant to turn JSON objects, URLs, raw HTML, pasted text, or local files into AI Daily Report stories with rich tabs, source-evidence overlay images, TTS, directly authored SVG icons, validation, and MP4 rendering."
---

# Vision Generate Video

Thin wrapper over the real production layer. All sourcing, content-density, evidence, and
keyword rules live in `$ai-daily-report`; this skill only adds three things:

1. Route the mixed invocation inputs into the real layer's supplied-source workflow.
2. Author SVG tab icons directly with the model's file-editing tools instead of running
   `bun run generate-svg`.
3. Run the real layer's existing validation and MP4 rendering, then report.

Why this skill exists: the fully-automatic and native half-auto paths run under a
text-only model, where `bun run generate-svg` is slow and image understanding has to go
through MCP vision tooling, which is slower still. The calling model is multimodal — it reads
evidence images and writes SVGs directly, so this path exists to keep that speed advantage. Keep
the wrapper thin; never let content-production rules grow back into it, and never route
SVG generation or image understanding back through the text-model commands.

Do not reimplement or bypass project validation, and do not grow content-production rules
back into this skill.

First distinguish a production request from a request to diagnose or improve this workflow.
Pasted previous invocations and execution logs are diagnostic material, not new production
instructions; do not rerun their sourcing, TTS, or MP4 commands when reviewing performance.

## Hard rules

1. Activate `$ai-daily-report` first and follow its production and safety rules. Read its
   `rules/supplied-source-mode.md` in full — it owns input routing (RSS state first),
   source-quality and link-chasing decisions, screenshot/evidence rules, single-image
   inputs, story/tab scaling, and the keyword-replacement floor. Also read
   `rules/images.md` for overlay display rules and `rules/evidence-workflow.md` for the executable capture/preflight/export workflow. When anything here seems to conflict with
   those files, they win; only the direct-SVG exception below is unique to this skill.
   Read these references once per task; recover from the fact ledger and pending review items after context compaction.
2. Never run `bun run generate-svg`, invoke `$generate-svg`, or use a command that calls it
   indirectly. Forbidden aggregate commands include `bun run video`,
   `bun run video:auto-generate`, and `bun run video:half-auto` — besides SVG they would
   re-ingest and overwrite `data.json`.
3. Generate and edit every required SVG directly with the model's file-editing tools.
4. Follow the real layer's evidence floor: every narration scene carries a source-derived
   `overlayImg`. Exclude stories whose core facts cannot be evidenced, record the reason,
   and continue with supported stories. If none remain, stop without replacing the report.
5. Default "generate video" to producing `out/AiDailyReport.mp4`. Stop earlier only when
   the user explicitly asks for data preparation, icons, TTS, or preview without rendering.
6. Never publish or upload to any platform; publishing stays fully manual outside this skill.

## Production flow

1. Inspect the current `data-scheme/`. If it contains a different report, preserve it with
   `bun run archive` before replacing Raw; do not use `reset` as a shortcut.
2. Before browsing, materialize the invocation as the OS-temp `sources.json` contract from
   `rules/supplied-source-mode.md`. Count source units mechanically, create the complete
   source-to-Story/navigation plan, and run
   `bun run evidence:prepare-supplied --input <temp>/sources.json --output <temp>`.
   Do not continue until its plan validation passes. Reuse that same temp
   directory for the whole task so candidate downloads are cached. Use at most five body
   categories (Intro/outro excluded), grouping related stories consecutively; pixel width
   is an additional check, never permission to add more categories.
3. Treat the generated `manifest.json` as the source and candidate inventory. Batch-view only
   its distinct `reviewable: true` candidates; never send filtered, failed, or already-viewed
   duplicate files through vision. Execute the real layer's fact/evidence rules and its bounded
   external-link capture policy only for Stories still lacking acceptable evidence. Before
   writing Raw, complete the real layer's final-asset visual checks and collect all failures
   before batch repair. Use `evidence:capture` for planned webpage regions; its ledger
   persists attempts per factual region, cached captures and unchanged-pixel results. Emit the combined per-source
   content-and-evidence audit checkpoint, then copy
   only adopted final assets to `data-scheme/images/` and write the complete
   `data-scheme/data.json` in one edit when practical. Keep only sourced scenes; never fill a quota.
4. Run `bun run evidence:check-raw`; repair the collected issues in one batch using the real
   layer's validators rather than serial one-field patches or separate repeated checks.
5. Import the real layer's fact ledger with
   `bun run evidence:prepare-review -- --facts=<temp>/facts.json`, complete its single
   factual-difference review, and record the asset, narration and editorial judgements.
   Reuse unchanged judgements; inspect only new or disputed items. Require
   `bun run evidence:check-preflight` to pass; never fill approvals without actual review.
   State that TTS may use the configured paid
   API, then run `bun run tts` once. Do not use
   `bun run video:render`, because it repeats TTS.
6. Run `bun run check-icons -- --plan`. Directly author only the returned missing/invalid
   visible icon targets in one batch. Evidence-only body Stories do not show their Tabs;
   keep the editorial summaries, but do not generate hidden icons. Existing valid references
   can remain. Add only the planned icon fields to Generated and mirror visible story icon
   fields to Raw; never edit unrelated generated fields.
7. Run the keyword scan. Follow `rules/evidence-workflow.md` for conditional layout
   checks: a stable template does not require PNG previews for every new report. Preview
   only scenes with a concrete unresolved display question, collecting fixes before encoding.
   A midpoint frame shows one timed subtitle cue, not the full narration; do not shorten
   Raw or regenerate TTS merely because the rest of the sentence is absent from that frame.
   The export command below already runs Generated, evidence, icon, and preflight checks;
   do not run those checks separately immediately before it. If the user requested stopping
   before MP4, run the relevant checks separately for the requested deliverable.
8. Run `bun run render:mp4` once. Require a successful exit and a newly written, non-empty
   `out/AiDailyReport.mp4`, then deliver. Do not append a full preview, `evidence:frames`,
   or a final visual recheck by default. Use the real layer's optional post-render review
   only when the user requests it; investigate concrete encoding/playback failures in the
   affected portion. Rerender only for a confirmed defect or a requested change, batching
   repairs first. Never claim that automatic validation constitutes a visual MP4 review.
9. Report counts from the preflight and generated files, never from memory: source units,
   stories, tabs, evidence overlays, generated icons, and blocked sources. Include the phase
   timings for phases actually executed, the final MP4 path, and any explicit merge/split override.

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

Use this section for the planned visible icons; do not read another SVG skill or its reference tree
for routine direct authoring. Do not hand this step to another SVG skill or wrapper. `bun run check-icons` is the final authority on
the file and reference contract.

## Invocation examples

`/vision-generate-video {objectA} https://example.com/story <html>...</html>` creates three stories in
that order.

`/vision-generate-video 把网站 1 和网站 2 合成一个 story：https://a.example https://b.example`
creates one combined story because the user explicitly requested the merge.
