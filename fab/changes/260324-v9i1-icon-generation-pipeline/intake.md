# Intake: Icon Generation Pipeline

**Change**: 260324-v9i1-icon-generation-pipeline
**Created**: 2026-03-24
**Status**: Draft

## Origin

> User observed jagged white fringe around the RunKit dock icon on macOS. Investigation revealed
> all PWA icon PNGs (`icon-192.png`, `icon-512.png`, `icon-512-maskable.png`) have transparent
> backgrounds — macOS composites these onto the dock with a white fill, causing aliasing artifacts.
>
> Discussion established: (1) macOS doesn't support transparent PWA dock icons — solid background
> required, (2) the canonical SVG mark serves dual duty as favicon and in-app logo so it must stay
> transparent, (3) a generation pipeline should produce padded, dark-background PNGs from the
> single SVG source, (4) the existing `regenerate-png-logos.sh` is a naive resize with no
> background/padding support — replace it entirely.
>
> User directed: rename `logo.svg` → `icon.svg`, output generated variants to `generated-icons/`,
> delete old `icons/` directory, copy (not symlink) for favicon, add `just icons` recipe.

## Why

1. **Problem**: PWA icons render with jagged white fringe on macOS dock because PNGs have transparent backgrounds. The OS fills transparent areas with white, creating visible aliasing at the hexagon edges.
2. **Consequence**: The app looks unprofessional in the dock — the icon has visible artifacts that contrast with every other dock icon.
3. **Approach**: A generation script that composites the SVG mark onto a solid dark canvas with proper padding. This separates the canonical mark (transparent, used as favicon and in-app logo) from the generated app icons (solid background, padded). The existing `regenerate-png-logos.sh` just resizes — it has no concept of backgrounds or padding.

## What Changes

### 1. Rename canonical SVG

Rename `app/frontend/public/logo.svg` → `app/frontend/public/icon.svg`. This is the single source of truth for the hexagonal cube mark. No changes to the SVG content itself.

### 2. Generation script

Replace `scripts/regenerate-png-logos.sh` with `scripts/generate-icons.sh`. The script:

- Reads `app/frontend/public/icon.svg` as source
- Outputs to `app/frontend/public/generated-icons/`:

| File | Size | Background | Padding | Purpose |
|------|------|-----------|---------|---------|
| `favicon.svg` | same as source | transparent | none | Browser favicon (file copy of `icon.svg`) |
| `icon-192.png` | 192×192 | `#0f1117` | ~20% (hex sized to ~154px centered) | PWA icon, apple-touch-icon |
| `icon-512.png` | 512×512 | `#0f1117` | ~20% (hex sized to ~410px centered) | PWA icon |
| `icon-512-maskable.png` | 512×512 | `#0f1117` | ~40% (hex sized to ~307px centered) | PWA maskable icon (safe zone per spec) |

Uses `sharp` (Node.js image library) via an inline Node script — same dependency the old script used via `sharp-cli`. The `#0f1117` background color matches the existing `manifest.json` `background_color` and the dark theme `theme-color`.

### 3. Reference updates

| File | Old | New |
|------|-----|-----|
| `app/frontend/index.html` line 27 | `href="/logo.svg"` | `href="/generated-icons/favicon.svg"` |
| `app/frontend/index.html` line 9 | `href="/icons/icon-192.png"` | `href="/generated-icons/icon-192.png"` |
| `app/frontend/src/components/top-bar.tsx` line 223 | `src="/logo.svg"` | `src="/icon.svg"` |
| `app/frontend/src/components/top-bar.tsx` line 230 | `src="/logo.svg"` | `src="/icon.svg"` |
| `app/frontend/public/manifest.json` | `/icons/*` paths | `/generated-icons/*` paths |

### 4. Justfile recipe

Add `icons` recipe under a new `# ─── Assets ───` section that runs `scripts/generate-icons.sh`.

### 5. Cleanup

- Delete `app/frontend/public/icons/` directory (3 old PNGs)
- Delete `scripts/regenerate-png-logos.sh` (replaced)

## Affected Memory

- `run-kit/architecture`: (modify) Update icon file paths and generation pipeline description
- `run-kit/ui-patterns`: (modify) Update logo SVG references and icon set description

## Impact

- **Frontend static assets**: New directory structure for icons, updated HTML/manifest references
- **Build pipeline**: New `just icons` recipe; icons are generated artifacts, not source files
- **Top bar component**: Path change for in-app logo image (`/logo.svg` → `/icon.svg`)
- **PWA install**: Manifest icon paths change — users with existing PWA installs may need to re-install for updated icons
- **No backend changes**: Purely frontend/static asset concern

## Open Questions

None — all decisions were made during the discussion session.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `#0f1117` as icon background color | Discussed — matches existing `manifest.json` `background_color` and dark theme `theme-color` | S:95 R:90 A:95 D:95 |
| 2 | Certain | Rename `logo.svg` → `icon.svg` | Discussed — user explicitly chose `icon.svg` over `main.svg` | S:95 R:85 A:90 D:95 |
| 3 | Certain | Output directory `generated-icons/` | Discussed — user explicitly specified this name | S:95 R:90 A:90 D:95 |
| 4 | Certain | Copy favicon.svg (not symlink) | Discussed — user explicitly said "copy instead" | S:95 R:95 A:95 D:95 |
| 5 | Certain | 20% padding for standard icons, 40% for maskable | Discussed — user confirmed these values | S:90 R:85 A:85 D:90 |
| 6 | Certain | Delete old `icons/` directory | Discussed — user said "icons/ -> can delete" | S:95 R:80 A:90 D:95 |
| 7 | Certain | No theme-aware favicon | Discussed — user confirmed "greyscale as is is ok" | S:95 R:90 A:90 D:95 |
| 8 | Confident | Use `sharp` for PNG generation | Existing script already uses sharp-cli; sharp is the standard Node image library | S:80 R:90 A:85 D:85 |
| 9 | Confident | Inline Node script rather than sharp-cli | sharp-cli is limited (no composite/background); inline script gives full sharp API access | S:70 R:90 A:80 D:75 |

9 assumptions (7 certain, 2 confident, 0 tentative, 0 unresolved).
