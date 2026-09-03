# Plan: Marker track and pad refinements

**Change**: 260830-hbsr-marker-track-and-pad-refinements
**Intake**: `intake.md`

## Requirements

### Row: the always-on marker track

#### R1: The track chrome renders on every window row
The 12% ink wash and the 1px 30%-ink right edge SHALL render on every window row, marked or not. Only
the *fill* (solid / hatch / chevrons) SHALL be gated on `parseMarker(marker) !== null`. The track
SHALL remain `aria-hidden` and `pointer-events-none`; it SHALL NOT become focusable or announce
itself, and the strip overlay above it SHALL keep sole ownership of interaction.

- **GIVEN** a window row whose `@rk_win_marker` is unset
- **WHEN** it renders
- **THEN** `marker-well` is present, carrying the wash and right edge
- **AND** no fill element and no chevrons render inside it
- **AND** no `.rk-hazard` wedge mounts on the row

- **GIVEN** a window row carrying `manual:2`
- **WHEN** it renders
- **THEN** `marker-well` renders with the same wash and edge as an unmarked row
- **AND** a fill renders inside it at the stage-2 width

#### R2: The hazard wedge stays gated on a blocked marker
`.rk-hazard` SHALL mount only when the displayed marker's mode is `blocked`. Making the track
unconditional SHALL NOT make the wedge unconditional.

- **GIVEN** an unmarked row and a `manual:3` row
- **WHEN** each renders
- **THEN** neither mounts `.rk-hazard`
- **AND** a `blocked:2` row does

### Row: coarse-pointer geometry

#### R3: Track width and content start are pointer-class dependent
The marker track SHALL be **22px** wide on fine pointers and **36px** on coarse. Row content SHALL
start at **30px** on fine and **44px** on coarse, preserving the 8px gap that holds the status dot's
3px waiting halo clear of the track on both classes.

- **GIVEN** a fine-pointer row
- **WHEN** it renders
- **THEN** the track is 22px wide and content begins 30px from the row's left edge

- **GIVEN** a coarse-pointer row
- **WHEN** it renders
- **THEN** the track is 36px wide and content begins 44px from the row's left edge

#### R4: Stage fill widths scale with the track
`markerFillStyle` SHALL render stage widths of **7 / 15 / 22** against a 22px track and
**12 / 24 / 36** against a 36px track, so `manual:3` and `blocked:3` fill their track exactly on both
pointer classes. The width table SHALL be supplied by the caller rather than closed over, because the
row (pointer-class dependent) and the pad cells (always the fine table) need different tables
simultaneously.

- **GIVEN** a coarse row carrying `manual:3`
- **WHEN** its fill renders
- **THEN** the fill is 36px wide — flush to the track's right edge
- **AND** the same row on a fine pointer renders a 22px fill
- **AND** a pad cell renders the fine table regardless of the row's pointer class

#### R5: Chevron geometry scales with the track
The `auto` chevron constants (width 4.2, height 10, pitch 7.2, stroke 1.8 — sized for a 22px track)
SHALL scale by the track ratio (36/22) on coarse, so `auto:N` reads as the same proportion of its
track on both pointer classes.

- **GIVEN** a coarse row carrying `auto:3`
- **WHEN** its chevrons render
- **THEN** the glyph row spans proportionally the same fraction of the 36px track as it does of the
  22px track on a fine pointer

#### R6: Every consumer of the track width follows the pointer class
The track width has three consumers — the well's `width`, the strip press-target overlay's width, and
the `anchorLeft` argument handed to `placeMarkerPad`. All three SHALL read the pointer-class-resolved
value.

- **GIVEN** a coarse row whose pad is opened
- **WHEN** the pad is placed
- **THEN** it is anchored at the coarse track's right edge (36px), not 22px
- **AND** the strip press target spans the full 36px track

### Pad: title, column headings, and label highlight

#### R7: The pad names itself and labels its stage axis
The pad's top-left cell SHALL read `Marker`. The three stage columns SHALL carry the headings `1`,
`2`, `3`, and the ∅ column SHALL be headed `∅`. The stage gloss (`early` / `mid` / `done`) SHALL
remain reachable as the column headings' accessible label.

