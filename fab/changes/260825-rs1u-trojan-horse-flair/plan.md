# Plan: Trojan Horse Flair

**Change**: 260825-rs1u-trojan-horse-flair
**Intake**: `intake.md`

## Requirements

### Flair vocabulary: the `troy` closed-set value

#### R1: `troy` appended to both closed sets in lockstep
The frontend `FLAIR_STATES` (`app/frontend/src/themes.ts:494`) and the backend `flairTokens` (`app/backend/internal/validate/validate.go:208`) MUST both gain `"troy"`, appended after `"spidey"` (append-at-end growth order). The enumerating comment at `validate.go:273` and the operator help text at `app/backend/api/operator.go:444` MUST be updated to include `troy`. The doc-comment unions in `app/frontend/src/types.ts` (~lines 68, 107) MUST gain `"troy"`.

- **GIVEN** a client writes `@rk_flair` (or `@rk_session_flair`) with value `troy`
- **WHEN** the write path validates via `ValidateFlairValue`
- **THEN** the value is accepted (no 400), and the frontend `FlairState` type admits `"troy"`

#### R2: `.rk-flair-troy` narrative treatment in `globals.css`
A new flair CSS block MUST render the Trojan Horse story as an always-on, CSS-only animation with **one master-loop duration `D` (~24s) shared by every keyframe timeline on both pseudos**, story phases encoded as keyframe percentages: (1) day — a wooden horse pulled/pushed by figures traverses the beach left→right toward the gate (~0–55%); (2) the sprite slides behind the wall layer through the gate opening, then the sheet parks on a blank frame (~55–65%); (3) the backdrop steps to night frames with the town skyline aflame, flickering between 2 fire frames (~65–95%); (4) reset to day while the row is horse-free (~95–100%).

- **GIVEN** a row carries `rk-flair-troy`
- **WHEN** one master loop elapses
- **THEN** the horse crosses the beach, disappears through the gate, the scene turns to night with the town burning, and the scene returns to day with no visible snap at the loop boundary

#### R3: Layering and occlusion (the two-layer pattern, extended)
The treatment MUST use the established two-pseudo split: `::before` carries the ambient backdrop (beach ground + town-skyline scene tiles whose vertical frames are day / night-fire-A / night-fire-B, y-stepped at master-loop percentages); `::after` (bottom-anchored strip) carries two background layers — layer 1 (painting on top) the castle wall + gate as a no-repeat slice anchored at the box's right edge with static x, layer 2 (behind it) the horse + pullers vertical sprite sheet (22px frames: walk frames + a blank frame). The traversal MUST end just inside the gate's x so the sprite is genuinely occluded by the wall layer as it enters. The wall layer MUST also be a vertical scene sheet (day / night frames) y-stepped in sync.

- **GIVEN** the traversal reaches the gate (phase 2)
- **WHEN** the horse sprite's x overlaps the wall layer's gate slice
- **THEN** the wall paints over the sprite (multi-layer occlusion on one pseudo — the pacman layering pattern), and afterwards the sheet parks on its blank frame

#### R4: Standing flair CSS discipline
The block MUST honor every standing flair constraint: `background-position` longhands only — never `transform`, never `left` (the drag-ghost rule; no cube/warp child-span exception); fixed-height strips with static anchoring so px frame offsets hold at every box height (24px rows, 36px coarse rows, 18px picker preview cells, server tiles); sprite layers `no-repeat` with balanced from/to offsets; ambient tiles displaced by exact integer tile multiples per loop; every sub-cadence period dividing the master duration `D` exactly; keyframe names in the `rk-flair-troy-*` register, never shared with another flair; loop boundaries clean (sprite fully off-screen or parked blank at 0%/100%). All art MUST be original stylized pixel-art inline SVG data URIs (URL-encoded, `%23` hex colors) — no external requests, no copyrighted assets. Fire-flicker cadence MUST be ≥ 0.3s per frame (under photosensitivity thresholds).

- **GIVEN** the CSS block as authored
- **WHEN** inspected against the flair section's comment contract
- **THEN** no `transform`/`left` animation appears on row pseudos, all sub-periods divide `D`, and all imagery is inline `data:image/svg+xml` URIs

#### R5: Reduced-motion gate
`.rk-flair-troy::before, .rk-flair-troy::after` MUST be added to the `prefers-reduced-motion: reduce` flair enumeration in `globals.css` (`animation: none; display: none`) — hidden entirely, no static fallback. The block's "all thirteen named states" comment MUST become fourteen, and the flair section's header comment list (~line 482) MUST gain `troy`. Base rules MUST precede the gate block (source order).

- **GIVEN** `prefers-reduced-motion: reduce`
- **WHEN** a row carries `rk-flair-troy`
- **THEN** neither pseudo renders (no animation, no static residue)

