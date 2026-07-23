# Intake: Label Picker Markers & Shades

**Change**: 260723-wwoi-label-picker-markers-shades
**Created**: 2026-07-23

## Origin

> Label picker extensions: dashed + thick markers, normal/dark shade axis (paired-grid picker with live marker row previews), static hazard-wedge texture paired with thick, and marker stripe tile-height fix

Conversational — this intake distills a long interactive design session (`/fab-discuss` → live HTML design studies iterated ~10 rounds with the user clicking through mockups in a run-kit iframe window). Every visual decision below was **seen and approved (or explicitly rejected) in a rendered mock** using the real OKLCH pipeline ported from `themes.ts`, not decided abstractly. The reference artifact is the "Label Picker — Extension Studies" page (claude.ai artifact `65079ed7-f01a-4c5a-8bcc-80d07f9087b1`); its final state matches this intake.

Key rejections during iteration (binding — do NOT resurrect):
- **Always-on "worker stream" animation on dashed** — rejected: "feels like the window is loading".
- **Progress seam on dashed selection** — rejected for the same loading connotation.
- **Barber-pole stripes inside the thick bar** — rejected: "too noisy".
- **Any animation of the hazard weave** (rest or selection) — rejected: "too distracting".
- **Phosphor bleed paired with solid** — tried, pulled to keep rest-state texture scarce.
- **Light shade variant** — replaced by normal+dark so existing colors map unchanged.

## Why

1. **Problem**: The window-row label vocabulary has only 3 marker shapes (dotted/solid/double) and 10 colors. The user wants two more semantic slots — "agent is working" (dashed) and "completed" (thick) — and a second color axis (normal/dark shades) to double the color space for organizing many parallel riff windows.
2. **If we don't**: the marker axis saturates — users with >10 windows per concern re-use the same labels and glanceability degrades. The picker also has a latent geometry bug (marker rows pair 1:1 with color rows by a "load-bearing coincidence" documented in `swatch-popover.tsx`) that any future extension would break; this change is the planned occasion to rebuild that pairing deliberately.
3. **Why this approach**: adding 2 markers (→ 5 non-empty states) and doubling colors (→ 20 swatches, 4-wide = 5 rows + Clear = 6 rows) makes the marker column pair 1:1 with the grid again (6 cells ↔ 6 rows) — the two extensions fix each other's layout. The shade axis derives dark variants in OKLCH from the existing hue families, so hue identity and theme adaptation are preserved with zero new palette data.

## What Changes

### 1. Marker vocabulary: add `dashed` and `thick` (frontend + backend closed set)

Display order (user-specified): **dotted → dashed → solid → double → thick**.

- `app/frontend/src/themes.ts`:
  - `MARKER_STATES = ["", "dotted", "dashed", "solid", "double", "thick"]` (empty first, then display order).
  - `markerStripeStyle(state, color)` gains two cases and fixes the existing one (see §2):
    ```ts
    case "dotted": return { backgroundImage: `linear-gradient(to bottom, ${color} 0 3px, transparent 3px 6px)`, backgroundSize: "3px 6px", backgroundRepeat: "repeat-y" };
    case "dashed": return { backgroundImage: `linear-gradient(to bottom, ${color} 0 8px, transparent 8px 12px)`, backgroundSize: "3px 12px", backgroundRepeat: "repeat-y" };
    case "solid":  return { borderLeft: `3px solid ${color}` };
    case "double": return { borderLeft: `6px double ${color}` };
    case "thick":  return { borderLeft: `6px solid ${color}` };
    ```
  - dashed = 3px wide, 8px dash / 4px gap (12px period — exactly 2 dashes per 24px row, 3 per 36px coarse row, so stacked dashed rows weld seamlessly). thick = 6px continuous bar.
- `app/backend/internal/validate/validate.go`: `MarkerValues` gains `"dashed"` and `"thick"`; `ValidateMarkerValue` error copy becomes `"Marker must be one of: dotted, dashed, solid, double, thick (or empty to clear)"`.
- `app/backend/internal/tmux/tmux.go`: update the two `@rk_marker` closed-set doc comments (~lines 473, 821).
- **Semantics are label conventions only**: dashed = "working", thick = "completed" as user conventions. NO functional wiring to `@rk_agent_state` or the status pyramid in this change (explicitly deferred by the user).
- **No new animations anywhere.** All markers are static in all states. The only motion in the label system remains the already-shipped double-marker scanline crawl + CRT band on selection (`globals.css` § scanlines, unchanged).

### 2. Marker stripe tile-height fix (latent bug, back-port from the mock)

`markerStripeStyle`'s dotted case currently uses `repeating-linear-gradient` with `backgroundSize: "3px 100%"` + `no-repeat` — the tile height is element-dependent, so the rhythm only welds because rows happen to be 24/36px (multiples of the 6px period). In any other element height (e.g. the new 18px picker preview cells) the pattern breaks at the tile boundary. Fix: one-period fixed tiles (`3px 6px` dotted, `3px 12px` dashed) with plain `linear-gradient` + `backgroundRepeat: "repeat-y"`, as in the code block above. Visual output in rows is pixel-identical; behavior in arbitrary-height elements becomes correct.

