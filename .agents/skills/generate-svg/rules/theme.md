# Theme Adaptation Rules

Each tab references one SVG file, and the SVG does not receive the React theme automatically.
Generate it for the current report theme while keeping it readable on the opposite theme.

## Process

1. Read `theme` from `data-scheme/data-generate.json`.
2. Treat a theme change as a reason to review or regenerate existing icons.
3. Optimize contrast for the current theme.
4. Avoid colors or details that disappear completely on the opposite theme.
5. Preview representative icons against the actual card backgrounds.

## Dark Theme

- Prefer bright or medium-light saturated colors.
- Cyan, mint, yellow, coral, pink, and lavender generally work well.
- Use white only as a small highlight, never as the only meaningful shape.
- Avoid dark navy, deep purple, and low-opacity primary strokes.

## Light Theme

- Prefer medium or dark saturated colors rather than pale tints.
- Dark blue, teal, amber, coral, magenta, and violet generally work well.
- Replace white highlights with a darker accent, colored outline, or negative space when needed.
- Avoid pale yellow, pale cyan, and low-opacity primary details.

## Cross-Theme Safety

- Important shapes should use opaque fills or strokes.
- Use opacity mainly for optional secondary details.
- Do not rely on shadows for recognition.
- If one color cannot work acceptably on both themes, prioritize the current theme and regenerate
  icons when the report theme changes.

