# Plan: Spidey Swing Flair

**Change**: 260824-164i-spidey-swing-flair
**Intake**: `intake.md`

## Requirements

### Flair Vocabulary: closed sets

#### R1: Frontend closed set gains `spidey`
`FLAIR_STATES` in `app/frontend/src/themes.ts` SHALL gain `"spidey"` appended as the last named state (after `"warp"`), preserving the existing order (empty first, rain/scan leading).

- **GIVEN** the closed set of flair states
- **WHEN** `FLAIR_STATES` is read by any consumer (picker band, FlairOverlay callers, type `FlairState`)
- **THEN** `"spidey"` is a valid `FlairState` and appears as the 13th named state

#### R2: Backend closed set gains `spidey` (lockstep)
`flairTokens` in `app/backend/internal/validate/validate.go` SHALL gain `"spidey"` appended last, so `FlairValues`/`ValidateFlairValue` accept it on `@rk_flair` writes (window and session paths).

- **GIVEN** a `POST` writing `@rk_flair` (window options or session flair)
- **WHEN** the value is `"spidey"`
- **THEN** validation passes and the option is written
- **AND** case variants / padded forms (`"Spidey"`, `" spidey "`) remain rejected (closed-set rule)

### Visual Treatment: `.rk-flair-spidey`

#### R3: Sprite-sheet swing treatment in `globals.css`
A `.rk-flair-spidey` treatment SHALL be added to `globals.css` following the character-flair sprite-sheet mold (nyan/naruto/onepiece precedent):

- `::after` carries an inline-SVG data-URI **vertical sheet of 22px-tall frames** (frame n at y = −22n) drawing an original red/blue web-swinger homage; each frame includes its **web line from the frame's top edge to the character's hand**, and the swing arc (rise → dip → rise, body lean swapping) is encoded in the frames.
- The two `background-position` longhands compose: `-x` runs a slow linear left→right traversal from a negative start offset to `calc(100% + Npx)` (loop boundaries fully off-screen); `-y` steps the sheet with `step-end` keyframes at low-fps sprite cadence. Keyframes named `rk-flair-spidey-x` / `rk-flair-spidey-y`.
- The strip is the fixed 22px centering pattern (static top/margin) so it renders box-agnostically (24px rows, 36px coarse rows, server tiles, 18px picker preview cells).
- An optional `::before` ambient companion layer (own keyframes, never shared) MAY be added if it doesn't read as noise.
- **No transforms, no layout-affecting properties** — `background-position` only, on the overlay's pseudos. If `::after` glues multiple layers, all layers' from/to offsets displace by identical px.

- **GIVEN** a row/tile whose `@rk_flair` is `spidey`
- **WHEN** the row renders in any state (rest/hover/selected)
- **THEN** the swinger traverses the full box width ambiently, always-on, and text stays readable above the z-5 overlay

#### R4: Reduced-motion gate covers the new flair
The `prefers-reduced-motion` enumeration block in `globals.css` SHALL gain `.rk-flair-spidey::before, .rk-flair-spidey::after` with `animation: none; display: none` (hidden entirely — no static fallback), with base rules preceding the gate block (source-order rule).

- **GIVEN** `prefers-reduced-motion: reduce`
- **WHEN** a spidey-flaired row renders
- **THEN** the overlay's pseudos paint nothing

### Consumers & Tests

#### R5: Picker and overlay absorb the 13th flair with no layout rework
The flair band derives from `FLAIR_STATES.slice(1)` with a computed `i % 2` row split — the 13th value lands in row 1 (7/6 split) automatically; `FlairOverlay` renders sheet flairs as the bare overlay span (no child markup). No component API changes SHALL be made.

- **GIVEN** the banded Label picker's `[ flair ]` band
- **WHEN** it renders with the 13-state set
- **THEN** a live `spidey` cell appears (row 1, last column), keyboard-reachable, with `data-flair-value="spidey"`, and the panel keeps constant height

