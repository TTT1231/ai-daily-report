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

## Execute

1. Inspect `data-scheme/data-generate.json`, including its `theme`, the relevant sibling tabs, and
   existing SVG files.
2. Decide which icons genuinely need generation or revision.
3. Generate transparent SVGs at `data-scheme/icons/{storyId}-{tabId}.svg`.
4. Update only the corresponding `icon` fields in `data-generate.json`.
5. Remove orphan icons only when they are no longer referenced.
6. Run `bun run val-schema` and `bun run lint` and `bun run comment`.
7. For visual changes, open a representative Remotion frame and verify icon scale, contrast, and
   distinction from sibling icons.

Preserve unrelated user changes. Do not stop at a proposal when the icons can be generated and
verified in the workspace.
