---
name: generate-svg
description: Generate or improve colorful semantic SVG icons for tabs in data-scheme/data-generate.json. Use after TTS creates or changes tabs, when icon files are missing, or when existing icons need visual improvement.
---

# Generate SVG Icons

Generate transparent, colorful, semantic SVG icons for report tabs. Let the icon concept determine
its shapes and number of colors; do not add decorative detail merely to satisfy a fixed formula.

## Required Rules

Read all four rule files before generating or revising icons:

- [rules/design.md](rules/design.md): visual quality and SVG construction
- [rules/semantics.md](rules/semantics.md): choosing an icon concept from tab meaning
- [rules/theme.md](rules/theme.md): adapting colors for dark and light report themes
- [rules/data-workflow.md](rules/data-workflow.md): project paths, updates, and validation

## Workflow

1. Read `data-scheme/data-generate.json`, including its `theme`, and collect tabs from `intro.tabs`
   and `stories[].tabs`.
2. Inspect the whole tab group before choosing concepts so sibling icons are distinct.
3. Preserve an existing valid icon unless it is missing, stale, semantically wrong, or visually weak.
4. Generate or revise `data-scheme/icons/{storyId}-{tabId}.svg`.
5. Update only the matching `icon` fields in `data-generate.json`.
6. Remove orphan SVG files no longer referenced by any tab.
7. Run `bun run check-icons` and `bun run lint` and `bun run comment`.
8. Preview representative icons in the composition when visual quality is part of the request.
