# Plan: Marker rework phase 1 — expand: accept the `mode:stage` vocabulary

**Change**: 260830-nip5-marker-expand-mode-stage-vocabulary
**Intake**: `intake.md`

## Requirements

### Backend: `@rk_win_marker` accepted vocabulary

#### R1: The marker validator accepts the union of both vocabularies
`validate.markerTokens` SHALL be the ordered union of the twelve `<mode>[:<stage>]` tokens
(`manual`, `manual:1`, `manual:2`, `manual:3`, `auto`, `auto:1`, `auto:2`, `auto:3`, `blocked`,
`blocked:1`, `blocked:2`, `blocked:3`) followed by the eight legacy flat tokens (`pipe`, `dotted`,
`dashed`, `solid`, `double`, `thick`, `hatch`, `block`). The new tokens MUST come first, since slice
order is the presentation order of the derived error message. `""` MUST remain valid (unset), and
the closed set MUST stay a closed set — no pattern matching, no whitespace tolerance, no case
folding. `MarkerValues`, `ValidateMarkerValue`, `closedSet` and `validateClosedSet` MUST keep
deriving from this single slice.

- **GIVEN** a running server on this build
- **WHEN** `ValidateMarkerValue` is called with any of the twenty tokens or `""`
- **THEN** it returns the empty string (valid)
- **AND WHEN** it is called with `"manual:0"`, `"manual:4"`, `"manual:"`, `"manual:1:2"`,
  `"MANUAL"`, `" manual "`, `"auto:01"`, `"mode:stage"`, `"Dotted"`, `" solid "`, `"wavy"` or a
  flair token such as `"rain"`
- **THEN** it returns a non-empty error message naming the accepted set with the new tokens first

#### R2: `NormalizeMarker` lands as a pure, exported, tested function — and is NOT wired in
`internal/tmux` SHALL export `NormalizeMarker(raw string) string` backed by an unexported
`legacyMarkerValues` table mapping `pipe|dotted|dashed|solid → manual:1`, `double → manual:2`,
`thick → manual:3`, `hatch → blocked:2`, `block → blocked:3`. Current-vocabulary tokens and `""`
MUST pass through; anything else MUST normalize to `""`. The function MUST NOT be called from
`parseWindows`, `layout.go`, `snapshot/restore.go`, or any other production path in this change —
its only consumer is its own test.

- **GIVEN** any of the eight legacy tokens
- **WHEN** `NormalizeMarker` is called with it
- **THEN** it returns that token's `<mode>:<stage>` mapping, never the legacy token itself
- **AND GIVEN** any of the twelve new tokens or `""`
- **WHEN** `NormalizeMarker` is called with it
- **THEN** it returns the input unchanged
- **AND GIVEN** `"wavy"`, `"Manual"`, `" manual:1 "` or `"manual:4"`
- **THEN** it returns `""`
- **AND GIVEN** the existing `parseWindows` marker tests on this branch
- **WHEN** `go test ./internal/tmux` runs
- **THEN** they pass untouched — a window carrying `dotted` is still served as `dotted`

#### R3: The `color-tabs` operator prompt vocabulary tracks the validator
The marker token literal in `api/operator.go`'s `color-tabs` prompt SHALL list the same twenty
tokens in `markerTokens` order, so `api/operator_test.go`'s existing set-equality invariant
(`promptVocab("@rk_win_marker") == closedSetTokens(validate.MarkerValues)`) continues to hold. That
invariant MUST NOT be weakened or removed.

- **GIVEN** the widened `markerTokens`
- **WHEN** `go test ./api` runs
- **THEN** `TestRenderColorTabs` passes, both its substring assertion and its set-equality invariant

### Frontend: the `mode × stage` model

#### R4: `marker.tsx` ships the parse/format half only
`app/frontend/src/marker.tsx` SHALL export `MARKER_MODES`, `MARKER_STAGES`, `MARKER_STAGE_GLOSS`,
the `MarkerMode` / `MarkerStage` / `Marker` types, `parseMarker` and `formatMarker`. It MUST NOT
ship `MARKER_INK`, `MARKER_STAGE_WIDTHS`, the `MARKER_CHEVRON_*` geometry constants,
`markerFillStyle`, or `MarkerChevrons` — those arrive in phase 2 with their first consumer.
`parseMarker` MUST never throw. `formatMarker` MUST always emit the explicit `<mode>:<stage>` form.

