# Intake: Leading Icons on Top-Bar Menu Rows

**Change**: 260801-3q1z-top-bar-menu-leading-icons
**Created**: 2026-08-01

## Origin

Promptless dispatch (via `/fab-proceed`-style orchestration) from a synthesized user-conversation description. The user discussed the change interactively, chose the **"toggles iconified too" variant**, and approved it via a visual before/after mock. Key conversation decisions are captured verbatim below and in Assumptions.

> **Change: Leading icons on top-bar menu rows (bar↔menu glyph parity, "toggles too" variant)**
>
> The split control was recently merged into a single split-button (260731-oiho). Its dropdown rows — and most other overflow-menu rows — are text-only, while the Open control's rows already carry leading glyphs (260722-fc3b, `OpenTargetIcon` in `app/frontend/src/components/open-app-icons.tsx`). The menu is visually mixed and rows are slower to scan.
>
> **Principle agreed with the user**: every menu row that mirrors an in-bar icon button should carry that button's glyph — completing the existing "bar↔menu behavior can never drift" contract (comment at `top-bar.tsx:2505`) visually, and teaching the icon↔action mapping in both directions.

## Why

1. **Pain point**: After the 260731-oiho navbar consolidation, the overflow chevron menu and the SplitControl popover mix icon-bearing rows (Open targets, via `OpenTargetIcon`) with text-only rows (Split ×2, Close pane, Refresh, Fixed width, Autofit, Terminal font). The menu is visually inconsistent and rows are slower to scan — users match rows by reading, not by glyph recognition.
2. **Consequence of not fixing**: The bar↔menu parity contract (the comment block at `top-bar.tsx:2505`: "the rows reuse the same underlying actions as their in-bar button forms … so bar↔menu behavior can never drift") holds *behaviorally* but not *visually*. Users never learn the icon↔action mapping from the menu, and the in-bar icons stay opaque; each new menuOnly row (the consolidation direction) worsens the mixed look.
3. **Why this approach**: Mirror each in-bar button's exact glyph as a leading icon on its menu row (identity), keeping the trailing ✓ as the state marker on toggle rows (the macOS menu pattern: leading icon = identity, trailing ✓ = state). Extract shared glyph components so bar and menu render **one definition each** — visual parity becomes structural, not copy-paste. The `OpenTargetIcon` precedent (260722-fc3b) already proves the pattern in this exact menu.
4. **Alternatives rejected in conversation**: (a) icons on action rows only, toggles left text-only — rejected; user chose the "toggles iconified too" variant via a before/after mock. (b) Iconifying the View-switcher rows — rejected; the in-bar form is a text pill, there is no glyph to mirror.

## What Changes

All row components live in `app/frontend/src/components/top-bar.tsx` unless noted. Rows already use `flex items-center gap-2` (via `POPOVER_ROW_CLASS` / `MENU_ROW_CLASS`, hosted in `top-bar-overflow-menu.tsx`), so a leading icon as first child aligns naturally — **no row-class changes expected**.

### 1. SplitControl popover rows (~line 2013)

The two `POPOVER_ROW_CLASS` rows in the SplitControl dropdown get leading direction glyphs:

- **"Split vertical"** → the square-split-vertical glyph already inlined in the popover's primary segment (~line 1960), verbatim paths:
  ```
  <path d="M5 8V5c0-1 1-2 2-2h10c1 0 2 1 2 2v3" />
  <path d="M19 16v3c0 1-1 2-2 2H7c-1 0-2-1-2-2v-3" />
  <line x1="4" x2="20" y1="12" y2="12" />   {/* horizontal divider */}
  ```
  (24-viewBox, `stroke="currentColor"`, strokeWidth 2, round caps/joins, rendered 14×14)
- **"Split horizontal"** → the 90°-rotated variant (lucide `square-split-horizontal`: side brackets + vertical divider `line x1="12" x2="12" y1="4" y2="20"`).

### 2. Overflow chevron menu rows (all `MENU_ROW_CLASS`)