### 3. Hazard-wedge row texture paired with `thick` (window rows)

A `thick`-marked window row renders a static "hazard wedge" background — the completed / "taped off" cue:

- 45° weave in the row's guarded marker color (`--rk-marker-color`, same custom property the scanlines use) at 13% alpha, built on a 12px square tile so adjacent thick rows weld seamlessly:
  ```css
  .rk-hazard::before {
    content: ""; position: absolute; inset: 0; pointer-events: none;
    background-image: linear-gradient(45deg,
      color-mix(in srgb, var(--rk-marker-color) 13%, transparent) 25%, transparent 25% 50%,
      color-mix(in srgb, var(--rk-marker-color) 13%, transparent) 50% 75%, transparent 75%);
    background-size: 12px 12px;
    -webkit-mask-image: linear-gradient(to right, #000, transparent 38%);
    mask-image: linear-gradient(to right, #000, transparent 38%);
  }
  ```
- The mask confines the weave to a left-edge wedge fading out by ~38% of the row width — a taped-off corner, not full-row wallpaper (full-width was tried and rejected as louder than the selected row).
- **NEVER animated — in any state** (rest, hover, selected). Explicit user decision after seeing animated variants.
- Implementation mirrors the shipped double-marker scanlines exactly: dedicated absolutely-positioned inner overlay element (`inset-0`, `overflow-hidden`, `pointer-events-none`, z-index 5 — above tint, below the z-10 icon cluster / z-20 gutter), NEVER `overflow-hidden` on the row root (would clip the `top-full` popovers — same must-fix the scanlines documented). `window-row.tsx` sets `--rk-marker-color` inline for `thick` rows the same way it already does for `isDouble`.
- `prefers-reduced-motion`: no gate needed (static), but keep it listed in the reduced-motion audit since scanlines' block is adjacent.

### 4. Color shade axis: normal + dark (20 values)

- `app/frontend/src/themes.ts`:
  - Each of the 10 `HUE_FAMILIES` gains a dark variant rendered at `L_dark = themeColorStats(palette).L − 0.14` (same hue, same chroma, gamut-reduced via the existing `oklchToHexInGamut`). Normal shade = existing rendering (mean L), so **every existing stored color maps to the normal shade untouched**.
  - `slate`'s dark variant follows the same rule with its near-neutral chroma (an intentional gray ramp).
  - `PICKER_COLOR_VALUES` becomes the 20 display values in paired order: `red, red-dark, orange, orange-dark, … slate, slate-dark`.
  - `computeRowTints` / `computeRowBorders` compute entries for all 20 (dark-variant source hex → same ×1.5 saturate → same 14/22/40% blend ratios; borders through the same WCAG contrast guardrail). Maps stay keyed under every stored vocabulary form (see storage below).
  - `resolveFamily` / `colorValueToHex` / `parseColorValue` accept the `-dark` suffixed names.
- **Storage vocabulary**: dark shades are stored as **family-name values with a `-dark` suffix** (`"blue-dark"`), and plain family names become valid stored values too. `familyToLegacy` at the write seam maps normal-shade picks to the legacy numeric vocabulary exactly as today (zero migration, existing values untouched); dark picks have no legacy form and are written as `"{family}-dark"`.
- `app/backend/internal/validate/validate.go`: `ValidateColorValue` / `NormalizeColorValue` extended to accept the family-name vocabulary (10 family names + their `-dark` variants) alongside the existing numeric/blend forms. Existing numeric values remain valid forever (read + write).
- Everything keyed by stored color value (window rows, session rows, server tiles/stripes, board pins) picks up dark variants transparently through the tints/borders maps — no per-consumer changes beyond map population.

### 5. Picker rebuild: paired grid + live marker row previews (`swatch-popover.tsx`)

Layout ("Variant C", chosen over shade-rows and split-swatch variants):

- **Color grid**: 20 swatches, 4-wide, pairs adjacent — each family renders `normal | dark` side by side (row 1: red, red-dark, orange, orange-dark; …). 5 color rows + full-width `Clear color` row = 6 grid rows.
- **Swatches are uniform solid squares** (single fill = the value's selected-tint blend; no more split base/selected halves), 18×18px, ✓ glyph on the selected swatch. Selected ring must be unambiguous between adjacent same-family shades.
- **Marker column**: 6 cells (∅ + the 5 states in display order), restoring the 1:1 marker-cell ↔ grid-row pairing the old layout got by coincidence (document this deliberately — the old "LOAD-BEARING COINCIDENCE" comment is superseded).
- **Marker cells are live row previews**: each non-∅ cell renders as a miniature window row for the currently selected color — background = that family/shade's `tint.base` (gray sentinel when uncolored), stripe in the guarded border color with a **2px left inset** (so the marker doesn't kiss the cell edge and the cell reads as a mini row), plus the paired row texture (hazard wedge on thick, scanline wash on double). Picking a different swatch repaints the marker column immediately.
- **Preview cells NEVER animate** — explicit user decision: motion belongs to real rows only. No scanline crawl even when the double cell is selected.
- **Keyboard grid**: conceptual 5-col × 6-row grid (marker col 0 + 4 color cols; Clear spans cols 1–4 of row 0). Arrow-key clamping rules preserved; no dead cells anymore (20 colors fill 5×4 exactly).
- The color-only picker variant (session/server rows + palette "Set Color" actions — `onSelectMarker` absent) gets the same 20-swatch paired grid without the marker column, same as today's split.

