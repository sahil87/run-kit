# Plan: Tile-Header Verb Button Visibility Fix

**Change**: 260820-pjqd-tile-verb-button-visibility
**Intake**: `intake.md`

## Requirements

### Surface Layout: Verb button rest-state visibility

#### R1: Full-opacity rest state, no alpha dim
`VERB_BUTTON_CLASS` (`app/frontend/src/components/surface-layout.tsx`) MUST render verb buttons at full opacity at rest, inheriting the header's `text-text-secondary`. The `opacity-65` rest dim and its now-dead companions (`coarse:opacity-100`, `hover:opacity-100`, `focus-visible:opacity-100`, `transition-opacity`) SHALL be removed. Hover keeps `text-text-primary` + `bg-bg-inset` (destructive verbs keep `hover:text-signal-red`). A rest-state alpha dim MUST NOT be reintroduced in any form (e.g. `text-text-secondary/80`); a muted rest look, if ever wanted, must be a solid color token tuned to ≥3:1 in both themes. The constant's doc comment MUST record the new contract (full-opacity rest, contrast-passing in both themes) in place of the 65%-opacity rationale.

- **GIVEN** a tile header (tty, web, or code) in either theme
- **WHEN** the verbs render at rest (no hover, no focus)
- **THEN** each glyph renders full-opacity `text-text-secondary` (≈4.5:1 dark / ≈4.8:1 light over `bg-bg-card` — passes WCAG SC 1.4.11 and text AA)
- **AND** hovering shows `text-text-primary` on `bg-bg-inset` (signal-red for Close Pane / tile ✕)

#### R2: 24×24 targets; header and segment grow to fit
Verb buttons MUST be `h-[24px] w-[24px]` (WCAG 2.2 SC 2.5.8 AA), keeping `coarse:h-[26px] coarse:w-[26px]`. The tile header row SHALL grow `h-[30px]` → `h-[32px]`, and the pane-segment bordered wrapper `h-6` (24px) → `h-[26px]` so the 24px buttons fit inside its border. Comments referencing the 30px header height SHALL be updated.

- **GIVEN** a desktop tile header
- **WHEN** measured
- **THEN** every verb button is 24×24 (26×26 coarse), the header is 32px, the pane segment 26px, and no button clips its container

### Surface Layout: SVG verb glyphs

#### R3: Six unicode glyphs become ControlGlyph SVGs
The six unicode verb glyphs MUST be replaced with 14px SVG components in the existing `ControlGlyph` register (`app/frontend/src/components/top-bar-icons.tsx` — `currentColor`, 24-viewBox strokeWidth-2 defaults, `aria-hidden`, kebab-case `data-icon` test seam):

| Verb | Today | New export | `data-icon` | Design |
|------|-------|-----------|-------------|--------|
| Find | `&#x2315;` | `FindGlyph` | `find` | lucide `search` (circle + handle) |
| Export | ⇩ | `ExportGlyph` | `export` | lucide arrow-down-to-line style |
| Zoom | ⛶ | `ZoomGlyph` | `zoom` | lucide `maximize` corner brackets |
| Promote | ◧ | `PromoteGlyph` | `promote` | square + left-half divider (custom, register idiom) |
| Swap | ⇄ | `SwapGlyph` | `swap` | lucide `arrow-left-right` |
| Tile close | ✕ | `TileCloseGlyph` | `tile-close` | lucide `x` |

`SplitHorizontalGlyph`, `SplitVerticalGlyph`, and `ClosePaneBoxedGlyph` are already SVG and SHALL NOT change.

- **GIVEN** the tile header renders its verbs
- **WHEN** inspected
- **THEN** each verb carries an `svg[data-icon]` child per the table, rendered at 14px from `currentColor`
- **AND** no unicode verb glyph remains in the surface-layout verb buttons

