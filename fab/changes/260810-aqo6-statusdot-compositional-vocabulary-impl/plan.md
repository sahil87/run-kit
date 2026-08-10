# Plan: StatusDot Compositional Vocabulary (PR Eviction)

**Change**: 260810-aqo6-statusdot-compositional-vocabulary
**Intake**: `intake.md`

> Binding visual references (in this change folder — match, do not re-derive):
> `reference-status-dot-final.svg` (the final compositional reference diagram) and
> `reference-mock.html` (column **A** is the authoritative row-by-row rendering for the
> 18 representative window states).

## Requirements

### Dot model: `pr-status-model.ts`

#### R1: DotPhase shrinks to the four-hue compositional vocabulary
`DotPhase` SHALL be `"building" | "prReady" | "agent" | "none"` (replacing
`intake | apply | pr | agent | agentPr | none`). `PHASE_HUE` SHALL map
`building: "text-blue-400"`, `prReady: "text-accent-green"`, `agent: "text-yellow-400"`,
`none: "text-text-secondary"`. `text-purple-400` / `text-orange-400` MUST leave the dot's hue map
(purple stays in the glyph/segment vocabularies).

- **GIVEN** the compiled frontend
- **WHEN** any surface resolves a dot hue
- **THEN** only blue/green/yellow/gray tokens are reachable from `PHASE_HUE`

#### R2: fabPhase becomes the stage-based two-stop split
`fabPhase(stage)` SHALL return `"building"` for `intake`/`apply`/`review` and `"prReady"` for
everything else (`ship`/`review-pr`/`done`, and unknown/absent — `hydrate` lands here via the
default arm). The split MUST be stage-based, never `prNumber`-based — the dot never consults PR
fields.

- **GIVEN** a fab window at stage `review`
- **WHEN** `statusDotState` runs
- **THEN** the phase is `building` (blue), regardless of any `prNumber` on the window
- **GIVEN** a fab window at stage `ship` (or `done`, or an unknown stage)
- **WHEN** `statusDotState` runs
- **THEN** the phase is `prReady` (green)

#### R3: DotShape shrinks to three; done parks as a resting ring
`DotShape` SHALL be `"ring" | "solid" | "failed"` — `done` and `skipped` are deleted.
`fabShape(displayState)` SHALL map `pending → ring`, `failed → failed`, **`done → ring`**
(parked = resting), and `active`/`ready`/unknown → `solid`. A `skipped` display-state no longer
maps to any shape.

- **GIVEN** a fab window with `fabDisplayState: "done"`
- **WHEN** the dot renders
- **THEN** it is a hollow ring in the fab hue (green resting ring for a parked-done change)

#### R4: statusDotState loses its PR branches; skipped falls through the ladder
`statusDotState()` SHALL lose both `prOwnsDot(...)` branches. The fab arm becomes
`{ phase: fabPhase(win.fabStage), shape: fabShape(win.fabDisplayState), waiting }`; the agent arm
becomes `{ phase: "agent", shape: idle ? "ring" : "solid", waiting }` (no `agentPr` case). A
**`skipped`** fabDisplayState makes the window not fab-owned: the ladder falls through past the
fab arm (fresh agent → yellow, else gray floor). The waiting overlay stays additive and unchanged.

- **GIVEN** a fab window with a merged PR (`prNumber` set, `prState: "merged"`)
- **WHEN** `statusDotState` runs
- **THEN** the dot state is the fab arm's (no `pr` phase, no purple, no square)
- **GIVEN** a fab window with `fabDisplayState: "skipped"` and no fresh agent
- **WHEN** `statusDotState` runs
- **THEN** the state is the gray floor (`phase: "none"`, shape by tmux activity)

#### R5: prShape deleted; prOwnsDot renamed to prOwnsGlyph
`prShape()` SHALL be deleted. `prDotState()` and `PR_STATE_COLORS`/`PR_CHECKS_COLORS`/
`PR_REVIEW_COLORS` are retained unchanged. `prOwnsDot()` SHALL be renamed **`prOwnsGlyph`**
(same predicate: `prNumber` present and not closed-unmerged) with all import sites updated —
it now gates only the rest-state row glyph.

- **GIVEN** the frontend source tree (swept with `grep -a` / perl — `session-tiles.tsx` carries a
  deliberate NUL byte)
- **WHEN** searching for `prShape` or `prOwnsDot`
- **THEN** no live references remain

### Glyph vocabulary: `prGlyphColor()`

