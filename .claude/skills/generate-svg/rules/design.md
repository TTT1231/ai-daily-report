# SVG Design Rules

## Required

- Use `viewBox="0 0 96 96"` and a transparent canvas.
- Draw only the icon. Do not add a full-canvas rectangle, background circle, badge, or container.
- Make the meaningful silhouette occupy most of the canvas, generally within `12-84`.
- Keep the icon clearly recognizable when displayed around 48-64px.
- Use color. Avoid grayscale-only or white-only icons.
- Choose the number of colors from the concept:
  - One strong color is valid for a simple outline or silhouette.
  - Add another color when it clarifies structure, state, motion, or hierarchy.
  - Add highlights only when they improve legibility.
- Follow [theme.md](theme.md) when choosing fills, strokes, and highlights.
- Prefer solid fills and confident strokes. Use strokes around 5px or heavier for primary line icons.
- Keep files self-contained and lightweight. Use inline SVG attributes.

## Quality Judgment

Prioritize, in order:

1. Semantic recognition
2. Clear silhouette
3. Legibility at rendered size
4. Harmony with sibling icons
5. Decorative detail

Do not force every icon into the same construction style. A code symbol may work best as one colored
stroke, while a rocket or warning symbol may benefit from multiple colors.

## Avoid

- Internal padding that makes the actual symbol look small
- Background artwork that duplicates the card background
- Tiny low-opacity details that disappear during video rendering
- Arbitrary color-count requirements
- `<text>`, external assets, `<style>`, scripts, or CSS animation
- Overly complex paths that do not improve recognition
