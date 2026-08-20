---
name: generate-svg
description: Generate, revise, and validate colorful semantic SVG icons for tabs in data-scheme/data-generate.json. Use when report tabs lack icons, tab meaning changes, generated icons look weak, or the icon generation workflow needs to run after TTS.
---

# Generate SVG Icons

Create transparent, colorful SVG icons whose silhouettes clearly communicate each tab's meaning.
Exercise design judgment: the concept determines the number of shapes and colors.

## Read First

Read all rules before editing:

- [rules/design.md](rules/design.md)
- [rules/semantics.md](rules/semantics.md)
- [rules/theme.md](rules/theme.md)
- [rules/data-workflow.md](rules/data-workflow.md)

## Structured Payload Mode

`bun run generate-svg` loads this skill through `scripts/render/generate-svg.mjs`. In that wrapper
mode, the prompt includes target icon context and asks for a structured payload.

When the prompt says `Structured payload mode`:

1. Do not call tools, read or write files, run shell commands, start previews, or edit JSON.
2. Use only the provided target context, sibling tabs, theme, and preflight issues.
3. Generate every requested SVG in one response.
4. Return only the structured JSON object requested by the wrapper, with one entry per exact target path. When the wrapper supplies a CLI JSON schema, do not add marker text or Markdown fences; the CLI handles JSON escaping.
5. Let the Node wrapper write SVG files, update `icon` fields, mirror `data.json`, prune orphan icons,
   and run `bun run check-icons` and `bun run lint`.

## Manual Execute

Use these steps only when an agent is applying the skill directly in the workspace, not when the
wrapper asks for structured payload output.

1. Read `data-scheme/data-generate.json`, including its `theme` and the relevant sibling tabs.
2. Ensure the icon output directory exists before inspecting or writing icons:
   `mkdir -p data-scheme/icons`.
3. Inspect existing SVG files, treating an empty newly created directory as a first-time generation.
4. Decide which icons genuinely need generation or revision. Treat an existing icon as valid only
   when `bun run check-icons` accepts both the file and its same-story uniqueness. Lock valid icons
   during incremental generation; shared paths, repeated canonical artwork, and repeated sibling
   palettes are repair targets rather than locked assets.
5. Generate transparent SVGs at `data-scheme/icons/{storyId}-{tabId}.svg`.
6. Update only the corresponding `icon` fields in `data-generate.json`. If the user is manually maintaining or replacing a story in `data-scheme/data.json`, mirror those same `icon` fields there too so the next `bun run tts` keeps them.
7. Remove orphan icons only when they are no longer referenced.
8. Run `bun run check-icons` and `bun run lint`.
9. For visual changes, open a representative Remotion frame and verify icon scale, contrast, and
   distinction from sibling icons.

Preserve unrelated user changes. In manual mode, do not stop at a proposal when the icons can be
generated and verified in the workspace.
