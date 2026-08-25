# Intake: Tile-Header Verb Button Visibility Fix

**Change**: 260820-pjqd-tile-verb-button-visibility
**Created**: 2026-08-20

## Origin

Promptless dispatch (via `/fab-proceed`) from a user conversation in which the user reviewed a rendered HTML mock of four visual variants for the tile-header verb buttons — A (current), B (opacity-only fix), C (full fix: opacity + size + SVG glyphs), D (boxed) — in both light and dark themes, and **approved variant C**. The mock lived at the session scratchpad (`tile-verb-mock.html`, not part of the repo). The synthesized dispatch description carried measured contrast values verified against the actual theme tokens and code.

> Tile-header verb button visibility/accessibility fix: the verb buttons rendered by `VERB_BUTTON_CLASS` (app/frontend/src/components/surface-layout.tsx:271) are barely visible at rest. Drop the rest-state `opacity-65`, grow buttons 22×22 → 24×24 (header 30px → 32px), and replace the unicode verb glyphs with 14px SVGs in the existing `ControlGlyph` register (top-bar-icons.tsx). Approved mock: variant C.

## Why

**The pain point** — the tile-header verb buttons are the primary pointer affordances on every surface-layout tile (tty, web, code): find ⌕, export ⇩, the pane segment (Split H, Split V, Close Pane), zoom ⛶, promote ◧, swap ⇄, and tile-close ✕. All share one constant, `VERB_BUTTON_CLASS` (`app/frontend/src/components/surface-layout.tsx:271`), which renders them 22×22px (26×26 coarse), borderless, inheriting the header's `text-text-secondary` at `opacity-65` rest opacity. Measured contrast of that rest state over the header's `bg-bg-card`:

| Theme | Rest (`text-secondary` @ 65%) | Full-opacity `text-secondary` |
|-------|-------------------------------|-------------------------------|
| Dark (`#7a8394` over `#171b24`) | ≈2.7:1 | ≈4.5:1 |
| Light (`#6b7280` over `#ffffff`) | ≈2.5:1 | ≈4.8:1 |

The rest state fails WCAG SC 1.4.11 non-text contrast (3:1) and text AA (4.5:1); full opacity passes both — **the opacity dim alone is the difference between failing and passing**. Compounding it: the unicode glyphs (⌕ ⇩ ⛶ ◧ ⇄ ✕) render at the header's `text-[11px]` (~8px of visible ink) with platform-font-fallback-dependent stroke weight, and 22×22 fails WCAG 2.2 SC 2.5.8 Target Size Minimum (24×24 AA) — the pane-segment buttons sit adjacent with no gap, so the spacing exception does not apply.

**If not fixed** — users on either theme cannot reliably discover or hit the layout/pane verbs; the accessibility failures are measurable, not aesthetic taste.

**Why this approach** — the user compared four rendered variants in both themes and chose C (full fix). Opacity-only (B) passes contrast but leaves sub-minimum targets and inconsistent unicode ink; boxed (D) had the highest discoverability but the busiest chrome. C fixes all three measured failures while keeping the existing hover vocabulary.

## What Changes

All three parts modify the shared constant and its consumers, so tty/web/code headers are fixed simultaneously. `VERB_BUTTON_CLASS` stays a **single constant**.

### 1. Drop the rest-state opacity dim

`VERB_BUTTON_CLASS` currently:

```
inline-flex items-center justify-center h-[22px] w-[22px] coarse:h-[26px] coarse:w-[26px] rounded opacity-65 coarse:opacity-100 hover:opacity-100 focus-visible:opacity-100 hover:bg-bg-inset transition-opacity
```

- Remove `opacity-65` — rest becomes full-opacity `text-text-secondary` (inherited from the header). The now-redundant `coarse:opacity-100 hover:opacity-100 focus-visible:opacity-100 transition-opacity` classes go with it.
- Hover keeps the existing treatment: `text-text-primary` + `bg-bg-inset` (destructive verbs — Close Pane, tile ✕ — keep `hover:text-signal-red`).
- **Do NOT re-introduce a dim via a lighter alpha** (e.g. `text-text-secondary/80`) — alpha compounds against whatever is behind it. If a muted rest look is ever wanted, it must be a solid color token tuned to ≥3:1 in both themes. This is a decided constraint, not a preference.
- Update the constant's doc comment (currently documents the 65% rest opacity as intentional, citing 260812-wfic R4) to record the new contract: visible at rest at full opacity, contrast-passing in both themes.

