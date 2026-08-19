# Plan: Universal Flair Catalogue Refresh

**Change**: 260819-lrm8-universal-flair-catalogue-refresh
**Intake**: `intake.md`

## Requirements

### Vocabulary: single universal flair set

#### R1: Frontend vocabulary grows to 10 named flairs
`FLAIR_STATES` in `app/frontend/src/themes.ts` (currently :472) MUST become `["", "nyan", "naruto", "onepiece", "pacman", "matrix", "aquarium", "roadrunner", "invaders", "cube", "warp"]` (order fixed; `FlairState` follows automatically). Flair doc-comment enumerations in `app/frontend/src/types.ts` (the `flair?` fields on session and window types) SHALL be updated to match.

- **GIVEN** the frontend build
- **WHEN** `FLAIR_STATES` is imported
- **THEN** it contains exactly the 11 values above in that order

#### R2: Backend closed set mirrors the frontend
`flairTokens` in `app/backend/internal/validate/validate.go` (currently :205) MUST become the same 10 names (no empty string — empty means "unset" per the existing structure). Adjacent doc comments (`validate.go` ~:261–272 — "the three named states", `""`/nyan/naruto/onepiece enumerations) SHALL be updated. No `ValidateServerFlairValue`, no second set.

- **GIVEN** any flair write seam (window `@rk_flair` via POST /options, session flair via POST /api/sessions/{session}/flair)
- **WHEN** a new token (e.g. `invaders`) is submitted
- **THEN** validation accepts it; unknown tokens (including `train`, `dvd`, `tetris`) are rejected

### Treatments: seven new flair CSS blocks

#### R3: pacman, matrix, aquarium, warp ported verbatim from PR #606
The CSS blocks (keyframes + rules + inline-SVG data URIs) for `.rk-flair-pacman` / `.rk-flair-matrix` / `.rk-flair-aquarium` / `.rk-flair-warp` MUST be ported **verbatim** from the local git ref `pr-606-view`'s `app/frontend/src/globals.css` (pacman ~:859, matrix ~:900, aquarium ~:929, warp ~:1146) into this branch's `globals.css`, appended after the existing onepiece block. The `train` block (~:797–845) and the dvd/tetris/invaders/cube tile blocks MUST NOT be ported (invaders/cube ship the new box-agnostic versions in R5/R6 instead).

- **GIVEN** a row with `@rk_flair=aquarium` (or pacman/matrix/warp)
- **WHEN** the sidebar renders
- **THEN** the overlay animates exactly as on the PR #606 branch