- **GIVEN** an open pad
- **WHEN** it renders
- **THEN** its top-left reads `Marker`
- **AND** headings `∅`, `1`, `2`, `3` sit above their columns
- **AND** the stage headings carry `early` / `mid` / `done` as their accessible label

#### R8: Selection is expressed by tinting the row label and column heading
When a cell is highlighted, its **mode row label** and its **stage column heading** SHALL render in
`var(--color-marker-ink)`; every other label and heading SHALL stay `text-text-secondary`. On the ∅
cell the ∅ heading SHALL highlight and no mode label SHALL. The per-cell `ring-1 ring-text-primary`
SHALL be retained — the label tint is additive.

- **GIVEN** a pad whose highlighted cell is `auto:2`
- **WHEN** it renders
- **THEN** the `auto` row label and the `2` column heading are ink-tinted
- **AND** `manual`, `blocked`, `∅`, `1` and `3` are not
- **AND** the `auto:2` cell still carries its ring

- **GIVEN** a pad whose highlighted cell is ∅
- **WHEN** it renders
- **THEN** the `∅` heading is ink-tinted and no mode label is

#### R9: The value-echo header line is removed
The `<mode> · <gloss>` line and its `data-testid="marker-pad-header"` SHALL be removed, and the
`padHeader()` helper SHALL be deleted together with its unit test. No element SHALL render the
`<mode> · <gloss>` string.

- **GIVEN** an open pad in any state
- **WHEN** it renders
- **THEN** no `marker-pad-header` element exists and no `<mode> · <gloss>` text is present
- **AND** `padHeader` is not exported from `marker-pad.tsx`

#### R10: The pad's fit and placement are unchanged
`markerPadPopoverLayout`'s width math SHALL be untouched — the added heading row changes height only,
which the placement effect already measures. The 160px fit SHALL still yield `{152, 22, 42}` and the
pad SHALL still clamp inside the sidebar at 160px and 300px, first and last row.

- **GIVEN** a 160px sidebar
- **WHEN** the pad opens on the first and on the last visible row
- **THEN** `markerPadPopoverLayout(160)` still returns `{width: 152, cellPx: 22, labelPx: 42}`
- **AND** the placed box lies wholly inside the sidebar in both cases, and at 300px

### Design authority and memory

#### R11: The hand-authored design docs stop asserting the superseded rules
`docs/wiki/marker-3x3-studies.html` SHALL no longer state that the well is drawn only on rows that
carry a marker, nor that stage widths are universally 7 / 15 / 22. The exploration rationale SHALL be
retained — only the stated conclusion moves. `docs/specs/index.md`'s one-line description of that
study SHALL be corrected in the same edit, since it summarises the claim being changed.

**Scope boundary**: `docs/memory/` is **not** part of this requirement. Memory is written at the
**hydrate** stage from `## Requirements`, by the hydrate worker — apply neither writes nor is
accountable for it, and review MUST NOT fail this change for memory that still describes the previous
behavior. The memory updates this change implies are enumerated in `intake.md` § Affected Memory and
are hydrate's contract.

- **GIVEN** the change at review time
- **WHEN** `docs/wiki/marker-3x3-studies.html` and `docs/specs/index.md` are read
- **THEN** no surviving claim in either contradicts the shipped behavior
- **AND** the study's live demos and surrounding markup still render
- **AND** `docs/memory/**` is untouched by apply — it is hydrate's to write

### Non-Goals

- **No change to the gesture model** — press/drag/release, the wheel listener, the single-open
  registry, capture-phase dismissal, Escape-reverts, and the `marker-pad:open` palette path are all
  untouched. Their tests should pass unmodified except where a geometry constant appears.
- **No backend change** — `app/backend/` must not appear in `git diff --stat`.
- **No change to the stored vocabulary** — `parseMarker`, `formatMarker`, the twelve tokens and
  `NormalizeMarker` are final.
- **No Marker section in the row hover card** — `row-flyout-card.tsx` stays untouched.
- **No new route, settings key, or `RK_*` env var.**

### Design Decisions

#### The marker track is row chrome, not marker rendering