#### R6: Consumers pick the value up from the closed sets
`FlairOverlay` MUST render `troy` as a bare overlay span (no child markup). The picker flair band MUST show 14 named cells in a computed 7/7 column-flow split with no layout code change; the "13 named states" doc comments in `swatch-popover.tsx` (~lines 53, 78, 624) MUST be updated to 14.

- **GIVEN** the Label picker opens on a flair-capable call site
- **WHEN** the flair band renders
- **THEN** a `data-flair-value='troy'` cell appears last, carrying the live `rk-flair-troy` overlay

#### R7: Test sweep (count-bearing enumerations)
All closed-set/count-bearing tests MUST be updated: `app/frontend/src/themes.test.ts:532` (expected `FLAIR_STATES` array), `app/backend/internal/validate/validate_test.go:529` (valid list gains `troy`; invalid list gains case/whitespace variants e.g. `"Troy"`, `" troy "`), `app/backend/api/operator_test.go:960` (enumeration string), `app/frontend/src/components/swatch-popover.test.tsx` (~457: "13 states … spidey last" → 14 states, troy last; ~801: re-derive the column-clamp expectation on the 7/7 grid), `app/frontend/src/components/sidebar/index.test.tsx:2080` (flair-cell presence), `app/frontend/src/components/flair-overlay.test.tsx` (sample loop gains `troy`).

- **GIVEN** the full verification gates (`go test ./...`, `tsc --noEmit`, frontend unit tests)
- **WHEN** run after the change
- **THEN** all pass with the new value enumerated

### Non-Goals

- No e2e spec addition — flairs are asserted via class presence at unit level (spidey precedent).
- No API surface change, no new endpoints, no new components, no dependencies.
- No semantic wiring — flair remains decoration-only (no `@rk_agent_state` / status-pyramid coupling).

### Design Decisions

#### Narrative master loop
**Decision**: One master duration `D` ≈ 24s shared by every keyframe timeline on both pseudos; story phases as keyframe percentages; every sub-cadence (walk frames, flame flicker, scene steps) a period dividing `D` exactly.
**Why**: The only CSS-only way to keep multi-phase state synced with no JS timers; extends the flairs' standing integer-multiple loop math scene-wide.
**Rejected**: Independent per-layer durations (the stateless-flair norm) — phases would drift apart; JS-driven phase switching — violates the CSS-only flair contract.
*Introduced by*: 260825-rs1u-trojan-horse-flair

#### Gate occlusion via multi-layer single pseudo
**Decision**: Wall + gate as the top background layer of `::after`, no-repeat, anchored at the box's right edge; the horse sheet as the layer behind it; traversal ends just inside the gate's x.
**Why**: pacman's multi-layer-one-pseudo pattern gives genuine occlusion with zero transforms; a right-edge anchor is the only box-width-agnostic fixed gate target.
**Rejected**: A hard cut to a blank frame at an arbitrary x (reads as a glitch, not an entry); putting the wall on `::before` (stacks below `::after`, cannot occlude the horse).
*Introduced by*: 260825-rs1u-trojan-horse-flair

#### Token `troy`
**Decision**: The flair token is `troy`.
**Why**: Matches the short homage-nickname register (naruto/onepiece/pacman/spidey); Iliad is public domain; short token in a stored tmux option.
**Rejected**: `trojan` (malware connotation), `trojanhorse`/`iliad` (register mismatch).
*Introduced by*: 260825-rs1u-trojan-horse-flair

## Tasks

### Phase 1: Closed sets (lockstep)

- [x] T001 [P] Append `"troy"` to `flairTokens` in `app/backend/internal/validate/validate.go:208`; update the enumerating comment at `validate.go:273`; append `troy` to the operator help-text enumeration in `app/backend/api/operator.go:444` <!-- R1 -->
- [x] T002 [P] Append `"troy"` to `FLAIR_STATES` in `app/frontend/src/themes.ts:494`; add `"troy"` to the doc-comment unions in `app/frontend/src/types.ts` (~68, ~107); update the "13 named states" doc comments in `app/frontend/src/components/swatch-popover.tsx` (~53, ~78, ~624) to 14 <!-- R1 -->

### Phase 2: CSS treatment

- [x] T003 Author the `.rk-flair-troy` block in `app/frontend/src/globals.css` (after the spidey block): pixel-art SVG data-URI sheets (horse + pullers walk frames + blank frame; wall + gate day/night sheet; beach/skyline day/fire-A/fire-B scene tiles), `rk-flair-troy-*` keyframes on one ~24s master loop with phase percentages, `::before` backdrop + two-layer `::after` occlusion, background-position longhands only, balanced offsets, D-dividing sub-cadences, flicker ≥ 0.3s/frame; update the flair section header comment (~482) with `troy` <!-- R2, R3, R4 --> <!-- rework: traversal endpoint calc(100% - 30px) never overlaps the wall layer — gate occlusion (R3) does not occur; A-003 unmet — FIXED in rework cycle 1: endpoint re-derived as calc(100% + 11px) (percentage offsets resolve against box−image width; sheet left edge parks at W−29, rear inside the gate window [W−24, W−16]) -->
- [x] T004 Add `.rk-flair-troy::before, .rk-flair-troy::after` to the reduced-motion flair enumeration in `globals.css` (~1320) and bump its "all thirteen named states" comment to fourteen <!-- R5 -->

