---
name: codex-generate-video
description: "Orchestrate the ai-daily-report project from mixed user inputs into a rendered, evidence-backed report video. Use when the user invokes /codex-generate-video or $codex-generate-video, or asks Codex to turn JSON objects, URLs, raw HTML, pasted text, or local files into AI Daily Report stories with rich tabs, source-evidence overlay images, TTS, directly authored SVG icons, validation, and MP4 rendering."
---

# Codex Generate Video

Use `$ai-daily-report` as the base project workflow, then apply the overrides in this skill. Keep this
skill as the orchestration layer; do not reimplement or bypass project validation.

## Hard rules

1. Activate `$ai-daily-report` first and follow its production and safety rules. Read its
   `rules/manual-mode.md` for supplied-source data and `rules/images.md` for evidence overlays; this
   orchestration requires both manual content and images rather than RSS ingest.
2. Treat this skill as authoritative when it conflicts with `$ai-daily-report` only for source-to-story
   mapping, tab density, evidence-overlay coverage, the exact Chinese keyword replacement rule, and
   SVG generation.
3. Never run `bun run generate-svg`, invoke `$generate-svg`, or use a command that calls it
   indirectly. Forbidden aggregate commands include `bun run video`, `bun run video:auto-generate`,
   `bun run video:half-auto`, and `bun run all:bili`.
4. Generate and edit every required SVG directly with Codex file-editing tools.
5. Give every story at least one source-derived `overlayImg`; never substitute a decorative or
   AI-generated illustration for evidence.
6. Default "generate video" to producing `out/AiDailyReport.mp4`. Stop earlier only when the user
   explicitly asks for data preparation, icons, TTS, or preview without rendering.
7. Never publish or upload. Run Bilibili publishing commands only after a separate explicit request.
8. Write all audience-facing titles, tabs, and narration in a direct short-video news voice. Never
   mention the ingestion platform, the user-supplied input, or the generation process in report
   content. Do not emit phrases such as “贴文称”, “用户提供”, “据标题”, “来源提示”, or “以官方为准”.

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
user-supplied source unit into supporting material for a different story. When a claim needs
attribution, name the primary actor, document, researcher, or reporting outlet in one concise clause;
never attribute the news to the ingestion platform. Express material uncertainty as a useful fact,
such as “官方尚未公布发布日期”, rather than instructing viewers to verify it themselves.

## Build rich report content

Write `data-scheme/data.json` according to the current schema and `$ai-daily-report` manual-mode
rules. Keep navigation labels compact while making the story body detailed.

- Treat `introTitle` as an edited headline for the opening overview, not a verbatim source title.
  Rewrite every source title for a general short-video audience: remove forum prefixes, brackets,
  clickbait questions, emotional wording, redundant punctuation, source names, and inconsistent
  product casing. Keep the core actor, event, number, and date when they matter.
- Use `contentTitle` as the compact headline for the individual story screen. It may be shorter than
  `introTitle`, but both must read as finished editorial headlines rather than copied post titles.
- Aim for 4-6 meaningful tabs per story whenever the source supports them. Do not settle for a terse
  2-3 tab summary merely for speed.
- Prefer concrete tab dimensions such as the core event, figures and dates, mechanism or product
  details, user or market impact, and what happens next.
- Use 2-3 tabs only when the source truly lacks enough distinct facts. Never invent content to reach a
  target count.
- Make tab titles specific and complementary. Avoid filler headings such as "重点" or "更多".
- Never spend a tab on source disclaimers, verification instructions, or explaining what the input
  did not contain. Provenance belongs in `overlayImg`; a genuine unknown belongs in a factual tab only
  when that unknown materially changes the news.
- Keep every summary within the schema limits, include exactly one bold span, and wrap English model,
  product, API, error-code, and version names in inline code.
- Prefer two non-redundant scenes for a dense story and one scene for a short story. Keep each subtitle
  a natural spoken sentence within the schema limit.
- Pair scenes with the source-evidence overlays described below; use the scene narration to explain
  the fact visible in its image rather than showing an unrelated visual.

Give every story tab a stable semantic icon path in Raw, for example
`icons/{storyId}-{semantic-name}.svg`, so subsequent TTS rebuilds retain the reference.

## Use overlayImg as source evidence

Treat `overlayImg` as the visual proof layer, not optional decoration. Actively inspect each source
unit and attach at least one readable evidence image to every story.

- Prefer, in order: an original announcement or document excerpt, product/UI screenshot, source data
  chart or benchmark, source-page excerpt containing the central claim/date/number, then an original
  event photo that directly proves the subject.
- For URLs and HTML, download a relevant original image or capture the exact useful page region. For
  local files and objects, use their embedded visual; when the source is text-only, render a clearly
  labeled source-extract card from its actual fields or excerpt. Do not invent facts or present a
  generated illustration as evidence.
- Save evidence under `data-scheme/images/` with semantic names such as
  `images/{storyId}-evidence-1.png`. Put `overlayImg` on the matching scene, never on a story or tab.
- Use two scenes with two complementary evidence images when the source contains distinct proofs,
  such as an announcement plus a product screen or a claim plus its data chart.
- Inspect every asset before use. Crop long pages or chat/article screenshots to the claim and enough
  surrounding source context to remain trustworthy and readable at 1920x1080. Never use a full long
  screenshot that will collapse into a thin strip; `overlayImgScale` is not a substitute for cropping.
- Exclude avatars, logos by themselves, ads, unrelated stock art, thumbnails with unreadable text,
  and decorative images that do not support the corresponding scene.
- Do not write `overlayImgWidth` or `overlayImgHeight` in Raw; TTS derives true dimensions. Use
  `overlayImgScale` only after inspecting the rendered size.
- If a source image visibly contains the forbidden exact keyword, do not doctor the screenshot.
  Select another evidence region or make a clearly labeled, faithful paraphrased source-extract card
  that follows the wording rule below.

Before TTS, verify that every story has at least one evidence overlay:

```powershell
node -e "const d=require('./data-scheme/data.json');const m=d.stories.filter(s=>!s.scenes?.some(x=>x.overlayImg));if(m.length){console.error('Missing evidence overlay:',m.map(s=>s.id).join(', '));process.exit(1)}"
```

Treat a missing overlay as an incomplete story. If the source cannot be retrieved or represented
faithfully, stop and report that source as blocked instead of silently rendering an evidence-free
story.

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
2. Read every source unit, decide the story mapping, inspect or capture its evidence, and write the
   complete `data-scheme/data.json` plus source-derived assets in `data-scheme/images/`.
3. Run the overlay-coverage check and `bun run check-data-json`. Fix the first error and repeat until
   Raw and every evidence path pass.
4. State that TTS may use the configured paid API, then run `bun run tts` once. Do not use
   `bun run video:render`, because it repeats TTS.
5. Read `data-scheme/data-generate.json` and collect all `intro.tabs` and `stories[].tabs`. Directly
   create or repair an SVG for every referenced icon. Add only missing `icon` fields to Generated and
   mirror story icon fields to Raw; never edit unrelated generated fields.
6. Run the keyword scan, `bun run check-data-json:render`, and `bun run check-icons`. Fix every error
   before continuing.
7. Run `bun run render:mp4` and confirm that `out/AiDailyReport.mp4` exists and is non-empty.
8. Report the number of source units, stories, tabs, evidence overlays, generated icons, and the final
   MP4 path. Mention any explicit merge/split override or intentionally sparse story.

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