- **GIVEN** any of the nine mode×stage `Marker` values
- **WHEN** `parseMarker(formatMarker(m))` is evaluated
- **THEN** it deep-equals `m`
- **AND GIVEN** a bare mode string such as `"auto"`
- **THEN** `parseMarker` returns `{ mode: "auto", stage: 1 }`
- **AND GIVEN** `null`, `undefined`, `""`, `"  "`, `"manual:0"`, `"manual:4"`, `"manual:"`,
  `"manual:1:2"`, `"solid"` or `"MANUAL"`
- **THEN** `parseMarker` returns `null`
- **AND GIVEN** `" manual "` or `"auto:01"`
- **THEN** `parseMarker` returns `{manual, 1}` and `{auto, 1}` respectively — the frontend parser
  trims and tolerates a leading zero where the backend closed set rejects both, and the tests MUST
  pin that asymmetry rather than assume symmetry

### Change-wide: invisibility

#### R5: The change is behaviourally invisible and diff-scoped
No file under `app/frontend/src/components/` SHALL be modified. `app/frontend/src/themes.ts`
(`MARKER_STATES`, `markerStripeStyle`), `globals.css`, every e2e spec, `internal/tmux/layout.go`,
`internal/snapshot/*` and `internal/tmux/legacy_options.go` SHALL be untouched. Comments added or
modified by this change MUST carry no plan/change IDs (`R#` / `T###` / `A-###`), no PR numbers, and
no removed-feature narration; comments outside this change's own lines MUST NOT be rewritten.

- **GIVEN** the completed change
- **WHEN** `git diff --stat` is inspected against the merge-base
- **THEN** no path under `app/frontend/src/components/` appears
- **AND WHEN** the provenance sweep
  `grep -rnE '\((hwtr|[a-z0-9]{4})\)|\b(R[0-9]{1,2}|T0[0-9]{2}|A-[0-9]{3})\b'` runs over every
  touched file including tests
- **THEN** it reports no hits
- **AND WHEN** a live server serving windows that carry legacy markers is loaded before and after
- **THEN** the sidebar rows render identically

### Non-Goals

- Wiring `NormalizeMarker` into any read or write path — phase 2 flips `parseWindows`, `layout.go`
  field 27 and `snapshot/restore.go` in the same change that teaches the UI to draw the new model.
- Narrowing `markerTokens` to the twelve new tokens — that is phase 2's contract half.
- Any visual work: the well, `--color-marker-ink`, `markerFillStyle`, `MarkerChevrons`,
  `window-row.tsx`, `swatch-popover.tsx`, `LabelZone` retirement — all phase 2.
- The spring-loaded marker pad and every interaction surface — phase 3, blocked on OQ-1.
- A `legacy_options.go` migration row: that table maps option *names*; this is a same-name *value*
  remap, which is why the forward map lives at the parse seam instead.

### Design Decisions

#### Expand before migrate: widen the accepted set, land the model unconsumed
**Decision**: Phase 1 widens `markerTokens` to the union of both vocabularies and lands
`NormalizeMarker` plus the frontend parse/format module with tests as their only consumer. The read
path, the renderer and the contract half all wait for phase 2.
**Why**: The stored vocabulary and the renderer are genuinely coupled — the token set cannot narrow
without changing what draws it. Splitting on that seam means no phase ever leaves a running server
or a stored snapshot holding a token its own validator rejects, and each phase answers exactly one
review question. This phase's question is *does every stored value survive?*
**Rejected**: A single flag-day change (PR #767) — it passed every gate but took ten review cycles
against a budget of three, and two user-visible interaction defects survived, because a storage
migration, a visual rework, a new interaction component and a docs move shared one pass/fail
verdict.
*Introduced by*: 260830-nip5-marker-expand-mode-stage-vocabulary

#### The operator prompt vocabulary widens in this phase, not the next
**Decision**: `api/operator.go`'s `color-tabs` marker token literal (and its `operator_test.go`
substring assertion) widen to the twenty-token union here, even though the split plan lists
`operator.go` under phase 2.
**Why**: `operator_test.go` asserts set-equality between the rendered prompt vocabulary and
`validate.MarkerValues`. That is a drift guard, and it sits inside this phase's own `go test ./...`
gate — widening `markerTokens` without widening the literal fails the gate. The plan is simply
wrong on the timing.
**Rejected**: Relaxing or deleting the invariant test to defer the literal to phase 2 — it is the
only mechanism keeping the operator prompt honest about what the server will accept, and phase 2
narrows both back to twelve anyway.
*Introduced by*: 260830-nip5-marker-expand-mode-stage-vocabulary

