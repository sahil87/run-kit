# Spec: Icon Generation Pipeline

**Change**: 260324-v9i1-icon-generation-pipeline
**Created**: 2026-03-24
**Affected memory**: `docs/memory/run-kit/architecture.md`, `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- Theme-aware favicon (light/dark variants) — user confirmed grayscale is fine
- macOS `.icns` generation — not needed for PWA
- Modifying the SVG mark itself (colors, geometry, viewBox)

## Static Assets: Canonical Icon

### Requirement: Single Source SVG

The project SHALL have a single canonical icon SVG at `app/frontend/public/icon.svg`. This file SHALL be the renamed `logo.svg` with no content changes. All generated icon variants SHALL derive from this file.

#### Scenario: SVG rename
- **GIVEN** `app/frontend/public/logo.svg` exists
- **WHEN** the rename is applied
- **THEN** `app/frontend/public/icon.svg` exists with identical content
- **AND** `app/frontend/public/logo.svg` no longer exists

### Requirement: In-App Logo Reference

The top bar component (`app/frontend/src/components/top-bar.tsx`) SHALL reference `/icon.svg` for the in-app logo display.

#### Scenario: Top bar renders logo
- **GIVEN** the app is loaded
- **WHEN** the top bar renders on desktop (>= 640px)
- **THEN** an `<img>` element with `src="/icon.svg"` is displayed at 20×20px
- **AND** on mobile (< 640px), a 30×30px variant is displayed

## Static Assets: Generated Icons

### Requirement: Generation Script

A script at `scripts/generate-icons.sh` SHALL generate all icon variants from `app/frontend/public/icon.svg` into `app/frontend/public/generated-icons/`.

The script SHALL use `sharp` (Node.js) to:
1. Copy `icon.svg` to `generated-icons/favicon.svg` (file copy, not symlink)
2. Generate PNG variants by compositing the SVG centered onto a solid `#0f1117` canvas

#### Scenario: Script generates all variants
- **GIVEN** `app/frontend/public/icon.svg` exists
- **WHEN** `scripts/generate-icons.sh` is executed
- **THEN** `app/frontend/public/generated-icons/` contains exactly 4 files:
  - `favicon.svg` — byte-identical copy of `icon.svg`
  - `icon-192.png` — 192×192, `#0f1117` background, hex mark sized to ~80% of canvas (~154px) centered
  - `icon-512.png` — 512×512, `#0f1117` background, hex mark sized to ~80% of canvas (~410px) centered
  - `icon-512-maskable.png` — 512×512, `#0f1117` background, hex mark sized to ~60% of canvas (~307px) centered

#### Scenario: Script is idempotent
- **GIVEN** `generated-icons/` already contains previously generated files
- **WHEN** `scripts/generate-icons.sh` is executed again
- **THEN** all files are overwritten with identical output
- **AND** no extra files accumulate

### Requirement: PNG Background and Padding

Generated PNGs SHALL have a solid `#0f1117` background (matching `manifest.json` `background_color` and dark theme `theme-color`). Standard icons (192, 512) SHALL have ~20% padding. The maskable icon SHALL have ~40% padding (per the maskable icon safe zone specification).

#### Scenario: No transparent fringe on macOS dock
- **GIVEN** the generated `icon-512.png` is installed as a PWA dock icon
- **WHEN** macOS renders the icon in the dock
- **THEN** no white/light fringe is visible around the hexagon edges
- **AND** the icon background matches the app's dark theme

### Requirement: Old Icons Cleanup

The directory `app/frontend/public/icons/` SHALL be deleted. The script `scripts/regenerate-png-logos.sh` SHALL be deleted.

#### Scenario: Old assets removed
- **GIVEN** the old `icons/` directory and `regenerate-png-logos.sh` exist
- **WHEN** the cleanup is applied
- **THEN** `app/frontend/public/icons/` no longer exists
- **AND** `scripts/regenerate-png-logos.sh` no longer exists

## Static Assets: HTML and Manifest References

### Requirement: Index HTML References

`app/frontend/index.html` SHALL reference:
- `href="/generated-icons/favicon.svg"` for the favicon `<link rel="icon">`
- `href="/generated-icons/icon-192.png"` for the apple-touch-icon `<link rel="apple-touch-icon">`

#### Scenario: Favicon loads from generated-icons
- **GIVEN** the app is loaded in a browser
- **WHEN** the browser requests the favicon
- **THEN** it fetches `/generated-icons/favicon.svg`

### Requirement: Manifest References

`app/frontend/public/manifest.json` SHALL reference icons at `/generated-icons/icon-192.png`, `/generated-icons/icon-512.png`, and `/generated-icons/icon-512-maskable.png`.

#### Scenario: PWA install uses generated icons
- **GIVEN** a user installs the PWA
- **WHEN** the browser reads `manifest.json`
- **THEN** icon URLs resolve to `generated-icons/*` paths

## Build Pipeline: Justfile Recipe

### Requirement: Icons Recipe

The justfile SHALL include an `icons` recipe under an `# ─── Assets ───` section that executes `scripts/generate-icons.sh`.

#### Scenario: Running just icons
- **GIVEN** Node.js and sharp are available
- **WHEN** `just icons` is executed
- **THEN** `scripts/generate-icons.sh` runs successfully
- **AND** all 4 icon variants are present in `generated-icons/`

## Design Decisions

1. **Copy favicon.svg instead of symlink**: User explicitly requested copy over symlink — avoids potential issues with symlinks in static file serving and git.
   - *Rejected*: Symlink — user preference, plus some static servers don't follow symlinks.

2. **Inline Node script using sharp API**: The existing `regenerate-png-logos.sh` used `sharp-cli` (`npx sharp-cli`), but sharp-cli lacks composite/background operations. An inline Node script gives full access to `sharp()` API for canvas creation and compositing.
   - *Rejected*: sharp-cli — cannot create backgrounds or composite images.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Background color `#0f1117` | Confirmed from intake #1 — matches manifest `background_color` and dark `theme-color` | S:95 R:90 A:95 D:95 |
| 2 | Certain | Rename `logo.svg` → `icon.svg` | Confirmed from intake #2 — user explicitly chose this name | S:95 R:85 A:90 D:95 |
| 3 | Certain | Output directory `generated-icons/` | Confirmed from intake #3 — user explicitly specified | S:95 R:90 A:90 D:95 |
| 4 | Certain | Copy favicon (not symlink) | Confirmed from intake #4 — user explicitly directed | S:95 R:95 A:95 D:95 |
| 5 | Certain | 20% standard / 40% maskable padding | Confirmed from intake #5 — user confirmed values | S:90 R:85 A:85 D:90 |
| 6 | Certain | Delete old `icons/` directory | Confirmed from intake #6 — user directed cleanup | S:95 R:80 A:90 D:95 |
| 7 | Certain | No theme-aware favicon | Confirmed from intake #7 — grayscale as-is | S:95 R:90 A:90 D:95 |
| 8 | Certain | Use `sharp` for PNG generation | Upgraded from intake Confident #8 — verified: existing script uses sharp-cli, sharp is already in the ecosystem | S:90 R:90 A:90 D:90 |
| 9 | Confident | Inline Node script over sharp-cli | Confirmed from intake #9 — sharp-cli lacks composite API, inline script is the only option | S:75 R:90 A:85 D:80 |
| 10 | Confident | sharp installed as devDependency in frontend package | Frontend already uses pnpm; sharp is a Node lib, natural fit as devDep alongside vite-plugin-pwa | S:70 R:90 A:80 D:75 |

10 assumptions (8 certain, 2 confident, 0 tentative, 0 unresolved).
