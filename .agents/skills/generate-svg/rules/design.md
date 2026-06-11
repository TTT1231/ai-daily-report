# SVG Design Rules

## Required

- Use `viewBox="0 0 96 96"` and a transparent canvas.
- Draw only the icon. Do not add a full-canvas rectangle, background circle, badge, or container.
- Make the meaningful silhouette occupy most of the canvas, generally within `12-84`.
- Keep the icon clearly recognizable when displayed around 48-64px.
- Use color. Avoid grayscale-only or white-only icons.
- Let the concept determine color count:
  - One strong color is valid for a simple outline or silhouette.
  - Add colors only when they clarify structure, state, motion, or hierarchy.
  - Add highlights only when they improve legibility.
- Follow [theme.md](theme.md) when choosing fills, strokes, and highlights.
- Prefer solid fills and confident strokes. Use strokes around 5px or heavier for primary line icons.
- Keep files self-contained and lightweight with inline SVG attributes.

## Quality Order

Prioritize semantic recognition, silhouette, rendered-size legibility, harmony with siblings, then
decorative detail.

Do not force every icon into the same construction style. Avoid internal padding, background
artwork, tiny low-opacity details, arbitrary color counts, `<text>`, external assets, `<style>`,
scripts, CSS animation, and unnecessary path complexity.