#### R6: Enumeration tests updated
All tests that enumerate the flair closed set SHALL be updated: `themes.test.ts:532` (exact `FLAIR_STATES` equality), `validate_test.go:529` (valid `@rk_flair` list), and `swatch-popover.test.tsx:791`'s keyboard-walk test (hardcoded 6-column row walks become 7/6). `flair-overlay.test.tsx`'s bare-span coverage SHOULD gain `spidey`.

- **GIVEN** the full verification gates
- **WHEN** `go test ./...`, `tsc --noEmit`, and the Vitest suite run
- **THEN** all pass with the new state asserted

### Non-Goals

- No hover-vocabulary change — the chrome one-treatment-per-category map (glitch/boot-sweep/brackets+caret/typed-sweep/glint/sash) is untouched (see intake research: all categories claimed; flair owns row motion).
- No new e2e spec (flairs are asserted at unit level via class presence).
- No API/route changes, no settings, no per-flair config.

### Design Decisions

#### Swing animation lands on the flair axis
**Decision**: The Spider-Man-style swinging animation is a 13th named flair (`spidey`), not a new hover-treatment category.
**Why**: Every hover-vocabulary element category is claimed; character homages are categorically flairs (nyan/naruto/onepiece/pacman/roadrunner precedent); the recorded motion-split ("flair owns ALL row motion") and always-on-ambient decisions forbid row-hover character motion.
**Rejected**: A new chrome hover treatment — no unclaimed category maps to a swing; a row hover animation would contradict two standing design decisions.
*Introduced by*: 260824-164i-spidey-swing-flair

#### Sheet mold, not the child-span transform exception
**Decision**: The swing reads through sprite-sheet frame poses + step-end bob (`background-position` longhands only), not cube/warp-style child-span transforms.
**Why**: The sheet mold is the house pattern for character flairs; a background sweep cannot paint outside the element's box (drag-ghost rule), and frames already express arcs (nyan bob, onepiece hull roll).
**Rejected**: Child-span pendulum transforms — sanctioned only where 3D genuinely needs transforms; adds markup to FlairOverlay for no visual necessity.
*Introduced by*: 260824-164i-spidey-swing-flair

## Tasks

### Phase 2: Core Implementation

- [x] T001 [P] Append `"spidey"` to `FLAIR_STATES` in `app/frontend/src/themes.ts:494`; update the exact-equality enumeration test in `app/frontend/src/themes.test.ts:531-532` <!-- R1, R6 -->
- [x] T002 [P] Append `"spidey"` to `flairTokens` in `app/backend/internal/validate/validate.go:208`; add `"spidey"` to the valid list in `app/backend/internal/validate/validate_test.go:529` (keep invalid-forms cases intact) <!-- R2, R6 -->
- [x] T003 Add the `.rk-flair-spidey` block to `app/frontend/src/globals.css` (after the warp block, before the reduced-motion gate): `rk-flair-spidey-x`/`-y` keyframes, `::after` sprite sheet (22px frames, web line in-frame, ~4 frames, step-end cadence, off-screen loop offsets), optional `::before` ambient layer with its own keyframes <!-- R3 -->
- [x] T004 Add `.rk-flair-spidey` pseudos to the `prefers-reduced-motion` enumeration block in `app/frontend/src/globals.css` (~line 1253): `animation: none; display: none` <!-- R4 -->

### Phase 3: Integration & Edge Cases

- [x] T005 Update `app/frontend/src/components/swatch-popover.test.tsx` — the keyboard-walk test (~line 791) hardcoding 6-column flair rows (row 1 gains `spidey` after `cube`: 7 columns), plus any other `FLAIR_NAMED`-derived assertions that break; verify the band renders `data-flair-value="spidey"` <!-- R5, R6 -->
- [x] T006 [P] Extend `app/frontend/src/components/flair-overlay.test.tsx` bare-span coverage to `spidey` (overlay class emitted, no child markup) <!-- R5, R6 -->
- [x] T007 Run verification gates: `cd app/backend && go test ./...`; `cd app/frontend && npx tsc --noEmit`; `PNPM_CONFIG_STRICT_DEP_BUILDS=false just test-frontend` <!-- R6 -->

