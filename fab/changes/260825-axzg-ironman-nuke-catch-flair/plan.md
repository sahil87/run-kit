# Plan: Iron Man Nuke-Catch Flair

**Change**: 260825-axzg-ironman-nuke-catch-flair
**Intake**: `intake.md`

## Requirements

### Flair Vocabulary: `ironman` closed sets

#### R1: Frontend closed set gains `ironman`
`FLAIR_STATES` in `app/frontend/src/themes.ts` MUST gain `"ironman"` appended after `"spidey"` (append-only — existing values and order untouched). The `FlairState` type derives automatically.

- **GIVEN** the picker's flair band derives from `FLAIR_STATES.slice(1)`
- **WHEN** `FLAIR_STATES` contains `"ironman"`
- **THEN** the band renders a 14th live-preview cell (computed 7/7 alternating row split, no component change)

#### R2: Backend closed set gains `ironman` in lockstep
`flairTokens` in `app/backend/internal/validate/validate.go` MUST gain `"ironman"` appended after `"spidey"`, keeping the two closed sets in lockstep (`FlairValues`/`ValidateFlairValue` derive from it).

- **GIVEN** a `POST` writing `@rk_flair`, `@rk_session_flair`, or a `server_flairs` entry with value `"ironman"`
- **WHEN** the handler validates via `ValidateFlairValue`
- **THEN** the write succeeds (no 400), and any other unknown token still fails

### Visual Treatment: `.rk-flair-ironman` in `globals.css`

#### R3: Two-layer Manhattan parallax backdrop
`.rk-flair-ironman::before` MUST paint TWO bottom-anchored repeat-x NYC-skyline silhouette tiles as background layers on the one pseudo — a near layer (~96px period, ~12px tall, stepped rooftops + one distinctly taller stepped spire, ~12% fill) and a far layer (~64px period, ~8px tall, lower sparser blocks, ~6% fill) — drifting right→left at different speeds, each displacing by an exact multiple of its own period per loop (`rk-flair-ironman-city` keyframes, own, never shared with any other flair). Artwork MUST be distinct from spidey's tile.

- **GIVEN** a flaired row at any width
- **WHEN** the city loop wraps
- **THEN** no visible snap occurs on either layer (exact-multiple displacement), and the two layers visibly move at different speeds

