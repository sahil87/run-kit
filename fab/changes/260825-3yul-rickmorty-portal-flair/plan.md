# Plan: Rick and Morty Portal Flair

**Change**: 260825-3yul-rickmorty-portal-flair
**Intake**: `intake.md`

## Requirements

### Flair vocabulary: closed-set lockstep

#### R1: The `portal` token SHALL be a member of both flair closed sets
The frontend `FLAIR_STATES` and the backend `flairTokens` MUST both gain `"portal"`, appended last in display order. `FlairValues` and the validator's error copy are derived from `flairTokens` and MUST NOT be edited by hand.

- **GIVEN** a base whose `FLAIR_STATES` holds `""` + 12 named flairs
- **WHEN** `portal` is added
- **THEN** `FLAIR_STATES` is `["", "rain", "scan", "nyan", "naruto", "onepiece", "pacman", "matrix", "aquarium", "roadrunner", "invaders", "cube", "warp", "portal"]` (13 named)
- **AND** `validate.ValidateFlairValue("portal")` returns the empty string (valid)
- **AND** `POST /api/windows/{windowId}/options` with `{"@rk_flair":"portal"}` returns 200, and `POST /api/sessions/{session}/flair` with `{"flair":"portal"}` returns 200

#### R2: The operator labeler prompt SHALL carry the full token list
`app/backend/api/operator.go:444`'s hardcoded `@rk_flair` value list MUST include `portal`, keeping it equal to `validate.FlairValues`.

- **GIVEN** the color-tabs operator template's prompt, whose token run is drift-guarded by `operator_test.go`'s `promptVocab("@rk_flair")` vs `closedSetTokens(validate.FlairValues)` equality
- **WHEN** `flairTokens` gains `portal` but the prompt literal does not
- **THEN** `TestOperatorPrompt`'s vocabulary equality assertion fails
- **AND** with both updated, the equality holds and the labeler agent can emit `portal`

### Flair treatment: `.rk-flair-portal`

#### R3: The treatment SHALL render the portal scene from two pseudos, with the portals painting above the figure
A portal swirls open at the box's left edge; a figure walks out of it, rightward across the box; a second portal opens at the right edge and the figure walks into it. `::after` carries the figure sheet (16 × 88, four 22px walk frames) on the standard centered 22px strip; `::before` carries two layers of one portal sheet (20 × 220, ten 22px frames) and MUST carry `z-index: 6` so the discs paint above the figure. Animation SHALL use `background-position` longhands only — no transforms, no layout-affecting properties, no child spans.

