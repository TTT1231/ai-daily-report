# Data Workflow Rules

## Paths

- Generated report: `data-scheme/data-generate.json`
- Raw human-maintained report: `data-scheme/data.json`
- Icons: `data-scheme/icons/`
- Icon field: `icons/{storyId}-{tabId}.svg`
- Intro story ID: `intro`

## Editing

- Collect tabs from `intro.tabs` and `stories[].tabs`.
- Preserve valid existing icons unless meaning, report theme, or visual quality requires revision.
- Update only matching tab `icon` fields; do not modify unrelated generated data.
- Never modify `data-scheme/data.json` while generating icons.
- Preserve two-space JSON indentation.
- Remove only icon files that are no longer referenced.

## Validate

Run:

```bash
bun run val-schema
bun run lint
```

Icons must exist, use `.svg`, include `xmlns` and `viewBox="0 0 96 96"`, remain transparent without
a full-size background rectangle, and avoid `<style>`, `<script>`, and preferably `<text>`.

For visual or theme changes, preview a representative frame in Remotion Studio and inspect scale,
contrast, and sibling distinction.