### 2. Grow targets to 24×24 (header 30px → 32px)

- Verb buttons: `h-[22px] w-[22px]` → `h-[24px] w-[24px]` (meets SC 2.5.8 AA). Coarse stays `coarse:h-[26px] coarse:w-[26px]` (already ≥24).
- Tile header row (`surface-layout.tsx:1370`): `h-[30px]` → `h-[32px]` — the approved mock used 32px.
- Pane-segment bordered wrapper (`surface-layout.tsx:1507`): `h-6` (24px) → 26px so the 24px buttons fit inside its border.

### 3. Replace unicode verb glyphs with `ControlGlyph` SVGs

New glyphs in the existing register `app/frontend/src/components/top-bar-icons.tsx`, following its conventions (14px rendered, `currentColor`, 24-viewBox strokeWidth-2 defaults, `aria-hidden`, kebab-case `data-icon` test seam, bar↔menu parity per the file's header comment):

| Verb | Today | New glyph | Design |
|------|-------|-----------|--------|
| Find | `&#x2315;` (⌕) | `FindGlyph` (`data-icon="find"`) | lucide `search`: circle + handle |
| Export | ⇩ | `ExportGlyph` (`data-icon="export"`) | lucide `arrow-down-to-line` style |
| Zoom | ⛶ | `ZoomGlyph` (`data-icon="zoom"`) | lucide `maximize` corner brackets |
| Promote | ◧ | `PromoteGlyph` (`data-icon="promote"`) | square with left-half divider (custom path in the register idiom) |
| Swap | ⇄ | `SwapGlyph` (`data-icon="swap"`) | lucide `arrow-left-right` |
| Tile close | ✕ | `TileCloseGlyph` (`data-icon="tile-close"`) | lucide `x` |

Split H / Split V / Close Pane already use real SVG paths (`SplitHorizontalGlyph`, `SplitVerticalGlyph`, `ClosePaneBoxedGlyph`) — unchanged. Exact glyph export names may follow the register's existing naming, but the `data-icon` values are the test seam and should be stable kebab-case as above.

### Behavior that MUST survive the refactor

- Find button open state: `text-accent-green` when `findOpen` (`surface-layout.tsx:1420-1421`; the `opacity-100` suffix there becomes dead once rest opacity is gone and is removed with it), plus `aria-pressed`.
- Zoom active state: `text-accent-green` while zoomed (`surface-layout.tsx:1552-1553`), same dead `opacity-100` cleanup.
- All existing `aria-label`s, `aria-haspopup`/`aria-expanded` on export, and `Tip` tooltips.
- The misclick-trap distinction between `ClosePaneBoxedGlyph` (boxed square-x, kills the tmux pane) and the bare tile-close ✕→`TileCloseGlyph` — the two destructive closes never share a shape (existing close-distinction contract).
- Primary-tty-only gating of find/export, arity>1 gating of layout verbs (`showVerbs`), zoomed-tile promote/swap hiding — untouched.

### Out of scope (explicit)

- The web tile URL-row buttons (`iframe-window.tsx` ~507-574, `w-7 h-7`, full-opacity `text-secondary`) already pass contrast; unifying their unicode glyphs onto the same SVG register is a noted follow-up, **not** part of this change.
- No change to verb semantics, palette entries, keybindings, or the surface-layout spec's tile-verb model — visual treatment only.

## Affected Memory

- `run-kit/ui/lenses-and-layout`: (modify) tile-header chrome — VERB_BUTTON_CLASS rest-state contract (full opacity, 24×24, 32px header), glyph swap to the SVG register
- `run-kit/ui/top-bar`: (modify) `top-bar-icons.tsx` ControlGlyph register gains six tile-verb glyphs (find/export/zoom/promote/swap/tile-close)
- `run-kit/ui/visual-design`: (modify) record the no-alpha-dim-at-rest contrast rule (solid tokens tuned ≥3:1 per theme, never opacity) and the 24×24 minimum verb target

## Impact

- **Code**: `app/frontend/src/components/surface-layout.tsx` (VERB_BUTTON_CLASS:271, header row:1370, pane-segment:1507, ten button call sites 1413-1597), `app/frontend/src/components/top-bar-icons.tsx` (six new glyph exports).
- **Unit tests**: `app/frontend/src/components/surface-layout.test.tsx` — at least one assertion on glyph text content (`expect(unzoom.textContent).toBe("⛶")` at :404) must move to the `data-icon` seam; sweep for other textContent/glyph-string assertions.
- **E2E**: `tests/e2e/surface-layout.spec.ts`, `terminal-export.spec.ts`, `terminal-tile-find.spec.ts`, `web-tile-find.spec.ts` locate these buttons by `aria-label`/role, so they should pass unchanged — but comments and any glyph-text locators need a sweep; per the constitution, any modified `.spec.ts` updates its sibling `.spec.md` in the same commit.
- **Visual**: header grows 30→32px on desktop tile headers (header is desktop-only chrome); no mobile layout change beyond the coarse sizes already in place.
- **Verification**: Vitest for the seam changes; `just test-e2e` for the affected specs; both-theme visual check per the Playwright-driven-development workflow.

## Open Questions

*(none — promptless dispatch; no decision scored Unresolved)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Drop rest `opacity-65` entirely; full-opacity `text-text-secondary` at rest; never re-add an alpha dim | User approved variant C from a both-themes rendered mock; measured contrast data makes this the decided fix, and the no-alpha rule was stated verbatim | S:95 R:85 A:90 D:95 |
| 2 | Certain | Keep `VERB_BUTTON_CLASS` a single shared constant styling every tile kind | Explicit constraint in the approved description; matches the existing pattern | S:95 R:85 A:95 D:95 |
| 3 | Certain | Buttons 22×22 → 24×24; coarse stays 26×26 | SC 2.5.8 AA target and the approved mock both fix 24; coarse already ≥24 | S:90 R:85 A:90 D:90 |
| 4 | Confident | Header 30px → 32px and pane-segment wrapper 24px → 26px | Description says the header "may grow to 32px"; the mock the user approved rendered 32px, so the front-runner is clear | S:80 R:85 A:75 D:75 |
| 5 | Certain | Six unicode glyphs → 14px `ControlGlyph` SVGs in top-bar-icons.tsx with the listed designs; split/close-pane glyphs untouched | Designs specified per-glyph in the approved description; register conventions verified in source | S:90 R:80 A:90 D:85 |
| 6 | Confident | Promote glyph is a custom path (square + left-half divider) drawn in the register's 24-viewBox strokeWidth-2 idiom | No exact lucide equivalent; description specifies the shape, register parameterization verified | S:75 R:85 A:80 D:70 |
| 7 | Confident | Web tile URL-row glyph unification is out of scope, recorded as follow-up | Description delegates the call ("your judgment"); smallest-scope default keeps the change reviewable | S:75 R:90 A:80 D:75 |
| 8 | Certain | Preserve find/zoom active states (accent-green), aria attributes, Tips, and the close-distinction contract; drop only the now-dead `opacity-100` suffixes | Explicit survive-the-refactor constraints; dead-class cleanup follows mechanically from removing rest opacity | S:90 R:85 A:90 D:90 |
| 9 | Confident | Tests move glyph-content assertions to the `data-icon` seam; e2e specs (aria-label locators) expected unchanged, swept + `.spec.md` updated if touched | `data-icon` is the stated test seam; one unit assertion found at surface-layout.test.tsx:404; constitution's `.spec.md` rule applies | S:80 R:90 A:85 D:80 |

9 assumptions (5 certain, 4 confident, 0 tentative, 0 unresolved).