### 6. Tests & docs

- Unit: `themes.test.ts` (new marker cases, tile fix, dark-variant derivation + gamut, vocabulary resolution round-trip), `swatch-popover.test.tsx` (6-cell marker column, 20 swatches, preview repaint on color pick, keyboard grid), backend `validate_test.go` (new marker + color vocabularies, legacy still valid).
- e2e: grep `tests/e2e` for chrome assertions on the picker/marker DOM before changing structure (Playwright specs assert `data-marker-value` / `data-color-value` / aria labels); update specs + their `.spec.md` companions in the same commit (constitution § Test Companion Docs).
- `fab/project/context.md` hover-animation vocabulary line: no change needed (no new animations).

## Affected Memory

- `run-kit/ui-patterns`: (modify) marker vocabulary (5 states + order + semantics), hazard-wedge pairing, shade axis, paired-grid picker with live marker previews, tile-height rule
- `run-kit/architecture`: (modify) validate closed sets — marker values and the new color family-name vocabulary accepted by the backend

## Impact

- **Frontend**: `app/frontend/src/themes.ts` (marker states/stripes, shade derivation, tints/borders, vocabulary), `app/frontend/src/components/swatch-popover.tsx` (full layout rebuild), `app/frontend/src/components/sidebar/window-row.tsx` (hazard-wedge overlay wiring), `app/frontend/src/globals.css` (`.rk-hazard` block beside the scanlines block), colocated unit tests.
- **Backend**: `app/backend/internal/validate/validate.go` (+ tests), doc comments in `app/backend/internal/tmux/tmux.go`. No API shape changes — same `@rk_marker` / color option plumbing, wider accepted vocabularies.
- **e2e**: `app/frontend/tests/` specs asserting picker/marker chrome + `.spec.md` companions.
- No schema/state migrations: legacy stored values remain valid; new vocabulary is additive.

## Open Questions

- (none — all design decisions were resolved interactively during the design session)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Marker display order dotted→dashed→solid→double→thick; thick=completed, dashed=working as label conventions only (no agent-state wiring) | User specified order and semantics verbatim; wiring explicitly deferred | S:95 R:90 A:95 D:95 |
| 2 | Certain | No new animations anywhere: dashed static in all states, hazard wedge never animated, picker previews never animate; double's shipped selection crawl is the only motion | User rejected every animated variant across four iterations, each with explicit rationale | S:95 R:85 A:95 D:95 |
| 3 | Certain | Hazard wedge geometry: 45° weave, 12px tile, 13% alpha of guarded marker color, mask fade to transparent at 38% row width, scanlines-style inner overlay element | Values approved visually in the rendered mock ("try 1 for the weave design") | S:90 R:80 A:90 D:90 |
| 4 | Certain | Shade axis = normal + dark (dark = mean-L − 0.14, same hue/chroma, gamut-reduced); existing colors map to normal untouched; Variant C paired grid (20 swatches 4-wide, pairs adjacent) with uniform solid swatches | User chose normal+dark over light/dark and Variant C over A/B in the mock; uniform squares requested explicitly | S:90 R:75 A:90 D:90 |
| 5 | Certain | Marker cells render as mini row previews of the selected color: 2px left inset, tint.base background, guarded stripe color, paired texture | User requested the preview behavior and the 2px inset explicitly | S:90 R:85 A:90 D:90 |
| 6 | Confident | Dark shades stored as `"{family}-dark"` family-name values; normal picks keep the legacy numeric write mapping; backend ValidateColorValue additionally accepts the full family-name vocabulary; legacy numeric values stay valid forever | Storage form was flagged in discussion but not explicitly picked; family-name suffix is the cleanest additive extension (legacy has no shade slot) and preserves zero migration | S:60 R:65 A:80 D:70 |
| 7 | Confident | Color-only picker callers (session/server rows, palette Set Color) get the same 20-swatch paired grid, no marker column | Follows directly from the existing shared-component split; consistency is the obvious default | S:60 R:80 A:85 D:80 |
| 8 | Confident | Dotted tile fix (`3px 6px` one-period tile) back-ported to production `markerStripeStyle` | Latent bug demonstrated in the mock (18px cells); row rendering is pixel-identical | S:70 R:85 A:90 D:85 |
| 9 | Tentative | Marker preview cells when no color is selected use the uncolored gray sentinel (ANSI 8) tint/border | Not discussed; mirrors the row's uncolored-selected sentinel convention | S:45 R:80 A:70 D:60 |

9 assumptions (5 certain, 3 confident, 1 tentative, 0 unresolved).