**Decision**: the 12% wash + 30% edge render on every window row; only the fill is gated on a parsed
marker.
**Why**: the track is the affordance that says "a marker goes here". Gating it on the marker made the
22px press/tap target invisible on exactly the rows a user most wants to mark, so phase 3 shipped a
write path that could not be discovered.
**Rejected**: drawing only the 1px edge on unmarked rows — it gives the gutter a column without
tinting the sidebar, but reads as a hairline rather than a target; and leaving the marked-rows-only
rule and teaching discovery through the palette entry alone, which abandons the pointer affordance.
*Introduced by*: 260830-hbsr-marker-track-and-pad-refinements

#### Marker geometry is pointer-class dependent

**Decision**: the track is 22px on fine and 36px on coarse, with stage fills of 7/15/22 and 12/24/36
respectively and chevrons scaled by the same ratio; content starts at 30px and 44px.
**Why**: a coarse row is 36px tall, so a 22px track renders the marker as a tall rectangle when the
design intent — and every study mock — is a square swatch. Scaling the fills with the track keeps
stage 3 flush to the edge, which is what makes the ordinal axis readable at a glance.
**Rejected**: a 36px track with the fills left at 7/15/22, which leaves a 14px dead gap at stage 3 and
breaks the "stage 3 fills the well" reading; and shrinking the coarse row to ~26px so the existing
22px track reads square, which shrinks every mobile touch target to fix a marker.
**Introduced by**: 260830-hbsr-marker-track-and-pad-refinements

#### The pad names itself; the labels carry the selection

**Decision**: the pad's top-left reads `Marker`, stage columns are headed `1`/`2`/`3`, and the
highlighted cell tints its mode-row label and stage-column heading in the marker ink. The
`<mode> · <gloss>` header line is deleted.
**Why**: the top-left is where a reader looks for the name of the surface, and spending it on the
current value duplicated what the highlight ring already showed. Tinting the two labels states the
selection on the axes themselves, which also labels the previously unlabelled ordinal axis.
**Rejected**: keeping the value line and adding a separate title row, which costs a second line of a
pad that must fit a 160px sidebar; and labelling columns with the gloss words (`early`/`mid`/`done`),
which does not fit the cell width — the gloss is retained as the headings' accessible label instead.
*Introduced by*: 260830-hbsr-marker-track-and-pad-refinements

### Deprecated Requirements

#### The marker well is drawn only on rows that carry a marker

**Reason**: superseded by R1. The rule came from the T4 study and was hydrated into memory by phase 2;
it made the marker's own press target undiscoverable on unmarked rows.
**Migration**: the track chrome is unconditional; the fill remains gated. `docs/wiki/marker-3x3-studies.html`
and `docs/memory/run-kit/ui/{sidebar,visual-design}.md` are corrected in this change (R11).

#### Stage fill widths are 7 / 15 / 22 on every pointer class

**Reason**: superseded by R4. The single table produced a non-square marker on coarse rows.
**Migration**: 7/15/22 remains the fine-pointer table; coarse uses 12/24/36. Both are recorded in
`docs/memory/run-kit/ui/visual-design.md`.

#### The marker pad renders a `<mode> · <gloss>` header line

**Reason**: superseded by R7/R8/R9. It spent the pad's title position on a value the highlight ring
already conveyed.
**Migration**: replaced by the `Marker` title, numbered column headings, and the label tint.
`padHeader()` and `data-testid="marker-pad-header"` are removed.

## Tasks

### Phase 1: Setup

- [x] T001 In `app/frontend/src/marker.tsx`, add `MARKER_STAGE_WIDTHS_COARSE = { 1: 12, 2: 24, 3: 36 }` beside the existing fine table and export a `MARKER_WELL_WIDTH_FINE = 22` / `MARKER_WELL_WIDTH_COARSE = 36` pair so the row and the pad read one source <!-- R3 R4 -->

### Phase 2: Core Implementation