#### `NormalizeMarker` is copied verbatim, with the union pass-through pinned by a test
**Decision**: Copy `NormalizeMarker` from PR #767 unchanged — including its
`validate.MarkerValues[raw]` pass-through arm, which during phase 1 consults the *union* rather
than the narrowed set — and add a test asserting no input ever yields a legacy token.
**Why**: The `legacyMarkerValues` lookup runs first and shadows all eight legacy tokens, so the
union arm is unreachable for them and behaviour is identical to phase 2's narrowed set. Copying
verbatim means phase 2 needs zero edits to the function; the test turns that reasoning into a
check that would fail loudly if the arm order were ever inverted.
**Rejected**: Guarding the pass-through against an explicit new-vocabulary set — it would be dead
defensive code that phase 2 has to unpick, and it hides the shadowing property instead of testing
it.
*Introduced by*: 260830-nip5-marker-expand-mode-stage-vocabulary

#### The gate set is deliberately reduced to Go tests plus `tsc` and one vitest file
**Decision**: This change's gates are `cd app/backend && go test ./...` and
`cd app/frontend && npx tsc --noEmit && npx vitest run src/marker.test.ts`. No Playwright, no
`just test`, no `just build` — a departure from `fab/project/code-quality.md` § Verification's
four-gate list.
**Why**: Nothing in this phase touches a rendered surface, a route, a build input or an e2e
fixture; R5's `git diff --stat` acceptance item is what keeps that claim honest. The full gate set
costs ~9 minutes per cycle against ~1 for the reduced set, and #767's post-mortem attributes real
cost to slow cycles on a change with no visual surface.
**Rejected**: Running the full four-gate set anyway — it buys no coverage this change can affect
and multiplies the cost of every rework cycle.
*Introduced by*: 260830-nip5-marker-expand-mode-stage-vocabulary

## Tasks

### Phase 2: Core Implementation

- [x] T001 [P] In `app/backend/internal/validate/validate.go` replace `markerTokens` (~:206) with the twenty-token union, new twelve first (`manual`, `manual:1..3`, `auto`, `auto:1..3`, `blocked`, `blocked:1..3`) then the legacy eight (`pipe`, `dotted`, `dashed`, `solid`, `double`, `thick`, `hatch`, `block`); rewrite the `MarkerValues` (~:237) and `ValidateMarkerValue` (~:244) doc comments to describe the `<mode>[:<stage>]` schema (mode ∈ manual/auto/blocked = categorical shape axis; stage ∈ 1/2/3 = ordinal axis; bare mode = stage 1) plus the transitional legacy tokens — leave `closedSet`/`validateClosedSet` structurally untouched. In `validate_test.go` `TestValidateMarkerValue` (~:486) extend `valid` to all twenty tokens plus `""`, keep the existing `invalid` entries and add `"manual:0"`, `"manual:4"`, `"manual:"`, `"manual:1:2"`, `"MANUAL"`, `" manual "`, `"auto:01"`, `"mode:stage"`; update the test's leading comment to describe the union <!-- R1 -->
- [x] T002 [P] In `app/backend/internal/tmux/tmux.go` add `legacyMarkerValues` and `NormalizeMarker` immediately after `MarkerOption` (~:165), copied verbatim from `git show pr767:app/backend/internal/tmux/tmux.go` (~:168–194), and update the `MarkerOption` doc comment to name the `<mode>[:<stage>]` schema — do NOT touch `parseWindows` (~:1225) or any other call site. In `tmux_test.go` add a `NormalizeMarker` table test beside the existing `parseWindows` marker cases (~:679): all eight legacy tokens map forward, all twelve new tokens and `""` pass through, `"wavy"`/`"Manual"`/`" manual:1 "`/`"manual:4"` → `""`, plus an explicit assertion that no input in the table ever yields one of the eight legacy tokens <!-- R2 -->
- [x] T003 In `app/backend/api/operator.go` (~:450) widen the `@rk_win_marker` token literal in the `color-tabs` prompt to the same twenty tokens in `markerTokens` order, and update the matching substring assertion in `api/operator_test.go` (~:890) — leave the `promptVocab` set-equality invariant (~:935) untouched. In `app/backend/api/windows.go` refresh the stale `optKeyMarker` comment (~:537, currently "one of dotted/solid/double") to name the `<mode>[:<stage>]` schema plus the transitional legacy tokens; comment only, no logic change <!-- R3 -->
- [x] T004 [P] Create `app/frontend/src/marker.tsx` from `git show pr767:app/frontend/src/marker.tsx`, keeping only the file-header comment, `MARKER_MODES`, `MARKER_STAGES`, `MARKER_STAGE_GLOSS`, the `MarkerMode`/`MarkerStage`/`Marker` types, the private `isMarkerMode`/`isMarkerStage` guards, `parseMarker` and `formatMarker`; drop `MARKER_INK`, `MARKER_STAGE_WIDTHS`, `MARKER_CHEVRON_*`, `markerFillStyle`, `MarkerChevrons` and the now-unused `import type { CSSProperties }`; trim the header comment so it describes only what the file ships (no forward references to a pad or a well). Then write `app/frontend/src/marker.test.ts` FRESH — #767 has no such file, there is nothing to copy — covering the nine-pair `parseMarker ∘ formatMarker` round trip, bare mode → stage 1 for all three modes, `null` for `null`/`undefined`/`""`/`"  "`/`"manual:0"`/`"manual:4"`/`"manual:"`/`"manual:1:2"`/`"solid"`/`"MANUAL"`, `{manual,1}` for `" manual "` and `{auto,1}` for `"auto:01"`, never-throws on arbitrary input, and `MARKER_STAGE_GLOSS` covering every stage <!-- R4 --> <!-- rework: parseMarker throws TypeError on a non-string runtime value (calls .trim() after a null/undefined-only check), violating R4/A-011 "never throws"; the never-throws test exercises strings only -->

