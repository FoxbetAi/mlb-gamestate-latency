# Design System

## Theme

Sunlit scorebook: a pure-white field surface, navy-black ink, deep cobalt structural accents, and a late-summer amber primary taken from the project palette seed. Restrained product color strategy; status and data colors have defined meaning.

## Color Palette

- Background: `oklch(1 0 0)`
- Surface: `oklch(0.965 0.006 57)`
- Ink: `oklch(0.20 0.025 255)`
- Muted ink: `oklch(0.43 0.025 255)`
- Primary amber: `oklch(0.68 0.17 57)`
- Primary dark: `oklch(0.49 0.14 57)`
- Cobalt accent: `oklch(0.42 0.18 258)`
- Success: `oklch(0.47 0.13 155)`
- Danger: `oklch(0.48 0.18 25)`
- Border: `oklch(0.87 0.012 255)`

## Typography

Use the native system sans stack for fast, reliable rendering. UI labels are 0.75–0.875rem, body text is 0.9375rem, section headings are 1.125rem, and the page title is 1.5rem. Tabular data uses `font-variant-numeric: tabular-nums`.

## Layout

The page is a single operational column capped at 1440px. The game strip remains prominent, the race board and pairwise evidence form the core, and raw transition history follows. On narrow screens, tables become source/pair rows rather than requiring horizontal scrolling.

## Components

- Top bar: product title, environment badge, connection state.
- Game picker: native select plus explicit game metadata.
- Source rail: one row per fixed topic with coverage, state, and relative latency.
- Pairwise table: sample count, median signed delta, consistency, verdict.
- Transition tape: chronological raw observations with source and state.
- Method panel: concise rules and identity warnings.

## Motion

Only state transitions use motion, at 160–200ms. New observations may briefly tint their row. All effects are disabled under `prefers-reduced-motion`.
