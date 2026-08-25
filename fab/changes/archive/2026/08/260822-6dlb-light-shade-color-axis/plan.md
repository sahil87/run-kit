# Plan: Light Shade — Third Rung of the Color Axis

**Change**: 260822-6dlb-light-shade-color-axis
**Intake**: `intake.md`

## Requirements

### Color Axis: Light Shade

#### R1: Shade machinery — light as the exact mirror of dark
`app/frontend/src/themes.ts` MUST render `{family}-light` at OKLCH (mean-L + Δ, same chroma, same hue), gamut-reduced via `oklchToHexInGamut`, with Δ defaulting to the symmetric 0.14 (`LIGHT_SHADE_L_DELTA` mirroring `DARK_SHADE_L_DELTA`). `Shade` gains `"light"`; `SHADE_LIGHT_SUFFIX = "-light"`; `shadedName`/`resolveShaded`/`parseColorValue`/`formatColorValue`/`colorValueToHex` handle the light rung; `computeRowTints`/`computeRowBorders` gain the light entry per family keyed under the stored `{family}-light` form (maps 31 → 41 entries). Slate keeps its near-neutral chroma rule in all three shades. `familyToLegacy` is verified passthrough — NO change.

- **GIVEN** any theme palette
- **WHEN** `colorValueToHex("orange-light", palette)` resolves
- **THEN** it returns the family hue at mean-L + Δ, gamut-reduced, and round-trips through parse/format

#### R2: Backend closed set + icontint table
`internal/validate/validate.go`'s `colorFamilyNames` map MUST grow by `f+"-light"` per family (20 → 30 entries) — the single map feeding ValidateColorValue + NormalizeColorValue. `internal/icontint/icontint.go`'s frozen `familyHexByValue` table MUST gain the 10 `{family}-light` hexes computed by the same formula at default-dark stats **at the landed delta** (they must match whatever Δ apply settles on). Reject-assertions flip: `validate_test.go:477`/`:565`, `icontint_test.go:52`.

- **GIVEN** a POST storing `@color = orange-light`
- **WHEN** validation runs
- **THEN** it is accepted and normalized verbatim; icontint resolves it to the frozen light hex

#### R3: Picker — 3 shade rows, light on top
The color band in `swatch-popover.tsx` MUST become 3 shade rows (light/normal/dark — the rows ARE the lightness axis) via `PICKER_COLOR_VALUES` in family-TRIPLET order (light, normal, dark per family; 30 values) and `i % 3` row slices; the strip grid becomes `grid-rows-[18px_18px_18px]` (+21px panel, one-time). The keyboard grid gains one color row — every row below shifts by one; initial-focus mapping covers the light row (light 2, normal 3, dark 4). Everything else (scroll model, header −, panel − clear-all, marker/flair bands, dismissal, preview mechanics) is untouched.

- **GIVEN** the picker open on any caller
- **WHEN** the color band renders
- **THEN** three 18px shade rows show one family per column, light on top, and arrows walk all three plus the shifted bands below

#### R4: Guard coverage proven by tests (no new mechanics)
`adjustBorderForContrast` is already bidirectional (threshold 3.0; light themes push L down) — verified. Unit tests MUST prove a light shade's guarded border clears 3.0 on the built-in light theme(s) (downward nudge) and on dark themes.

- **GIVEN** a light terminal theme
- **WHEN** `computeRowBorders` guards `orange-light`
- **THEN** the result's contrast against the background is ≥ 3.0