- [x] T002 Change `markerFillStyle` in `app/frontend/src/marker.tsx` to take the stage-width table (or an explicit coarse flag) as a parameter, defaulting to the fine table, and update both call sites <!-- R4 -->
- [x] T003 Scale the chevron geometry in `app/frontend/src/marker.tsx`: `MarkerChevrons` accepts a scale factor (1 for fine, 36/22 for coarse) applied to width, height, pitch and stroke <!-- R5 -->
- [x] T004 In `app/frontend/src/components/sidebar/window-row.tsx`, move the well's render gate inward — the container renders unconditionally, and only the fill/chevron span stays gated on `displayMarker`. Add `data-testid="marker-fill"` to the fill span <!-- R1 -->
- [x] T005 Confirm the `.rk-hazard` wedge in `window-row.tsx` remains gated on `displayMarker?.mode === "blocked"` and does not follow the track's new unconditional render <!-- R2 -->
- [x] T006 Resolve the track width from the existing `useCoarsePointer()` flag in `window-row.tsx` and thread it to all three consumers: the well's `width`, the strip overlay's width (replacing the literal `w-[22px]`), and the `anchorLeft` argument to `placeMarkerPad` <!-- R3 R6 -->
- [x] T007 Change the row button's content padding in `window-row.tsx` from `pl-[30px]` on both classes to `pl-[30px]` fine plus `coarse:pl-[44px]` <!-- R3 -->
- [x] T008 In `app/frontend/src/components/sidebar/marker-pad.tsx`, replace the header line with a heading row: the `Marker` title in the label track's header position and `∅`/`1`/`2`/`3` headings above their columns, with `MARKER_STAGE_GLOSS` supplying each stage heading's accessible label <!-- R7 -->
- [x] T009 Tint the highlighted cell's mode-row label and stage-column heading with `var(--color-marker-ink)` in `marker-pad.tsx`, leaving all other labels `text-text-secondary` and retaining the per-cell ring <!-- R8 -->
- [x] T010 Delete `padHeader()` and the `marker-pad-header` element from `marker-pad.tsx`, and confirm no `<mode> · <gloss>` string is rendered anywhere <!-- R9 -->

### Phase 3: Integration & Edge Cases

- [x] T011 [P] Update `app/frontend/src/marker.test.ts`: `markerFillStyle` cases for both width tables (7/15/22 and 12/24/36), and `MarkerChevrons` scaling cases <!-- R4 R5 -->
- [x] T012 [P] Update `app/frontend/src/components/sidebar/marker-pad.test.tsx`: drop the `padHeader` test, add the title/headings render test, add the label-tint tests for a stage cell and for ∅, and confirm the 160px/300px fit and placement cases still pass unchanged <!-- R7 R8 R9 R10 -->
- [x] T013 Update `app/frontend/src/components/sidebar/window-row.test.tsx`: an unmarked row renders `marker-well` but no `marker-fill` and no `.rk-hazard`; a marked row renders both; coarse rows render a 36px track and 44px content start while fine rows stay 22/30 <!-- R1 R2 R3 -->
- [x] T014 Rewrite the unmarked-row assertion in `app/frontend/tests/e2e/window-marker-gutter.spec.ts` from "renders nothing in the strip" to "renders the track with no fill", updating its `Proves:` / `Steps:` JSDoc in the same edit <!-- R1 -->
- [x] T015 Update the two left-zone tests in `app/frontend/tests/e2e/row-flyout.spec.ts`: the coarse one asserts a 36px track and ≈44px content offset, the fine one keeps 22px/≈30px; update both `Proves:` / `Steps:` blocks in the same edit <!-- R3 -->

### Phase 4: Polish

