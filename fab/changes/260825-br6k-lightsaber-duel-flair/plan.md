# Plan: Lightsaber Duel Flair

**Change**: 260825-br6k-lightsaber-duel-flair
**Intake**: `intake.md`

## Requirements

### Closed Sets: the `duel` token

#### R1: Frontend closed set gains `duel`
`FLAIR_STATES` in `app/frontend/src/themes.ts` SHALL gain `"duel"` appended as the last named state (after `"spidey"`), preserving the existing order (empty string first, `rain`/`scan` leading the named order).

- **GIVEN** the frontend flair vocabulary
- **WHEN** `FLAIR_STATES` is read
- **THEN** `"duel"` is a valid `FlairState` and appears as the 14th named state
- **AND** every consumer deriving from `FLAIR_STATES` (picker band, overlay, gating) sees it without further edit

#### R2: Backend closed set gains `duel` (lockstep with R1)
`flairTokens` in `app/backend/internal/validate/validate.go` SHALL gain `"duel"` appended last, so `FlairValues` and `ValidateFlairValue` accept it on `@rk_flair` (window) and `@rk_session_flair` (session) writes.

- **GIVEN** a window or session flair write
- **WHEN** the value is `"duel"`
- **THEN** validation passes and the tmux option is written
- **AND** case variants and padded forms (`"Duel"`, `" duel "`) remain rejected (the closed-set rule)
- **AND** the generated error copy enumerates `duel` among the accepted values

#### R3: The labeler-agent prompt token list gains `duel`
The `@rk_flair` value list in the operator labeler prompt (`app/backend/api/operator.go:444`) SHALL gain `duel`.

- **GIVEN** a labeler agent choosing a flair for a window
- **WHEN** it reads the prompt's `@rk_flair` token list
- **THEN** `duel` is among the values it may emit
- **AND** a value it emits from that list never 400s at the validator (the list and `flairTokens` agree)

### Visual Treatment: `.rk-flair-duel`

#### R4: The sprite-sheet block
A `.rk-flair-duel` treatment SHALL be added to `app/frontend/src/globals.css`, placed after the `.rk-flair-spidey` block and before the `prefers-reduced-motion` gate, following the character-flair sprite-sheet mold:

- `::after` is a **centered 22px strip** (`top: 50%; height: 22px; margin-top: -11px`) carrying an inline-SVG data-URI **vertical sheet of 38×220 — ten 22px frames**, frame *n* at `background-position-y: -22n`, `background-repeat: no-repeat`, `background-size: 38px 220px`.
- Both combatants are drawn into **every frame of the one sheet** — never as two independently-positioned background layers.
- The ten frames encode, in order: guard → advance → high clash → press → break with a low red sweep → the Jedi's jump over that sweep → land and downstrike → low clash → retreat → guard on the opposite foot.
- The two `background-position` longhands compose: `-x` runs `0% → 100%` under `steps(60, jump-none)` over **30s `infinite alternate`**; `-y` steps the ten frames with **explicit `step-end` keyframes** (eleven stops at `0px … -198px`, the last stop repeating `-198px`) over **5s**, i.e. 0.5s per frame — exactly one wander step per fight frame.
- Keyframes are named `rk-flair-duel-wander` and `rk-flair-duel-fight`; a companion layer, if it ships, uses `rk-flair-duel-corridor`. Keyframes SHALL NOT be shared with any other flair.
- Animation SHALL use `background-position` only — no `transform`, no layout-affecting properties. The cube/warp child-span exception is NOT invoked, so `FlairOverlay` needs no new markup.

- **GIVEN** a row, server tile, or 18px picker cell whose flair is `duel`
- **WHEN** it renders without `prefers-reduced-motion`
- **THEN** two figures duel on a centered 22px strip, drifting side to side across the full box width and reversing at each edge
- **AND** the treatment animates only `background-position`, so no compositor layer grows beyond the box (the drag-ghost rule holds)
- **AND** the px frame offsets hold identically at 24px rows, 36px coarse rows, and 18px picker cells

#### R5: Blade and figure legibility
The sheet's palette SHALL make the two blades the brightest marks and keep the figures near-silhouette.