#### R5: Row-scale visual verification with delegated delta tuning
Before freezing the icontint hexes, apply MUST render row-scale stacks (resting 14% tint + guarded stripe — the study's `#shade-rows` method) at the default +0.14 for a few families (orange/blue/green/slate) and judge legibility. If clearly too washed, tune to +0.10–0.12 (or a mild light-rung chroma floor), record the landed value as a plan assumption, and freeze icontint at that value. Default stands unless row-scale rendering clearly fails.

- **GIVEN** the implemented pipeline at the landed Δ
- **WHEN** the row stacks render
- **THEN** light/normal/dark separate at row scale and the landed Δ is recorded

#### R6: Tests, e2e, and spec docs
Unit coverage end to end per intake §10 (parse/format/store/validate/icontint/tint-border keys/guard). Count/keyboard/order tests update: paired-order 20 → triplet 30 (`themes.test.ts:245–256`), `swatch-popover.test.tsx` 20→30 swatches / 45→55 options / "2-shade-row"→"3-shade-row" / keyboard re-indexing; `themes.test.ts:355` blue-light flips positive (near-misses stay rejected). E2E: extend window-marker-gutter's color-persistence test with a light-shade verbatim leg (`orange-light` picked → `@color` stores verbatim) + same-commit `.spec.md`. `docs/specs/themes.md` shade-axis prose goes 2 → 3 shades, records the faded-character trade and that the existing bidirectional guard covers light-on-light.

- **GIVEN** the change is applied
- **WHEN** the suites run
- **THEN** all pass, including the flipped former reject-assertions

### Design Decisions

#### Light rung ships faded, not brightened
**Decision**: `{family}-light` = mean-L + Δ at unchanged chroma, gamut-reduced — accepting that shed chroma makes the light rung read faded/desaturated.
**Why**: The user judged the study's row-scale stacks and accepted the character; it fits the recessive role in the ramp job (family = project, shade = sub-grouping).
**Rejected**: Chroma-boosting the light rung to keep it vivid (fights the gamut; breaks the symmetric-mirror simplicity); omitting slate (three grays are the archive ramp — deliberate).
*Introduced by*: 260822-6dlb-light-shade-color-axis

### Non-Goals

- No write-seam, API, endpoint, or migration changes; rows/sidebar/tiles untouched (raw-value-keyed maps).
- No wiki-page sync (the study page ships unchanged on main; its "open flag" prose is a historical record).

## Tasks

### Phase 2: Core Implementation

- [x] T001 themes.ts shade machinery: Shade "light", SHADE_LIGHT_SUFFIX, LIGHT_SHADE_L_DELTA (0.14 default), shadedName/resolveShaded/colorValueToHex light branches, PICKER_COLOR_VALUES → family-triplet 30, computeRowTints/computeRowBorders light entries (41) <!-- R1 -->
- [x] T002 themes.test.ts: triplet-order 30-value assertion, light round-trip/resolveFamily/passthrough/L+Δ cases, blue-light flip at :355 (near-misses still rejected), guard-on-light-theme + dark-theme cases <!-- R1, R4 -->
- [x] T003 [P] validate.go colorFamilyNames +10 `-light` (20→30) + validate_test.go flips (:477, :565) and new accept/normalize cases <!-- R2 -->

### Phase 3: Integration & Edge Cases

- [x] T004 Row-scale visual verification at +0.14 (render orange/blue/green/slate stacks with the shipped pipeline — the study's method); tune Δ only if clearly washed; record the landed Δ in ## Assumptions <!-- R5 -->
- [x] T005 icontint.go: 10 frozen `{family}-light` hexes at the landed Δ (default-dark stats) + icontint_test.go:52 flip and new resolution cases <!-- R2, R5 -->
- [x] T006 swatch-popover.tsx: 3-row band (i % 3 slices, grid-rows-[18px_18px_18px]), keyboard grid + initial-focus re-index <!-- R3 -->
- [x] T007 swatch-popover.test.tsx: 30 swatches / 55 options / 3-shade-row wording / keyboard row re-indexing (magenta walk, ArrowRight clamp, etc.) <!-- R3, R6 -->
- [x] T008 [P] e2e window-marker-gutter.spec.ts color-persistence light leg (orange-light verbatim) + `.spec.md` same commit <!-- R6 -->
- [x] T009 [P] docs/specs/themes.md: shade axis 2→3, faded-trade note, bidirectional-guard coverage note, banded-picker "3-shade-row" wording <!-- R6 -->

### Phase 4: Polish

- [x] T010 Gates in order: `cd app/backend && go test ./...` (validate + icontint), `just test-frontend`, `npx tsc --noEmit`, marker-gutter e2e (`just test-e2e window-marker-gutter`, private rig if 3020 busy), `just build` <!-- R6 -->

## Execution Order

- T001 blocks T002/T004/T006; T004 blocks T005 (frozen hexes need the landed Δ)
- T003 is independent; T008/T009 independent after T006/T001 respectively

## Acceptance

### Functional Completeness

- [x] A-001 R1: `{family}-light` parses, formats, renders at mean-L + landed Δ, and has tint/border map entries for all 10 families (41-entry maps)
- [x] A-002 R2: validators accept/normalize all 10 `-light` values; icontint resolves them to frozen hexes matching the landed Δ
- [x] A-003 R3: the picker shows 3 shade rows (light top) in family columns; 30 swatches / 55 options; keyboard walks every row incl. the shifted bands

### Behavioral Correctness

- [x] A-004 R1: `familyToLegacy` passes `-light` values through verbatim (storage vocabulary is the value itself); pre-existing stored values resolve unchanged
- [x] A-005 R4: guarded borders for light shades clear 3.0 contrast on built-in light AND dark themes (test-proven, no new guard mechanics)
- [x] A-006 R5: the landed Δ is recorded, and icontint's frozen hexes were computed at that Δ

### Scenario Coverage

- [x] A-007 R6: the former reject-assertions (themes.test.ts:355, validate_test.go:477/565, icontint_test.go:52) now assert acceptance
- [x] A-008 R6: e2e persists a picked `orange-light` verbatim to `@color`; `.spec.md` updated in the same commit

### Edge Cases & Error Handling

- [x] A-009 R1: slate-light renders under slate's near-neutral chroma rule (no special-casing); near-miss values (`bluish-light`, `blue-lite`) still reject

### Code Quality

- [x] A-010 Pattern consistency: light mirrors dark at every seam (constant, suffix, branch, map entry) with no parallel new vocabulary machinery
- [x] A-011 No unnecessary duplication: single closed-set map, single parser branch, shared render formula

## Notes

- Check items as you review: `- [x]`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Light row goes ON TOP (light/normal/dark descending) — the rows read as the lightness axis | Study's 3-row mock renders light on top; user approved that mock | S:70 R:90 A:85 D:75 |
| 2 | Confident | The e2e light leg extends the EXISTING color-persistence test rather than adding a new test() (keeps the suite's per-test budget shape) | Intake §10 names that test as the natural home; the 10s local budget punished long tests before | S:60 R:85 A:80 D:70 |
| 3 | Confident | Light delta LANDS at the default +0.14 — row-scale render (resting 14% tint + guarded stripe, the study's #shade-rows method, driven by the shipped pipeline) shows the light row legible and clearly separated from normal/dark for orange/blue/green/slate; not washed. icontint frozen hexes computed at +0.14 | Rendered and judged during apply (T004); the faded character is the accepted trade, and at +0.14 the stacks still read | S:70 R:80 A:75 D:70 |

2 assumptions (0 certain, 2 confident, 0 tentative).