- [x] T016 Update `docs/wiki/marker-3x3-studies.html`: the T4 conclusion no longer says the well is drawn only on marked rows, and the settled-values line records 7/15/22 fine plus 12/24/36 coarse. Edit the claim text only — leave the surrounding markup and the live demo scripts intact <!-- R11 -->
- [x] T019 Correct `docs/specs/index.md`'s one-line description of the Marker 3×3 Studies page — it still summarises T4 as `marked rows only`, which now contradicts the corrected study <!-- R11 -->
- [x] T020 Add a comment above the row's class-string in `app/frontend/src/components/sidebar/window-row.tsx` naming what the two literal content-start utilities track (`pl-[30px]` = `MARKER_WELL_WIDTH_FINE + 8`, `coarse:pl-[44px]` = `MARKER_WELL_WIDTH_COARSE + 8`, the 8px status-dot halo gap), matching the `coarse:pr-[56px]` / `STATUS_RAIL_WIDTH_PX` idiom already a few lines above. The utilities stay literal — Tailwind scans literal class strings only <!-- R3 -->
- [x] T021 Update the `Proves:` / `Steps:` JSDoc on the fine-pointer left-zone test in `app/frontend/tests/e2e/row-flyout.spec.ts` so it describes the stage-two-fill assertion the test gained; the coarse counterpart's block must likewise match its body <!-- R11 -->
- [x] T017 Run the provenance sweep over every touched file **including tests and e2e specs** — `grep -rnE '\((hwtr|[a-z0-9]{4})\)|\b(R[0-9]{1,2}|T0[0-9]{2}|A-[0-9]{3})\b' <touched files>` — and clear every hit in this change's own lines <!-- R11 -->
- [x] T018 Run the gates in order, one e2e invocation at a time: `cd app/backend && go test ./...`; `cd app/frontend && npx tsc --noEmit`; `just test-frontend`; `just test-e2e "window-marker-gutter"`; `just test-e2e "row-flyout"`; `just build`. Confirm `git diff --stat` touches no file under `app/backend/` and no `row-flyout-card.tsx` <!-- R11 -->

## Execution Order

