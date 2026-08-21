# Plan: Web Tile URL-Bar Glyphs Join the ControlGlyph Register

**Change**: 260821-76uz-web-tile-url-bar-glyphs
**Intake**: `intake.md`

## Requirements

### Iframe Window: URL-bar glyphs from the register

#### R1: Three new ControlGlyph exports
`app/frontend/src/components/top-bar-icons.tsx` MUST gain three exports on the `ControlGlyph` wrapper's 24-viewBox / strokeWidth-2 defaults (`currentColor`, `aria-hidden`, kebab-case `data-icon`, doc comments in the file's idiom):

| Export | `data-icon` | Paths (verbatim) |
|---|---|---|
| `WebBackGlyph` | `web-back` | `<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>` |
| `WebForwardGlyph` | `web-forward` | `<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>` |
| `OpenExternalGlyph` | `open-external` | `<path d="M7 7h10v10"/><path d="M7 17 17 7"/>` |

The `data-icon` values are the stable, user-approved test seam. Existing exports and the wrapper SHALL NOT change.

- **GIVEN** the register module
- **WHEN** the three components render
- **THEN** each emits a 14px `svg[data-icon]` per the table, stroke `currentColor`

#### R2: URL-bar buttons render register SVGs
The five URL-bar buttons in `app/frontend/src/components/iframe-window.tsx` (~495–580) MUST swap their `<span className="text-sm">` unicode children for register components: Back → `<WebBackGlyph />`, Forward → `<WebForwardGlyph />`, Refresh → `<RefreshGlyph />` (reuse), Find → `<FindGlyph />` (reuse), Open in browser → `<OpenExternalGlyph />`. No unicode glyph remains in these buttons.

- **GIVEN** a same-origin web tile
- **WHEN** the URL bar renders
- **THEN** the five buttons carry `svg[data-icon="web-back"|"web-forward"|"refresh"|"find"|"open-external"]` respectively
- **AND** on a cross-origin frame, back/forward stay hidden exactly as today

#### R3: Hover brighten, states preserved
All five buttons MUST add `hover:text-text-primary` (the tile-verb hover contract), keeping `hover:bg-bg-card`. The find button keeps `text-accent-green` when `findOpen` else `text-text-secondary`, plus `aria-pressed={findOpen}`. Geometry (`w-7 h-7`, layout, order), aria-labels, `Tip` labels, the `TipGroup` cluster, click handlers, the address input, and the error alert are untouched.

- **GIVEN** the find bar is open
- **WHEN** the URL bar renders
- **THEN** the find button is accent-green with `aria-pressed="true"`, and every button brightens to `text-text-primary` on hover

### Tests: data-icon seam coverage

#### R4: Glyph identity proven via the seam
`app/frontend/src/components/iframe-window.test.tsx` MUST assert the five buttons' `svg[data-icon]` identities (the pjqd precedent). Existing selectors are aria-label-based and pass unchanged (glyphs appear only in test titles — titles MAY be updated where the unicode naming becomes misleading). No `.spec.ts` is expected to change; if one is touched, its `.spec.md` sibling updates in the same commit (constitution).

- **GIVEN** the updated unit suite
- **WHEN** the same-origin URL-bar test runs
- **THEN** each button's glyph is asserted by `data-icon`, and the full suite passes

### Non-Goals
- Contrast/size changes — 28×28 full-opacity `text-secondary` already passes; geometry unchanged.
- The code-surface tile (no URL bar) and chat view.
- Any behavior, layout, or handler changes.

### Design Decisions

#### Web-tile chrome consumes the shared glyph register
**Decision**: The URL bar's back/forward/open-external join `top-bar-icons.tsx` as register exports; refresh and find REUSE `RefreshGlyph`/`FindGlyph` rather than getting web-local copies.
**Why**: One glyph vocabulary across the chrome is the register's charter; reuse gives refresh top-bar parity and find one identity across the tty tile and web tile for free.
**Rejected**: Inline SVGs in `iframe-window.tsx` — duplicates wrapper attributes and loses the `data-icon` seam convention; a web-local icon module — a second register to drift.
*Introduced by*: 260821-76uz-web-tile-url-bar-glyphs

## Tasks

### Phase 2: Core Implementation

- [x] T001 [P] Add `WebBackGlyph`, `WebForwardGlyph`, `OpenExternalGlyph` to `app/frontend/src/components/top-bar-icons.tsx` per the R1 table (register idiom doc comments naming the lucide source and the URL-bar consumer) <!-- R1 -->
- [x] T002 In `app/frontend/src/components/iframe-window.tsx`: import the five glyph components, swap the five `<span>` unicode children per R2, add `hover:text-text-primary` to all five button classNames (find's conditional split preserved) <!-- R2 -->
- [x] T003 In `app/frontend/src/components/iframe-window.test.tsx`: add `svg[data-icon]` assertions for the five buttons in the same-origin URL-bar test (~:517) and update test titles that name unicode glyphs where misleading <!-- R4 -->
- [x] T004 Verify: frontend Vitest (iframe-window suite, then full), `npx tsc --noEmit`, `just test-e2e "web-tile-find.spec.ts web-view-lens.spec.ts"` <!-- R4 -->

## Execution Order

- T001 blocks T002; T003 after T002; T004 last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: The three new register exports render 14px `currentColor` SVGs with the exact `data-icon` values; wrapper and existing exports byte-unchanged
- [x] A-002 R2: All five URL-bar buttons render their register SVGs; no unicode glyph remains in these buttons; cross-origin hiding of back/forward unchanged

### Behavioral Correctness

- [x] A-003 R3: `hover:text-text-primary` added to all five while `hover:bg-bg-card` stays; find open state (accent-green + `aria-pressed`) and every aria-label/Tip/handler survive; geometry and bar layout untouched

### Scenario Coverage

- [x] A-004 R4: Unit suite asserts each button's `data-icon`; full frontend suite green; `web-tile-find.spec.ts` + `web-view-lens.spec.ts` green; `.spec.md` untouched unless its `.spec.ts` changed

### Code Quality

- [x] A-005 Pattern consistency: new glyphs follow the register conventions (naming, doc comments, data-icon); no inline SVG at call sites
- [x] A-006 No unnecessary duplication: refresh/find reuse existing exports; no web-local icon module

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — the unicode `<span>` glyphs this change retired were deleted in place as part of the swap; no other existing code was made redundant or unused.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Export names `WebBackGlyph`/`WebForwardGlyph`/`OpenExternalGlyph` (intake's suggested names; the data-icon seam is what's pinned) | Names match the register's `<Consumer><Verb>Glyph` idiom; seam fixed by intake | S:90 R:90 A:90 D:90 |
| 2 | Confident | The five buttons keep their exact className strings apart from appending `hover:text-text-primary` (no shared constant extracted) | Five near-identical strings exist today; extracting a constant is a refactor beyond the approved scope — parity with the intake's "no logic changes" | S:75 R:90 A:85 D:80 |

2 assumptions (1 certain, 1 confident, 0 tentative).