### Phase 3: Verification

- [x] T005 Run the provenance sweep `grep -rnE '\((hwtr|[a-z0-9]{4})\)|\b(R[0-9]{1,2}|T0[0-9]{2}|A-[0-9]{3})\b'` over every touched file **including the test files**, and clear every hit — plan IDs, change IDs and PR numbers must not appear in shipped comments. Confirm `git diff --stat` against `origin/main` lists no path under `app/frontend/src/components/` and no `themes.ts`, `globals.css`, `layout.go`, `snapshot/`, `legacy_options.go` or e2e spec. Run the gates: `cd app/backend && go test ./...` then `cd app/frontend && npx tsc --noEmit && npx vitest run src/marker.test.ts`. Do NOT run Playwright or `just build` <!-- R5 -->

## Execution Order

- T001, T002 and T004 are independent (different packages/files) and may run in parallel.
- T003 depends on T001 — the operator prompt literal must match the widened `markerTokens` order,
  and `go test ./api` only passes once both halves land.
- T005 runs last; its gates cover every preceding task.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `ValidateMarkerValue` returns valid for `""` and all twenty tokens, and the derived error message lists the twelve new tokens before the eight legacy ones.
- [x] A-002 R2: `tmux.NormalizeMarker` is exported, maps all eight legacy tokens forward per the table, passes the twelve new tokens and `""` through, and returns `""` for anything else.
- [x] A-003 R3: `TestRenderColorTabs` passes with the widened prompt literal, and the `promptVocab` set-equality invariant is present and unmodified.
- [x] A-004 R4: `app/frontend/src/marker.tsx` exports `MARKER_MODES`, `MARKER_STAGES`, `MARKER_STAGE_GLOSS`, `Marker`, `parseMarker`, `formatMarker` — and exports none of `MARKER_INK`, `MARKER_STAGE_WIDTHS`, `MARKER_CHEVRON_*`, `markerFillStyle`, `MarkerChevrons`.

### Behavioral Correctness

- [x] A-005 R2: `NormalizeMarker` has zero production call sites — `parseWindows`, `layout.go`, `snapshot/restore.go` and every other read/write path are byte-identical to `origin/main`, and the pre-existing `parseWindows` marker tests pass untouched.
- [x] A-006 R1: Every previously-accepted marker value still validates; `POST /api/windows/{id}/options` newly accepts the twelve `mode:stage` tokens and still 400s an out-of-set value with zero tmux calls.
- [x] A-007 R5: A live server carrying legacy markers renders identically before and after — no marker reaches the UI in a form `markerStripeStyle` did not already handle.