| Row | Location | Leading glyph (mirrors in-bar control) |
|-----|----------|----------------------------------------|
| `SplitMenuRow` ×2 | ~2518 | Same two direction glyphs as the popover rows above |
| `ClosePaneMenuRow` | ~2609 | In-bar `ClosePaneButton` (~2047) ✕ glyph — two crossed lines, 24-viewBox |
| `RefreshMenuRow` | ~2650 | In-bar `RefreshButton` (~2153) lucide rotate-cw glyph: `M21 12a9 9 0 1 1-3-6.7L21 8` + `M21 3v5h-5` (24-viewBox) |
| `FixedWidthMenuRow` | ~2544 | In-bar `FixedWidthToggle` (~2398) arrows glyph (14-viewBox). **Trailing ✓ stays as the state marker** (leading icon = identity, trailing ✓ = state) |
| `AutofitMenuRow` (board mode) | ~2589 | In-bar `BoardAutofitToggle` (~2455) frame-with-columns glyph (14-viewBox: `rect x=1 y=2.5 w=12 h=9 rx=1` + divider lines x=5, x=9). **Trailing ✓ stays** |
| `TerminalFontMenuRow` | ~2566 | A leading **"Aa" text glyph** matching the in-bar `TerminalFontControl` trigger (~2207) |

Note: the in-bar `FixedWidthToggle` and `BoardAutofitToggle` glyphs are **state-dependent** (arrows flip inward/outward; autofit frame gains filled panes when on). The menu row's *leading* icon is a **static identity variant** — state is carried solely by the trailing ✓ (see Assumptions #5).

### 3. Extract shared glyph components

New shared components so the in-bar buttons and menu rows render **one definition each** — dedupes the split-vertical SVG currently inlined twice-over in SplitControl, plus new shared: split-horizontal, close-✕, refresh, fixed-width, autofit, "Aa".

Follow the `OpenTargetIcon` precedent (`app/frontend/src/components/open-app-icons.tsx`):
- ~14px rendered size
- `stroke`/`fill` via `currentColor` (rides the row hover treatments and rk-glint flips for free)
- `aria-hidden="true"` decoration — the row's accessible name stays its text label
- `shrink-0`
- a `data-icon` attribute as the test seam (e.g. `data-icon="split-vertical"`)

