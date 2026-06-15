# Plan: Status Dot Lifecycle Journey

**Change**: 260615-0hsz-status-dot-lifecycle-journey
**Intake**: `intake.md`

## Requirements

### Status Dot: Precedence

#### R1: Three-way input precedence (PR > fab > tmux)
`statusDotState(win)` SHALL resolve which input drives the single dot in strict precedence order: PR drives when the window is change-bound AND has a PR; else fab drives when the window has a fab change; else tmux activity drives it.

- **GIVEN** a window with `fabChange` set AND `prNumber` set
- **WHEN** `statusDotState(win)` is computed
- **THEN** it returns `{ phase: "pr", shape: prShape(win) }`
- **AND GIVEN** a window with `fabChange` set but no `prNumber`, **THEN** it returns `{ phase: fabPhase(win.fabStage), shape: fabShape(win.fabDisplayState) }`
- **AND GIVEN** a window with neither `fabChange` nor a PR, **THEN** it returns `{ phase: "none", shape: win.activity === "active" ? "solid" : "ring" }`

### Status Dot: Hue (phase)

#### R2: fabStage → phase mapping using the README 4-phase grouping
`fabPhase(stage)` SHALL map each fab stage to one of the 4 README phases: `intake`→intake; `apply`,`review`→execution; `hydrate`→completion; `ship`,`review-pr`→shipping. Any unknown/absent stage SHALL map to `none`.

- **GIVEN** `fabStage` is `"apply"` or `"review"`, **WHEN** `fabPhase` runs, **THEN** it returns `"execution"`
- **AND GIVEN** `"hydrate"`, **THEN** `"completion"`; **GIVEN** `"ship"` or `"review-pr"`, **THEN** `"shipping"`; **GIVEN** `"intake"`, **THEN** `"intake"`
- **AND GIVEN** an unknown/undefined stage, **THEN** `"none"`

#### R3: phase → hue token (PHASE_HUE), Execution and Completion both amber
`PHASE_HUE` SHALL map: `intake`→`text-blue-400`, `execution`→`text-amber-400`, `completion`→`text-amber-400`, `shipping`→`text-accent-green`, `pr`→`text-purple-400`, `none`→`text-text-secondary`. No raw hex; only standard Tailwind/theme classes.

- **GIVEN** a `{phase}` of `execution` or `completion`, **WHEN** the dot renders, **THEN** the hue is `text-amber-400` for both (apply/review/hydrate render identically)
- **AND GIVEN** `pr`, **THEN** `text-purple-400`; **GIVEN** `shipping`, **THEN** `text-accent-green`

### Status Dot: Shape (status)

#### R4: fabDisplayState → shape mapping
`fabShape(displayState)` SHALL map: `pending`→`ring`; `active`,`ready`→`solid`; `failed`→`failed`; `done`→`done`; `skipped`→`skipped`. Unknown/absent SHALL default to `solid` (treat an active-but-unlabeled fab window as a live solid dot).

- **GIVEN** `fabDisplayState` is `"pending"`, **THEN** shape is `"ring"`
- **AND GIVEN** `"active"` or `"ready"`, **THEN** `"solid"`; **GIVEN** `"failed"`, **THEN** `"failed"`; **GIVEN** `"done"`, **THEN** `"done"`; **GIVEN** `"skipped"`, **THEN** `"skipped"`
- **AND GIVEN** an unknown/undefined display-state on a fab window, **THEN** `"solid"`

#### R5: PR fields → shape (prShape) reusing prDotState semantics
`prShape(win)` SHALL reuse the existing `prDotState(win)` outcomes and map them onto the unified shape vocabulary: `merged`→`done`, `fail`→`failed`, `pending`→`ring`, `healthy`→`solid`, `neutral`→`solid`. Closed-unmerged (a `neutral` from `prState === "closed"`) renders within the purple phase as `solid` per the preserved `prDotState` semantics; the `skipped` shape is reserved for the explicit closed-skip case surfaced by the matrix and is not separately produced here (see Design Decisions).