### Phase 3: Tests

- [x] T005 [P] Update backend tests: `validate_test.go:529` valid list + invalid case/whitespace variants; `operator_test.go:960` enumeration string <!-- R7 -->
- [x] T006 [P] Update frontend tests: `themes.test.ts:532` expected array; `swatch-popover.test.tsx` (~457 count/last-state, ~801 column-clamp on the 7/7 grid); `sidebar/index.test.tsx:2080`; `flair-overlay.test.tsx` sample loop <!-- R6, R7 -->

### Phase 4: Verification

- [x] T007 Run the verification gates: `cd app/backend && go test ./...`; `cd app/frontend && npx tsc --noEmit`; `just test-frontend`; visually sanity-check the flair via the picker if a dev rig is available (optional) <!-- R7 -->

## Execution Order

- T001/T002 are parallel and block nothing except their tests
- T003 blocks T004 (the gate enumerates rules that must exist first, source-order)
- T005/T006 parallel after Phase 1–2
- T007 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `"troy"` present, appended last, in both `FLAIR_STATES` and `flairTokens`; `validate.go` comment, `operator.go` help text, and `types.ts` doc unions updated
- [x] A-002 R2: `.rk-flair-troy` exists in `globals.css` with a single master-loop duration shared by all its keyframe timelines and the four narrative phases encoded as keyframe percentages
- [x] A-003 R3: `::after` carries the wall+gate layer above the horse sheet (right-edge-anchored, no-repeat) and the traversal ends inside the gate; `::before` carries the day/night scene backdrop — verified after rework cycle 1: endpoint `calc(100% + 11px)` resolves to sheet-left = (W−40)+11 = W−29; the 40px sheet spans [W−29, W+11], overlapping the wall layer ([W−28, W]) by 29px with the horse's rear (image x 5–13 → box [W−24, W−16]) parked exactly inside the gate opening (wall art leaves x 4–12 open below the lintel → box [W−24, W−16]); the wall layer is first in `background-image` so it paints over the horse — genuine occlusion, not a cut
- [x] A-004 R6: The picker flair band renders 14 cells (7/7 computed split) with `troy` last; `FlairOverlay` renders `troy` as a bare span

### Behavioral Correctness

- [x] A-005 R2: Loop boundary is seamless — at 0%/100% the sprite is off-screen or parked blank and the backdrop is on its day frame; all sub-cadence periods divide the master duration exactly
- [x] A-006 R5: Under `prefers-reduced-motion: reduce`, both `troy` pseudos are `display: none` with `animation: none`; counts in comments updated (thirteen → fourteen)

### Scenario Coverage

- [x] A-007 R7: All enumerated test files updated and passing (backend + frontend)

### Edge Cases & Error Handling

- [x] A-008 R4: No `transform`/`left` animation on row pseudos anywhere in the new block; strips are fixed-height with static anchoring (box-agnostic across 18–36px+ boxes); fire flicker ≥ 0.3s/frame
- [x] A-009 R1: A write of `troy` to `@rk_flair`/`@rk_session_flair` validates (closed-set acceptance), and case/whitespace variants are rejected

### Code Quality

- [x] A-010 Pattern consistency: The new CSS block follows the flair section's comment style (narrated block comment with geometry/timing), keyframe naming register, and source placement (before the reduced-motion gate)
- [x] A-011 No unnecessary duplication: No shared keyframes with other flairs; no duplicated utility logic; art inline like every other sheet
- [x] A-012 Magic numbers: Loop math constants (durations, offsets) explained in the block comment per house style

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Master loop D = 24s exactly (sub-cadences: 0.4s walk step = D/60, 0.6s fire flicker = D/40, scene steps at whole-percent keyframes) | ~24s was the intake's indicative figure; exact divisors keep the integer-multiple math trivial to verify; trivially tunable | S:70 R:85 A:85 D:75 |
| 2 | Confident | Wall+gate slice ~28px wide anchored right; horse+pullers sheet ~40px wide, 22px frames (~4 walk + 1 blank) | Sized against the 22px strip norm and existing sheet widths (30–36px); pullers need horizontal room ahead of the horse | S:60 R:85 A:80 D:70 |
| 3 | Certain | CSS block placement after spidey's, before the reduced-motion gate | Source-order rule is a documented contract in the flair section | S:80 R:90 A:100 D:95 |

3 assumptions (1 certain, 2 confident, 0 tentative).