#### R6: The glyph gains a yellow checks-running state (five-way, ordered)
`prGlyphColor()` SHALL be the five-way first-match-wins chain: (1) `text-red-400` fail-ish
(`prDotState → "fail"`); (2) `text-text-secondary` open draft; (3) **`text-yellow-400` open with
`prChecks === "pending"` (NEW)**; (4) `text-accent-green` open otherwise; (5) `text-purple-400`
merged. Draft outranks pending (drafts stay muted while their checks run). Closed never reaches
the glyph (gate unchanged).

- **GIVEN** an owned open PR with `prChecks: "pending"`
- **WHEN** the row glyph renders
- **THEN** it is yellow (`text-yellow-400`)
- **GIVEN** an open **draft** PR with `prChecks: "pending"`
- **WHEN** the row glyph renders
- **THEN** it stays gray (`text-text-secondary`)

### Dot rendering: `status-dot.tsx`

#### R7: Three shape renderers; skipped-gray special case deleted
`StatusDot` SHALL delete the `done` (sharp square) branch; only `solid`, `ring`, and `failed`
(dotted 9px ring + 3px red center — unchanged) remain, plus the additive waiting halo (unchanged,
including the reduced-motion static ring). The `skipped`-forces-gray color special case SHALL be
deleted — color is always `PHASE_HUE[state.phase]`. The header comment SHALL be rewritten to the
compositional model (dot = local story, glyph = remote story).

- **GIVEN** any window state
- **WHEN** `StatusDot` renders
- **THEN** no `rounded-none` square markup is reachable and the color is always the phase hue

### Labels: `status-dot-label.ts`

#### R8: dotLabel composes hue-word + status-word; PR words leave the dot
`dotLabel` SHALL compose the fab label from the phase word (`building` / `PR-ready`) plus a
status word derived from `fabDisplayState` (`pending` → "pending", `failed` → "failed",
`done` → "parked", `ready` → "ready", `active`/unknown → "active"), keeping the additive
`— agent waiting Xm` suffix. Agent labels stay `agent — active` / `agent — idle`; the floor stays
the bare activity word. PR-specific labels (`"PR — merged"` etc.) SHALL leave the dot's label
space (`PR_SHAPE_LABEL` deleted) — the PR facts live in the flyout/register surfaces.

- **GIVEN** a fab window at `apply`/`active`
- **WHEN** the dot's aria-label composes
- **THEN** it reads `building — active` (and `— agent waiting 3m` appends when waiting)
- **GIVEN** a fab window at `review-pr`/`done` with a merged PR
- **WHEN** the label composes
- **THEN** it reads `PR-ready — parked` — no PR word appears

### Glyph surfaces: parity where the dot renders without a register view

#### R9: Session tiles gain the rest-state glyph; pane panel and board-pane do not
`session-tiles/session-tiles.tsx` SHALL add the rest-state git-pull-request glyph to the window
tile's header line (same `prOwnsGlyph` gate, same `prGlyphColor` fn, same `aria-hidden`
decoration semantics; never on ghost windows). `sidebar/status-panel.tsx` gets no glyph (its
register view is the detail surface). `board-pane.tsx` was inspected: it renders **no StatusDot**
in its header, so it is left untouched.

- **GIVEN** an expanded session tile whose window has an owned open PR
- **WHEN** the tile renders
- **THEN** an `aria-hidden` PR glyph appears on the tile's header line in the `prGlyphColor` token
- **GIVEN** a window with a closed-unmerged PR (or no PR, or a ghost window)
- **WHEN** the tile renders
- **THEN** no glyph appears

### Documentation