- **GIVEN** a PR window with `prState: "merged"`, **THEN** `prShape` returns `"done"`
- **AND GIVEN** `isFailish` (checks fail or changes_requested), **THEN** `"failed"`; **GIVEN** `prChecks: "pending"`, **THEN** `"ring"`; **GIVEN** `prChecks: "pass"`, **THEN** `"solid"`; **GIVEN** an open PR with no decisive signal (`neutral`), **THEN** `"solid"`

### Status Dot: Rendering

#### R6: Render the {phase, shape} dot with the unified shape vocabulary
`StatusDot` SHALL render the dot from `{phase, shape}`, resolving `color = PHASE_HUE[phase]` and the geometry per shape: `ring`→hollow circle (1.8px solid border in hue, transparent fill); `solid`→filled circle in hue; `failed`→dashed ring (1.8px dashed border in hue, transparent fill) with a centered red (`bg-red-400`) dot; `done`→filled rounded square (`rounded-[3px]`) in hue; `skipped`→gray hollow ring (hue forced to `text-text-secondary`).

- **GIVEN** `shape: "failed"`, **WHEN** the dot renders, **THEN** it is a dashed-bordered transparent circle in the phase hue with a small red `bg-red-400` dot centered inside it
- **AND GIVEN** `shape: "done"`, **THEN** it is a filled `rounded-[3px]` square in the phase hue (visibly a square, not a circle)
- **AND GIVEN** `shape: "skipped"`, **THEN** it is a hollow ring rendered in `text-text-secondary` regardless of phase

#### R7: tmux fallback stays monochrome gray
A plain window (`phase: "none"`) SHALL render monochrome: `solid` (active) is a gray filled circle, `ring` (idle) is a gray hollow ring. No phase color is ever applied to the tmux fallback.

- **GIVEN** a plain active window, **THEN** a `text-text-secondary` filled circle
- **AND GIVEN** a plain idle window, **THEN** a `text-text-secondary` hollow ring

#### R8: Accessibility — label composed from phase + status
Every dot SHALL carry `role="img"`, `aria-label`, and `title` composed from phase + status, never relying on color alone. fab/PR labels read e.g. `"apply — active"`, `"review — failed"`, `"intake — pending"`, `"PR — merged"`; the tmux fallback uses `"active"` / `"idle"`.

- **GIVEN** a window in `apply`/`active`, **THEN** the dot's `aria-label` and `title` are `"apply — active"`
- **AND GIVEN** a PR window that merged, **THEN** `"PR — merged"`
- **AND GIVEN** a plain idle window, **THEN** `"idle"`

### Status Dot: Out of scope (preserved)

#### R9: Preserve prDotState / PR_* exports and PrStatusLine unchanged
The existing `prDotState`, `PR_STATE_COLORS`, `PR_CHECKS_COLORS`, `PR_REVIEW_COLORS`, `isFailish`, and `PrStatusLine` exports SHALL remain unchanged in behavior. They serve the dashboard PR line and the pane-panel PR segments, which are out of scope for this change. **`PR_DOT_COLOR` and `PR_DOT_LABEL` are NOT preserved — this change DELETES both** (they became zero-call-site once the redesigned dot stopped consuming them; `status-dot.tsx` was their sole consumer, and the dot now resolves color via `PHASE_HUE` and labels via `SHAPE_LABEL`/`PR_SHAPE_LABEL`). See A-012 below.

- **GIVEN** the existing `prDotState` / `PrStatusLine` tests, **WHEN** this change lands, **THEN** they continue to pass unmodified

### Docs

#### R10: Spec page + committed SVG matrix + index row
A new `docs/specs/status-dot.md` SHALL document the precedence rule, the hue=phase / shape=status model, the full stage×status matrix (markdown table), the README-4-phase-grouping-with-our-palette note (Execution+Completion=amber, Shipping=green, PR=purple), and the "red only as a failed-ring center dot" rule. A `docs/img/status-dot-matrix.svg` rendering the actual dot shapes/colors SHALL be committed and embedded via `![...](...)`. `docs/specs/index.md` SHALL gain a row for the new spec.