#### R4: Existing behavior survives the refactor
The refactor MUST preserve: the find button's open state (`text-accent-green` when open, `aria-pressed`); the zoom button's zoomed state (`text-accent-green`); all `aria-label`s, export's `aria-haspopup`/`aria-expanded`, and `Tip` tooltips; the close-distinction contract (boxed `ClosePaneBoxedGlyph` vs bare-x `TileCloseGlyph` — the two destructive closes never share a shape); primary-tty-only gating of find/export, arity>1 gating of layout verbs, and zoomed-tile promote/swap hiding. The `opacity-100` suffixes in the findOpen/isZoomed conditional classes become dead with the rest dim removed and SHALL be dropped with it.

- **GIVEN** the find bar is open (or a tile is zoomed)
- **WHEN** the header renders
- **THEN** the ⌕ (or ⛶) button shows `text-accent-green` with correct `aria-pressed`, exactly as before

### Tests: seam migration

#### R5: Glyph assertions move to the data-icon seam
Unit assertions on glyph text content MUST migrate to the `data-icon` seam — the known site is `surface-layout.test.tsx:404` (`expect(unzoom.textContent).toBe("⛶")`); the file SHALL be swept for any others. E2E specs locate these buttons by `aria-label`/role and are expected to pass unchanged; if any `.spec.ts` is modified, its sibling `.spec.md` MUST be updated in the same commit (constitution).

- **GIVEN** the migrated unit suite
- **WHEN** `surface-layout.test.tsx` runs
- **THEN** glyph identity is asserted via `svg[data-icon=…]`, and the full suite passes

### Non-Goals
- Web tile URL-row buttons (`iframe-window.tsx` ~507-574) — already contrast-passing; glyph unification is a noted follow-up.
- No change to verb semantics, palette entries, keybindings, or the surface-layout spec's tile-verb model — visual treatment only.

### Design Decisions

#### No alpha dim at rest on tile-header verbs
**Decision**: Verb buttons render full-opacity `text-text-secondary` at rest; muted looks must be solid tokens tuned ≥3:1 per theme, never opacity.
**Why**: The 65% dim dropped measured contrast from ≈4.5:1/≈4.8:1 (pass) to ≈2.7:1/≈2.5:1 (fails SC 1.4.11 and text AA); alpha compounds against whatever is behind it, so a "safer" dim cannot be tuned once for both themes.
**Rejected**: A lighter dim (e.g. `/80`) — still alpha, still theme-dependent; a boxed rest border (mock variant D) — highest discoverability but busiest chrome, user chose C.
*Introduced by*: 260820-pjqd-tile-verb-button-visibility

#### Tile verb glyphs live in the ControlGlyph register
**Decision**: The six new SVGs are exports of `top-bar-icons.tsx`, not a new module or inline SVGs in `surface-layout.tsx`.
**Why**: The register already owns the pane-segment glyphs the same header renders, carries the conventions (currentColor, data-icon seam, parameterized wrapper), and keeps bar↔header glyph vocabulary in one place.
**Rejected**: Inline SVGs at the call sites — duplicates the wrapper attributes ten times and loses the test seam convention.
*Introduced by*: 260820-pjqd-tile-verb-button-visibility

## Tasks

### Phase 2: Core Implementation