## Execution Order

- T001 and T002 are independent ([P]); T003 blocks T004 (source-order in the same file); T005/T006 after T001; T007 last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `FLAIR_STATES` contains `"spidey"` as its last entry; `FlairState` accepts it
- [x] A-002 R2: `ValidateFlairValue("spidey")` passes; window `@rk_flair` and session flair writes accept `"spidey"`
- [x] A-003 R3: `.rk-flair-spidey` exists in `globals.css` with `rk-flair-spidey-x`/`-y` keyframes, a 22px-frame sprite sheet including the web line, and off-screen loop boundaries
- [x] A-004 R4: The reduced-motion block enumerates the spidey pseudos with `animation: none; display: none`

### Behavioral Correctness

- [x] A-005 R3: The treatment animates `background-position` longhands only — no transforms, no layout-affecting properties, no child-span markup
- [x] A-006 R5: The picker flair band shows 13 live cells (7/6 computed split) with constant panel height; no component API changed

### Scenario Coverage

- [x] A-007 R6: `themes.test.ts` enumeration, `validate_test.go` closed-set cases, and the swatch-popover keyboard-walk test assert the 13-state set and pass
- [x] A-008 R2: Invalid forms (`"Spidey"`, `" spidey "`, unknown names) remain rejected

### Edge Cases & Error Handling

- [x] A-009 R3: The flair renders box-agnostically (22px strip centering) — sensible on 24px rows, 36px coarse rows, server tiles, and 18px picker preview cells

### Code Quality

- [x] A-010 Pattern consistency: The CSS block matches the sibling flair blocks' structure, comment style, and naming register
- [x] A-011 No unnecessary duplication: No new components or utilities; consumers derive from the closed sets
- [x] A-012 Tests included: New/changed behavior is covered by the updated unit tests (code-quality principle: features must include tests)
- [x] A-013 No comment narration: CSS comments state constraints (loop-boundary math, layer balance), not narration

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | ~4 sheet frames at a ~0.5s step cadence, ~7s traversal (roadrunner/pacman-range speed — a swing reads brisker than the 14s ship) | Sibling flairs bracket the range; trivially tunable constants | S:50 R:90 A:70 D:60 |
| 2 | Confident | Sprite palette: red/blue homage silhouette with a light-gray web line, near-opaque like sibling sprites (not `--rk-flair-color`-tinted — only rain/scan tint) | Matches the character-flair convention: characters carry their own iconic colors | S:55 R:85 A:75 D:70 |
| 3 | Tentative | Include a faint `::before` web-filament ambient layer drifting the opposite way | Homage flairs mostly carry a companion layer (stars/streaks/waves); may be dropped if it reads as noise per the "too loud" review precedent | S:40 R:90 A:55 D:45 |
| 4 | Confident | `::before` layer kept: 56px tile of two diagonal filaments at 0.07–0.09 stroke opacity, 4s leftward drift (own `rk-flair-spidey-web` keyframes) — below naruto/roadrunner streak opacity, so it reads as texture, not noise | Resolves assumption 3 at apply; the faint end of the sibling range keeps the swinger the sole focal motion | S:40 R:90 A:60 D:50 |
| 5 | Certain | Enumeration sweep fallout updated in lockstep: `operator.go`/`operator_test.go` labeler prompt token list, `types.ts` flair doc-comments, `globals.css` section-header enumeration, `sidebar/index.test.tsx` 13-cell assertion; the CSS block sits after the cube block (the last flair block before the reduced-motion gate) | The prompt token list is a live closed-set surface agents write from; stale lists would 400 on `spidey` writes; placement keeps all flair blocks contiguous ahead of the gate (source-order rule) | S:60 R:85 A:90 D:85 |

5 assumptions (1 certain, 3 confident, 1 tentative).