#### R10: docs/site/status-dot.md rewritten; matrix SVG replaced and renamed
`docs/img/status-dot-matrix.svg` SHALL be replaced by the compositional reference (content =
this change folder's `reference-status-dot-final.svg`, verbatim) and renamed
`docs/img/status-dot-reference.svg`, updating the image references in `docs/site/status-dot.md`
and `README.md`. `docs/site/status-dot.md` SHALL be rewritten to the compositional structure:
four legend strips (hue / shape / glyph / halo) replace the precedence prose + 6×5 matrix; the
ladder drops both PR branches; D1 dissolves; D2 survives reworded (feeds the glyph's durable
purple merged state); "red is used in exactly one way" becomes the honest split (dot-red =
failed center only; glyph-red = failing PR); the Row Minimalism "survives as" table updates
(`done`-parking → green resting ring; PR states → the glyph column).

- **GIVEN** the docs tree after this change
- **WHEN** grepping for `status-dot-matrix.svg` in `README.md` + `docs/site/`
- **THEN** no references remain, and `docs/img/status-dot-reference.svg` matches the binding SVG

#### R11: docs/specs/status-pyramid.md updated to the compositional vocabulary
`docs/specs/status-pyramid.md` (the design authority) SHALL update its channel-model table, tier
ladder, and decision table to the compositional vocabulary (fab family = blue building → green
PR-ready; decision-table rows 6–10 and 17–20 rewrite; PR rows move to the glyph channel), marking
the palette-v3 sections as superseded rather than deleting the rationale history.

- **GIVEN** the spec after this change
- **WHEN** reading the tier ladder and decision table
- **THEN** no PR branch owns the dot and the fab family reads blue building → green PR-ready

### Tests

#### R12: Unit and Playwright coverage conforms to the new vocabulary
`status-dot.test.tsx`, `pr-status-model.test.ts`, `window-row.test.tsx`,
`row-flyout-card.test.tsx`, `sidebar.test.tsx` SHALL be updated to the new phases/shapes/labels
and the glyph's pending state; `session-tiles.test.tsx` SHALL gain glyph coverage. Playwright
specs asserting dot labels (`row-minimalism.spec.ts`, `row-flyout.spec.ts`) SHALL be updated,
**with sibling `.spec.md` companions updated in the same commit** (constitution: Test Companion
Docs). `agent-next-waiting.spec.ts` asserts `agent — active — agent waiting 3m`, which is
unchanged.

- **GIVEN** the updated suites
- **WHEN** `just test-frontend` and the two touched e2e specs run
- **THEN** they pass with the new vocabulary asserted

### Non-Goals

- Zero backend changes: no `WindowInfo` fields, no D2 derivation, no default-branch carve-out,
  no SSE payload, no routes (intake § 8).
- The waiting halo mechanism/CSS, the two-family ladder top, #314 freshness rules, the register
  view (`out`/`agt`/`fab`/`pr`), flyout card structure, pane-panel PR segments, and
  `PR_STATE_COLORS`/`PR_CHECKS_COLORS`/`PR_REVIEW_COLORS`/`prDotState` are all unchanged.
- Memory (`docs/memory/run-kit/ui-patterns.md`) is hydrate's, not apply's.

### Design Decisions

#### Skipped display-state falls through the whole ladder
**Decision**: `statusDotState` treats `fabDisplayState === "skipped"` as "not a fab-owned dot"
and continues down the ladder (fresh agent → yellow, else gray floor), rather than forcing gray
inside the fab arm.
**Why**: The intake frames it as "it simply isn't a fab-owned dot"; ladder continuation is the
least machinery and matches the old forced-gray rendering in the common (agent-less) case.
**Rejected**: A dedicated skipped→gray short-circuit — extra machinery that would also hide a
live agent on a skipped change's pane.
*Introduced by*: 260810-aqo6-statusdot-compositional-vocabulary

#### Fab label words: hue-word + displayState-derived status word
**Decision**: `dotLabel` fab labels use `building` / `PR-ready` as the phase word and derive the
status word from `fabDisplayState` (`done` → "parked"), not from the shape.
**Why**: The shape alone can't distinguish parked from pending (both are rings post-eviction);
the intake's composition rule (hue-word + shape-word, no PR words) requires the label to be a
pure function of what the dot shows plus the parked/pending split the user asked to keep legible.
**Rejected**: Keeping the raw stage word (`review — active`) — it violates the intake's
composition rule and re-encodes per-stage detail the dot no longer renders (the exact stage lives
in the `fab` register on both register surfaces).
*Introduced by*: 260810-aqo6-statusdot-compositional-vocabulary

## Tasks

### Phase 1: Setup

*(none — no scaffolding or dependencies required)*

### Phase 2: Core Implementation

- [x] T001 Rewrite the dot model in `app/frontend/src/components/pr-status-model.ts`: shrink `DotPhase`/`DotShape`, new `fabPhase` two-stop split, `fabShape` done→ring, delete `prShape`, rename `prOwnsDot`→`prOwnsGlyph`, five-way `prGlyphColor` with yellow pending, `statusDotState` without PR branches + skipped fall-through; update module doc comments <!-- R1 R2 R3 R4 R5 R6 -->
- [x] T002 Rewrite `app/frontend/src/components/status-dot-label.ts`: phase-word + displayState-derived status-word composition, delete `PR_SHAPE_LABEL`, keep agent/floor words + waiting suffix <!-- R8 -->
- [x] T003 Update `app/frontend/src/components/status-dot.tsx`: delete `done` branch and skipped-gray special case, rewrite header comment to the compositional model <!-- R7 -->
- [x] T004 Update `app/frontend/src/components/sidebar/window-row.tsx` to import/call `prOwnsGlyph`; refresh the glyph/dot comments (five-way color incl. yellow pending) <!-- R5 R6 -->
- [x] T005 Add the rest-state PR glyph to `app/frontend/src/components/session-tiles/session-tiles.tsx` (gate `prOwnsGlyph`, color `prGlyphColor`, `aria-hidden`, `data-testid="tile-pr-glyph"`, never on ghosts) — edit with the NUL byte preserved <!-- R9 -->

### Phase 3: Integration & Edge Cases (tests)

- [x] T006 Update `app/frontend/src/components/status-dot.test.tsx` to the new phases/shapes/labels (fab eviction cases, skipped fall-through, parked-done green ring, no purple/orange/square) <!-- R1 R2 R3 R4 R7 R8 -->
- [x] T007 Update `app/frontend/src/components/pr-status-model.test.ts`: `prOwnsGlyph` rename, `prGlyphColor` pending-yellow + draft-outranks-pending cases <!-- R5 R6 -->
- [x] T008 Update `app/frontend/src/components/sidebar/window-row.test.tsx`: replace the PR-phase dot cases with fab-arm expectations; add a pending-yellow glyph case <!-- R4 R6 R8 -->
- [x] T009 [P] Add glyph coverage to `app/frontend/src/components/session-tiles/session-tiles.test.tsx`; sweep `sidebar.test.tsx` / `row-flyout-card.test.tsx` for stale label expectations <!-- R9 R12 -->
- [x] T010 Update Playwright specs + companions: `app/frontend/tests/e2e/row-minimalism.spec.ts`+`.spec.md` (`review — active` → `building — active`) and `app/frontend/tests/e2e/row-flyout.spec.ts`+`.spec.md` (`PR — open` header → `building — active — agent waiting 3m`) <!-- R12 -->

### Phase 4: Polish (docs)

- [x] T011 [P] Replace `docs/img/status-dot-matrix.svg` with the binding `reference-status-dot-final.svg` content as `docs/img/status-dot-reference.svg` (delete the old file); update the image refs in `README.md` and `docs/site/status-dot.md` <!-- R10 -->
- [x] T012 Rewrite `docs/site/status-dot.md` to the compositional structure (four legend strips, D1 dissolved, D2 reworded to the glyph, honest red split, updated survives-as table) <!-- R10 -->
- [x] T013 [P] Update `docs/specs/status-pyramid.md`: channel model, tier ladder, decision table rows 6–10 + 17–20, D1/D2 wording; mark palette-v3 sections superseded <!-- R11 -->

## Execution Order

- T001 blocks T002–T005 (they consume the new model exports)
- T006–T010 follow their implementation tasks; T009/T011/T013 are independent of each other
- Run `cd app/frontend && npx tsc --noEmit` + `just test-frontend` after Phase 3; targeted `just test-e2e` for the two touched specs after T010

## Acceptance

### Functional Completeness

- [x] A-001 R1: `DotPhase` is `building | prReady | agent | none` and `PHASE_HUE` carries only blue/green/yellow/gray tokens
- [x] A-002 R2: `fabPhase` maps intake/apply/review → `building` and everything else (incl. unknown/absent) → `prReady`, consulting no PR field
- [x] A-003 R3: `DotShape` is `ring | solid | failed`; `fabShape("done")` returns `ring`
- [x] A-004 R4: `statusDotState` contains no PR branch; a merged-PR fab window renders the fab arm's state
- [x] A-005 R6: `prGlyphColor` returns `text-yellow-400` for an open non-draft PR with pending checks
- [x] A-006 R7: `StatusDot` renders exactly three shapes + halo; color is always `PHASE_HUE[state.phase]`
- [x] A-007 R8: fab labels compose as `building`/`PR-ready` — status word (done → "parked"); no `PR — *` label remains
- [x] A-008 R9: session-tile window rows show the `aria-hidden` PR glyph under the `prOwnsGlyph` gate; status-panel and board-pane carry no new glyph
- [x] A-009 R10: `docs/img/status-dot-reference.svg` exists (binding SVG content), `status-dot-matrix.svg` is gone, and no markdown references the old name
- [x] A-010 R11: `status-pyramid.md`'s ladder/decision table carry no PR dot-ownership and read blue building → green PR-ready

### Behavioral Correctness

- [x] A-011 R4: a `skipped` fabDisplayState window renders the floor (or agent) tier, not a fab dot
- [x] A-012 R6: an open **draft** with pending checks stays gray (draft outranks pending)
- [x] A-013 R8: the waiting suffix still appends additively on every tier (`building — active — agent waiting 3m`)

### Removal Verification

- [x] A-014 R5: `prShape` and `prOwnsDot` have zero live references (swept NUL-safe with `grep -a`/perl)
- [x] A-015 R7: no `rounded-none` square branch and no skipped-gray forcing remain in `status-dot.tsx`

### Scenario Coverage

- [x] A-016 R12: unit suites cover the reference-mock A-column states (parked-done green ring, merged-PR fab window, pending-yellow glyph) and pass via `just test-frontend`
- [x] A-017 R12: `row-minimalism` and `row-flyout` e2e specs pass with updated labels, and their `.spec.md` companions are updated in the same commit

### Edge Cases & Error Handling

- [x] A-018 R2: an unknown/absent `fabStage` on a live fab window reads `prReady` (green), never gray
- [x] A-019 R9: ghost windows and closed-unmerged PRs render no tile glyph

### Code Quality

- [x] A-020 Pattern consistency: new code follows the existing token/comment conventions (no new hex, established Tailwind/theme tokens only)
- [x] A-021 No unnecessary duplication: the tile glyph reuses `prOwnsGlyph`/`prGlyphColor`/`GitPullRequestIcon` — no re-implementation

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- `app/frontend/src/components/session-tiles/session-tiles.tsx` has a deliberate NUL byte (~line 63) — use `grep -a` or perl for sweeps; edit carefully so the byte survives

## Deletion Candidates

- `prDotState` non-fail states (`app/frontend/src/components/pr-status-model.ts:74` — `merged`/`pending`/`healthy`/`neutral` returns) — post-eviction the only live consumer is `prGlyphColor`'s fail branch (`pr-status-model.ts:229`); the other four states are exercised solely by direct-call unit tests. A follow-up could collapse that branch to `isFailish(win)` and retire `prDotState`/`PrDotState` (kept unchanged in this change per the intake's § 8 non-goal).
- `AGENT_SHAPE_LABEL.failed` (`app/frontend/src/components/status-dot-label.ts` agent map) — unreachable branch retained only for `Record<DotShape, …>` totality; documented as such in the code comment.
- `docs/memory/run-kit/ui-patterns.md` §§ Status Dot / PR Status palette-v3 prose (~lines 166–250, 1289, 1427) — documents the retired `prOwnsDot`/`prShape`/`PR_SHAPE_LABEL`/6-hue model; superseded by this change and scheduled for hydrate's rewrite (intake Affected Memory), not code deletion.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `hydrate` stage maps to `prReady` (green) via `fabPhase`'s default arm | Intake lists intake/apply/review → building and "everything else and unknown/absent → prReady"; hydrate is unlisted in every artifact but is post-review local work and the default arm covers it; trivially reversible one-liner | S:60 R:90 A:75 D:70 |
| 2 | Confident | Skipped fall-through continues down the full ladder (agent arm reachable), not a direct gray short-circuit | Intake says a skipped change "simply isn't a fab-owned dot"; ladder continuation is less machinery; the agent-on-skipped case is rare and reversible | S:55 R:85 A:75 D:65 |
| 3 | Confident | Fab label wording: `building — {active\|ready\|pending\|parked\|failed}` and `PR-ready — …`, status word derived from `fabDisplayState` | Intake delegates exact wording to apply but binds the composition rule (hue-word + status-word, no PR words); "parked" for done is the intake's own status-word list | S:55 R:90 A:70 D:60 |
| 4 | Confident | Tile glyph placement: trailing position on the tile header line after the fab-stage badge, `data-testid="tile-pr-glyph"` | Intake specifies gate/color/a11y semantics but not exact placement; trailing right-edge mirrors the sidebar row's rest-glyph position; distinct testid avoids ambiguity with the row glyph | S:50 R:90 A:75 D:70 |
| 5 | Certain | `board-pane.tsx` left untouched | Intake's conditional resolved by inspection: the file renders no StatusDot in its header (grep verified), so the "otherwise leave untouched" arm applies | S:85 R:90 A:95 D:90 |
| 6 | Confident | `README.md`'s matrix-SVG image reference is updated alongside `docs/site/status-dot.md` | Intake names "referencing markdown"; README.md:161 references the renamed file and a broken image would be a regression | S:60 R:95 A:85 D:80 |

6 assumptions (1 certain, 5 confident, 0 tentative).