- T001 blocks T002, T003 and T006
- T002 and T003 block T004 and T006 (the row consumes both signatures)
- T008 blocks T009 and T010 (one file, built up in order)
- T011–T015 depend on their Phase 2 counterparts; T017 runs after every code and test task; T018 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: every window row renders the marker track's wash and right edge, marked or not
- [x] A-002 R1: only a row with a parsed marker renders a fill or chevrons inside that track
- [x] A-003 R3: the track is 22px on fine and 36px on coarse, with content starting at 30px and 44px
- [x] A-004 R4: stage fills are 7/15/22 against a 22px track and 12/24/36 against a 36px track
- [x] A-005 R5: chevron geometry scales with the track so `auto:N` reads proportionally the same on both classes
- [x] A-006 R7: the pad's top-left reads `Marker` and the columns are headed `∅`, `1`, `2`, `3`
- [x] A-007 R8: the highlighted cell tints its mode-row label and stage-column heading in the marker ink
- [x] A-008 R11: `docs/wiki/marker-3x3-studies.html` and `docs/specs/index.md` record the always-on track and the pointer-class geometry (memory is hydrate's stage, explicitly out of scope for this item)

### Behavioral Correctness

- [x] A-009 R2: an unmarked row and a `manual:3` row mount no `.rk-hazard`; a `blocked:2` row does
- [x] A-010 R4: `manual:3` fills its track exactly on both pointer classes — no dead gap at stage 3 on coarse
- [x] A-011 R6: on a coarse row the pad anchors at 36px and the strip press target spans the full 36px
- [x] A-012 R8: on the ∅ cell the `∅` heading tints and no mode label does
- [x] A-013 R9: no `marker-pad-header` element and no `<mode> · <gloss>` text renders in any pad state
- [x] A-014 R3: the 8px gap between the track's right edge and the content is preserved on both classes

### Removal Verification

- [x] A-015 R9: `padHeader` is gone from `marker-pad.tsx` and its unit test is removed, with no unreferenced export left behind
- [x] A-016 R7: `MARKER_STAGE_GLOSS` retains a real consumer (the column headings' accessible label) rather than becoming dead
- [x] A-017 R11: no surviving claim in `docs/wiki/marker-3x3-studies.html` or `docs/specs/index.md` contradicts the shipped behavior, and apply left `docs/memory/**` untouched
- [x] A-018: `git diff --stat` shows no file under `app/backend/` and no `row-flyout-card.tsx`

### Scenario Coverage

- [x] A-019 R10: `markerPadPopoverLayout(160)` still returns `{152, 22, 42}`, and the pad still clamps inside the sidebar at 160px and 300px on the first and last rows
- [x] A-020 R1/R3: `window-marker-gutter.spec.ts` and both `row-flyout.spec.ts` left-zone tests assert the new track behavior and geometry on their respective pointer classes
- [x] A-021: the gesture, wheel, single-open, Escape-revert and palette tests pass with no behavioral edits — only geometry constants change

### Edge Cases & Error Handling

- [x] A-022 R4: the pad's cells render the fine width table regardless of the row's pointer class
- [x] A-023 R11: the study page's live demos and surrounding markup still render after the claim edits

### Code Quality

- [x] A-024 Pattern consistency: pointer-class branching uses the existing `useCoarsePointer()` hook and the `coarse:` Tailwind variant already used by this row
- [x] A-025 No unnecessary duplication: the track width and stage-width tables have one definition in `src/marker.tsx`, consumed by both the row and the pad
- [x] A-026 No magic numbers: the track widths and the 36/22 chevron ratio are named constants in `src/marker.tsx`. The two content-start values are Tailwind arbitrary utilities (`pl-[30px]`, `coarse:pl-[44px]`) and MUST stay literal — Tailwind scans literal class strings only — so they instead carry a comment naming the constants they track (`MARKER_WELL_WIDTH_FINE + 8`, `MARKER_WELL_WIDTH_COARSE + 8`), matching the `coarse:pr-[56px]` / `STATUS_RAIL_WIDTH_PX` idiom already in this file
- [x] A-027 Comment hygiene: no comment **this change adds or modifies** narrates the next line, addresses the reviewer, or cites a plan/change ID or PR number. Scoped to the diff — untouched files are out of scope and MUST NOT be flagged
- [x] A-028 Test intent comments: every touched Playwright `test()` carries `Proves:` and `Steps:` JSDoc matching its current body — including the fine-pointer left-zone test in `row-flyout.spec.ts`, whose block must describe the stage-two-fill assertion it gained — narrating no history and citing no change IDs — the fine-pointer left-zone test body changed without updating its own intent block

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

### Ship note (not a gate)

A hand check at mobile width is worth a minute, since item 2 is a geometry change judged by eye. It is
deliberately **not** a blocking ship gate this time: the gesture model — where #767's defects lived and
what justified the blocking gate on the previous change — is explicitly out of scope here, and the
geometry is fully covered by unit and e2e assertions.

## Deletion Candidates

None — this change removes the superseded `padHeader` helper and does not leave additional existing
code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The track width and stage-width tables live in `src/marker.tsx`, not in `window-row.tsx` | `MARKER_WELL_WIDTH` is currently a `window-row.tsx` local, but the pad also needs the value for its anchor, and phase 2 established `marker.tsx` as the single home for the marker vocabulary | S:80 R:90 A:90 D:85 |
| 2 | Certain | `markerFillStyle` takes the width table as a parameter defaulting to the fine one | Two call sites need different tables at the same time — the row (pointer-class dependent) and the pad cells (always fine). A module-level mutable would make one of them wrong | S:85 R:85 A:90 D:90 |
| 3 | Certain | A `data-testid="marker-fill"` is added so absence assertions survive the always-on track | Existing "nothing in the strip" assertions key on `marker-well`, which now always exists; without a fill testid those tests either lose their meaning or assert on style internals | S:80 R:90 A:90 D:85 |
| 4 | Confident | Chevrons scale by a single 36/22 ratio rather than getting a second absolute constant table | One factor keeps `auto:N` reading identically across pointer classes; a second table would need a design pass the author has not asked for | S:65 R:85 A:80 D:75 |
| 5 | Confident | The ∅ column is headed `∅`, matching its cell glyph | The heading row reads as a complete axis legend; a blank cell above a glyph column looks like a rendering gap. Trivially reversible | S:55 R:95 A:70 D:60 |
| 6 | Confident | The study's exploration prose is preserved and only its stated conclusion is edited | The page is a design study whose value is the record of what was tried and why; rewriting it wholesale to match the new conclusion would destroy that, while leaving the conclusion stale would mislead the next reader | S:70 R:85 A:85 D:75 |
| 7 | Confident | The coarse content-start change rides the `coarse:` Tailwind variant rather than a JS branch | The row's base class string already composes `coarse:` variants for padding and min-height; a JS branch would split one concern across two mechanisms | S:70 R:90 A:85 D:80 |

7 assumptions (3 certain, 4 confident, 0 tentative).