Proposed home: a new sibling module `app/frontend/src/components/top-bar-icons.tsx` (see Assumptions #4 — `open-app-icons.tsx` is Open-target-specific; `top-bar-overflow-menu.tsx` hosts row classes/sizing tokens, not glyphs).

In-bar consumers to refactor onto the shared components (no visual change to the bar): `SplitControl` primary segment (~1960), `ClosePaneButton`, `RefreshButton`, `FixedWidthToggle` (keeps its state-driven variant selection), `BoardAutofitToggle` (same), `TerminalFontControl` trigger.

### 4. Explicitly out of scope (agreed with user)

- `ViewSwitcherMenuRows` (`view-switcher.tsx`) — the in-bar form is a text pill, no glyph to mirror
- The command palette
- Breadcrumb session/window/board switcher dropdowns
- The desktop titlebar host-switcher menu (has its own fixed ✓/+ marker column)
- The bottom-bar Fn-keys menu
- The Open rows (already have icons via `OpenTargetIcon`)

## Affected Memory

- `run-kit/ui-patterns`: (modify) top-bar chrome — chevron-menu / SplitControl-popover row anatomy gains the leading-glyph parity rule (leading icon = in-bar identity, trailing ✓ = state) and the shared glyph-component seam

## Impact

- `app/frontend/src/components/top-bar.tsx` — 7 menu-row components + 6 in-bar button/segment consumers refactored onto shared glyphs (file is ~2664 lines; changes are localized to the right-cluster/menu region)
- New file `app/frontend/src/components/top-bar-icons.tsx` (proposed) — shared glyph components
- `app/frontend/src/components/top-bar.test.tsx`, `top-bar-overflow-menu.test.tsx` — unit assertions on `data-icon` presence per row (existing `OpenTargetIcon` precedent)
- Playwright e2e: `app/frontend/tests/e2e/top-bar-overflow.spec.ts`, `top-bar-refresh.spec.ts`, `board-autofit.spec.ts`, `board-close-and-unpin.spec.ts`, `tooltips.spec.ts` reference these rows/controls — per project memory, e2e specs assert UI-chrome details, so grep/run these before and while changing. Rows keep their accessible names (icons are `aria-hidden`), so assertions are expected to stay green; any `.spec.ts` change requires the sibling `.spec.md` update in the same commit (constitution § Test Companion Docs)
- No backend, routing, or API impact; no row-class (`MENU_ROW_CLASS`/`POPOVER_ROW_CLASS`) changes expected

## Open Questions

- None — the design was fully resolved in conversation (variant chosen and mock-approved); remaining micro-decisions are graded in Assumptions.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope = "toggles iconified too" variant: all 7 listed row components (Split popover ×2, SplitMenuRow ×2, ClosePane, Refresh, FixedWidth, Autofit, TerminalFont) get leading glyphs | Discussed — user chose this variant and approved a visual before/after mock | S:95 R:90 A:95 D:95 |
| 2 | Certain | Out of scope: View-switcher rows, command palette, breadcrumb dropdowns, titlebar host-switcher menu, Fn-keys menu, Open rows | Discussed — exclusion list agreed with user, with per-item rationale | S:95 R:90 A:95 D:95 |
| 3 | Certain | Icon conventions follow the `OpenTargetIcon` precedent: ~14px, `currentColor`, `aria-hidden`, `shrink-0`, `data-icon` test seam | Stated in the description; precedent exists in the same menu (260722-fc3b) | S:90 R:90 A:95 D:90 |
| 4 | Confident | Shared glyph components live in a new sibling module `app/frontend/src/components/top-bar-icons.tsx` | Extraction is mandated but the file location was not fixed; `open-app-icons.tsx` is Open-specific, `top-bar-overflow-menu.tsx` hosts row classes — a dedicated icons module mirrors the `open-app-icons.tsx` shape. Trivially relocatable | S:55 R:90 A:70 D:60 |
| 5 | Confident | Stateful toggles get a **static identity** leading glyph: FixedWidth → inward/contract arrows; Autofit → unfilled frame-with-columns (no filled panes); state stays on the trailing ✓ only | The agreed macOS pattern (leading = identity, trailing ✓ = state) implies the leading icon must not flip with state; the off/base variant is the natural identity form | S:70 R:85 A:70 D:65 |
| 6 | Confident | "Aa" glyph renders as an `aria-hidden` text span in a fixed ~14px `shrink-0` box with `data-icon="terminal-font"`, matching the in-bar trigger's text styling — not an SVG | Description specifies a leading "Aa" *text* glyph matching the in-bar trigger; a span is the direct match and keeps `currentColor` behavior | S:60 R:90 A:75 D:60 |
| 7 | Certain | Split-horizontal uses lucide `square-split-horizontal` (90°-rotation of the existing inline vertical glyph; vertical divider line x=12), same stroke conventions | Named explicitly in the description; the vertical sibling's exact paths are already in the file (~1960) | S:75 R:90 A:80 D:80 |
| 8 | Confident | `data-icon` values: `split-vertical`, `split-horizontal`, `close-pane`, `refresh`, `fixed-width`, `autofit`, `terminal-font` | Naming not specified; kebab-case action names mirror the `OpenTargetIcon` `data-icon={name}` seam and read naturally in tests | S:55 R:95 A:80 D:70 |
| 9 | Confident | Existing Playwright specs need no behavioral changes: rows keep their accessible names (icons are `aria-hidden`); verify by grep + running the 5 named specs during apply | e2e specs select by role/name; decoration doesn't alter names. Project memory still mandates the grep/run check, and any spec edit triggers the `.spec.md` companion rule | S:70 R:85 A:75 D:75 |
| 10 | Confident | Test coverage = extend existing colocated unit tests (`top-bar.test.tsx`, `top-bar-overflow-menu.test.tsx`) with `data-icon` presence assertions per row; no new e2e spec | Description's testing notes name unit `data-icon` assertions as the mechanism (OpenTargetIcon precedent); code-quality requires tests for changed behavior | S:65 R:90 A:80 D:75 |
| 11 | Certain | In-bar buttons are refactored to consume the same shared glyph components (one definition each); zero visual change to the bar | Stated in the description ("in-bar buttons and menu rows render one definition each"); dedupe of the inlined split-vertical SVG is called out explicitly | S:90 R:85 A:90 D:90 |

11 assumptions (5 certain, 6 confident, 0 tentative, 0 unresolved).
