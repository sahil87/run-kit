# Intake: Row Color System Overhaul — Owned Palette + Axis Split

**Change**: 260718-3prk-row-color-owned-palette-axis-split
**Created**: 2026-07-19

## Origin

> row color system overhaul — owned 10-family theme-adapted palette + axis split (hue=label, tint-depth=selection, gutter marker)

Conversational — the design was developed in a `/fab-discuss` session (2026-07-18/19) through five iterative live demos (swatch comparison, 10×3 palette matrix, weight-technique comparison, selection-interaction stress test, and an interactive simulation of the user's real sidebar). Every decision below was either explicitly chosen by the user against rendered alternatives or derived and then user-approved in the simulation. Rejected alternatives are recorded in **Why**. Mid-intake, at the user's request, the branch was fast-forwarded to `origin/main` (`4fe813f7`) — the intake below reflects post-rebase reality: the SSE-hub wake seam for user-option mutations already exists (#390, `260718-xpur`), and board pinning is link-based with dual presence (#393, `260718-co9z`).

## Why

1. **Problem**: The window-row / server color picker derives its 10 swatches from the active theme's ANSI palette (6 single hues `ansi[1..6]` + 4 audited blends `1+3`/`1+4`/`3+4`/`1+2` in `themes.ts`). Hue identity is therefore hostage to the theme: a window labeled "orange" renders tan-gray on Zenburn, brownish-pink on Rosé Pine. The blend pairs had to be locked by a 70-theme audit precisely because ANSI hues collide (distinct on only 83–96% of themes), and the color count is capped at 10 by what ANSI offers.
2. **Consequence of not fixing**: labels don't survive theme switches semantically, near-collisions persist on muted themes, and the palette can never grow past 10.
3. **Approach**: invert the derivation — an **owned base set** of 10 fixed OKLCH hue families, **adapted to the theme** (render each family hue at the theme's mean OKLab L and chroma) so they feel native while hue identity stays stable. Additionally, split the row's visual axes so labeling and selection never share a channel: **hue = label**, **tint depth = selection**, **left-gutter border-style = an independent 4-state user marker**.

**Rejected alternatives** (explored against rendered demos):
- *Halfway adaptation* (65% lerp toward theme L/C) — rejected for full adoption; user judged full adoption correct across 9 themes.
- *Weight variants (muted/base/vivid) via source L/C modulation* — visually crushed by the tint pipeline (blend ratio dominates: on Default Dark the three variants render `#2a1f1c`/`#312118`/`#312622`). Dead on arrival.
- *Weight via tint loudness (6/14/28%)* — worked visually but superseded by the axis split (tint depth is now reserved for selection).
- *Weight via border style (dotted/solid/double) or width ramp (2/3/4px)* — rejected: collides with the selection border; in the worst case (selected muted among resting vivid) every non-typographic cue points at the wrong row.

## What Changes

### 1. Owned palette + theme adaptation (`app/frontend/src/themes.ts`)

Replace the ANSI-descriptor picker machinery (`PICKER_ANSI_INDICES`, `PICKER_BLEND_PAIRS`) with 10 owned hue families (OKLCH hue angles, placed non-uniformly — tight in the discriminable red-orange region, the large gap parked in teal→blue where human hue discrimination is weakest):

| Family | Hue angle | Role | Legacy value |
|---|---|---|---|
| red | 25° | anchor: blocked/urgent | `1` |
| orange | 55° | quiet | `1+3` |
| amber | 90° | anchor: attention/WIP | `3` |
| olive | 120° | quiet | `1+2` |
| green | 150° | anchor: done/good | `2` |
| teal | 185° | quiet | `6` |
| blue | 250° | anchor: default/info | `4` |
| purple | 290° | quiet | `1+4` |
| magenta | 330° | quiet | `5` |
| slate | 250° chroma-floored | neutral: parked/archived | `3+4` |

**Adaptation (full adoption)**: theme stats = mean OKLab L and mean chroma C over `palette.ansi[1..6]`, with a chroma floor of **0.05** (near-monochrome themes stay distinguishable). Family base color = OKLCH(L_theme, C_theme, ownHue). Slate uses `C = min(C_theme × 0.2, 0.025)`. Out-of-gamut results are clamped by **reducing C stepwise (×0.92, ≤20 iterations)** — never by sRGB channel-clamping, which shifts hue. The existing OKLab conversions in `themes.ts` are reused; a small `oklchToHex` + in-gamut check is added.

**Downstream pipeline unchanged**: saturate ×1.5, tint blends into theme background, WCAG border guardrail (`adjustBorderForContrast`, 3.0 min) all operate on the new source hexes as-is.

**Legacy mapping (zero migration)**: stored color values (tmux user options) keep their current vocabulary; `colorValueToHex` resolves each legacy value to its family base per the table above (1:1). No storage, API, or backend change for *color*. New writes may use family names (`"orange"`) with numeric forms kept as parse aliases.

### 2. Row anatomy — selection loses the border

Selection = **tint depth + typography only**: selected row background = family tint at **40%** blend ratio (up from 32%; uncolored rows use the gray sentinel at 40–50% as today), name bolds (`font-medium`) and brightens (`text-primary`). The `borderLeft` selection cue in `window-row.tsx` (currently 4px solid guarded color) is **removed**. Rest tint stays 14%, hover 22%.

**Board-pin cue relocation (decided)**: the pinned-to-active-board 4px accent border (`window-row.tsx` `isPinnedToActiveBoard` branch) is also removed. Its job — distinguishing "pinned to the board you're currently viewing" from "pinned to some board" — moves onto the **already-persistent filled pin glyph**: the glyph turns **accent-colored** when the row is pinned to the active board (it is already `opacity-100` + filled whenever `isPinnedToAny`; monochrome `text-text-secondary` otherwise). Zero new elements; the gutter stays single-purpose. Context: since `260718-co9z` (link-based pinning, dual presence) pinned rows stay visible in SESSIONS while pinned, so this cue is load-bearing — keep it working, just on the glyph.

### 3. Left-gutter marker — new independent label axis

The freed left edge of each row becomes a **marker gutter** (~14px wide, full row height, fine pointers):

- **4 states, click to cycle**: empty → dotted (3px dotted) → solid (3px solid) → double (6px double), rendered in the row's family guarded color, gray for uncolored rows. Markers are available on **all** rows including uncolored ones.
- **Hover affordance, two-stage**: hovering the row fills the gutter at 12–20% family color (user tuned to the stronger end); hovering the gutter itself steps to ~30% and ghosts a preview of the **next** state (empty shows faint dotted; dotted previews solid; etc.).
- **Cursor**: `cell` on gutter hover (decided against pointer/context-menu/crosshair/copy/custom-SVG after live comparison).
- **Semantics deliberately unnamed** in the UI — states are abstract (todo/doing/done for one user, priority for another).
- Marker click must not trigger row selection (stopPropagation) and must coexist with row drag-reorder.

### 4. Easter egg — double marker dresses the row in scanlines

A row whose marker is **double** gets a static CRT scanline overlay across its full width: `repeating-linear-gradient(to bottom, {markerColor at ~14%} 0 1px, transparent 1px 3px)` layered over the tint. Pure static CSS — does not touch the `prefers-reduced-motion` contract and stays out of the status pyramid's animation channel (waiting halo remains unambiguous). Effect: double becomes the one marker state readable from across the sidebar ("burning" state).

**Retro animation (decided — user approved the prototype)**: when a scanlined (double-marker) row is *also selected*, the scanlines animate — a slow downward crawl (`background-position-y` cycling the 3px gradient period, ~1.4s linear infinite) plus an occasional CRT refresh band (a ~12px soft gradient band in the marker color rolling top→bottom, ~3.4s cycle with a rest phase, via an absolutely-positioned `::after` with `pointer-events: none`; row gets `position: relative; overflow: hidden`). Static again when deselected. MUST be fully zeroed under `prefers-reduced-motion` (no crawl, band hidden) per the project's animation contract.

### 5. Marker persistence (backend)

Follow the existing row-color pattern: marker state stored as a tmux **window user option** (e.g. `@rk_marker`, values `""`/`dotted`/`solid`/`double`), written via a `POST` endpoint mirroring the color endpoints, surfaced through the sessions enrichment into the state-socket payload. **Wire the POST handler into the existing SSE-hub wake seam** (landed upstream in `260718-xpur`, #390 — user-option mutations emit no tmux control-mode event, so the wake call is what avoids the 12s safety-poll repaint lag). **Scope (decided): windows only** — session rows and server tiles do not get markers in this change; they can follow later if the pattern proves out.

### 6. Scope of the palette change across surfaces

The owned palette + adaptation applies everywhere the current swatch set is consumed: window rows, **server colors** (server tiles use the same set — user's explicit requirement), swatch popover, and any tint consumers keyed by color value. The swatch popover grid stays 10 + Clear (no weight variants — that axis was dropped in favor of the marker).

### 7. Keyboard + touch parity

- **Palette action** (Constitution V): `Window: Cycle Marker` command-palette entry operating on the current window; boundary behavior mirrors other window actions.
- **Touch (`coarse:`) — decided: palette only.** The gutter is inert on coarse pointers (no tap target, no accidental cycles while scrolling); the palette action is the touch path.

### 8. Documentation

`docs/specs/themes.md` describes the ANSI-derivation design and must be updated by the author (human-curated spec) — flag in PR body. Memory updates via hydrate as listed below. Test companion docs (`.spec.md`) required for any new/changed Playwright specs per constitution.

## Affected Memory

- `run-kit/ui-patterns`: (modify) row anatomy — selection cue change, gutter marker axis, easter egg, palette/touch parity
- `run-kit/architecture`: (modify) new marker POST endpoint + `@rk_marker` window option + state-socket payload field

## Impact

- **Frontend**: `themes.ts` (palette machinery replacement + OKLCH helpers), `swatch-popover.tsx` (renders from new families), `sidebar/window-row.tsx` (selection style, gutter, scanlines), `server-panel.tsx` / server-tile color consumers (resolution seam only), `globals.css` (scanline/animation utilities), palette action wiring, unit tests for the new derivation math, e2e coverage for gutter cycling + selection rendering (+ `.spec.md` companions).
- **Backend**: marker endpoint (`api/`), tmux option read/write (`internal/tmux/`), sessions enrichment + hub wake, Go tests.
- **Docs**: `docs/specs/themes.md` (human), memory files via hydrate.
- **No migration**: legacy stored color values resolve unchanged; marker option absent = empty state.

## Open Questions

None — all open points were resolved during intake (board-pin cue, touch treatment, marker scope, retro-animation approval).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Owned 10-family palette (hue angles per table) replaces ANSI-derived swatches; full theme adoption (mean L/C over ansi[1..6], chroma floor 0.05, gamut clamp via chroma reduction) | Discussed — user approved full adoption against rendered alternatives across 9 themes | S:95 R:70 A:90 D:90 |
| 2 | Certain | Axis split: hue = label, tint depth = selection, gutter border-style = independent 4-state marker | Discussed — user proposed the split; validated in interactive sim on both dark and light themes | S:95 R:65 A:85 D:95 |
| 3 | Certain | Selection = 40% tint + bold + text-primary, borderless; rest 14%, hover 22% | Discussed — user confirmed "40% works" in sim with depth toggle | S:95 R:85 A:90 D:95 |
| 4 | Certain | Marker: 4 states (empty/dotted 3px/solid 3px/double 6px), click-to-cycle, family color (gray uncolored), available on all rows | Discussed — "marker earns its keep", gutter interaction "works perfectly" | S:90 R:80 A:85 D:90 |
| 5 | Certain | Gutter hover: row-hover fill ~20%, gutter-hover ~30% + next-state ghost; cursor `cell` | Discussed — user tuned the fill strength and locked the cell cursor after comparing 7 options | S:95 R:90 A:90 D:90 |
| 6 | Certain | Double marker → static scanline overlay (~14% marker color, 1px/3px repeat) on the whole row | Discussed — user requested the easter egg and kept it after live trial | S:90 R:85 A:85 D:85 |
| 7 | Certain | Legacy color values resolve 1:1 to family bases (zero migration; numeric forms stay valid aliases) | Derived — current 10 values map cleanly onto the 10 families; keeps storage/API untouched | S:80 R:75 A:90 D:85 |
| 8 | Certain | `Window: Cycle Marker` palette action | Constitution V mandates keyboard parity; naming follows existing action grammar | S:70 R:90 A:95 D:85 |
| 9 | Certain | Marker persists as tmux window user option (`@rk_marker`) + POST endpoint wired into the existing SSE-hub wake seam (260718-xpur) | Follows the row-color pattern + Principle II; the wake seam now exists upstream, removing the main unknown | S:75 R:75 A:90 D:85 |
| 10 | Certain | Selected+double retro animation ships: scanline crawl (~1.4s) + CRT refresh band (~3.4s), reduced-motion-zeroed | Asked — user approved the live prototype ("the effect looks good, go ahead") | S:85 R:85 A:85 D:90 |
| 11 | Certain | Board-pin active-board cue moves to the persistent filled pin glyph rendered accent-colored (border removed) | Asked — user chose accent glyph over right-edge tick / gutter priority / dropping the cue | S:85 R:85 A:80 D:90 |
| 12 | Certain | Touch: gutter inert on coarse pointers; palette action is the marker path | Asked — user chose palette-only over widened tap zone / long-press | S:85 R:90 A:85 D:90 |
| 13 | Certain | Marker scope: window rows only (palette change still applies to all color surfaces incl. server tiles) | Asked — user chose windows-only over sessions/server-tile extension | S:85 R:85 A:80 D:85 |

13 assumptions (13 certain, 0 confident, 0 tentative, 0 unresolved).
