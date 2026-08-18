---
name: codex-generate-video
description: "Orchestrate the ai-daily-report project from mixed user inputs into a rendered report video. Use when the user invokes /codex-generate-video or $codex-generate-video, or asks Codex to turn JSON objects, URLs, raw HTML, pasted text, or local files into AI Daily Report stories with rich tabs, TTS, directly authored SVG icons, validation, and MP4 rendering."
---

# Codex Generate Video

Use `$ai-daily-report` as the base project workflow, then apply the overrides in this skill. Keep this
skill as the orchestration layer; do not reimplement or bypass project validation.

## Hard rules

1. Activate `$ai-daily-report` first and follow its production and safety rules. Read its
   `rules/manual-mode.md` because supplied objects, URLs, HTML, text, and files use the manual data
   path rather than RSS ingest.
2. Treat this skill as authoritative when it conflicts with `$ai-daily-report` only for source-to-story
   mapping, tab density, the exact Chinese keyword replacement rule, and SVG generation.
3. Never run `bun run generate-svg`, invoke `$generate-svg`, or use a command that calls it
   indirectly. Forbidden aggregate commands include `bun run video`, `bun run video:auto-generate`,
   `bun run video:half-auto`, and `bun run all:bili`.
4. Generate and edit every required SVG directly with Codex file-editing tools.
5. Default "generate video" to producing `out/AiDailyReport.mp4`. Stop earlier only when the user
   explicitly asks for data preparation, icons, TTS, or preview without rendering.
6. Never publish or upload. Run Bilibili publishing commands only after a separate explicit request.

## Map inputs to stories

Parse everything after the invocation as ordered source units:

- Treat each top-level JSON object as one source unit. Treat every object in a top-level array as its
  own source unit unless the user describes the array as one object.
- Treat each standalone URL as one source unit. Fetch and read the actual page; do not rely only on a
  search snippet. Use an authenticated browser session when the page requires it and one is available.
- Treat each complete HTML document or clearly separated HTML block as one source unit. Extract its
  visible text, headings, metadata, links, and useful image candidates.
- Treat each local file, attachment, or clearly separated pasted-text block as one source unit.
- Keep a source unit atomic even when it contains several subtopics. Explain those subtopics through
  tabs or scenes inside the same story.
- Create exactly one story per source unit and preserve input order. Do not automatically cluster,
  deduplicate, or merge similar units.
- Merge or split units only when the user explicitly requests it. For example, "网站 1 和网站 2
  合成一个 story" overrides the default and produces one combined story.

Use linked primary material to verify or enrich the same source unit, but do not silently turn another
user-supplied source unit into supporting material for a different story. Preserve uncertainty and
attribute claims when the supplied material is unconfirmed.

## Build rich report content

Write `data-scheme/data.json` according to the current schema and `$ai-daily-report` manual-mode
rules. Keep navigation labels compact while making the story body detailed.

- Aim for 4-6 meaningful tabs per story whenever the source supports them. Do not settle for a terse
  2-3 tab summary merely for speed.
- Prefer concrete tab dimensions such as the core event, figures and dates, mechanism or product
  details, evidence or source boundary, user or market impact, and what happens next.
- Use 2-3 tabs only when the source truly lacks enough distinct facts. Never invent content to reach a
  target count.
- Make tab titles specific and complementary. Avoid filler headings such as "重点" or "更多".
- Keep every summary within the schema limits, include exactly one bold span, and wrap English model,
  product, API, error-code, and version names in inline code.
- Prefer two non-redundant scenes for a dense story and one scene for a short story. Keep each subtitle
  a natural spoken sentence within the schema limit.
- Save useful source visuals locally under `data-scheme/images/` and reference them with `overlayImg`
  when they improve understanding. Omit weak or irrelevant decoration.

Give every story tab a stable semantic icon path in Raw, for example
`icons/{storyId}-{semantic-name}.svg`, so subsequent TTS rebuilds retain the reference.

## Replace the exact keyword

Never emit the exact substring `中国` in generated report content. Rewrite it before writing Raw:

- Use `国内` for markets, companies, users, teams, regions, industries, and other domestic contexts.
- Use `我国` when the country is the grammatical subject or the sentence refers to national ownership
  or participation.
- Use `国家` for policies, standards, strategies, institutions, and other country-level concepts.
- Paraphrase official names or quoted text when a direct substitution would be ungrammatical; do not
  preserve the forbidden substring merely because it appeared in the source.

Apply this rule to titles, tabs, subtitles, metadata, comments, and SVG-accessible text. Do not mutate
the external source itself. Before rendering, run:

```powershell
rg -n --glob '*.json' --glob '*.txt' --glob '*.svg' '中国' data-scheme
```

Treat any match in generated human-facing content as a blocking validation failure and rewrite it.

## Execute the production flow

1. Inspect the current `data-scheme/`. If it contains a different report, preserve it with
   `bun run archive` before replacing Raw; do not use `reset` as a shortcut.
2. Read every source unit, decide the story mapping, and write the complete `data-scheme/data.json`
   plus any local image assets.
3. Run `bun run check-data-json`. Fix the first error and repeat until Raw passes.
4. State that TTS may use the configured paid API, then run `bun run tts` once. Do not use
   `bun run video:render`, because it repeats TTS.
5. Read `data-scheme/data-generate.json` and collect all `intro.tabs` and `stories[].tabs`. Directly
   create or repair an SVG for every referenced icon. Add only missing `icon` fields to Generated and
   mirror story icon fields to Raw; never edit unrelated generated fields.
6. Run the keyword scan, `bun run check-data-json:render`, and `bun run check-icons`. Fix every error
   before continuing.
7. Run `bun run render:mp4` and confirm that `out/AiDailyReport.mp4` exists and is non-empty.
8. Report the number of source units, stories, tabs, generated icons, and the final MP4 path. Mention
   any explicit merge/split override or intentionally sparse story.

## Author SVGs directly

For each tab, design one distinct semantic icon that remains legible at small size:

- Write a self-contained SVG with `xmlns="http://www.w3.org/2000/svg"`,
  `viewBox="0 0 96 96"`, and a transparent canvas.
- Prefer bold geometric shapes, rounded strokes, and 2-4 harmonious colors. Make sibling icons
  visually consistent but conceptually distinct.
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
