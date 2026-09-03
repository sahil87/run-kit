# Plan: StatusDot — Shape = Liveness, Failed → Red-Center Overlay

**Change**: 260903-18ot-statusdot-shape-liveness-overlays
**Intake**: `intake.md`

## Requirements

> Binding visual reference: `docs/img/status-dot-reference.svg` — already at the v2 target in this
> worktree (uncommitted). Do NOT re-derive or redraw it; carry it in the commit (R8).

### Dot Model: shape = liveness

#### R1: Shape derives from agent liveness on journey hues
`statusDotState` (`app/frontend/src/components/pr-status-model.ts`) SHALL derive the dot's shape
per family: on the **fab family** and the **agent family** (journey hues), shape is `solid` iff the
window's rolled-up `agentState === "active"`; `waiting`, `idle`, and absent/stale (empty)
`agentState` all yield `ring`. The **floor** is unchanged: `activity === "active"` → solid, else
ring — the L0 output fallback is the floor's alone and MUST NOT reach the journey hues.
`fabShape(displayState)` (shape-from-bookkeeping) SHALL be removed. `fabPhase` (blue/green stage
split) and the `skipped` fall-through are unchanged. `DotShape` narrows to `"ring" | "solid"`.

- **GIVEN** a fab-owned window at stage `ship` with `fabDisplayState: "active"` whose rolled
  `agentState` is `idle` (the `ipad-ui-review` case)
- **WHEN** `statusDotState(win)` runs
- **THEN** it returns `{ phase: "prReady", shape: "ring" }` — a green ring, not solid
- **AND** the same window with `agentState: "active"` returns `shape: "solid"`

- **GIVEN** a fab-owned window with NO `agentState` and `activity === "active"` (a dev server
  flowing output in the worktree pane)
- **WHEN** `statusDotState(win)` runs
- **THEN** shape is `ring` (output never makes a journey hue solid)

- **GIVEN** a floor window (no fab change, no fresh agent) with `activity === "active"`
- **WHEN** `statusDotState(win)` runs
- **THEN** shape is `solid` in gray (floor behavior unchanged)

#### R2: Failure is an additive overlay flag, not a shape
`StatusDotState` SHALL gain `failed?: boolean` (mirroring `waiting?`), true iff the window is
fab-owned and `fabDisplayState === "failed"`. The flag composes with either shape (liveness and
failure are orthogonal). `waiting` computation is unchanged; since a waiting agent is not
`active`, waiting windows get `ring` base + halo (supersedes the shipped waiting-solid behavior).

- **GIVEN** a fab window with `fabDisplayState: "failed"` and `agentState: "active"` (rework live)
- **WHEN** `statusDotState(win)` runs
- **THEN** it returns `{ shape: "solid", failed: true }` in the stage phase
- **AND** with `agentState: "idle"` or absent it returns `{ shape: "ring", failed: true }`

- **GIVEN** any window with rolled `agentState: "waiting"`
- **WHEN** `statusDotState(win)` runs
- **THEN** `shape` is `ring` and `waiting` is true (ring + halo)

#### R10: PR glyph channel untouched
`prOwnsGlyph`, `prGlyphColor`, `prGlyphIcon`, the PR color maps, `isFailish`, and every glyph
call-site SHALL be byte-identical to today. The dot consults no PR field (unchanged).

- **GIVEN** the shipped glyph unit tests and any window with an owned PR
- **WHEN** this change is applied
- **THEN** glyph gating, color, and icon outputs are unchanged

### Rendering: status-dot.tsx