- The blue blade is a 1px full-opacity stroke in a bright cyan-blue; the red blade a 1px full-opacity stroke in a bright red. These SHALL be the only fully saturated, fully opaque strokes in the sheet.
- Clash frames carry a small white flash block at the blade crossing point — the brightest mark in the sheet.
- The Jedi is drawn in light robes; Vader in a near-black charcoal fill **carrying a 1px cool-gray rim** on the silhouette edge, so the figure reads against both dark rows (the shipped default) and light rows. A pure-`#000` fill SHALL NOT be used.

- **GIVEN** the duel flair on a dark row and on a light row
- **WHEN** a viewer looks at it at row scale
- **THEN** blue and red read as distinct blades in both themes
- **AND** Vader's silhouette remains visible against a dark background rather than merging into it

#### R6: Reduced-motion gate
The `prefers-reduced-motion` enumeration block in `globals.css` SHALL gain `.rk-flair-duel::before, .rk-flair-duel::after` with `animation: none; display: none` — hidden entirely, no static fallback — with the base rules preceding the gate block (the source-order rule).

- **GIVEN** a viewer with `prefers-reduced-motion: reduce`
- **WHEN** a `duel`-flaired row renders
- **THEN** the overlay pseudos are hidden entirely, with no residual static artwork
- **AND** the row's text, color tint, and marker are unaffected

### Enumeration Lockstep

#### R7: Doc comments and counts move with the closed sets
Every doc comment and count that enumerates the flair vocabulary SHALL be updated in the same commit: `validate.go`'s `ValidateFlairValue` comment; `types.ts`'s two flair doc lists; `globals.css`'s section-header name list and its reduced-motion "all thirteen named states" count; and `swatch-popover.tsx`'s three "13 named states" band comments.

- **GIVEN** a reader of any flair enumeration in source
- **WHEN** they read the list or the count
- **THEN** it names fourteen states including `duel`
- **AND** no source comment still claims thirteen

#### R8: Test enumerations move with the closed sets
Every test asserting the closed set or its cardinality SHALL be updated: the exact `FLAIR_STATES` equality; the backend valid/invalid `@rk_flair` lists; the operator prompt substring; the picker's total-options arithmetic (56 → 57), band listing, and keyboard-walk expectations; the overlay bare-span coverage; and the sidebar band cell count (13 → 14).

- **GIVEN** the full test suite
- **WHEN** it runs after the closed sets gain `duel`
- **THEN** every suite passes with no stale cardinality or ordering assertion
- **AND** the invalid-forms cases still reject `"Duel"` and `" duel "`

#### R9: Consumers absorb the 14th value without layout rework
`FlairOverlay` and the picker flair band SHALL pick `duel` up from `FLAIR_STATES` with no structural change. `duel` takes odd index 13, landing in the band's row 2 last column for a 7/7 split.

- **GIVEN** the Label picker's `[ flair ]` band
- **WHEN** it renders after `duel` is added
- **THEN** a live animated `duel` cell appears in row 2's last column, keyboard-reachable, carrying `data-flair-value="duel"`
- **AND** the maximum row width stays 7, so the 190px panel keeps constant height and does not scroll
- **AND** `FlairOverlay` emits the bare `rk-flair-duel` span with no child markup

### Non-Goals

- Fixing pre-existing stale flair enumerations that predate this change (`tmux.go`, `windows.go`, `sessions.go`, `client.ts`, `docs/specs/themes.md`, the e2e `.spec.md` counts, the frozen wiki design study) — the drift predates this work and the spidey change did not touch it either; folding an unrelated cleanup in would inflate the diff and blur review.
- Any new e2e spec. Flairs are asserted at unit level via class and `data-flair-value` presence; the one flair-touching Playwright file does not enumerate the closed set.
- Any change to `FlairOverlay`'s markup, the picker's layout, or the backend API surface.

### Design Decisions

#### Two-figure scenes ride one sheet, never balanced layers
**Decision**: A flair depicting two interacting characters draws both into every frame of a single sprite sheet, rather than compositing two independently-positioned background layers.
**Why**: The distance between interacting figures must change per frame — closing, clashing, and breaking apart *is* the content. The multi-layer mold requires every layer's from/to constants to be balanced so the layers displace by identical px and never separate, which forbids exactly that varying gap. Drawing the pair into each frame is the mold-conforming way to animate a changing relationship.
**Rejected**: Two sprite layers on one pseudo with independent x offsets (breaks the balanced-layer rule and would let the combatants drift apart across a loop); two pseudos, one per figure (spends `::before` on the second figure, leaving no layer for ambience, and still desynchronizes).
*Introduced by*: 260825-br6k-lightsaber-duel-flair