- **GIVEN** the new spec page, **THEN** it contains the precedence rule, the two-axis model, the full matrix, the palette note, and the red-center rule, with the SVG embedded
- **AND** `docs/specs/index.md` lists the new spec

### Non-Goals

- No backend / API / SSE / tmux changes — all inputs already flow on `WindowInfo`.
- No change to the sidebar row's separate `fabStage` text (`window-row.tsx`) — the dot complements it.
- No change to `prDotState` / `PR_*` / `PrStatusLine` behavior (R9).
- No new keyboard actions (the dot is display-only).

### Design Decisions

1. **Rendering medium: CSS, not SVG** — the approved HTML preview renders the dashed ring with `border: 1.8px dashed currentColor` + a `::after` red center, and the square with `border-radius: 3px`. In React the same is achieved with inline `style` + a child `<span>` for the red center (inline styles can't use `::after`). *Why*: stays consistent with the existing `StatusDot` (already inline-styled), matches the approved preview pixel-for-pixel, no new dependency. *Rejected*: inline SVG with `stroke-dasharray` — heavier, unnecessary at the chosen size.
2. **Size bump for `failed` and `done`** — `ring`/`solid` stay 6px (`w-1.5 h-1.5`); `failed` and `done` render at 8px (`w-2 h-2`). *Why*: a CSS dashed border on a 6px circle shows only ~2 dashes and the red center is cramped; 8px gives ~4 dashes with a clearly visible red center, and the rounded square reads unambiguously as a square vs the 6px circles. This is exactly the size-bump path the intake's Tentative assumption #11 sanctioned. *Rejected*: keeping 6px (poor legibility) and SVG (overkill).
3. **`fabShape` and `fabPhase` default to live, not gray** — an unknown/absent `fabDisplayState` on a fab window → `solid`; an unknown `fabStage` → `none` phase. *Why*: a fab-bound window with an unrecognized future state should still read as "a live fab window" (solid) rather than vanish; the phase falls back to gray only when the stage is wholly unknown. *Rejected*: defaulting to `ring` (would imply "pending" for live windows).
4. **`prShape` maps `neutral`→`solid`** — the intake says "neutral/open → solid"; closed-unmerged currently yields `neutral` from `prDotState`, so it renders as a purple solid under the journey. The dedicated `skipped` gray-ring shape exists in the vocabulary (and the matrix documents closed→gray ring) but is produced only by the tmux/explicit-skip paths, not by `prShape`, to keep `prDotState` semantics untouched per R9. *Why*: preserves the out-of-scope `prDotState` exactly while honoring the intake's explicit neutral→solid instruction.

## Tasks

### Phase 2: Core Implementation

- [x] T001 In `app/frontend/src/components/pr-status-line.tsx`, add the lifecycle types and helpers: `DotShape` (`"ring" | "solid" | "failed" | "done" | "skipped"`), `DotPhase` (`"intake" | "execution" | "completion" | "shipping" | "pr" | "none"`), `StatusDotState = { phase: DotPhase; shape: DotShape }`, `fabPhase(stage)`, `fabShape(displayState)`, `prShape(win)`, and the `PHASE_HUE` map; rewrite `statusDotState(win)` to the three-way precedence. Preserve all existing `prDotState`/`PR_*`/`isFailish`/`PrStatusLine` exports. <!-- R1 R2 R3 R4 R5 R9 -->
- [x] T002 In `app/frontend/src/components/status-dot.tsx`, rewrite `StatusDot` to render the `{phase, shape}` dot: resolve `color = PHASE_HUE[phase]`, render the five shapes (ring / solid / failed=dashed-ring+red-center / done=rounded-square / skipped=gray-ring), keep `role="img"` + `aria-label` + `title` composed from phase + status, and keep the tmux fallback monochrome. Update the component doc comment. <!-- R6 R7 R8 -->

### Phase 4: Docs & Tests

- [x] T003 [P] Create `docs/img/status-dot-matrix.svg` — a visual rendering of the stage×status matrix (the actual dot shapes/colors), translated from `/tmp/rk-statusdot-preview/index.html`. <!-- R10 -->
- [x] T004 [P] Create `docs/specs/status-dot.md` — precedence rule, hue=phase/shape=status model, full stage×status matrix (markdown table), README-4-phase-grouping-with-our-palette note, "red only as a failed-ring center dot" rule, and embed the SVG via `![...](...)`. <!-- R10 -->
- [x] T005 [P] Add a row to `docs/specs/index.md` for the new Status Dot spec. <!-- R10 -->
- [x] T006 Update `app/frontend/src/components/status-dot.test.tsx` — three-way precedence (PR > fab > tmux), `fabPhase`/`fabShape` mappings (all 6 stages, all 6 display-states), `prShape` mapping, tmux fallback, and a11y label composition; conform the old two-way assertions to the new `{phase, shape}` model. <!-- R1 R2 R3 R4 R5 R6 R7 R8 -->
- [x] T007 Conform `app/frontend/src/components/sidebar/window-row.test.tsx` and `app/frontend/src/components/dashboard.test.tsx` dot assertions (old PR-dot labels / activity-dot-red-on-failed) to the new lifecycle model. Keep `prDotState`/`PR_*` tests in `pr-status-line.test.tsx` passing unmodified. <!-- R1 R8 R9 -->

## Execution Order

- T001 blocks T002, T006, T007 (types/helpers must exist first).
- T003 blocks T004 (the SVG is embedded in the spec).
- T003/T004/T005 are independent of the TS work and may run alongside it.

## Acceptance

### Functional Completeness

- [ ] A-001 R1: `statusDotState` returns `pr` phase when change-bound + PR, fab phase when only `fabChange`, and `none` (activity) otherwise — verified by unit tests.
- [ ] A-002 R2: `fabPhase` maps all 6 stages to the correct README phase (apply/review→execution, hydrate→completion, ship/review-pr→shipping, intake→intake) and unknown→none — verified by unit tests.
- [ ] A-003 R3: `PHASE_HUE` maps each phase to the correct token; execution and completion both → `text-amber-400` — verified by render assertions.
- [ ] A-004 R4: `fabShape` maps all 6 display-states correctly (pending→ring, active/ready→solid, failed→failed, done→done, skipped→skipped) — verified by unit tests.
- [ ] A-005 R5: `prShape` maps prDotState outcomes onto shapes (merged→done, fail→failed, pending→ring, healthy→solid, neutral→solid) — verified by unit tests.
- [ ] A-006 R6: `StatusDot` renders all five shapes; failed shows a dashed ring + centered red dot, done shows a rounded square — verified by render assertions on style/className.
- [ ] A-007 R7: the tmux fallback renders monochrome (gray solid active / gray hollow ring idle), never a phase color — verified by render assertions.
- [ ] A-008 R8: every dot carries `role="img"` + `aria-label` + `title` composed from phase + status (e.g. "apply — active", "PR — merged", "idle") — verified by `getByLabelText`.
- [ ] A-010 R10: `docs/specs/status-dot.md` exists with the precedence rule, two-axis model, full matrix, palette note, and red-center rule, with the SVG embedded; `docs/specs/index.md` has a row; `docs/img/status-dot-matrix.svg` is committed.

### Behavioral Correctness

- [ ] A-011 R6: the old `fabDisplayState === "failed"` whole-dot red tint and the old solid-red PR `fail` dot are GONE — failed now renders as a dashed ring in phase hue with only a red center dot.

### Removal Verification

- [ ] A-012 R9: `prDotState`, `PR_STATE_COLORS`, `PR_CHECKS_COLORS`, `PR_REVIEW_COLORS`, `isFailish`, and `PrStatusLine` remain exported and unchanged (`pr-status-line.test.tsx` passes unmodified); `PR_DOT_COLOR` and `PR_DOT_LABEL` are DELETED (zero-call-site after the redesign — verified by a repo-wide grep finding no remaining references).

### Scenario Coverage

- [ ] A-013 R1: PR-wins-over-fab precedence is exercised (a window with both `fabChange`+`fabStage` and a PR renders the purple PR phase, not the fab phase).

### Edge Cases & Error Handling

- [ ] A-014 R4: an unknown/absent `fabDisplayState` on a fab window renders `solid` (live), and an unknown `fabStage` renders the `none` (gray) phase — verified by unit tests.

### Code Quality

- [ ] A-015 Pattern consistency: new types/helpers follow the existing `pr-status-line.tsx` style; rendering follows the existing inline-style `StatusDot` pattern.
- [ ] A-016 No unnecessary duplication: `prShape` reuses `prDotState`/`isFailish`; no new color hex (only standard Tailwind/theme tokens).
- [ ] A-017 Type narrowing over assertions: discriminated `{phase, shape}` and `Record<>` lookups used instead of `as` casts (code-quality § Frontend).
- [ ] A-018 Verification gates pass: `tsc --noEmit` clean and `just test-frontend` green for the changed components.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)

