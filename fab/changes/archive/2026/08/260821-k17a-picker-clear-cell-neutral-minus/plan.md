# Plan: Label Picker Clear-Cell Neutral Minus

**Change**: 260821-k17a-picker-clear-cell-neutral-minus
**Intake**: `intake.md`

## Requirements

### Label Picker: Header Clear-Cell Glyph

#### R1: Neutral minus glyph in the ✕ treatment
The three band-header clear cells (color / marker / flair — all rendered by `BandHeader` in `app/frontend/src/components/swatch-popover.tsx`) MUST render `−` (U+2212 MINUS SIGN, `&#x2212;` — not the ASCII hyphen) in place of `∅` (`&#x2205;`). Everything else about the cell MUST stay byte-identical: the `text-text-secondary hover:text-text-primary` color pair (already the ✕ close button's treatment), `bg-bg-inset`, the 10px glyph size, `role="option"`, `aria-selected={isUnset}`, the unset ring, the focus ring, the `Tip`, and the accessible names (`Clear color` / `Marker none` / `Flair none`).

- **GIVEN** the Label picker is open on any caller (window row, session row, server color-only)
- **WHEN** any band header renders
- **THEN** its clear cell shows `−`, secondary-colored, brightening to primary on hover
- **AND** clicking it clears that axis exactly as before, with the unset ring behavior unchanged

#### R2: ∅ keeps exactly one job — the caption state token
The composite preview's combo caption MUST continue rendering `∅` for unset axes (`swatch-popover.tsx` caption fallbacks — e.g. `teal · ∅ · scan`). No caption code and no caption test assertion (`∅ · ∅ · ∅` in `swatch-popover.test.tsx` and `window-marker-gutter.spec.ts`) changes.

- **GIVEN** an axis is unset
- **WHEN** the combo caption renders
- **THEN** that axis's token is `∅`, unchanged

#### R3: Wording rides along; behavior artifacts stay untouched
Comments, test names, and docs that call the header cell "∅" SHALL be reworded to the minus, with zero test-assertion changes: `swatch-popover.tsx` doc comments, `sidebar/index.tsx:2750` comment, test-name/comment wording in `swatch-popover.test.tsx` / `sidebar/index.test.tsx:2076` / `settings-dialog.test.tsx:408`, comments in `tests/e2e/window-marker-gutter.spec.ts`, and — same commit, per the constitution's Test Companion Docs rule — `window-marker-gutter.spec.md`. Spec/wiki docs update: `docs/specs/themes.md:170,179` (line 169's caption ∅ stays), `docs/wiki/picker-layout-studies.html` synced from this change's `assets/picker-layout-studies.html`, and the page's one-line description in `docs/specs/index.md` extended to mention the glyph strip. (Memory files are hydrate's scope, not apply's.)

- **GIVEN** the change is applied
- **WHEN** grepping the touched code/spec/wiki files for header-cell "∅" wording
- **THEN** only the caption's state-token ∅ references remain

### Design Decisions

#### Neutral minus over ∅ and over red minus
**Decision**: The header clear cells render a neutral `−` in the ✕ close button's treatment; ∅ survives only as the caption's unset-state token.
**Why**: The header cell is an ACTION ("clear this axis"); ∅ is a STATE symbol — one glyph carrying both meanings was a permanent legibility tax. ✕/− now form a verb pair: ✕ closes the panel, − clears the axis.
**Rejected**: Red minus (user's own alternative) — red is this UI's kill/danger vocabulary, clearing a label is cheap and reversible, and the hover accent here is green; a red glyph over-signals and has no hover story. Recorded in the design study's glyph-comparison strip.
*Introduced by*: 260821-k17a-picker-clear-cell-neutral-minus

### Non-Goals

- No aria, layout, keyboard-model, handler, backend, or stored-value changes — visual glyph only.
- No change to the strips' value cells or to any ∅ used as a state token.

## Tasks

### Phase 2: Core Implementation

- [x] T001 Swap `&#x2205;` → `&#x2212;` in `BandHeader` (`app/frontend/src/components/swatch-popover.tsx:133`) and reword the file's header-∅ comments (lines ~45, 49, 56, 83–84, 95–97, 198–199, 228, 522, 574 — caption comments at 394–399 keep ∅); reword the `sidebar/index.tsx:2750` comment <!-- R1, R2 -->

### Phase 3: Integration & Edge Cases

- [x] T002 [P] Reword test names/comments only (zero assertion changes): `swatch-popover.test.tsx`, `sidebar/index.test.tsx:2076`, `settings-dialog.test.tsx:408` <!-- R3 -->
- [x] T003 [P] Reword comments in `tests/e2e/window-marker-gutter.spec.ts` and update its `.spec.md` companion in the same commit <!-- R3 -->
- [x] T004 [P] Docs: `docs/specs/themes.md:170,179` wording; sync `docs/wiki/picker-layout-studies.html` from `fab/changes/260821-k17a-picker-clear-cell-neutral-minus/assets/picker-layout-studies.html`; extend the page's description in `docs/specs/index.md` to mention the glyph strip <!-- R3 -->

### Phase 4: Polish

- [x] T005 Gates, scoped to the change: `just test-frontend` (full Vitest incl. the three touched suites), `npx tsc --noEmit` in app/frontend, and `just test-e2e "window-marker-gutter"` (its .spec.ts changed) <!-- R1 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: All three band-header clear cells render `−` (U+2212) with unchanged treatment (secondary→primary hover, inset bg, 10px, rings, Tip) and unchanged accessible names
- [x] A-002 R2: The combo caption still renders `∅` for unset axes; caption code and the `∅ · ∅ · ∅` assertions are untouched

### Behavioral Correctness

- [x] A-003 R1: Clicking each header clear cell still clears exactly its axis; the unset ring still appears on the header cell

### Scenario Coverage

- [x] A-004 R3: No stale "header ∅" wording remains in the touched code, test, e2e, spec, or wiki files (grep-verifiable); `window-marker-gutter.spec.md` updated in the same commit as its `.spec.ts`

### Code Quality

- [x] A-005 Pattern consistency: the glyph entity form (`&#x2212;`) matches the file's existing entity idiom (`&#x2205;`/`&#x2715;`)
- [x] A-006 No unnecessary duplication: no new components or utilities introduced; `BandHeader` remains the single header-cell site

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)

## Deletion Candidates

- None — this change swaps one glyph entity in place and rewords comments/docs; it makes no existing file, symbol, or branch redundant

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Gates scoped to frontend (Vitest + tsc + the one changed e2e spec) — no backend/Go gate run | Change touches no Go or backend files; code-quality gate list is scoped down per the change's actual surface | S:70 R:90 A:85 D:75 |
| 2 | Confident | `docs/specs/index.md` wiki-row description IS extended (the intake marked it optional) | One-line change keeps the index honest about the page's new comparison strip; trivially reversible | S:60 R:95 A:80 D:70 |

2 assumptions (0 certain, 2 confident, 0 tentative).