#### Alternate wander suits mutually-facing figures; one-way traversal does not
**Decision**: A flair whose characters face **each other** uses the invaders wander (`background-position-x: 0%→100%`, `steps(n, jump-none)`, `infinite alternate`) rather than the linear off-left-to-off-right traversal the solo character flairs use.
**Why**: A duel has no destination, so a crossing reads wrong; and an alternate traversal reverses direction, which would demand mirrored artwork for any figure facing the way it travels. Two figures facing each other face *across* the direction of travel, so both halves of the alternate cycle read correctly from one sheet. The traversal model and the subject reinforce each other rather than trading off.
**Rejected**: Linear `-x` traversal from a negative offset to `calc(100% + Npx)` (the solo-character mold — implies the pair is going somewhere, and loses the pacing of a fight that holds ground); a mirrored second half of the sheet to support a reversing one-way crossing (doubles the sheet for no visual gain).
*Introduced by*: 260825-br6k-lightsaber-duel-flair

#### Near-silhouette figures carry a rim, never a pure-black fill
**Decision**: A flair figure meant to read as a dark silhouette is drawn as a near-black charcoal fill plus a 1px lighter rim on its silhouette edge, not as pure `#000`.
**Why**: Flair sheets carry hardcoded colors (CSS custom properties cannot resolve inside a data URI), so one palette must work in every theme. Rows ship dark by default, where a pure-black figure merges into the background and the silhouette read is lost precisely where it matters most. The rim costs one stroke and preserves the intent in both themes.
**Rejected**: Pure `#000` fill (invisible on dark rows); theme-conditional sheets (two data URIs per flair — a vocabulary fork the universal-flair-set decision rules out).
*Introduced by*: 260825-br6k-lightsaber-duel-flair

## Tasks

### Phase 1: Closed Sets

- [x] T001 [P] Append `"duel"` to `FLAIR_STATES` in `app/frontend/src/themes.ts:494`; update the exact-equality enumeration test in `app/frontend/src/themes.test.ts:531-532` <!-- R1 -->
- [x] T002 [P] Append `"duel"` to `flairTokens` in `app/backend/internal/validate/validate.go:208` and update the `ValidateFlairValue` doc comment at `:273`; add `"duel"` to the valid list in `app/backend/internal/validate/validate_test.go:529` and `"Duel"` / `" duel "` to the invalid list at `:539` <!-- R2, R7, R8 -->
- [x] T003 [P] Append `duel` to the labeler prompt `@rk_flair` token list in `app/backend/api/operator.go:444`; update the prompt substring assertion in `app/backend/api/operator_test.go:959-960` <!-- R3, R8 -->

### Phase 2: The Sprite Sheet

- [x] T004 Author the `.rk-flair-duel` block in `app/frontend/src/globals.css`, inserted after the `.rk-flair-spidey` block (ends ~`:1156`) and before the reduced-motion gate: `rk-flair-duel-wander` keyframes (`0%`→`100%`), `rk-flair-duel-fight` keyframes (eleven `step-end` stops, `0px` … `-198px` with the last repeated), and the `::after` rule (centered 22px strip, 38×220 ten-frame inline-SVG data URI, `no-repeat`, `steps(60, jump-none)` 30s alternate wander + 5s `step-end` fight). Draw the sheet with `<defs>` + `<use href='#id'>` symbols and per-frame `<g transform='translate(0,22n)'>` wrappers, following the invaders and spidey idioms <!-- R4 -->
- [x] T005 Within the same block, apply the R5 palette: 1px full-opacity blue and red blade strokes as the only fully saturated marks, a white flash block at the crossing point in the clash frames, light robes for the Jedi, and a near-black charcoal fill with a 1px cool-gray silhouette rim for Vader (never pure `#000`) <!-- R5 -->
- [x] T006 Add the optional `::before` corridor-backdrop layer (≈64px period tile, bottom-hugging, neutral gray at low fill opacity, own `rk-flair-duel-corridor` keyframes, one-direction `linear infinite` drift — NOT `alternate`), then judge it at row scale and DELETE it if it reads as noise against the two-figure scene. Record which way it went in the change's notes <!-- R4 -->