### Scenario Coverage

- [x] A-008 R2: A `NormalizeMarker` table test exists in `internal/tmux/tmux_test.go` and includes the explicit assertion that no input ever yields one of the eight legacy tokens.
- [x] A-009 R4: `marker.test.ts` covers the nine-pair round trip, bare-mode default, the null cases, and pins the two deliberate frontend/backend asymmetries (`" manual "` and `"auto:01"` parse on the frontend, reject on the backend).
- [x] A-010 R1: `validate_test.go`'s `invalid` list rejects the malformed new-vocabulary forms (`manual:0`, `manual:4`, `manual:`, `manual:1:2`, `MANUAL`, ` manual `, `auto:01`, `mode:stage`), proving the union stayed a closed set rather than becoming a pattern match.

### Edge Cases & Error Handling

- [x] A-011 R4: `parseMarker` never throws for any input, including `null`, `undefined`, non-string-shaped values reaching it at runtime, and strings with multiple colons.
- [x] A-012 R1: The union is case-sensitive and whitespace-intolerant on the backend — `"Manual"`, `" manual "` and `"AUTO:1"` all reject.

### Removal Verification

- [x] A-013 R5: **N/A** — this change removes nothing; the contract half is phase 2.

### Code Quality

- [x] A-014 Pattern consistency: The new backend code follows the file's existing idioms — the token slice stays the single source for both the membership map and the error copy; the normalize helper sits with the option const it belongs to; Go tests are table-driven in the package's existing style.
- [x] A-015 No unnecessary duplication: `NormalizeMarker` reuses `validate.MarkerValues` rather than re-declaring a token set, and `marker.tsx` is the single frontend home for the `mode:stage` vocabulary.
- [x] A-016 Comment discipline: Comments this change adds or modifies state constraints the code cannot show, and carry no plan/change IDs (`R#`/`T###`/`A-###`), no PR numbers, and no removed-feature narration. Comments outside this change's own lines are not rewritten.
- [x] A-017 Test coverage: The added behaviour is covered by tests — the widened validator, the normalize table, and the frontend parse/format module each have their own.
- [x] A-018 No magic strings: The stage glosses, mode list and stage list are named exported constants, not inline literals.
- [x] A-019 **N/A** UI e2e coverage: `code-quality.md` asks for Playwright coverage on UI changes; this change touches no rendered surface (A-007/R5), so no e2e spec applies.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- **Expected reviewer objection, pre-answered**: `NormalizeMarker` and `marker.tsx` have zero
  production call sites in this change. That is the deliberate first half of an expand → migrate →
  contract migration; phase 2 is the named production consumer. This objection was raised on #767
  cycle 1 and is recorded here as a decision, not a finding.

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Tasks are grouped source-with-test per file/module (5 tasks) rather than one task per file (9) | Matches the granularity of recent plans in this repo (e.g. 260829-lvvw shipped a comparable diff as 5 tasks with tests folded in), and a new module is not a completable unit of work without its test | S:70 R:90 A:85 D:80 |
| 2 | Certain | The `NormalizeMarker` table test asserts a *negative* — that no input yields a legacy token — rather than only enumerating the mappings | The union pass-through arm is the one place phase 1 diverges from #767's context; an enumeration test would still pass if the arm order were inverted, the negative assertion would not | S:80 R:85 A:90 D:85 |
| 3 | Certain | `marker.tsx`'s copied file-header comment is trimmed to describe only what phase 1 ships | #767's header references the marker pad and the row well, neither of which exists on this branch — shipping it verbatim would be comment narration about absent code, which `code-quality.md` prohibits | S:75 R:90 A:85 D:80 |
| 4 | Confident | `windows.go`'s comment refresh rides T003 with the operator change rather than getting its own task | Both are single-hunk edits in `app/backend/api`, verified by the same `go test ./api` run; splitting them would add a task without adding a checkpoint | S:65 R:95 A:80 D:75 |
| 5 | Confident | A-019 marks `code-quality.md`'s "UI changes SHOULD include Playwright e2e tests" as N/A rather than omitting the principle | The principle is in scope for the change type (a frontend file is added), so the plan should record *why* it does not apply — the module renders nothing — instead of silently dropping it | S:65 R:90 A:80 D:75 |

5 assumptions (3 certain, 2 confident, 0 tentative).
