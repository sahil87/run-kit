# Plan: Multi-color PR status dot in the sidebar window row (PR traffic-light)

**Change**: 260615-2olv-pr-status-dot-traffic-light
**Intake**: `intake.md`

## Requirements

### PR Dot: State Derivation

- **R1** The system MUST expose, in `app/frontend/src/components/pr-status-line.tsx` colocated with the existing exported `isFailish`, an exported `PrDotState` type (`"merged" | "fail" | "pending" | "healthy" | "neutral"`) and an exported `prDotState(win: WindowInfo): PrDotState` function with first-match-wins precedence: `merged` → `fail` (reusing `isFailish`) → `pending` (`prChecks === "pending"`) → `healthy` (`prChecks === "pass"`) → `neutral`.
  - GIVEN a window with `prState === "merged"` and historical `prChecks === "fail"`, WHEN `prDotState` is evaluated, THEN it returns `"merged"` (merged is first, regardless of historical checks).
  - GIVEN a window with `prChecks === "pass"` and `prReview === "changes_requested"` (or `prChecks === "fail"`), WHEN `prDotState` is evaluated, THEN it returns `"fail"` (fail beats healthy).
  - GIVEN a window with `prState === "closed"` (unmerged), WHEN `prDotState` is evaluated, THEN it returns `"neutral"` (closed is not in the merged branch and falls through).
  - GIVEN a draft window (`prIsDraft === true`) with `prChecks === "pass"`, WHEN `prDotState` is evaluated, THEN it returns `"healthy"` (green = health, no `&& approved` / `&& !draft` requirement).
  - GIVEN an open window with no decisive checks signal (`prChecks` absent / `"none"`), WHEN `prDotState` is evaluated, THEN it returns `"neutral"`.

- **R2** The system MUST expose the color and accessible-name maps the window row consumes (exported from `pr-status-line.tsx`): `PR_DOT_COLOR: Record<PrDotState, string>` = `{ merged: "text-purple-400", fail: "text-red-400", pending: "text-yellow-400", healthy: "text-accent-green", neutral: "text-text-secondary" }` and `PR_DOT_LABEL: Record<PrDotState, string>` = `{ merged: "PR merged", fail: "PR needs attention — checks failing or changes requested", pending: "PR checks running", healthy: "PR checks passing", neutral: "PR open" }`. No new color hex SHALL be introduced — all five tokens already exist.
  - GIVEN the five states, WHEN the maps are read, THEN each state has exactly the token and label specified above, and `isFailish` is left unchanged (single source of truth for the fail branch).

### PR Dot: Window-Row Rendering

- **R3** The window row (`app/frontend/src/components/sidebar/window-row.tsx`, right cluster ~line 284) MUST, for every change-bound PR window (gate unchanged: `win.fabChange && win.prNumber`), ALWAYS render a single dot whose color comes from `PR_DOT_COLOR[prDotState(win)]` and whose `aria-label` and `title` come from `PR_DOT_LABEL[prDotState(win)]`. The four live states (`merged`/`fail`/`pending`/`healthy`) render the solid glyph `●` (U+25CF); `neutral` renders as a dim/hollow ring (border + transparent fill via `currentColor`, the in-file activity-dot technique) in `text-text-secondary`. The existing `shrink-0`/`text-xs` sizing and placement (before stage text + duration) are preserved.
  - GIVEN a change-bound window whose `prDotState` is `merged`, WHEN the row renders, THEN a solid dot with class containing `text-purple-400`, `aria-label="PR merged"` exists.
  - GIVEN a change-bound window whose `prDotState` is `fail`, WHEN the row renders, THEN a solid dot with `text-red-400`, `aria-label="PR needs attention — checks failing or changes requested"` exists.
  - GIVEN a change-bound window whose `prDotState` is `pending`, WHEN the row renders, THEN a solid dot with `text-yellow-400`, `aria-label="PR checks running"` exists.
  - GIVEN a change-bound draft window with passing checks (`prDotState` = `healthy`), WHEN the row renders, THEN a solid dot with `text-accent-green`, `aria-label="PR checks passing"` exists.
  - GIVEN a change-bound window with no decisive signal or a closed-unmerged PR (`prDotState` = `neutral`), WHEN the row renders, THEN a dim/hollow dot with `text-text-secondary`, `aria-label="PR open"` exists.
  - GIVEN a window with no PR (`prNumber` absent) OR not change-bound (`fabChange` absent), WHEN the row renders, THEN NO PR dot is rendered (gate unchanged).

