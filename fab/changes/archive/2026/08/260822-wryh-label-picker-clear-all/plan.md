# Plan: Label Picker Panel-Level − (Clear All Axes)

**Change**: 260822-wryh-label-picker-clear-all
**Intake**: `intake.md`

## Requirements

### Label Picker: Panel-Level Clear-All

#### R1: The panel header row carries a − clear-all cell
The panel header row in `app/frontend/src/components/swatch-popover.tsx` (composite preview + ✕) MUST gain a − clear-all cell between the preview and ✕, in exactly the band-header clear-cell treatment (`&#x2212;` at fontSize 10, `text-text-secondary hover:text-text-primary`, `bg-bg-inset`, `CELL` geometry, `role="option"`, `Tip` + `aria-label="Clear all"`). It MUST render on every caller variant, including color-only (where it degenerates to clear-color).

- **GIVEN** the picker is open on any caller
- **WHEN** the header row renders
- **THEN** the order is preview · − (Clear all) · ✕ (Close picker)

#### R2: Clicking clear-all emits only the offered clears; picker stays open
Activation MUST emit `emit(null)` always, `onSelectMarker("")` only when `onSelectMarker` is supplied, `onSelectFlair("")` only when `onSelectFlair` is supplied — setting the corresponding preview overrides so the composite preview and combo caption drop to the unset state immediately (`∅ · ∅ · ∅` on the full variant). No new props, no dismissal.

- **GIVEN** a full-variant picker showing `teal · hatch · scan`
- **WHEN** the − clear-all is clicked
- **THEN** the three callbacks fire with their clear values, the caption reads `∅ · ∅ · ∅`, and the picker remains open

#### R3: Ring rule — the panel − rings when every offered axis is unset
`aria-selected` + `ring-1 ring-text-primary` MUST be computed from props (`selectedValue == null`, and where offered `currentMarker === ""` / `currentFlair === ""`), matching the band-header `isUnset` idiom, so after the caller echoes a clear-all the panel − and all offered band −s ring together.

- **GIVEN** all offered axes unset via props
- **WHEN** the header renders
- **THEN** the panel − is `aria-selected` and ringed; setting any one axis removes the ring

#### R4: Keyboard — the stack's top row becomes [− clear-all] [✕ close]
Grid row 0 MUST become `[cellId("clear-all"), cellId("close")]`: ArrowLeft/Right move within it, ArrowUp from the color band's header − lands on it (existing goal-column model), Enter/Space activates via the `activate` callback. All other row indices are unchanged.

- **GIVEN** keyboard focus on the color header −
- **WHEN** ArrowUp then ArrowRight then Enter
- **THEN** focus walks − → ✕ and Enter closes; Enter on the − instead clears all offered axes

#### R5: Docs ride along
`docs/specs/themes.md` picker section gains the panel-level − sentence; `docs/wiki/picker-layout-studies.html` is synced from this change's `assets/picker-layout-studies.html` (iteration-5 + third-shade study sections; the shade study documents a separate pending change). E2E spec changes only if chrome assertions require it — additive-or-none, with the `.spec.md` sibling in the same commit if touched.

### Non-Goals

- No backend change (null/"" are the existing clear vocabulary — verified).
- Nothing from the third-shade study beyond the wiki page carrying its documentation.

## Tasks

### Phase 2: Core Implementation

- [x] T001 swatch-popover.tsx: add the − clear-all cell to the header row (preview · − · ✕), `allUnset` ring rule from props, grid row 0 → `[clear-all, close]`, `activate` handles `clear-all` (emit(null) + offered marker/flair clears with overrides) <!-- R1, R2, R3, R4 -->

### Phase 3: Integration & Edge Cases

- [x] T002 swatch-popover.test.tsx: new tests — offered-clears-only emission per variant (full / color+flair / color-only), ring rule, keyboard top-row walk + Enter activation, stays-open + caption `∅ · ∅ · ∅` <!-- R2, R3, R4 -->
- [x] T003 [P] Docs: themes.md panel-level − sentence; sync docs/wiki/picker-layout-studies.html from assets/picker-layout-studies.html; check window-marker-gutter.spec.ts for needed chrome-assertion updates (additive-or-none; `.spec.md` same commit if touched) <!-- R5 -->

### Phase 4: Polish

- [x] T004 Gates: `just test-frontend`, `npx tsc --noEmit`; window-marker-gutter e2e on a private rig (3020 conflict-safe) if the shared rig is busy <!-- R1 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: The − clear-all cell renders between preview and ✕ on all caller variants with the band-clear treatment and accessible name "Clear all"
- [x] A-002 R2: Clicking it emits exactly the offered clears (three on full, two on color+flair, one on color-only); the picker stays open and the caption drops to the unset state

### Behavioral Correctness

- [x] A-003 R3: The ring appears iff every offered axis is unset (props-computed); after clear-all + caller echo, panel − and band −s ring together
- [x] A-004 R4: Top row is keyboard-reachable: ArrowUp from the color header − lands on it, ArrowLeft/Right walk − ↔ ✕, Enter/Space activates

### Scenario Coverage

- [x] A-005 R5: themes.md names the panel-level −; the wiki page matches the assets copy byte-for-byte

### Code Quality

- [x] A-006 Pattern consistency: the cell reuses the BandHeader clear-cell treatment and existing cellId/activate idioms; no new components
- [x] A-007 No unnecessary duplication: the write path reuses `emit` and the existing override setters

## Notes

- Check items as you review: `- [x]`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Grid row 0 gains a cell instead of a new row — all existing row indices (initial focus at {row:1..3}) stay valid | Verified against the grid useMemo (rows[0] = [close]); minimal-diff keyboard change | S:75 R:90 A:90 D:80 |
| 2 | Confident | Band-clear activation currently skips override-setting for marker/flair clears; clear-all DOES set overrides per the intake's immediacy requirement — band-clear behavior left as-is (out of scope) | Intake §3 specifies overrides for clear-all; changing band clears would widen scope | S:65 R:85 A:80 D:70 |

2 assumptions (0 certain, 2 confident, 0 tentative).