- [x] T001 [P] Add `FindGlyph`, `ExportGlyph`, `ZoomGlyph`, `PromoteGlyph`, `SwapGlyph`, `TileCloseGlyph` to `app/frontend/src/components/top-bar-icons.tsx` per the R3 table (ControlGlyph defaults, kebab-case `data-icon`, doc comments in the file's register idiom) <!-- R3 -->
- [x] T002 Update `VERB_BUTTON_CLASS` in `app/frontend/src/components/surface-layout.tsx`: drop `opacity-65 coarse:opacity-100 hover:opacity-100 focus-visible:opacity-100 transition-opacity`, size `h-[24px] w-[24px]` (coarse unchanged), add `transition-colors`; rewrite the doc comment to the new full-opacity/24px contract <!-- R1 -->
- [x] T003 In `surface-layout.tsx`: header row `h-[30px]` → `h-[32px]` (+ the 30px comment at the file top), pane segment `h-6` → `h-[26px]`; swap the six unicode glyphs at the verb call sites (~1413-1597) for the new components; drop the dead `opacity-100` suffixes in the findOpen/isZoomed conditional classes <!-- R2 -->
- [x] T004 Migrate glyph-content assertions in `app/frontend/src/components/surface-layout.test.tsx` to the `data-icon` seam (known: :404 ⛶ assertion; sweep the file for others) and update test names/comments that name unicode glyphs where misleading <!-- R5 -->
- [x] T005 Verify: `pnpm vitest run surface-layout` (frontend dir), `npx tsc --noEmit`, then `just test-e2e` for `surface-layout.spec.ts`, `terminal-export.spec.ts`, `terminal-tile-find.spec.ts`, `web-tile-find.spec.ts`; update any touched `.spec.md` <!-- R5 -->

## Execution Order

- T001 blocks T003 (call sites import the new glyphs); T002 is independent of T001 but same-file as T003 — run T002+T003 together after T001. T004 after T003; T005 last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `VERB_BUTTON_CLASS` carries no rest-state opacity class; verbs render full-opacity `text-text-secondary` at rest with the hover treatment intact
- [x] A-002 R2: Verb buttons are 24×24 (26×26 coarse), the header row 32px, the pane-segment wrapper 26px; nothing clips
- [x] A-003 R3: All six verbs render their `data-icon` SVGs; no unicode verb glyph remains in surface-layout verb buttons; split/close-pane glyphs byte-unchanged

### Behavioral Correctness

- [x] A-004 R4: Find open state and zoom state show accent-green with correct `aria-pressed`; all aria attributes, Tips, and the boxed-vs-bare close-shape distinction survive; primary-tty/arity/zoom gating unchanged (unit suite proves)

### Scenario Coverage

- [x] A-005 R5: `surface-layout.test.tsx` glyph assertions migrated to `data-icon`; full unit suite green; affected e2e specs green; `.spec.md` siblings updated iff their `.spec.ts` changed

### Edge Cases & Error Handling

- [x] A-006 R1: Coarse-pointer rendering unchanged in behavior (26×26, full opacity — previously already full opacity via `coarse:opacity-100`); no `transition-opacity` remains to animate a now-constant property

### Code Quality

- [x] A-007 Pattern consistency: new glyphs follow the ControlGlyph register conventions (naming, doc comments, data-icon)
- [x] A-008 No unnecessary duplication: glyphs reuse the `ControlGlyph` wrapper; no inline SVG at call sites
- [x] A-009 Comment discipline: updated doc comments state the contract (constraints), not narration or change provenance beyond the register's existing idiom

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — the change replaced inline unicode glyph literals with register components and restyled one shared constant; no existing symbol, file, or branch was left orphaned or redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | One `ZoomGlyph` serves both zoom and unzoom (state carried by accent-green + aria-label, as today with ⛶) | Today's behavior verbatim; the glyph never flipped with state | S:90 R:90 A:90 D:90 |
| 2 | Confident | `transition-colors` replaces `transition-opacity` in `VERB_BUTTON_CLASS` | Hover now changes color/background only; the top-bar button token uses the same class | S:80 R:90 A:85 D:80 |
| 3 | Certain | Header font stays `text-[11px]`; glyph size is fixed by the 14px SVGs, not font size | Only the six verb glyphs were font-sized; labels/meta keep today's scale | S:85 R:90 A:90 D:85 |
| 4 | Confident | The find-bar/export-menu positioning is unaffected by the 2px header growth (menu uses fixed positioning from the button rect; find bar renders below the header in flow) | Verified both mechanisms in source; 2px shifts are absorbed by rect-derived positioning | S:80 R:85 A:85 D:75 |

4 assumptions (2 certain, 2 confident, 0 tentative).