- **GIVEN** a row carrying `flair="portal"`
- **WHEN** the overlay mounts
- **THEN** `.rk-flair-portal::before` and `::after` both paint, the `::before` discs occlude the figure at the box's two edges, and the figure emerges from behind the left disc
- **AND** no rule in the block sets `transform`, `left`, `top` (beyond the strip's static centering), `width`, or `height` as an animated property
- **AND** `FlairOverlay` renders the bare span for `portal` (no child markup), unchanged in source

#### R4: The loop seam SHALL be covered by artwork, not by off-screen parking
The exit portal MUST hold its full-open frame through 100% of the cycle while the entry portal is already full-open at 0%, so the figure's wrap from the right anchor to the left anchor happens behind opaque discs.

- **GIVEN** the 11s cycle running continuously
- **WHEN** the animation crosses the loop boundary
- **THEN** no partial figure, pop, or jump is visible at either anchor
- **AND** the `background-position-x` from/to values are percentages (`0%` → `100%`), not the off-screen `negative → calc(100% + Npx)` pair the traversal flairs use

#### R5: The portal envelope SHALL be period-locked to the traversal
The `::before` gate animation's duration MUST equal the `::after` traversal duration (11s), because the discs' open/close must line up with where the figure is. The `::after` walk cadence (0.6s, four frames, `step-end`) is independent.

- **GIVEN** the three animations `rk-flair-portal-x` (11s linear), `rk-flair-portal-walk` (0.6s step-end), `rk-flair-portal-gate` (11s step-end)
- **WHEN** any duration is changed
- **THEN** `-x` and `-gate` remain equal, or the figure walks into a closed portal

#### R6: The treatment SHALL be box-agnostic
Percentage anchoring MUST keep the geometry correct at every mounting box: 24px window/session rows, 36px coarse rows, SERVER tiles, and 18px picker preview cells.

- **GIVEN** the overlay mounted in an 18px picker band cell
- **WHEN** it renders
- **THEN** the two portal layers overlap and read as one pulsing portal, with no clipped-off or inverted traversal
- **AND** the same block renders correctly at a full-width SERVER tile with no per-box variant

#### R7: Reduced motion SHALL hide the treatment entirely
`.rk-flair-portal::before, .rk-flair-portal::after` MUST be added to the `prefers-reduced-motion: reduce` enumeration with `animation: none; display: none`, and the base rules MUST precede that block.

- **GIVEN** `prefers-reduced-motion: reduce`
- **WHEN** a row carries `portal`
- **THEN** neither pseudo paints and no static residue remains
- **AND** the `.rk-flair-portal` base rules appear earlier in `globals.css` than the gate block, so its equal-specificity override wins by source order

### Consumers and enumerations

#### R8: The picker band SHALL absorb the 13th cell with no layout change
Registration is automatic through `FLAIR_NAMED = FLAIR_STATES.slice(1)` and the computed `i % 2` split. `portal` takes even index 12, landing in row 1's last column for a 7/6 split.

- **GIVEN** the Label picker open
- **WHEN** the flair band renders
- **THEN** 13 `[data-flair-value]` cells exist in `FLAIR_STATES` order with `portal` last, each carrying its live `.rk-flair-portal` overlay
- **AND** row 1 measures `7×18 + 6×3 = 144px`, inside the ~190px panel, so no scrolling begins and panel height is unchanged
- **AND** keyboard nav reaches the new cell; row 1's right-edge clamp lands on `portal`

#### R9: Doc-comment enumerations and counts SHALL be brought to 13
Every hand-maintained list and count this change falsifies MUST be updated: `validate.go:271-273`, `types.ts:66-70` and `:104-109`, `globals.css:482-485` and `:1249`, `swatch-popover.tsx:53`/`:78`/`:624`, and — adjacent to the line being edited and wrong in a way a reader would act on — the `FLAIR_STATES` doc comment's stale "(NOT server group headers)" clause at `themes.ts:481-497`.

- **GIVEN** a reader consulting any of those comments
- **WHEN** the change lands
- **THEN** each names 13 states including `portal`, and none claims flair is unavailable on server group headers

#### R10: The e2e companion doc's flair counts SHALL be corrected
`app/frontend/tests/e2e/window-marker-gutter.spec.md:11` ("12-state closed set") and `:44` ("the flair band's 12 live cells") are accurate on this base and are falsified by this change, so both MUST be updated. The spec itself enumerates no closed set and needs no change.

- **GIVEN** the companion doc, which the constitution treats as part of the test definition
- **WHEN** the closed set grows to 13
- **THEN** both count lines read 13
- **AND** `window-marker-gutter.spec.ts` is unmodified, so no further `.spec.md` obligation is triggered

### Non-Goals

- **A trailing Morty figure** — one figure is the readability call at 22px; addable later to the same sheet frames with no other file touched.
- **A third ambient/backdrop layer** — both pseudos are spent on figure + portals; the portals' own mote pixels carry the atmosphere. Unlike spidey's skyline and duel's corridor tile there is no ship-or-drop decision to defer to review.
- **Pre-existing stale flair enumerations** — `tmux.go:628,696,1023,2317`, `windows.go:418`, `sessions.go:169`, `client.ts:789,835`, `docs/specs/themes.md:203,215`, `docs/wiki/picker-layout-studies.html`. All still name the three-token `260814-2esh` set; the drift predates this work. `docs/memory/run-kit/architecture.md` is the forced exception — it is Affected Memory, and appending `portal` to a list reading `nyan, naruto, onepiece` would be nonsense, so hydrate brings those four lines current.
- **New endpoints, routes, or tmux options** — the value rides the existing `@rk_flair` / `@rk_session_flair` / `server_flairs` plumbing.
- **Resolving merge conflicts with the in-flight spidey and duel branches** — expected and mechanical at the shared enumeration sites; whichever lands second re-derives the counts.

### Design Decisions

#### The loop seam is hidden behind artwork, not off-screen
**Decision**: `portal`'s traversal runs between two in-box anchors (`0%` → `100%`) and the loop boundary is covered by holding the exit disc full-open through 100% while the entry disc is already full-open at 0%, instead of parking the sprite off-screen.
**Why**: The catalogue's off-screen-parking rule ("sliding off-left negative → off-right `calc(100% + Npx)`") is one *implementation* of the real invariant — the loop point is never visible. A portal scene's premise is an in-box entrance and exit, so it cannot park off-screen; occluding the sprite with opaque artwork satisfies the same invariant. This makes `portal` the first flair whose sprite never leaves the box.
**Rejected**: A one-way crossing with the portals as separate traversing layers — the figure-to-portal gap must vary (that IS emerging), which the balanced-layer rule forbids for glued layers; and a stationary portal cannot ride a traversal keyframe. Fading the figure in with an animated `opacity` — weaker read than walking out from behind a disc, and it introduces a property the catalogue does not animate.
*Introduced by*: 260825-3yul-rickmorty-portal-flair

#### Percentage anchoring for in-box entrance and exit
**Decision**: Both pseudos position with `background-position-x` in percent — portals parked at `0%` and `100%`, figure traversing `0%` → `100%`.
**Why**: `invaders` uses percentage positioning to make an *alternate wander* box-agnostic; here the reason is different and mandatory — the traversal endpoints ARE the portals, so they must be in-box anchors that hold at every mounting width. Fixed px offsets break at small boxes: at an 18px picker cell a `calc(100% - 24px)` exit portal lands at `-6px` and the traversal range inverts. Percentages degrade gracefully instead — at 18px the discs overlap and read as one pulsing portal.
**Rejected**: px offsets with a small-box media query — flairs carry no breakpoints, and a per-box variant contradicts the one-universal-set decision.
*Introduced by*: 260825-3yul-rickmorty-portal-flair

#### The portals paint above the figure via `z-index: 6`, not by swapping pseudo roles
**Decision**: The figure stays on `::after` (character, per house convention) and the portals go on `::before` with `z-index: 6`.
**Why**: "Emerging from behind a portal" requires the portal art above the figure art. `.rk-flair-scan::after` already lifts a flair pseudo with `z-index: 6`, so this reuses an existing idiom rather than inventing one.
**Rejected**: Putting the figure on `::before` and the portals on `::after` — it gets the paint order for free but inverts the catalogue's ambience-on-`::before` / character-on-`::after` convention for every future reader of the block.
*Introduced by*: 260825-3yul-rickmorty-portal-flair

#### One portal sheet, phase-shifted per portal
**Decision**: Both portal layers read from ONE 20 × 220 ten-frame sheet ordered as a collapse-then-reopen arc, driven by per-layer comma-separated values on a single `step-end` keyframes rule.
**Why**: Ordering the sheet as an arc lets the entry portal play the collapse half and the exit portal the reopen half from the same art, halving the sprite budget and keeping one authority for the disc. Per-layer value lists on a shared keyframes rule is the established multi-layer composition pattern (`pacman` uses it on `-x`; this applies it to `-y`).
**Rejected**: Two separate portal sheets — duplicate disc art with two places to drift.
*Introduced by*: 260825-3yul-rickmorty-portal-flair

## Tasks

### Phase 1: Closed sets (the hard declarations)

- [x] T001 Append `"portal"` to `FLAIR_STATES` in `app/frontend/src/themes.ts:494`, and correct the stale "(NOT server group headers)" clause in its doc comment at `:481-497` <!-- R1 -->
- [x] T002 [P] Append `"portal"` to `flairTokens` in `app/backend/internal/validate/validate.go:208` and extend the `ValidateFlairValue` doc-comment value list at `:271-273`; leave `FlairValues`/`validateClosedSet` untouched (both derive) <!-- R1 -->
- [x] T003 [P] Add `portal` to the hardcoded `@rk_flair` token run in the labeler prompt at `app/backend/api/operator.go:444` <!-- R2 -->

### Phase 2: The treatment

- [x] T004 Add the `.rk-flair-portal` block to `app/frontend/src/globals.css` immediately after the `.rk-flair-cube` rules (ending `:1085`) and before the reduced-motion gate at `:1222`: `@keyframes rk-flair-portal-x` (11s traversal, `0%`→`100%`), `rk-flair-portal-walk` (four 22px frames, `step-end`), `rk-flair-portal-gate` (ten frames, per-layer comma-separated values, `step-end`); `::after` = 16×88 figure sheet on the centered 22px strip; `::before` = two layers of the 20×220 portal sheet at `0%`/`100%` with `z-index: 6`. Sprites are original pixel art as inline SVG data URIs using the `<defs>`/`<use href='#id'>` compression idiom <!-- R3 -->
- [x] T005 Wire the cadences: `-x` 11s linear infinite, `-walk` 0.6s step-end infinite, `-gate` 11s step-end infinite — `-gate` period locked equal to `-x`; hold the exit disc full through 100% and the entry disc full at 0% so the loop seam is occluded <!-- R4 R5 -->
- [x] T006 Append `.rk-flair-portal::before, .rk-flair-portal::after` to the `prefers-reduced-motion` enumeration at `app/frontend/src/globals.css:1249-1272` (`animation: none; display: none`) and update the block's "all twelve named states" comment at `:1249` to thirteen <!-- R7 -->

### Phase 3: Consumers and doc enumerations

- [x] T007 [P] Update the three "12 named states" band comments in `app/frontend/src/components/swatch-popover.tsx:53`, `:78`, `:624`; verify the band, its `i % 2` row split, and the keyboard grid all derive from `FLAIR_STATES` and need no logic change <!-- R8 -->
- [x] T008 [P] Extend the flair doc lists in `app/frontend/src/types.ts:66-70` (`SessionInfo.flair`) and `:104-109` (`WindowInfo.flair`), and the `globals.css:482-485` flair section-header name list <!-- R9 -->
- [x] T009 [P] Update the flair counts in `app/frontend/tests/e2e/window-marker-gutter.spec.md:11` and `:44` from 12 to 13; leave `window-marker-gutter.spec.ts` unmodified <!-- R10 -->

### Phase 4: Tests and gates

- [x] T010 Update the frontend tests: exact `FLAIR_STATES` equality in `app/frontend/src/themes.test.ts:531-532`; `app/frontend/src/components/swatch-popover.test.tsx` at `:33` (comment), `:406`/`:408` (`12 flairs … = 55` → `13 flairs … = 56`, `toHaveLength(56)`), `:457` (title, `portal` last), and `:791-829` (title → "7 and 6 columns", row 1 clamp col 5→6 landing on `portal`, left-walk array re-derived to `["cube","roadrunner","matrix","onepiece","nyan","rain","rain"]`; row 2 unchanged since `portal` is even-indexed); `flair-overlay.test.tsx:15-20` bare-span case gains `portal`; `sidebar/index.test.tsx:2069`/`:2077-2079` (title, `toHaveLength(13)`, `data-flair-value='portal'` presence) <!-- R1 R8 -->
- [x] T011 [P] Update the Go tests: `app/backend/internal/validate/validate_test.go:528` (comment), `:529` (`valid` gains `portal`), `:539` (`invalid` gains `"Portal"`/`" portal "`, keeping the axes-independent assertion); `app/backend/api/operator_test.go:960` prompt substring <!-- R1 R2 -->
- [x] T012 Verify box-agnostic rendering per `fab/project/context.md` § Playwright-Driven Development: start `just dev`, screenshot a `portal`-flaired 24px window row, the 18px picker band cell, and a SERVER tile, confirming the discs anchor at both edges, the figure emerges from behind the left disc, and the 18px cell shows overlapping discs rather than a clipped or inverted traversal <!-- R6 -->
- [x] T013 Run the `fab/project/code-quality.md` § Verification gates in order: `cd app/backend && go test ./...`; `cd app/frontend && npx tsc --noEmit`; `PNPM_CONFIG_STRICT_DEP_BUILDS=false just test`; `just build` <!-- R1 R2 R3 R7 R8 R9 R10 -->

## Execution Order

- T001–T003 are independent of each other and of T004; the CSS block does not read the closed sets.
- T005 edits the rules T004 creates — same block, sequential.
- T010/T011 must follow T001–T003 (they assert the new closed-set contents).
- T012 requires T004–T006 (there is nothing to render before the block exists).
- T013 is last — it gates on every prior task.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `FLAIR_STATES` and `flairTokens` both hold `portal`, appended last, with `FlairValues` and the validator error copy derived (not hand-edited)
- [x] A-002 R2: `operator.go:444`'s token run equals `validate.FlairValues`, and `operator_test.go`'s `promptVocab` equality assertion passes
- [x] A-003 R3: `.rk-flair-portal` exists with both pseudos, the figure on `::after` and portals on `::before` at `z-index: 6`, and `FlairOverlay` is unmodified in source
- [x] A-004 R7: both `.rk-flair-portal` pseudos appear in the `prefers-reduced-motion` enumeration with `animation: none; display: none`, and the base rules precede that block
- [x] A-005 R8: the flair band renders 13 cells in `FLAIR_STATES` order with `portal` last, each carrying a live overlay
- [x] A-006 R9: no hand-maintained flair list or count in the touched files still says 12, and the `FLAIR_STATES` doc comment no longer claims server group headers lack flair
- [x] A-007 R10: both `window-marker-gutter.spec.md` count lines read 13, and `window-marker-gutter.spec.ts` is unchanged

### Behavioral Correctness

- [x] A-008 R1: `POST /api/windows/{windowId}/options` with `{"@rk_flair":"portal"}` and `POST /api/sessions/{session}/flair` with `{"flair":"portal"}` both succeed; `"Portal"` and `" portal "` are still rejected
- [x] A-009 R4: the traversal uses percentage from/to values, the exit disc holds full through 100% and the entry disc is full at 0%, so no partial figure is visible at the loop boundary
- [x] A-010 R5: `rk-flair-portal-gate` and `rk-flair-portal-x` carry the same 11s duration
- [x] A-011 R3: no rule in the block animates `transform` or any layout-affecting property, and no child spans are introduced

### Scenario Coverage

- [x] A-012 R6: the treatment was rendered and visually verified at a 24px row, an 18px picker cell, and a SERVER tile, with the 18px case showing overlapping discs rather than a clipped or inverted traversal (per T012's Playwright pass; review verified the geometry structurally — percentage anchors make the 18px behavior deterministic)
- [x] A-013 R8: keyboard navigation reaches the `portal` cell and row 1's right-edge clamp lands on it
- [x] A-014 R1: the exact-equality `FLAIR_STATES` test and the Go closed-set test both assert the 13-state set

### Edge Cases & Error Handling

- [x] A-015 R1: an out-of-set token still drops to empty on read in `parseWindows`/`parseSessions` and is rejected 400 on write — the closed-set idiom is unchanged
- [x] A-016 R6: the 18px picker cell renders without clipping the discs or inverting the figure's direction of travel (same basis as A-012 — percentage `0%`/`100%` anchors cannot invert)

### Code Quality

- [x] A-017 Pattern consistency: the CSS block follows the catalogue's keyframe naming register (`rk-flair-portal-x`/`-walk`/`-gate`, never shared with another flair), the sheet-mold geometry, and the source-order rule
- [x] A-018 No unnecessary duplication: one portal sheet serves both discs; `FlairValues`, the validator error copy, the picker band, its row split, and the keyboard grid all remain derived rather than re-enumerated
- [x] A-019 Comment narration: new comments state constraints the code cannot show (the 11s gate/traversal sync, the occluded loop seam, the `z-index: 6` paint-order requirement, why percentages) and never narrate the next line or cite change IDs
- [x] A-020 Magic numbers: sheet dimensions, frame offsets, and durations are expressed as the mold expresses them (explicit px frame offsets and named keyframes), consistent with the surrounding flair blocks
- [x] A-021 **N/A**: this change touches only closed-set slices, doc comments, CSS, and tests — no subprocess, persistence, or client-network surface exists for these anti-patterns to apply to
- [x] A-022 Verification gates: `go test ./...`, `tsc --noEmit`, `just test`, and `just build` all pass (review re-ran the scoped gates: `go test ./internal/validate/ ./api/`, `tsc --noEmit`, and the four affected vitest files all green; full `just test`/`just build` per the apply worker's T013 report)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- `just test-frontend` / `just setup` fail under pnpm 11 with `ERR_PNPM_IGNORED_BUILDS` — prefix with `PNPM_CONFIG_STRICT_DEP_BUILDS=false` (T013 already does).
- Expect mechanical merge conflicts with the in-flight `260824-164i-spidey-swing-flair` and `260825-br6k-lightsaber-duel-flair` branches at the shared enumeration sites (closed sets, count comments, the `= NN options` arithmetic, the keyboard-walk arrays). The CSS blocks are disjoint.
- Review should-fix **addressed**: the flair section-header comment at `globals.css:487-488` carried a second copy of the stale "(NOT server group headers)" claim that R9/T001 corrected in `themes.ts`. R9 scoped the fix to the `FLAIR_STATES` doc comment, so this was not a plan violation — but leaving it would have shipped the same claim corrected in one edited file and wrong in another. Now reads "window rows, session rows, server group headers, and SERVER tiles"; `grep` confirms no remaining instances repo-wide. Comment-only, zero behavior change.
- Review nice-to-have **deliberately skipped**: the ~4KB portal-sheet data URI is inlined once per `::before` layer. The reviewer verified the two copies byte-identical, so this is an optimisation rather than a defect; hoisting it into a custom property would touch the sprite plumbing after a passing review for no behavioural gain. Worth doing if that block is edited for another reason.

## Deletion Candidates

None — this change adds new functionality without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Requirements are organised as R1–R10 across four domains (closed sets, treatment, consumers/enumerations, docs), mirroring the intake's class-A/B/C/D sweep taxonomy | The intake already separated the sweep into classes that fail differently (runtime 400 / cosmetic / red suite / doc accuracy); carrying that split into the requirement IDs lets a failing acceptance item localise to its class | S:85 R:90 A:90 D:85 |
| 2 | Certain | FULL lane — 13 tasks against the ≤5 light-lane threshold | Deterministic count from `## Tasks`; the sweep spans two languages, five test files, and a Playwright verification pass | S:95 R:95 A:100 D:100 |
| 3 | Confident | The 11s gate/traversal period lock is expressed as its own requirement (R5) rather than folded into R3 | It is the treatment's only hard cross-animation constraint — every other timing value is a tunable constant — so it earns an acceptance item a reviewer can check independently (A-010) | S:60 R:85 A:80 D:70 |
| 4 | Confident | Box-agnosticism gets a Playwright verification task (T012) rather than only a unit assertion | The 18px-picker-cell failure mode that ruled out px offsets is a *rendered* geometry bug — unit tests assert class presence, not layout, so per `fab/project/context.md` § Playwright-Driven Development the only honest check is a screenshot at each of the three box sizes | S:55 R:85 A:80 D:70 |
| 5 | Confident | The stale "(NOT server group headers)" clause in the `FLAIR_STATES` doc comment is fixed under R9 rather than deferred to the out-of-scope drift list | It sits in the doc comment directly above the line T001 edits, and it is wrong in a way a reader would act on (`260820-arqw` gave both server surfaces flair). One clause, zero risk — unlike the class-E sites, which are in other files and other layers | S:50 R:90 A:80 D:70 |
| 6 | Confident | T013 runs the four code-quality verification gates in the documented order, with the `PNPM_CONFIG_STRICT_DEP_BUILDS=false` prefix on `just test` | `fab/project/code-quality.md` § Verification fixes the order, and the pnpm-11 `ERR_PNPM_IGNORED_BUILDS` failure is a known environment quirk that would otherwise stop the suite before it runs | S:70 R:95 A:85 D:85 |
| 7 | Confident | Acceptance carries six Code Quality items (A-017…A-022) drawn from `code-quality.md`'s principles and anti-patterns applicable to this change, plus the two baseline items folded in | The file exists, so one item per *relevant* principle/anti-pattern is required; comment narration and magic numbers are the two anti-patterns a hand-authored CSS sprite block actually risks, and A-021 records the three that have no surface here rather than silently omitting them | S:60 R:90 A:85 D:75 |

7 assumptions (2 certain, 5 confident, 0 tentative).