#### R3: Two base shapes + red-center overlay rendering
`StatusDot` (`app/frontend/src/components/status-dot.tsx`) SHALL render two base shapes (solid /
ring) plus two additive overlays (the existing `rk-waiting-halo` class; the new red-center flag).
Flagged (`failed: true`) dots render at the **9px footprint** with the ~**3px** `bg-signal-red`
center (today's failed geometry); unflagged dots stay at `DOT_SIZE` (7px). Over a **ring**: 9px
hollow circle with the standard `1.8px solid currentColor` border + centered red dot. Over a
**solid**: the **bullseye** — 9px filled circle, a dark gap ring cut between fill and red center
(per the SVG's fill → background-colored inner circle → red center construction), so failure
changes the silhouette and is never color alone. The dotted-border `failed` branch is deleted.
Halo rendering/class mechanics are unchanged.

- **GIVEN** `{ shape: "solid", failed: true }`
- **WHEN** `StatusDot` renders
- **THEN** a 9px filled circle in the phase hue with a visible dark gap ring and a ~3px red center
- **AND** `{ shape: "ring", failed: true }` renders a 9px solid-border ring with a ~3px red center
- **AND** no dotted border remains anywhere in the component

- **GIVEN** the real component at 9px in a browser (both themes)
- **WHEN** the bullseye gap is inspected (apply-time in-browser verification, T007)
- **THEN** the gap reads as a silhouette change; if it does not, the pre-approved fallback applies
  (a `1.2px dotted` border on the solid fill instead of the gap ring)

### Labels

#### R4: aria-label vocabulary follows liveness + flags
`dotLabel` (`app/frontend/src/components/status-dot-label.ts`) SHALL compose hue word + liveness
word + flags as a pure function of `StatusDotState`. Fab-hue status words become liveness words —
e.g. `"building — worker live"` (solid), `"PR-ready — at rest"` (ring), failed variants
`"failed — rework live"` (bullseye) / `"failed — at rest"` (ring + center). The additive waiting
suffix (`— agent waiting Xm`) is unchanged. The agent family and floor keep their word families
but the agent family's word MUST reflect the new base shape (a waiting agent no longer reads
`"agent — active"`); the floor's bare `active`/`idle` is unchanged. Exact remaining words are
apply-decided, consistent with these examples and the SVG captions (recorded in `## Assumptions`).

- **GIVEN** a fab building window with a live worker
- **WHEN** `dotLabel(state)` runs
- **THEN** it returns a label of the form `"building — worker live"`; the failed+solid form reads
  `"building — failed — rework live"`; no label ever encodes color or motion alone

### Docs

#### R5: docs/site/status-dot.md rewritten to the v2 model
The page SHALL match the updated SVG: shape strip = 2 shapes (liveness) with the per-family source
rule stated explicitly; a new overlays strip (red center + waiting halo — additive, never a tier);
bullseye silhouette + 9px flagged footprint documented; waiting wraps a ring; updated composed
examples mirroring the SVG row; "Where red appears" (red center is an overlay); the Row-Minimalism
survival table's failed entry; updated aria-label examples; provenance footer noting partial
supersession of `260810-aqo6` (which superseded palette v3).

- **GIVEN** the rewritten page
- **WHEN** read against the embedded SVG
- **THEN** prose and image agree on every strip (no 3-shape or shape-from-displayState claims remain)

#### R6: docs/specs/status-pyramid.md updated
The spec SHALL: give shape 2 values (solid = work happening now / ring = at rest) with the
per-family source in the channel model and tier ladder (`fabDisplayState` now contributes only the
failed overlay flag; `fabStage` the blue/green phase; `skipped` gate unchanged); restate the
overlay/animation channel as carrying TWO additive flags (waiting halo, failed red-center); rework
the decision table (row 5 → yellow · ring · halo; rows 11–16 shape-from-agentState with failed as
overlay; row 20 "live" = live agent; sweep all rows' shape column); mark what-wins-when fact #3
**superseded** with the physically-live-beats-bookkeeping rationale; update failed-shape references
in the duration/attention sections; keep the palette-v3 history block and add the aqo6
shape-channel supersession alongside it; soften the staleness claim (solid ≠ proof of progress;
wedged-solid is the reserved `stuck` overlay's case); document the accepted costs (dispatch
topology reads ring; one-value rollup).

- **GIVEN** the updated spec
- **WHEN** the decision table and ladder are read
- **THEN** no row derives shape from `fabDisplayState` except the failed flag, and fact #3 carries
  a superseded marker with rationale

#### R7: README status-dots bullet updated
README.md § "Status dots — read every window at a glance" SHALL replace the 3-shape prose bullet
with the 2-shapes + overlays vocabulary so the prose stops contradicting the embedded SVG.

- **GIVEN** the README section
- **WHEN** read
- **THEN** it names solid/ring as liveness and the red center + halo as additive overlays

#### R8: Updated SVG carried, not edited
`docs/img/status-dot-reference.svg` SHALL be committed exactly as it stands in the worktree (the
v2 design). No edits.

- **GIVEN** the change's diff
- **WHEN** inspected
- **THEN** the SVG hunk matches the current worktree content byte-for-byte

### Tests

#### R9: Unit + e2e coverage moves with the model
Unit tests SHALL cover the new model and rendering: `pr-status-model.test.ts` (per-family liveness
shape, failed flag, waiting→ring, skipped fall-through, floor unchanged, glyph functions
untouched), `status-dot.test.tsx` (both flagged renders, 9px flagged footprint, no dotted border,
halo, labels), and label-consumer sweeps (`sidebar/row-flyout-card.test.tsx`,
`window-row.test.tsx` if label-coupled). The e2e sweep SHALL update the known anchors —
`agent-next-waiting.spec.ts` (waiting-solid label + intent comment), `row-flyout.spec.ts`
(`"building — active"` label), `pane-register-panel.spec.ts` (verify failed-fixture assertions
target register text vs dot) — AND grep all of `app/frontend/tests/e2e/` for dotted-failed /
solid-on-stage-active / waiting-solid / dot-label references. Playwright `test()` intent comments
are updated in the same commit (constitution).

- **GIVEN** the swept test suites
- **WHEN** `npx tsc --noEmit`, `just test-frontend`, and the swept specs via `just test-e2e` run
- **THEN** all pass with the new expectations, and no spec still asserts the retired vocabulary

### Non-Goals

- No backend/Go changes — `agentState` rollup, PID reconciler, SSE fields, D2 glyph derivation
  untouched.
- No `stuck` overlay — the wedged-live-agent residual stays documented, not fixed.
- No redesign of downstream consumers (registers.ts, flyout card, session tiles, desktop status
  bar, pane panel) — they consume the shared model/label/component; only their tests are swept.
- No glyph changes of any kind (R10).

### Design Decisions

#### Shape source is per-family (agentState on journey hues; L0 only on the floor)
**Decision**: Journey hues (blue · green · yellow) derive shape from the rolled `agentState` only
(absent ⇒ ring); the output-flowing L0 fallback applies to the gray floor alone.
**Why**: `@rk_pane_agent_state` is PID-reconciled — solid cannot outlive the process; a single
global L0 fallback would let any byte source (dev server, log tail) make a fab dot lie solid.
**Rejected**: one uniform agentState-else-L0 rule (re-introduces the stale-solid lie via output);
keeping shape on `fabDisplayState` (bookkeeping renders solid for hours-idle agents — the
motivating bug).
*Introduced by*: 260903-18ot-statusdot-shape-liveness-overlays

#### Failure is an additive red-center overlay, not a shape
**Decision**: `failed` leaves the shape set and becomes `StatusDotState.failed?: boolean`, rendered
as a red center — inside the hollow ring at rest, as a bullseye (dark gap ring) over solid — with
flagged dots keeping the 9px footprint.
**Why**: failure and liveness are orthogonal facts; the overlay makes "failed, nobody on it — act"
vs "failed, rework live" distinct at a glance, and the silhouette change keeps failure legible
without color (a11y).
**Rejected**: moving review-failure to the PR glyph (a `review`-stage failure is pre-PR and the
glyph is owned-PR-gated — the failure would be invisible; and dot-red = my pipeline failed here
vs glyph-red = the PR is failing/closed on GitHub is a load-bearing split); keeping the third
shape (non-compositional, hides rework liveness).
*Introduced by*: 260903-18ot-statusdot-shape-liveness-overlays

#### waiting = ring + halo
**Decision**: A waiting agent renders the ring base under the additive constant-yellow halo.
**Why**: blocked is at rest by definition under shape = liveness; solid must mean work happening
now, with no exceptions.
**Rejected**: keeping the shipped waiting-solid rendering (contradicts the liveness rule exactly
where attention is highest).
*Introduced by*: 260903-18ot-statusdot-shape-liveness-overlays

## Tasks

### Phase 2: Core Implementation

- [x] T001 Rework the dot model in `app/frontend/src/components/pr-status-model.ts`: narrow `DotShape` to `"ring" | "solid"`, add `failed?: boolean` to `StatusDotState`, replace `fabShape` with per-family liveness derivation in `statusDotState` (journey hues: solid iff rolled `agentState === "active"`; floor: activity), keep `fabPhase`/`skipped`/glyph exports byte-identical, update the module's ladder doc comments <!-- R1, R2, R10 -->
- [x] T002 Rework rendering in `app/frontend/src/components/status-dot.tsx`: two base shape renderers + red-center overlay (ring+center at 9px with 1.8px solid border; bullseye over solid at 9px via background-colored gap ring), delete the dotted `failed` branch, keep `rk-waiting-halo` handling and 7px `DOT_SIZE` for unflagged dots <!-- R3 -->
- [x] T003 Update the label vocabulary in `app/frontend/src/components/status-dot-label.ts`: liveness words + failed-flag words per the R4 examples; keep the label a pure function (hue word + liveness word + flags); record chosen words in `## Assumptions` <!-- R4 -->

### Phase 3: Tests & Verification

- [x] T004 [P] Rework `app/frontend/src/components/pr-status-model.test.ts`: per-family shape cases (idle/waiting/absent ⇒ ring on fab and agent hues; active ⇒ solid; floor activity unchanged), failed flag both shapes, skipped fall-through, glyph functions unchanged <!-- R1, R2, R10 -->
- [x] T005 [P] Rework `app/frontend/src/components/status-dot.test.tsx` (flagged 9px renders, bullseye + ring+center structure, no dotted border, halo, labels) and sweep label-coupled assertions in `app/frontend/src/components/sidebar/row-flyout-card.test.tsx` and `window-row.test.tsx` <!-- R3, R4, R9 -->
- [x] T006 E2e sweep in `app/frontend/tests/e2e/`: update `agent-next-waiting.spec.ts` (waiting label + intent comment), `row-flyout.spec.ts` (`"building — active"`), verify `pane-register-panel.spec.ts` failed-fixture assertions; then grep the whole directory for dotted-failed / solid-on-stage-active / waiting-solid / dot-label references and update hits + intent comments <!-- R9 -->
- [x] T007 In-browser verification of the bullseye gap at the real 9px scale (both themes) via the worktree dev rig; apply the pre-approved dotted-border fallback if the gap does not read <!-- R3 -->

### Phase 4: Docs & Gates

- [x] T008 [P] Rewrite `docs/site/status-dot.md` to the v2 model (shape strip, overlays strip, composed examples, Where-red-appears, Row-Minimalism failed entry, aria examples, aqo6-supersession footer) <!-- R5 -->
- [x] T009 [P] Update `docs/specs/status-pyramid.md` (channel model, tier ladder, decision-table sweep incl. rows 5/11–16/20, fact #3 superseded, staleness softening, accepted costs, supersession history block) <!-- R6 -->
- [x] T010 [P] Update README.md § Status dots 3-shape bullet to 2 shapes + overlays; confirm `docs/img/status-dot-reference.svg` is carried unmodified from the worktree state <!-- R7, R8 -->
- [x] T011 Run gates: `cd app/frontend && npx tsc --noEmit`, `just test-frontend`, and the swept e2e specs via `just test-e2e "<spec>"` <!-- R9 -->

## Execution Order

- T001 blocks T002/T003 (types) and T004
- T002/T003 block T005, T006, T007
- T008–T010 are independent of code tasks; T011 runs last

## Acceptance

### Functional Completeness

- [x] A-001 R1: A fab window at any stage with rolled `agentState` `idle`/`waiting`/absent renders a ring in the stage hue; with `active` it renders solid (the `ipad-ui-review` case flips solid → ring)
- [x] A-002 R1: Output-flowing panes make journey-hue dots solid in NO case; the gray floor's activity-driven solid/ring is unchanged
- [x] A-003 R2: `fabDisplayState === "failed"` sets `failed: true` composed with either shape; no `"failed"` member remains in `DotShape`
- [x] A-004 R3: Flagged dots render at 9px (ring+center and bullseye) with ~3px red center; unflagged at 7px; the dotted-border branch is gone
- [x] A-005 R4: `dotLabel` composes hue + liveness + flags per the R4 examples and stays a pure function of `StatusDotState`
- [x] A-006 R5: `docs/site/status-dot.md` agrees with the embedded SVG on every strip; no 3-shape or shape-from-displayState prose remains
- [x] A-007 R6: `docs/specs/status-pyramid.md` decision table derives shape from agentState per family, row 5 reads yellow · ring · halo, and fact #3 is marked superseded with rationale
- [x] A-008 R7: README's status-dot bullet states the 2-shapes + overlays vocabulary
- [x] A-009 R8: The committed SVG matches the pre-existing worktree content exactly (no edits in this change)

### Behavioral Correctness

- [x] A-010 R2: A waiting window renders ring + halo on every hue (the shipped waiting-solid rendering is gone, including the agent family)
- [x] A-011 R10: Glyph gating/color/icon outputs and their tests are byte-identical to before the change

### Scenario Coverage

- [x] A-012 R9: The three named e2e anchors are updated with their intent comments, and a full grep of `app/frontend/tests/e2e/` shows no remaining retired-vocabulary assertions

### Edge Cases & Error Handling

- [x] A-013 R1: `skipped` fall-through unchanged; unknown/absent `fabDisplayState` no longer implies solid; absent `agentState` on a fab window yields ring, never a crash or a guessed state

### Code Quality

- [x] A-014 Pattern consistency: New rendering/label code follows the component's existing structure (Tailwind utilities, `PHASE_HUE` tokens, no new hex values)
- [x] A-015 No unnecessary duplication: overlay rendering reuses the existing halo/class composition pattern; no parallel dot model appears
- [x] A-016 No comment narration: comments state constraints only (per code-quality anti-patterns); no change-ID citations in code or tests
- [x] A-017 Type narrowing over assertions: model changes use discriminated unions/guards, no `as` casts

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before hydrate
- If an item is not applicable, mark checked and prefix with **N/A**

## Deletion Candidates

- None discovered — the change's planned removals (`fabShape` in `app/frontend/src/components/pr-status-model.ts`, `fabStatusWord` in `app/frontend/src/components/status-dot-label.ts`, the dotted-border `failed` branch in `app/frontend/src/components/status-dot.tsx`) were already executed during apply, and repo-wide sweeps (`fabShape`/`fabStatusWord`/`dotted`/retired label words across `app/` and `docs/`) found no remaining references or newly redundant code.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Solid on journey hues ⇔ rolled `agentState === "active"` exactly; `waiting`/`idle`/absent ⇒ ring | Intake decisions 1+2+5 fixed in-session; only partition consistent with all three | S:90 R:80 A:90 D:90 |
| 2 | Certain | `failed` modeled as `StatusDotState.failed?: boolean` mirroring `waiting?`; `DotShape` narrows to ring/solid | Intake decision 3 + module's established overlay-flag pattern | S:85 R:80 A:90 D:85 |
| 3 | Confident | Bullseye gap ring uses a background-color token matching the dot's mounting surfaces (per the SVG construction); exact token + legibility settled by T007's in-browser check, with the pre-approved dotted-border fallback | Multiple viable constructions, fully reversible, verification mandated in-plan | S:60 R:85 A:70 D:60 |
| 4 | Confident | Fab-hue label words: `"worker live"` / `"at rest"` with failed variants `"failed — rework live"` / `"failed — at rest"`; agent family and floor words apply-decided consistent with the intake examples (floor bare `active`/`idle` unchanged) | Three examples fixed in intake; remaining words strongly implied, reversible | S:60 R:90 A:75 D:65 |
| 5 | Confident | `window-row.test.tsx` sweep is conditional — swept only where assertions couple to dot labels/shapes (import graph shows the coupling is primarily in `row-flyout-card.test.tsx`) | Import scan at plan time; the grep in T006 bounds the residual | S:60 R:90 A:80 D:70 |
| 6 | Certain | Bullseye construction: 9px fill in the phase hue → 6px `bg-bg-primary` gap circle → 3px `bg-signal-red` center; the pre-approved dotted-border fallback was NOT needed | T007 in-browser check (Playwright screenshots at 8× device scale through the worktree rig, both default-dark and default-light): the gap ring reads clearly in both themes | S:85 R:80 A:85 D:85 |
| 7 | Confident | Label words: fab hues `"worker live"` (solid) / `"at rest"` (ring); failed variants `"failed — rework live"` / `"failed — at rest"`; agent family keeps `"active"`/`"idle"` (a waiting agent's core reads `"agent — idle"` — the waiting suffix carries the attention); `fabStatusWord` retired — the label is a pure function of the dot, so a parked-done change reads `"PR-ready — at rest"` ("parked" does not survive) | R4's three examples fixed the fab words; the agent ring word stays the module's established ring word, and dropping displayState-derived words is what makes the label a pure function of StatusDotState | S:65 R:85 A:75 D:70 |
| 8 | Confident | e2e sweep outcome: `agent-next-waiting.spec.ts` label → `"agent — idle — agent waiting 3m"` (waiting → ring); `row-minimalism.spec.ts` + `row-flyout.spec.ts` → `"building — at rest"`; `pane-register-panel.spec.ts` verified to assert register text only (no dot coupling) — untouched; full-directory grep found no other retired-vocabulary assertions | Pre-scan anchors confirmed; residual bounded by the two full grep sweeps (labels, dotted/shape keywords) | S:70 R:85 A:80 D:70 |

5 assumptions (2 certain, 3 confident, 0 tentative).