### Phase 3: Gate and Enumerations

- [x] T007 Add `.rk-flair-duel::before, .rk-flair-duel::after` to the `prefers-reduced-motion` enumeration block in `app/frontend/src/globals.css` (~`:1344`) with `animation: none; display: none`, keeping base rules ahead of the gate; if T006 dropped the `::before`, enumerate only `::after` <!-- R6 -->
- [x] T008 [P] Update the remaining source enumerations: the flair section-header name list at `app/frontend/src/globals.css:482-485`, the "all thirteen named states" count at `:1320`, the two flair doc lists in `app/frontend/src/types.ts:68` and `:107`, and the three "13 named states" band comments in `app/frontend/src/components/swatch-popover.tsx:53`, `:78`, `:624` <!-- R7 -->

### Phase 4: Test Enumerations

- [x] T009 Update `app/frontend/src/components/swatch-popover.test.tsx`: the "13 named flair states" comment at `:33`; the total-options arithmetic and length assertion at `:406` and `:408` (56 → 57); the band-listing test at `:457`; and the keyboard-walk test at `:552`, `:791`, `:798-810` — the title "walk 7 and 6 columns" becomes 7 and 7, the row-1 col-6 clamp changes, and the hardcoded left-walk array must be re-derived from the new 7/7 split <!-- R8, R9 -->
- [x] T010 [P] Extend `app/frontend/src/components/flair-overlay.test.tsx:15` bare-span coverage to `duel`; update the band cell count and presence assertions in `app/frontend/src/components/sidebar/index.test.tsx:2069`, `:2077-2080` (13 → 14 live cells) <!-- R8, R9 -->

### Phase 5: Verification

- [x] T011 Run the verification gates in order per `fab/project/code-quality.md`: `cd app/backend && go test ./...`; `cd app/frontend && npx tsc --noEmit`; then `PNPM_CONFIG_STRICT_DEP_BUILDS=false just test-frontend`. Confirm no stale-cardinality failures remain <!-- R8 -->

## Execution Order