#### R4: Fly-by zoom loop on one `::after` (REVISED — user rejected the two-act nuke-catch after seeing it shipped; this replaces it entirely)
`.rk-flair-ironman::after` MUST render a single-character **fly-by zoom loop** (~12–18s, tunable) from ONE vertical SVG data-URI sprite sheet carrying ONE background layer (no glued companion layers — thruster/repulsor streaks are baked into each frame at the frame's own scale), using only the two `background-position` longhands (no transforms, no layout-affecting properties). The zoom is **frame-encoded fake 3D**: the drawn figure's SIZE varies across frames while the strip geometry stays fixed.

- **Leg 1 — approach (~0–40%)**: Iron Man alone, right-facing horizontal flight pose, enters off-screen LEFT drawn TINY (~6px figure — far away, at city scale) and grows across ~4 frames (≈6 → 10 → 15 → 20px) as `-x` carries him toward the right — reads as flying toward the camera.
- **The turn (~40–60%)**: at his largest (~26–30px hero frames — the "fully zoomed-in" beat; a 30px strip with slight overhang is licensed by the spidey precedent) he executes a 2–3 frame **banking turn** near the RIGHT edge, ON-screen and deliberate: right-facing → three-quarter front → left-facing. The `-x` keyframes REVERSE direction inside this window (no teleport — a direction reversal is just keyframe values, and the turn frames cover the reversal moment so it reads as a banked turn, never a bounce).
- **Leg 2 — return (~60–100%)**: left-facing, shrinking back down (≈20 → 14 → 9 → 6px) as `-x` carries him back left, receding into the skyline — "returns to the city" — exiting off-screen left tiny.

`rk-flair-ironman-x` and `rk-flair-ironman-y` MUST share one duration so the frame narrative stays in sync with the traversal. The loop boundary is at the far-LEFT off-screen park only (start = end), so the wrap is invisible; the right-edge turn is intentionally on-screen. The overlay contract holds: mounted by the existing bare `FlairOverlay` span (`absolute inset-0 z-[5] overflow-hidden pointer-events-none`), box-agnostic (24px rows, 36px coarse rows, server tiles, 18px picker preview cells), colors baked in the artwork (no `--rk-flair-color`), cadence ~5fps step-end, no strobing.

- **GIVEN** a row with `@rk_flair = ironman`
- **WHEN** one full loop plays
- **THEN** a tiny figure enters left, grows while flying right, banks a visible turn at full size near the right edge, then shrinks while flying back left into the city — one continuous character, no empty-row gap, no snap at the wrap
- **GIVEN** the sheet mold
- **WHEN** frames are stepped
- **THEN** only `background-position` animates — no transform, no child spans, and the pseudo carries a single background layer (no glued-layer balancing needed)

#### R5: Reduced-motion gate
`.rk-flair-ironman::before, .rk-flair-ironman::after` MUST be added to the existing `prefers-reduced-motion` enumeration block (`animation: none; display: none`) — hidden entirely, no static fallback. Base rules MUST precede the gate block (source-order rule).

- **GIVEN** `prefers-reduced-motion: reduce`
- **WHEN** a row carries the `ironman` flair
- **THEN** nothing of the flair renders

### Tests & Consumers

#### R6: Closed-set enumeration tests updated
Every test that enumerates the flair vocabulary MUST be updated for the 14th value: `themes.test.ts`, `validate_test.go`, `flair-overlay.test.tsx`, `swatch-popover.test.tsx`, and any other enumeration the spidey diff touched (`sidebar/index.test.tsx` — sweep and mirror).

- **GIVEN** the updated closed sets
- **WHEN** `just test-backend` and the frontend unit suites run
- **THEN** all pass, including an assertion that `ironman` validates and renders its overlay class

#### R7: Zero component change; full verification gates
`flair-overlay.tsx` and `swatch-popover.tsx` MUST NOT need modification (bare-span sheet flair; computed row split). The change MUST pass the project gates: `cd app/backend && go test ./...`, `cd app/frontend && npx tsc --noEmit`, and `just build`.

- **GIVEN** the finished change
- **WHEN** the gates run
- **THEN** all succeed with no component-file diffs outside tests

### Non-Goals

- No portal ring/flash visual — a fixed landmark can't ride a traversing pseudo; flash adds photosensitivity risk
- No Hulk-catch second character — converging layers are impossible under the glued-layer rule
- No GIF/video/binary-asset mechanism — a separate exploration task, explicitly out of this change
- No `--rk-flair-color` tinting — character flairs bake their palette
- No e2e spec (flairs are unit-asserted); if one IS touched, its sibling `.spec.md` updates in the same commit

### Design Decisions

#### Frame-encoded zoom (fake 3D) with an on-screen banked reversal
**Decision**: The fly-by reads as camera depth by varying the DRAWN figure size across sheet frames (~6px far → ~26–30px hero close-up → back), while `-x` traverses left → right-edge → left with a direction reversal covered by 2–3 banking-turn frames; `-x`/`-y` share one duration. Single background layer, effects baked per frame.
**Why**: User rejected the shipped two-act nuke-catch and specified this shape (start tiny at the left, zoom in toward center, full close-up + a fight-scene-style turn at the right, recede back to the city); scale-in-frames is the only zoom available under the no-transform discipline; an on-screen reversal needs no teleport and the turn frames make it read as a bank, not a bounce.
**Rejected**: The shipped two-act carry/teleport loop (user: "didn't like it at all"); transform/`background-size` animation for the zoom (violates the background-position-only discipline and the size longhands don't step cleanly per frame).
*Introduced by*: 260825-axzg-ironman-nuke-catch-flair

#### Two-layer parallax skyline, distinct from spidey's
**Decision**: `::before` carries near+far skyline tiles at different speeds with exact-multiple displacement, original artwork with a Stark-spire silhouette.
**Why**: User directed the design to exceed the spidey flair, restoring the discussion design; nyan/onepiece prove multi-layer parallax; distinct artwork keeps adjacent flaired rows from reading as copies.
**Rejected**: Reusing spidey's single 12px strip idiom — dialed the design down to the prior flair's ceiling.
*Introduced by*: 260825-axzg-ironman-nuke-catch-flair

#### Effects baked per frame; no glued companion layers
**Decision**: Thruster/repulsor streaks are drawn inside each sheet frame at that frame's scale; `::after` carries exactly one background layer.
**Why**: A separate glued trail cannot change size with the figure (glued layers displace, never scale), and a fixed-size trail breaks the zoom illusion; a single layer also removes the equal-px balancing arithmetic entirely.
**Rejected**: The shipped glued 110px contrail (scale-blind); child spans (reserved for cube/warp's transform exception).
*Introduced by*: 260825-axzg-ironman-nuke-catch-flair

## Tasks

### Phase 1: Setup

- [x] T001 [P] Append `"ironman"` to `FLAIR_STATES` in `app/frontend/src/themes.ts` and update the flair closed-set expectations in `app/frontend/src/themes.test.ts` <!-- R1 -->
- [x] T002 [P] Append `"ironman"` to `flairTokens` in `app/backend/internal/validate/validate.go` and update `@rk_flair` closed-set cases in `app/backend/internal/validate/validate_test.go` <!-- R2 -->

### Phase 2: Core Implementation

- [x] T003 Draw the two skyline silhouette SVG tiles (near 96×12, far 64×8, original artwork with Stark-spire) and add `rk-flair-ironman-city` keyframes + the `.rk-flair-ironman::before` rule in `app/frontend/src/globals.css` <!-- R3 -->
- [x] T004 Draw the fly-by zoom sprite sheet (~9–11 frames: 4 right-facing approach frames growing ≈6→10→15→20px, 2–3 banking-turn hero frames at ≈26–30px, 3–4 left-facing return frames shrinking ≈20→6px; thruster streaks baked per frame at frame scale; original pixel art) as an inline SVG data-URI in `app/frontend/src/globals.css`, REPLACING the old two-act sheet + contrail layer <!-- R4 --> <!-- rework: user rejected the two-act nuke-catch — fly-by zoom loop replaces it -->
- [x] T005 Rewrite `rk-flair-ironman-x` (off-screen-left park → right-edge on-screen reversal inside the turn window → back to off-screen-left; loop boundary only at far left) and `rk-flair-ironman-y` (growth → turn → shrink frame narrative, same duration) and the `.rk-flair-ironman::after` rule as a SINGLE background layer (no glued-layer offsets), REPLACING the teleport choreography, in `app/frontend/src/globals.css` <!-- R4 --> <!-- rework: user rejected the two-act nuke-catch — fly-by zoom loop replaces it -->

### Phase 3: Integration & Edge Cases

- [x] T006 Add `.rk-flair-ironman::before, .rk-flair-ironman::after` to the `prefers-reduced-motion` enumeration block in `app/frontend/src/globals.css` (base rules stay above the gate) <!-- R5 -->
- [x] T007 Update frontend enumeration tests for the 14th flair: `app/frontend/src/components/flair-overlay.test.tsx`, `app/frontend/src/components/swatch-popover.test.tsx`, and sweep `app/frontend/src/components/sidebar/index.test.tsx` + any other enumeration the spidey diff (260824-164i) touched <!-- R6 -->

### Phase 4: Polish

- [x] T008 Run verification gates: `cd app/backend && go test ./...`, `cd app/frontend && npx tsc --noEmit`, `just build`; confirm `flair-overlay.tsx`/`swatch-popover.tsx` needed no changes <!-- R7 --> <!-- rework: re-run after the R4 redesign -->


## Execution Order

- T001/T002 are independent ([P])
- T003–T005 build the CSS block in order (backdrop → artwork → choreography); T006 follows the CSS
- T007 needs T001; T008 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `FLAIR_STATES` contains `"ironman"` appended after `"spidey"`; the picker flair band renders 14 cells (7/7) with no `swatch-popover.tsx` change
- [x] A-002 R2: `ValidateFlairValue("ironman")` passes on all three write paths (window option, session option, `server_flairs`); unknown tokens still 400
- [x] A-003 R3: `.rk-flair-ironman::before` paints two skyline layers at different drift speeds, each displacing by an exact multiple of its own tile period per loop
- [x] A-004 R4: `.rk-flair-ironman::after` plays the fly-by zoom loop — a tiny figure enters off-screen left, grows across 4 right-facing frames while flying right, banks an on-screen turn at hero size near the right edge, then shrinks back left into the city — via `background-position` longhands only on one shared duration, single background layer

### Behavioral Correctness

- [x] A-005 R4: The `::after` carries a single layer (no glued offsets to balance); the `-x` direction reversal sits inside the turn-frame window (covered by the banking frames) and the loop boundary lands fully off-screen left (0% = 100% = -36px — no visible snap)
- [x] A-006 R5: Under `prefers-reduced-motion` the flair renders nothing (both pseudos `animation: none; display: none`), and the gate rules sit below the base rules in source order

### Scenario Coverage

- [x] A-007 R6: Frontend unit suites assert the `ironman` cell renders in the picker band and the `rk-flair-ironman` overlay class is emitted; backend closed-set test covers `ironman`
- [x] A-008 R7: `go test ./...`, `npx tsc --noEmit`, and `just build` all pass

### Edge Cases & Error Handling

- [x] A-009 R4: The treatment is box-agnostic — renders correctly on 24px sidebar rows, 36px coarse rows, server tiles, and the 18px picker preview cell (fixed-height strip centering per the catalogue discipline)
- [x] A-010 R4: Step cadence stays ~5fps with no strobing (photosensitivity thresholds per the catalogue rule)

### Code Quality

- [x] A-011 Pattern consistency: keyframe naming (`rk-flair-ironman-*`), pseudo structure, and data-URI style match the adjacent flair blocks; comment style matches the catalogue's header-comment idiom
- [x] A-012 No unnecessary duplication: no keyframes shared with or copied from other flairs (own-keyframes rule); no new components or utilities
- [x] A-013 No magic-free drift: offsets and periods are internally consistent constants within the block (exact-multiple rule verifiable by arithmetic)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | 6-frame sheet (4 carry + 2 fall) at ~5fps; frame height chosen at drawing time within 22–30px (spidey licenses the taller strip) | Intake assumption 12 delegated exact geometry to apply; 4+2 is the minimum that carries flicker+bob and a two-pose tumble | S:60 R:85 A:80 D:70 |
| 2 | Confident | Act split ~47/53 with a ~6% empty-row portal beat inside a ~14–20s loop (user loosened the 14s ceiling — the carry may take the time it needs) | Intake fixed ~14s as pacing baseline and the beat concept; user direction allows longer; exact percentages/duration are tuning constants | S:65 R:90 A:80 D:75 |
| 3 | Confident | Contrail hidden in act 2 by off-screen parking of the shared stack; bake-into-frames is the recorded fallback if the offset math can't guarantee it | Intake assumption 7 pre-authorized both; the parking approach is attempted first as it keeps frames narrower | S:55 R:80 A:70 D:65 |

3 assumptions (0 certain, 3 confident, 0 tentative).