## Deletion Candidates

- `app/frontend/src/components/pr-status-line.tsx:219` — `PR_DOT_COLOR` is now a zero-call-site export: `status-dot.tsx` was its sole consumer (HEAD imported it at line 31) and the rewritten dot resolves color via `PHASE_HUE` instead; a repo-wide grep finds no other references. Removal verification needed: it is part of the R9 "preserved exports" set, so confirm whether keeping it as a deliberate public API is intended before deleting.
- `app/frontend/src/components/pr-status-line.tsx:233` — `PR_DOT_LABEL` is now a zero-call-site export for the same reason (status-dot.tsx HEAD line 32 was its only consumer; the new dot composes its label via `SHAPE_LABEL`). Same R9 caveat as above — flagged for the human reviewer, not auto-deleted.
- `app/frontend/src/components/pr-status-line.tsx:44` — the doc comment on `PR_STATE_COLORS` still claims the sidebar dot renders "via prDotState/PR_DOT_COLOR"; that wiring is gone (the dot now uses PHASE_HUE), so the comment is stale and should be corrected if the constants are retained.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Render with CSS (inline style + child red-center span) not SVG | Matches the approved HTML preview (border dashed + ::after); existing StatusDot is already inline-styled; intake assumption #11 sanctioned CSS-or-SVG and called the preview the source of truth | S:80 R:85 A:80 D:75 |
| 2 | Confident | Bump `failed` and `done` dots to 8px (`w-2 h-2`); keep ring/solid at 6px | Intake #11 (Tentative) explicitly permits a size bump for dashed-ring legibility and square-readability; 8px is the smallest size that shows ~4 dashes + a visible red center and reads as a square | S:70 R:85 A:65 D:65 |
| 3 | Confident | `fabShape` unknown/absent → `solid`; `fabPhase` unknown → `none` | A live fab window with a future/unrecognized state should still read as a live dot; gray only when the stage itself is unknown. Reversible, low blast radius | S:65 R:85 A:75 D:70 |
| 4 | Confident | `prShape` maps `neutral`→`solid` (closed-unmerged renders purple solid, not the gray `skipped` ring) | Intake says "neutral/open → solid" verbatim and mandates prDotState stays untouched (R9); the `skipped` shape is documented in the matrix but produced only outside prShape | S:75 R:80 A:80 D:70 |
| 5 | Certain | a11y label format `"{stage} — {status}"` / `"PR — {status}"` / `"active"`/`"idle"` | Intake item 3 gives these exact example strings; em-dash separator matches the examples ("apply — active", "PR — merged") | S:90 R:80 A:85 D:85 |

5 assumptions (2 certain, 3 confident, 0 tentative).