### PR Dot: Cross-Surface Color Story (status-panel)

- **R4** `getPrSegments` in `app/frontend/src/components/sidebar/status-panel.tsx` MUST color a draft PR's state segment via `PR_STATE_COLORS[win.prState]` (open → `text-accent-green`), dropping the `win.prIsDraft ? "text-text-secondary"` override at line 108, so the three PR surfaces tell one "green = health, not readiness" color story. The lines 99-100 doc comment MUST be updated from the "draft is not ready, not a healthy green" framing to the "health, not readiness" framing. No other behavior of `getPrSegments` changes (the checks/review suppression for `!open` PRs stays).
  - GIVEN a draft open PR (`prIsDraft === true`, `prState === "open"`), WHEN the pane panel renders its PR line, THEN the state segment (`open (draft)`) carries `text-accent-green`.
  - GIVEN a merged PR, WHEN the pane panel renders, THEN checks/review are still suppressed and the state segment is `text-purple-400` (unchanged).

### Non-Goals

- No backend change: `prstatus.go` / `api/sse.go` unchanged; no new SSE field; no new `gh`/GraphQL call (`mergeable`/`mergeStateStatus` deliberately not fetched).
- No new route, no new component, no new color token.
- "Yellow = merge conflicts" is rejected for v1; yellow is reserved for `pending`.

### Design Decisions

