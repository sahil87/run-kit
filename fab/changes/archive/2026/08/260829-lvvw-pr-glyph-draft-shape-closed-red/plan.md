# Plan: PR Glyph — Draft Shape + Closed Red

**Change**: 260829-lvvw-pr-glyph-draft-shape-closed-red
**Intake**: `intake.md`

## Requirements

### Status Signals: Rest-state PR glyph color

#### R1: Closed PR glyph renders red
`prGlyphColor(win)` in `app/frontend/src/components/pr-status-model.ts` MUST return `text-signal-red` when `win.prState === "closed"`. The chain order MUST remain closed → merged → isFailish → open-draft → open-pending → open; only the closed branch's token changes. The function's JSDoc MUST describe closed as red (GitHub's closed coloring, agreeing with `PR_STATE_COLORS.closed`) and MUST NOT describe it as muted.

- **GIVEN** a window whose `prState` is `closed` (draft or not, any `prChecks`/`prReview`)
- **WHEN** `prGlyphColor(win)` is evaluated
- **THEN** it returns `text-signal-red`
- **AND** the sidebar window row's `row-pr-glyph` span and the session tile's `tile-pr-glyph` span carry `text-signal-red`

- **GIVEN** a window whose `prState` is `open` and `prIsDraft` is true with passing/no checks
- **WHEN** `prGlyphColor(win)` is evaluated
- **THEN** it still returns `text-text-secondary` (draft color unchanged)

### Status Signals: Rest-state PR glyph shape

#### R2: Draft PRs carry their own glyph shape
`app/frontend/src/components/sidebar/icons.tsx` MUST export a `GitPullRequestDraftIcon` following the sibling PR icons' fixed idiom (`currentColor` stroke, `strokeWidth={2}`, `fill="none"`, round caps/joins, 24-unit viewBox, `size = 13` default, `aria-hidden="true"`) with the lucide `git-pull-request-draft` path data: `<circle cx="18" cy="18" r="3"/>`, `<circle cx="6" cy="6" r="3"/>`, `<path d="M18 6V5"/>`, `<path d="M18 11v-1"/>`, and the source rail `M6 9v12` (spelled the way the siblings spell their rail).

- **GIVEN** the icon module
- **WHEN** `GitPullRequestDraftIcon` renders
- **THEN** the SVG contains the two dashes `M18 6V5` and `M18 11v-1` and does NOT contain the merge arc `M13 6h3a2 2 0 0 1 2 2v7` nor the closed ✕ `m21 3-6 6`

#### R3: Three-way icon selection at every rest-state glyph site
The rest-state glyph at `window-row.tsx` (fine-pointer overlay and coarse rail slot) and `session-tiles.tsx` (tile header) MUST pick the icon by state, closed first: `prState === "closed"` → `GitPullRequestClosedIcon`; `prState === "open" && prIsDraft` → `GitPullRequestDraftIcon`; otherwise `GitPullRequestIcon`. The mapping SHOULD live in one pure helper (`prGlyphIcon(win)` in `icons.tsx`) consumed by all three sites rather than a ternary repeated three times. Site comments that claim closed is muted or that shape alone separates closed from draft MUST be corrected.

- **GIVEN** a window with `prState: "open"`, `prIsDraft: true`
- **WHEN** the sidebar row (fine or coarse) or session tile renders
- **THEN** the glyph is the draft icon (dashes present, arc absent) in `text-text-secondary`

- **GIVEN** a window with `prState: "closed"`, `prIsDraft: true`
- **WHEN** the row or tile renders
- **THEN** the glyph is the closed ✕ icon in `text-signal-red` (closed wins over draft)

- **GIVEN** a window with `prState: "open"`, `prIsDraft: true`, `prChecks: "fail"`
- **WHEN** the row renders
- **THEN** the glyph is the draft icon in `text-signal-red` (fail-over-draft color rule survives with the draft shape)

- **GIVEN** a window with `prState: "open"`, `prIsDraft: false`
- **WHEN** the row renders
- **THEN** the glyph is the standard arc icon (no dashes)

### Docs: Recorded reasoning reversed

#### R4: Spec reflects the new glyph model
`docs/specs/status-pyramid.md` MUST describe the PR glyph as six states including red closed (channel table ~69; chain restatements ~158 and ~243–245; row 21 ~230; D2 ~359) and MUST NOT say closed is muted, that closed earns no glyph, or that `prOwnsGlyph` never includes closed. Memory (`status-signals.md`, `sidebar.md`, `routes-and-shell.md`) is rewritten at hydrate per the intake's § 5.

- **GIVEN** the spec after this change
- **WHEN** grepping for "closed earns no glyph", "never closed", "gray open-draft" in `status-pyramid.md`
- **THEN** no stale statement remains

### Non-Goals

- `StatusDot`/`statusDotState`, `PR_STATE_COLORS`/`PR_CHECKS_COLORS`/`PR_REVIEW_COLORS`, `prOwnsGlyph`, `isFailish` — unchanged.
- Flyout card / PANE panel text segments — already colored via `PR_STATE_COLORS`.
- Coarse-rail geometry — reuses the same helper.
- New e2e spec — not required (no existing e2e asserts glyph color or draft state); unit coverage is the gate.

### Design Decisions

#### Closed PR glyph is red, separated from failing by shape
**Decision**: `prGlyphColor` returns `text-signal-red` for closed; the ✕ (`GitPullRequestClosedIcon`) is what separates closed from a failing open PR.
**Why**: GitHub renders closed PRs red — the mapping users already carry — and `PR_STATE_COLORS.closed` was already red in the status panel and flyout segments, so glyph and text now agree. The user accepted the cost: red on the sidebar no longer exclusively means "act now".
**Rejected**: muted gray + ✕ (the prior decision — at 13px indistinguishable from a gray draft); bolder/dimmer gray (near-invisible on dark); no glyph for closed (loses the "a PR existed and died" cue).
*Introduced by*: 260829-lvvw-pr-glyph-draft-shape-closed-red

#### Draft PRs own a distinct glyph shape
**Decision**: open drafts render the lucide `git-pull-request-draft` silhouette (dotted merge rail) in the existing gray token; a failing draft keeps the draft shape in red.
**Why**: gray-arc vs green-arc was a color-only distinction that fails for colorblind users and dim themes; the dashed rail is GitHub's own draft silhouette. One more 13px SVG is cheaper than the confusion.
**Rejected**: draft keeps the shared arc icon varied only by color (prior decision — "a second SVG is more maintained surface for one bit").
*Introduced by*: 260829-lvvw-pr-glyph-draft-shape-closed-red

## Tasks

### Phase 2: Core Implementation

- [x] T001 [P] In `app/frontend/src/components/pr-status-model.ts` change the closed branch of `prGlyphColor` to `text-signal-red`, rewrite the JSDoc (numbered list + "no new color system" sentence) to say closed is red; in `pr-status-model.test.ts` flip the four closed cases (~:154/:158/:164/:170) to `text-signal-red` and fix the describe prose (~:56–60, ~:151–153) <!-- R1 -->
- [x] T002 [P] Add `GitPullRequestDraftIcon` to `app/frontend/src/components/sidebar/icons.tsx` beside the two sibling PR icons, plus a pure `prGlyphIcon(win: WindowInfo)` selector (closed → Closed, open+draft → Draft, else standard) colocated in `icons.tsx` <!-- R2 -->

### Phase 3: Integration & Edge Cases

- [x] T003 Replace the two-way ternaries at `window-row.tsx` (~:726 overlay, ~:820 rail) and `session-tiles.tsx` (~:200) with `prGlyphIcon(win)`; fix the site comments (window-row ~:711–716, session-tiles ~:188–192) that call closed muted / say shape alone separates closed from draft <!-- R3 -->
- [x] T004 Tests: in `window-row.test.tsx` flip the closed case (~:535/:539) to red + rename, extend the draft case (~:501) with dashes-present/arc-absent, add closed-draft (✕, red), failing-draft (draft shape, red), open non-draft (arc, no dashes); in `session-tiles.test.tsx` flip closed (~:227/:231) to red and add draft + closed-draft cases; grep `app/frontend/src/**/*.test.ts{,x}` and `app/frontend/tests/e2e/*.spec.ts` for any other closed-glyph color / `prIsDraft` glyph assertion and update; run `just test-frontend` (three suites first) and `cd app/frontend && npx tsc --noEmit` <!-- R1, R3 -->

### Phase 4: Polish

- [x] T005 Update `docs/specs/status-pyramid.md` (~69 channel table, ~158 + ~243–245 chain restatements, ~230 row 21, ~359 D2) to the six-state red-closed / draft-shape model; memory files are hydrate's job <!-- R4 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `prGlyphColor({prState:"closed"})` returns `text-signal-red` for plain, failing-checks, changes-requested and draft closed windows; merged/open cases unchanged
- [x] A-002 R2: `GitPullRequestDraftIcon` exists in `icons.tsx` with the sibling idiom and the lucide draft path data
- [x] A-003 R3: All three render sites (window-row overlay, window-row rail, session-tile header) select the icon via the same closed-first three-way mapping
- [x] A-004 R4: `status-pyramid.md` has no remaining "closed earns no glyph" / "never closed" / "gray open-draft"-as-the-only-gray wording; the PR glyph row lists six states with red closed

### Behavioral Correctness

- [x] A-005 R1: The closed-glyph unit assertions in `pr-status-model.test.ts`, `window-row.test.tsx`, `session-tiles.test.tsx` assert `text-signal-red` (none still pin `text-text-secondary` for closed)
- [x] A-006 R3: A closed draft renders the ✕ icon in red (closed wins over draft); an open draft renders the draft icon in gray; a failing open draft renders the draft icon in red

### Scenario Coverage

- [x] A-007 R3: Unit tests assert the draft icon by path data (`M18 6V5`, `M18 11v-1` present; arc `M13 6h3a2 2 0 0 1 2 2v7` absent) for row and tile, mirroring the existing closed-✕ assertion style
- [x] A-008 R1: `just test-frontend` passes and `npx tsc --noEmit` is clean; no e2e spec asserts the old gray closed glyph

### Edge Cases & Error Handling

- [x] A-009 R3: A window with `prState` undefined/`""` still renders no glyph (`prOwnsGlyph` unchanged) — the selector is never reached for unowned states

### Code Quality

- [x] A-010 Pattern consistency: the new icon matches the sibling SVG attribute idiom exactly; the selector is a pure function with no `fab status`/React-state side effects
- [x] A-011 No unnecessary duplication: the three-way mapping exists once (`prGlyphIcon`), not as three copied ternaries
- [x] A-012 Comment discipline: updated site comments state constraints (closed-first ordering, shape-vs-color roles) without narrating code or citing change IDs
- [x] A-013 Tests cover the changed behavior (code-quality principle: bug fixes MUST include tests)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant: the two-way icon ternaries were replaced in place by `prGlyphIcon`, and all three PR icon exports remain in use through it.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The icon selector `prGlyphIcon(win)` lives in `sidebar/icons.tsx` (React home) rather than `pr-status-model.ts` | Intake allowed either; `pr-status-model.ts` is React-free today and should stay so; icons.tsx already owns the three icons | S:80 R:90 A:85 D:80 |
| 2 | Certain | Spec (`status-pyramid.md`) is updated in apply (T005); memory files are left to hydrate | Specs are human-curated design intent and the plan owns them; hydrate owns `docs/memory/` | S:85 R:90 A:90 D:85 |
| 3 | Confident | No new e2e spec | Intake #9; no existing e2e asserts glyph color/draft; unit tests pin the DOM contract | S:65 R:90 A:65 D:55 |

3 assumptions (1 certain, 2 confident, 0 tentative).
