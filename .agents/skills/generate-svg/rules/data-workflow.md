# Data Workflow Rules

## Paths

- Source package: `data-scheme/data-generate.json`
- Optional raw package for manual stories: `data-scheme/data.json`
- Icons: `data-scheme/icons/`
- Icon field format: `icons/{storyId}-{tabId}.svg`
- Intro uses `intro` as the story ID.

## Updating Data

- Collect tabs from `intro.tabs` and `stories[].tabs`.
- Preserve valid existing icons during incremental generation.
- When only some tabs are missing icons, generate or repair only the missing/invalid icons. Do not
  overwrite valid sibling icons for the same story or intro group.
- Regenerate an icon when its title, meaning, or report theme changed, the file is missing, or quality
  is inadequate.
- Update only tab `icon` fields. Do not change unrelated generated data.
- Default to editing `data-generate.json` only. When a story was manually added or replaced in `data.json`, copy the same `icon` fields into that raw story so future `bun run tts` runs preserve the icons.
- Preserve two-space JSON indentation.
- Remove icon files that are no longer referenced.

## Validation

Run:

```bash
bun run check-icons
```

The icon must:

- Exist at the referenced path
- Use `.svg`
- Include `xmlns` and `viewBox="0 0 96 96"`
- Use a transparent canvas without a full-size background rectangle
- Avoid `<style>`, `<script>`, and preferably `<text>`
- Remain under the validator's recommended file-size limit

When changing icon design, sizing, or the report theme, preview at least one representative frame in
Remotion Studio.