- T001–T003 are independent of each other and of Phase 2; they may run in parallel.
- T005 edits the sheet T004 authors — T004 blocks T005. T006 is a separate pseudo and may follow either.
- T007 depends on T006's ship/drop decision (which pseudos to enumerate).
- T009 depends on T001 (the band's cell count derives from `FLAIR_STATES`).
- T011 runs last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `FLAIR_STATES` contains `"duel"` as its last entry and `FlairState` accepts it
- [x] A-002 R2: `ValidateFlairValue("duel")` passes; window `@rk_flair` and session `@rk_session_flair` writes accept `"duel"`
- [x] A-003 R3: The operator labeler prompt's `@rk_flair` token list names `duel`
- [x] A-004 R4: `.rk-flair-duel` exists in `globals.css` with `rk-flair-duel-wander` and `rk-flair-duel-fight` keyframes, a 38×220 ten-frame sheet on a centered 22px strip, and both combatants drawn into every frame of that one sheet
- [x] A-005 R6: The reduced-motion block enumerates the `duel` pseudos with `animation: none; display: none`
- [x] A-006 R7: No source comment or count in `globals.css`, `types.ts`, `validate.go`, or `swatch-popover.tsx` still claims thirteen flair states

### Behavioral Correctness

- [x] A-007 R4: The wander is `background-position-x: 0% → 100%` with `steps(60, jump-none)` over 30s `alternate`, and the fight is a 5s `step-end` sequence of eleven stops — one wander step per fight frame
- [x] A-008 R4: The treatment animates `background-position` only; no `transform` and no layout-affecting property appears in the block, and `FlairOverlay` gained no `duel` branch
- [x] A-009 R5: The blue and red blades are the only fully saturated full-opacity strokes in the sheet, and Vader's fill is a near-black charcoal with a 1px rim rather than pure `#000`
- [x] A-010 R9: The picker band renders 14 live cells with `duel` at row 2's last column; the maximum row width is 7 and the panel neither grows nor scrolls

### Scenario Coverage

- [x] A-011 R4: The ten frames are visually distinguishable and encode the specified cycle — clashes with blades crossing, one figure jumping a low swing, and advancing/retreating footwork
- [x] A-012 R8: The full suite passes: `go test ./...`, `npx tsc --noEmit`, and the frontend unit tests, with no stale cardinality or ordering assertion left

### Edge Cases & Error Handling

- [x] A-013 R2: Invalid forms (`"Duel"`, `" duel "`, unknown names) remain rejected by `ValidateFlairValue`
- [x] A-014 R4: The px frame offsets hold at 24px rows, 36px coarse rows, and 18px picker cells — nothing in the block depends on the mounting box's height
- [x] A-015 R5: Vader's silhouette remains readable against a dark row background (the shipped default) and against a light one

### Code Quality

- [x] A-016 Pattern consistency: The CSS block follows the character-flair mold — a leading explanatory comment in the register of its siblings, keyframes above the rule, `no-repeat` sheet layers, and per-flair keyframe names shared with nothing else
- [x] A-017 No unnecessary duplication: The sheet uses `<defs>` + `<use>` symbols rather than hand-repeated figure pairs, and no existing keyframe or utility is re-implemented
- [x] A-018 Comment narration: The block's comment states the constraints and geometry the code cannot show (frame count, offsets, the one-step-per-frame sync, the ship/drop decision on `::before`) and never narrates the next line or cites change IDs
- [x] A-019 Magic numbers: The frame offsets, step count, and durations are internally consistent — 10 frames × 22px = the 220px sheet height, and 30s ÷ 60 steps = the 0.5s frame period

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- T006's ship/drop decision on the `::before` corridor layer: **SHIPPED**. Rendered at row scale (24px dark + light rows, corridor + fight frame composited) — the 0.08/0.13 neutral-gray struts and grating read as faint ambient depth below the duel, not noise; the two-figure scene stays dominant. Both pseudos are enumerated in the reduced-motion gate.

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. Every edit is an enumeration append or a count/expectation update in lockstep with the new `duel` token; no symbol, branch, file, or config lost its last consumer.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Requirements split the lockstep into R1/R2/R3 (hard closed sets), R7 (comments/counts), and R8 (tests) rather than one omnibus requirement | The three classes fail differently — a stale `flairTokens` is a 400 at runtime, a stale comment is cosmetic, a stale test is a red suite — so separating them lets review localize a failure to its class | S:70 R:85 A:85 D:75 |
| 2 | Certain | The verification gate uses `PNPM_CONFIG_STRICT_DEP_BUILDS=false` for the frontend tests | `just test-frontend` fails with `ERR_PNPM_IGNORED_BUILDS` under pnpm 11 without it; this is a known environment constraint in this checkout | S:80 R:95 A:90 D:90 |
| 3 | Confident | Keyframes are named `rk-flair-duel-wander` / `-fight` (and `-corridor`), following invaders' semantic naming rather than the `-x`/`-y` register | `-x`/`-y` belongs to the linear-crossing flairs where the axes *are* the traversal; invaders — the only other alternate-wander flair — names its keyframes for what they do, which is the closer precedent | S:45 R:95 A:80 D:70 |
| 4 | Confident | The `::before` corridor layer is authored (T006) but explicitly subject to deletion after a visual judgment at row scale, with the outcome recorded in Notes | The intake graded it optional; a two-figure scene is the busiest in the catalogue, so the noise risk is real and only judgeable once rendered. Building-then-judging is cheaper than deciding blind, and deleting one pseudo costs nothing | S:35 R:95 A:55 D:45 |
| 5 | Confident | Task decomposition splits sheet authoring (T004) from palette application (T005) even though both edit the same block | Authoring ten frames of two figures and tuning the blade/silhouette legibility are different kinds of work with different failure modes; splitting them lets a rework cycle re-do the palette without re-authoring the geometry | S:50 R:90 A:70 D:60 |
| 6 | Confident | Pre-existing stale enumerations are declared a Non-Goal rather than silently ignored | Carrying them as an explicit Non-Goal stops review from flagging them as missed lockstep while keeping the scope boundary auditable | S:55 R:90 A:85 D:75 |

6 assumptions (2 certain, 4 confident, 0 tentative).