#### R4: roadrunner (zip-blur)
A `.rk-flair-roadrunner` block MUST be added from the staged `assets/variants.css` class `.fx-rr-b` (2-frame 36×44 sheet, 3s traversal, 0.3s step cadence, `::before` speed-streak ambience), renamed to house style (`rk-flair-roadrunner-*` keyframes) with its **own** streak keyframes (never reusing naruto's).

- **GIVEN** a row with `@rk_flair=roadrunner`
- **WHEN** the sidebar renders
- **THEN** the zip-blur bird traverses left→right in ~3s with streaks racing the opposite way

#### R5: invaders (stepped wandering trio)
A `.rk-flair-invaders` block MUST be added from staged `assets/variants.css` class `.fx-inv3`: a 44×44 2-frame crab-trio sheet on a centered 22px strip `::after`; `background-position-x` 0%→100% over 13s **alternate with `steps(26, jump-none)`** (discrete jumps), `background-position-y` 2-frame wiggle at 1s step-end so each jump lands on an arm-flip. Pure background-position — no transforms.

- **GIVEN** a row (or any box) with `@rk_flair=invaders`
- **WHEN** the overlay animates
- **THEN** three crabs shuffle across the full box width in discrete wiggle-synced steps

#### R6: cube (DVD-ricochet wireframe)
A `.rk-flair-cube` block MUST be added from staged `assets/variants.css` class `.fx-cube2`: `container-type: size` on the overlay; nested wrapper spans animating `translateX(calc(100cqw - 18px))` 16s alternate and `translateY(calc(100cqh - 18px))` 7.5s alternate; a 16px 6-face accent-green wireframe cube (`translateZ(8px)`, perspective 260px) on an 8s tumble. Class names renamed to the `rk-` prefix (final names at apply's discretion; keyframes `rk-flair-cube-*`).

- **GIVEN** any box with `@rk_flair=cube`
- **WHEN** the overlay animates
- **THEN** the cube tumbles while ricocheting around the whole box (horizontal bounce in a row, 2D in a taller box)

### Artwork swaps

#### R7: naruto option A (true run)
Inside the existing `.rk-flair-naruto` block: the runner data URI MUST be replaced with the option-A 30×88 sheet from staged `assets/variants.css` `.fx-naruto-a`, and the x-keyframe constants adjusted for the 30px width (from `-30px`/`-150px` to `calc(100% + 34px)`/`calc(100% + 4px)` — balanced so runner and the UNCHANGED 120×44 wind-trail layer displace identically). `::before` streaks unchanged. Block comment updated to describe the new sheet.

- **GIVEN** a row with `@rk_flair=naruto`
- **WHEN** the overlay animates
- **THEN** the redrawn runner (short swept-back arms, spiky hair, whiskers, headband tails) traverses with the wind trail glued behind

#### R8: onepiece option A (Jolly-Roger sail)
Inside the existing `.rk-flair-onepiece` block: a pure `background-image` data-URI swap to the option-A 34×88 sheet from staged `assets/variants.css` `.fx-op-a` (straw-hat Jolly-Roger emblem on the mainsail, plain black pennant). Geometry and every keyframe constant identical; block comment updated.

- **GIVEN** a row with `@rk_flair=onepiece`
- **WHEN** the overlay animates
- **THEN** the ship shows the straw-hat skull emblem on its sail; hull/wake/waves/roll unchanged

### Mounting: shared overlay component

#### R9: FlairOverlay component with child-span contracts and drag guard
A new shared component `app/frontend/src/components/flair-overlay.tsx` MUST render the flair overlay span (`absolute inset-0 z-[5] overflow-hidden pointer-events-none rk-flair-{value}`, aria-hidden) plus the per-flair children: cube's nested wrapper/cube/6-face spans and warp's three `.rk-warp-plane` spans; other flairs render the bare span. `window-row.tsx` and `session-row.tsx` MUST mount it in place of their bare flair spans, and the overlay MUST be hidden on a drag-source row (cube/warp animate transforms on child spans, which would corrupt drag ghosts — mirror the simplest workable guard).

- **GIVEN** a window row with `@rk_flair=cube` being dragged
- **WHEN** the drag starts
- **THEN** the flair overlay is hidden for the drag's duration; at rest it renders the cube markup and animates

#### R10: Picker flair section grows to 11 cells in three logical rows
In `app/frontend/src/components/swatch-popover.tsx`: the flair section renders ∅ + 10 cells flowing in the existing 4-wide grid (visual rows of 4/4/3). Keyboard nav MUST treat them as three logical rows (`FLAIR_ROW`, `+1`, `+2`): flair index `i` at row `FLAIR_ROW + floor(i/4)`, col `(i%4)+1`; ArrowRight clamps at each row's last cell; ArrowDown/Up move between flair rows clamping to the short last row; the marker-column exception (col 0 → col 1 on entry) extends to all flair rows; activation maps `(row, col)` back to the right `FLAIR_STATES` index. Preview cells for cube/warp render their child markup via `FlairOverlay`.

- **GIVEN** the Label picker open with flair support
- **WHEN** the user arrows Down from the color grid through the flair rows and presses Enter on the 11th cell
- **THEN** focus walks 4/4/3 as laid out and `onSelectFlair("warp")` fires

### Motion discipline

#### R11: Reduced-motion coverage
The existing `prefers-reduced-motion` gate block in `globals.css` (currently ~:879–884) MUST be extended to hide every new/changed flair's animated elements — the seven new flairs' pseudos plus cube/warp child spans (`animation: none; display: none` per the existing pattern) — and its comment updated. All flair CSS blocks MUST stay ahead of the gate in source order.

- **GIVEN** `prefers-reduced-motion: reduce`
- **WHEN** any flaired row renders
- **THEN** no flair overlay is visible or animating

### Verification

#### R12: Tests
Go: extend the `TestValidateFlairValue` accept/reject matrix in `validate_test.go` (all 10 + `""` accepted; `train`/`dvd`/`tetris`/garbage rejected). Frontend: update `themes.test.ts` (FLAIR_STATES contents), `swatch-popover.test.tsx` (option count 20+Clear+✕+11 = 33; FLAIR_STATES order; live previews incl. cube/warp markup; three-row keyboard nav), `session-row.test.tsx`/`window-row.test.tsx` where they enumerate flair classes, plus new `flair-overlay` coverage (child markup per flair, drag hide). Gates: `cd app/backend && go test ./...`, `cd app/frontend && npx tsc --noEmit`, targeted vitest suites.

- **GIVEN** the test suites
- **WHEN** run through the gates above
- **THEN** all pass with the new vocabulary asserted

### Non-Goals

- `train`, `dvd`, `tetris` flairs — rejected in design review.
- Server-tile flair rendering and any server-flair option/endpoint — no such surface exists on main; PR #606's rescope mounts this same set on tiles.
- Two-class vocabulary (`TILE_FLAIR_STATES`/`SERVER_FLAIR_STATES`/`ValidateServerFlairValue`) — explicitly rejected.
- Rescoping PR #606 itself.
- New Playwright specs — decoration-only overlays, no route/behavior change (no `.spec.md` obligations).

### Design Decisions

#### One universal flair set, box-agnostic treatments
**Decision**: A single `FLAIR_STATES` vocabulary; every treatment fills whatever box mounts it (22px row strip or future server tile) — full-box ambience, centered strips, percentage-position wander, or container-query-unit ricochet.
**Why**: The user rejected a separate tile-only state outright; box-agnostic treatments make tile mounting (PR #606's rescope) a zero-vocabulary follow-up.
**Rejected**: Per-box sprite variants (two sheets per flair) — double the assets and a vocabulary fork; full-width repeat-x tiling for character flairs — read as noise ("too loud") in review.
*Introduced by*: 260819-lrm8-universal-flair-catalogue-refresh

#### Wander via percentage background-position; invaders stepped
**Decision**: Cluster flairs (invaders) wander with `background-position-x: 0%→100%` alternate — percentage positioning maps image-edge to box-edge, so it is box-agnostic with zero transforms; invaders quantizes the wander with `steps(26, jump-none)` synced to its 0.5s arm-flip.
**Why**: Keeps rows inside the never-transform rule wherever possible; the stepped shuffle is the identity read of Space Invaders.
**Rejected**: Transform-wrapper wander for invaders (needless drag-guard surface); smooth linear drift (lost the character).
*Introduced by*: 260819-lrm8-universal-flair-catalogue-refresh

#### Cube/warp keep child-span transforms behind a drag-time hide
**Decision**: cube and warp animate transforms on dedicated child spans (3D needs transforms); rows hide the flair overlay while the row is a drag source.
**Why**: The row transform ban exists for drag-ghost integrity; hiding during drag removes the hazard while keeping the treatments.
**Rejected**: Banning cube/warp from rows (recreates a tile-only class, which the user rejected); accepting transforms un-guarded (corrupts drag ghosts).
*Introduced by*: 260819-lrm8-universal-flair-catalogue-refresh

## Tasks

### Phase 1: Setup

- [x] T001 Verify staged assets exist and carry the final classes — `fab/changes/260819-lrm8-universal-flair-catalogue-refresh/assets/variants.css` (`.fx-naruto-a`, `.fx-op-a`, `.fx-rr-b`, `.fx-inv3`, `.fx-cube2`) and `assets/flair-only.css`; confirm git ref `pr-606-view` resolves (`git rev-parse pr-606-view`) <!-- R3 -->

### Phase 2: Core Implementation

- [x] T002 [P] Update `FLAIR_STATES` in `app/frontend/src/themes.ts` to the 11-value array and the flair doc-comment enumerations in `app/frontend/src/types.ts` <!-- R1 -->
- [x] T003 [P] Update `flairTokens` in `app/backend/internal/validate/validate.go` to the 10 names and fix the adjacent doc comments (~:261–272) <!-- R2 -->
- [x] T004 Port the pacman, matrix, aquarium, and warp CSS blocks verbatim from `pr-606-view:app/frontend/src/globals.css` into `app/frontend/src/globals.css` after the onepiece block (skip train and every other tile block) <!-- R3 -->
- [x] T005 Add the roadrunner block to `app/frontend/src/globals.css` from `assets/variants.css` `.fx-rr-b`, renamed `.rk-flair-roadrunner` / `rk-flair-roadrunner-*` with its own streak keyframes; write a house-style block comment <!-- R4 -->
- [x] T006 Add the invaders block to `app/frontend/src/globals.css` from `assets/variants.css` `.fx-inv3`, renamed `.rk-flair-invaders` / `rk-flair-invaders-*`; house-style comment covering the stepped percentage wander <!-- R5 -->
- [x] T007 Add the cube block to `app/frontend/src/globals.css` from `assets/variants.css` `.fx-cube2`, renamed to `rk-` classes / `rk-flair-cube-*` keyframes; house-style comment covering container-query travel + 260px perspective <!-- R6 -->
- [x] T008 Swap the naruto runner data URI + x-keyframe constants in `app/frontend/src/globals.css` per `assets/variants.css` `.fx-naruto-a` (trail layer and `::before` untouched); update the block comment <!-- R7 -->
- [x] T009 Swap the onepiece sail data URI in `app/frontend/src/globals.css` per `assets/variants.css` `.fx-op-a` (pure background-image swap); update the block comment <!-- R8 -->
- [x] T010 Extend the `prefers-reduced-motion` gate enumeration in `app/frontend/src/globals.css` to all 10 flairs' animated elements (pseudos + cube/warp child spans) and update its comment <!-- R11 -->
- [x] T011 Create `app/frontend/src/components/flair-overlay.tsx` (overlay span + per-flair child markup + drag-source hide) and mount it from `app/frontend/src/components/sidebar/window-row.tsx` and `session-row.tsx` <!-- R9 -->
- [x] T012 Grow the swatch-popover flair section to 11 cells in three logical rows with coherent keyboard nav and `FlairOverlay`-based preview cells (`app/frontend/src/components/swatch-popover.tsx`) <!-- R10 -->

### Phase 3: Integration & Edge Cases

- [x] T013 [P] Extend the Go accept/reject matrix in `app/backend/internal/validate/validate_test.go` (10 + "" accepted; train/dvd/tetris/garbage rejected) <!-- R12 -->
- [x] T014 [P] Update frontend tests: `themes.test.ts`, `swatch-popover.test.tsx` (33 options, order, previews, 4/4/3 nav), `session-row.test.tsx` / `window-row.test.tsx` flair enumerations; add `flair-overlay.test.tsx` (child markup per flair, drag hide) <!-- R12 -->
- [x] T015 Run the gates: `cd app/backend && go test ./...`; `cd app/frontend && npx tsc --noEmit`; targeted vitest for the touched suites <!-- R12 -->

## Execution Order

- T002–T003 parallel; T004–T010 are sequential edits to `globals.css` (single file); T011 blocks T012 (picker previews consume FlairOverlay); T013–T014 parallel after Phase 2; T015 last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `FLAIR_STATES` is exactly the 11-value array in the fixed order; `types.ts` flair comments enumerate the same set
- [x] A-002 R2: `flairTokens` carries the 10 names; validate.go doc comments no longer say "three named states" or enumerate the old set
- [x] A-003 R3: pacman/matrix/aquarium/warp blocks are byte-equivalent to their `pr-606-view` sources; no train/dvd/tetris CSS anywhere
- [x] A-004 R4: `.rk-flair-roadrunner` exists with own `rk-flair-roadrunner-*` keyframes (no `fx-` names, no reuse of naruto's streak keyframes)
- [x] A-005 R5: `.rk-flair-invaders` wander uses `steps(26, jump-none)` over percentage x-position; only background-position animates
- [x] A-006 R6: `.rk-flair-cube` uses container-type: size, cq-unit travel (16s/7.5s alternate), 260px perspective, 16px cube
- [x] A-007 R7: naruto block carries the new 30×88 URI with x constants `-30px`/`-150px` → `calc(100% + 34px)`/`calc(100% + 4px)`; trail URI and `::before` byte-identical to main
- [x] A-008 R8: onepiece block differs from main only in the background-image URI and comment
- [x] A-009 R9: `FlairOverlay` renders bare span for sheet flairs, cube markup (wrappers + 6 faces) and warp markup (3 planes) for those values
- [x] A-010 R10: picker renders ∅+10 flair cells; Enter on each cell emits its exact state

### Behavioral Correctness

- [x] A-011 R9: dragging a flaired row hides its overlay for the drag duration; rest state restores it
- [x] A-012 R10: arrow nav walks the 4/4/3 flair rows (Right clamps per row, Down/Up clamp onto the short row, marker-column entry maps col 0→1); existing color/marker nav unchanged

### Scenario Coverage

- [x] A-013 R12: Go matrix covers all 10 + "" accepted and train/dvd/tetris rejected
- [x] A-014 R12: swatch-popover tests assert 33 options, FLAIR_STATES order, and animated previews including cube/warp child markup

### Edge Cases & Error Handling

- [x] A-015 R11: reduced-motion hides every flair's animated elements (pseudos and child spans); flair blocks precede the gate in source order
- [x] A-016 R3: nyan block and all marker/scanline/dash-rain CSS are untouched (diff confined to flair blocks + gate)

### Code Quality

- [x] A-017 Pattern consistency: new CSS blocks follow the established flair comment/keyframe/naming discipline; component follows sidebar component patterns
- [x] A-018 No unnecessary duplication: shared FlairOverlay is the single mount; no per-caller flair markup copies

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. The three bare flair-span snippets (window-row, session-row, swatch-popover preview) were already removed in the apply diff itself, replaced by the shared `FlairOverlay` mount.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Three logical picker flair rows (4/4/3) mapped onto the wrapped 4-wide grid; index↔(row,col) mapping `FLAIR_ROW + floor(i/4)` / `(i%4)+1` | Grid code read directly — cells already flow in the 4-wide grid, so logical rows matching the visual wrap is the only nav that moves where the eye expects | S:80 R:90 A:85 D:85 |
| 2 | Confident | Drag guard = hide the overlay on the drag-source row for ALL flairs (not just cube/warp) | Simplest uniform guard; matches #606's dragged-tile hide; per-flair gating adds branching for no user-visible win | S:65 R:90 A:80 D:70 |
| 3 | Confident | warp ports verbatim (keeps `.rk-flair-warp` name and 3-plane markup) rather than being redrawn | User: "warp was already ok"; the block is box-agnostic already (inset −150% planes) | S:75 R:85 A:85 D:80 |
| 4 | Certain | Final cube class names take the `rk-` prefix (`.rk-flair-cube` + `rk-cube`-family children), keyframes `rk-flair-cube-*` | House naming discipline; mock's `fx-`/`cx`/`cy` names were scaffolding | S:85 R:95 A:90 D:90 |

4 assumptions (2 certain, 2 confident, 0 tentative).