- **`merged` is transient (Constitution II).** The dot derives from the live in-memory snapshot; an aged-out merge falls through to `neutral`. No persistence.
- **Neutral hollow-ring technique.** Reuse the existing activity-dot rendering (`border: "1.5px solid currentColor"` + `backgroundColor: "transparent"`) for the neutral state rather than a solid dim glyph — strongest in-repo precedent (Assumption #12, Tentative; resolved toward the precedent).
- **Single fail predicate.** `prDotState` reuses `isFailish` for its `fail` branch — one source of truth shared with `PrStatusLine`.

## Tasks

### Phase 2: Core Implementation

- [x] T001 Add exported `PrDotState` type, `prDotState(win)` precedence function, and exported `PR_DOT_COLOR` + `PR_DOT_LABEL` maps to `app/frontend/src/components/pr-status-line.tsx`, colocated with `isFailish` (reused as the fail branch). <!-- R1 R2 -->
- [x] T002 Replace the single-red-dot block (~line 284) in `app/frontend/src/components/sidebar/window-row.tsx` with a `prDotState`-driven always-rendered dot: solid `●` for the four live states in `PR_DOT_COLOR`, hollow ring (activity-dot technique) for `neutral`; `aria-label` + `title` from `PR_DOT_LABEL`; gate stays `win.fabChange && win.prNumber`; import `prDotState`/`PR_DOT_COLOR`/`PR_DOT_LABEL` from `pr-status-line`. <!-- R3 -->
- [x] T003 In `app/frontend/src/components/sidebar/status-panel.tsx` `getPrSegments`, drop the `win.prIsDraft ? "text-text-secondary"` override (line 108) so the draft state-color follows `PR_STATE_COLORS[win.prState]`, and update the lines 99-100 doc comment to the "health, not readiness" framing. <!-- R4 -->

### Phase 3: Tests

- [x] T004 [P] Rewrite the PR-dot block in `app/frontend/src/components/sidebar/window-row.test.tsx` (~lines 263-326) into per-state assertions: merged→purple+"PR merged"; fail→red+new label; pending→yellow+"PR checks running"; healthy (incl. draft `prIsDraft:true, prChecks:"pass"`)→green+"PR checks passing"; neutral (open no-checks, and closed-unmerged)→secondary+"PR open"; no-PR / non-change-bound→no dot. Update any test matching the old "PR needs attention" exact string. <!-- R3 -->
- [x] T005 [P] Add `prDotState` precedence unit tests to `app/frontend/src/components/pr-status-line.test.tsx`: fail-beats-healthy, merged-first (with historical fail), closed→neutral, draft→healthy, pending→pending, bare-open-no-checks→neutral. <!-- R1 R2 -->
- [x] T006 [P] In `app/frontend/src/components/sidebar/status-panel.test.tsx`, change the existing draft→secondary assertion (~line 460) to draft→`text-accent-green`, and add/confirm a draft→green state-segment assertion (`prIsDraft:true, prState:"open"`). <!-- R4 -->

## Acceptance

### Functional Completeness

- [ ] A-001 R1: `prDotState` is exported from `pr-status-line.tsx`, colocated with `isFailish`, and implements the exact first-match-wins precedence `merged → fail → pending → healthy → neutral`.
- [ ] A-002 R2: `PR_DOT_COLOR` and `PR_DOT_LABEL` are exported with the exact tokens/labels specified; `isFailish` is unchanged; no new color hex is introduced.
- [ ] A-003 R3: The window row always renders one dot for a change-bound PR window with the per-state color + accessible name; neutral is a hollow ring; the gate `fabChange && prNumber` is unchanged so non-PR windows show no dot.
- [ ] A-004 R4: `getPrSegments` colors a draft's state segment with `PR_STATE_COLORS[win.prState]` (open → green); the draft-secondary override is gone; the doc comment reflects health-not-readiness; checks/review suppression for `!open` is retained.

### Behavioral Correctness

- [ ] A-005 R1: Precedence edge cases hold — merged beats historical fail; fail beats would-be-healthy; closed → neutral; draft-with-passing-checks → healthy; bare-open-no-checks → neutral.
- [ ] A-006 R3: The fail dot's accessible name is the new string "PR needs attention — checks failing or changes requested" (not the old "PR needs attention").

### Scenario Coverage

- [ ] A-007 R3: window-row.test.tsx asserts each of the five states (color token + aria-label) plus the no-dot gate cases.
- [ ] A-008 R1: pr-status-line.test.tsx asserts each precedence-defining `prDotState` case.
- [ ] A-009 R4: status-panel.test.tsx asserts draft → green (state segment) and retains the pending→yellow / merged→purple assertions.

### Code Quality

- [ ] A-010 Pattern consistency: new code follows the existing `pr-status-line.tsx` map/predicate style, uses type narrowing over `as` casts (constitution / code-quality), and reuses the in-file activity-dot hollow-ring technique for neutral.
- [ ] A-011 No unnecessary duplication: the `fail` branch reuses `isFailish` rather than re-deriving it; the dot location and color vocabulary are reused, not re-invented (Constitution IV).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `PR_DOT_COLOR` and `PR_DOT_LABEL` are exported (not module-private) from `pr-status-line.tsx` because `window-row.tsx` imports and consumes both | Intake §1 says "export what the row consumes"; the row needs per-state color + label, so both maps are exported | S:95 R:90 A:95 D:95 |
| 2 | Certain | Neutral dot uses the in-file activity-dot hollow-ring technique (`border: "1.5px solid currentColor"` + transparent background) in `text-text-secondary`, NOT a solid dim glyph | Intake Assumption #12 (Tentative) flagged this as an apply-stage nuance and named the activity-dot border technique (window-row.tsx:254-257) as the strongest in-repo precedent; resolved toward the precedent. Sized like the activity dot's `w-1.5 h-1.5 rounded-full` so it reads as a ring | S:75 R:90 A:80 D:70 |
| 3 | Certain | The neutral hollow dot keeps the `text-xs`/`shrink-0` cluster sizing semantics; the ring itself is rendered with the activity-dot's `w-1.5 h-1.5 rounded-full` box (a fixed-size ring cannot use a glyph), while live states keep the `text-xs ●` glyph | Intake says keep `shrink-0`/`text-xs` sizing and "neutral renders hollow"; a hollow ring is a sized box not a glyph, so the two renderings differ in element shape but both stay `shrink-0` in the same cluster slot | S:80 R:90 A:85 D:75 |
| 4 | Confident | Tests are scoped-run via `pnpm test <files>` (vitest positional filter) for the apply gate rather than the full `just test-frontend` suite | Task contract says scope to touched files first; `package.json` test script is `vitest run`, which accepts positional filename filters | S:85 R:95 A:90 D:90 |

4 assumptions (3 certain, 1 confident, 0 tentative).
