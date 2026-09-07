# Plan: Show Code Server Even When Not In A Git Root

**Change**: 260907-a482-code-server-outside-git-root
**Intake**: `intake.md`

## Requirements

### Backend: Code-Lens Folder Derivation

#### R1: `deriveGitRoot` falls back to the resolved cwd when no git root is found
`app/backend/internal/sessions/sessions.go`'s `deriveGitRoot` (lines 664-683) SHALL return the
window's resolved cwd (active pane, else first pane, else worktree path — unchanged precedence)
when `config.FindGitRoot` finds no `.git` ancestor, instead of returning `""`. This mirrors
`cmd/rk/code.go`'s `codeTargetFolder` (lines 201-212), which already falls back to the raw cwd
"when not inside a repo (or when git is unavailable)".

- **GIVEN** a window whose active pane's cwd is `/tmp` (no `.git` ancestor anywhere above it)
- **WHEN** `deriveGitRoot(w)` is called
- **THEN** it returns `/tmp` (not `""`)

- **GIVEN** a window whose active pane's cwd is inside a git repository
- **WHEN** `deriveGitRoot(w)` is called
- **THEN** it returns the git toplevel, exactly as before this change (no regression)

- **GIVEN** a window with zero panes and an empty `WorktreePath`
- **WHEN** `deriveGitRoot(w)` is called
- **THEN** it still returns `""` — the sole remaining empty case (no cwd is resolvable at all)

#### R2: `config.FindGitRoot` and its other call sites are untouched
`app/backend/internal/config/gitroot.go`'s `FindGitRoot` SHALL NOT change: its `""` return for
"no `.git` ancestor found" remains exactly as-is, since `app/backend/api/fork.go:182`,
`app/backend/api/closed.go:263`, `app/backend/cmd/rk/operator.go:237`, and
`app/backend/cmd/rk/riff.go:243,302,316` each call it directly to answer "is this inside a repo at
all" for their own, unrelated purposes.

- **GIVEN** any of the call sites above invoke `config.FindGitRoot(cwd)` directly with a non-git
  `cwd`
- **WHEN** this change ships
- **THEN** they still receive `""`, exactly as before — zero behavior change for fork, closed
  sessions, operator, riff, and tutorial

### Docs: Right-Panel Spec Update

#### R3: The spec describes the cwd-fallback, not a hard git-root requirement
`docs/specs/right-panel.md`'s Surface Registry `code` row (line 92) and the `code` lens keying
note (~line 104, "Keyed by git root, not window id and not raw cwd") SHALL be reworded to
describe: availability derives from a resolvable folder — the git toplevel when found, else the
active pane's raw cwd — and editor state is keyed on that resolved folder; two non-git windows on
different raw cwds intentionally do NOT share editor state (there is no shared toplevel to key on
outside a repo), while two windows sharing the exact same git toplevel or the exact same raw cwd
still do.

- **GIVEN** a reader consults the Surface Registry `code` row or the keying note
- **WHEN** they read the availability/keying description
- **THEN** it accurately states the cwd-fallback behavior, not the old hard git-root requirement

### Frontend: Doc-Comment Accuracy (no logic changes)

#### R4: Comments describing `gitRoot`/`GitRoot` as strictly "the git toplevel" are corrected
Doc comments across `app/frontend/src/lib/window-view.ts` (lines 33-36, 78-79),
`app/frontend/src/lib/code-folder-latch.ts` (lines 6, 23, 32), `app/frontend/src/lib/right-panel.ts`
(line 13), `app/frontend/src/components/code-surface.tsx` (lines 14, 35),
`app/frontend/src/types.ts` (line 185), and the backend comments at `sessions.go:655-663` and
`tmux.go:802-807` SHALL be updated to describe `gitRoot`/`GitRoot` as "the git toplevel, falling
back to the active pane's raw cwd when not inside a repo" (or equivalent). This is purely
descriptive — `hasCode()`, `codeRootFor()`, `codeRootSeed()`, and `codeServerSrc()` all already
treat any non-empty `gitRoot` as code-capable / a valid folder, so none of their logic changes.

- **GIVEN** the backend now supplies a non-empty `gitRoot` for every window with a resolvable cwd
- **WHEN** a developer reads any of the comments listed above
- **THEN** the comment accurately reflects the fallback, not just "the git toplevel"

### Tests: Go Unit Coverage

#### R5: `TestDeriveGitRoot` reflects the new fallback contract
`app/backend/internal/sessions/sessions_test.go`'s `TestDeriveGitRoot` (lines 313-372) SHALL be
updated: the `"non-repo cwd yields empty"` subtest (lines 357-364) MUST assert the fallback value
(the non-repo `plain` temp dir itself), not `""`; the `"no cwd derivable yields empty"` subtest
(lines 366-371) remains unchanged, asserting `""` for a `WindowInfo{}` with no panes and no
worktree path.

- **GIVEN** the active pane's cwd is a non-repo temp directory (`plain` in the existing test
  fixture)
- **WHEN** `deriveGitRoot(w)` is called
- **THEN** the test asserts the return equals `plain` (the cwd itself), replacing the old `""`
  expectation

- **GIVEN** a `WindowInfo{}` with no panes and no worktree path
- **WHEN** `deriveGitRoot(w)` is called
- **THEN** the test continues to assert `""` — unchanged

### Tests: e2e Contract Flip

#### R6: e2e specs assert the new "non-git window is code-capable" contract
Playwright specs that use a `/tmp` (non-repo) cwd fixture specifically to assert the Code lens is
**unavailable** SHALL be updated to assert it is now **available**, with the code-server folder
equal to the raw cwd. Specs that use a `/tmp` cwd only to avoid an unrelated timing race (never
asserting Code-lens absence themselves) SHALL have only their stale rationale comments corrected —
their actual assertions are unaffected and must not change.

- **GIVEN** `app/frontend/tests/e2e/code-surface.spec.ts`'s test "the Code tile top-bar toggle
  appears only on a git-repo window..." (lines 215-255), whose `/tmp`-cwd branch (lines 243-255)
  currently asserts `codeToggle` has count 0 and no `View: Code` palette option
- **WHEN** this change ships
- **THEN** the test (renamed/re-described as needed) asserts the Code tile toggle IS visible and
  `View: Code` IS offered for the `/tmp`-cwd window too, with the surfaced folder equal to `/tmp`

- **GIVEN** `app/frontend/tests/e2e/right-panel.spec.ts`'s test "a window with no git root and no
  web tab shows the tty + web toggles only" (lines 238-255)
- **WHEN** this change ships
- **THEN** the test (renamed/re-described as needed) asserts the Code toggle IS present for the
  `/tmp`-cwd window

- **GIVEN** `app/frontend/tests/e2e/web-view-lens.spec.ts`'s five `/tmp`-cwd fixtures (lines 214,
  327, 368, 414, 452), each carrying a comment claiming `/tmp` makes the window "NON-repo (no
  gitRoot → code unavailable)"
- **WHEN** each surrounding test is audited
- **THEN** for any test whose own assertions never reference the Code toggle / `View: Code` option
  (i.e., it used `/tmp` only to dodge the gitRoot-probe timing race for an unrelated web-lens
  assertion), only the stale comment is corrected — test behavior is unchanged; for any test that
  DOES assert Code-lens absence, the assertion is flipped per the same pattern as the two specs
  above

### Tests: `code-folder-latch.spec.ts` Coverage (added post-review-cycle-1)

#### R7: The latch e2e spec asserts the new fallback value, not empty
`app/frontend/tests/e2e/code-folder-latch.spec.ts` drives the real "active pane leaves the repo"
scenario via `splitPaneOutsideRepo` (a `tmux split-window -c /tmp`) and polls
`expectDerivedGitRoot(page, id, "")` (lines 213, 269) to confirm the LIVE derivation actually moved
before asserting the latched option/tile/iframe stayed put. Post-change, splitting to `/tmp` makes
the live derivation resolve to `/tmp` (the cwd fallback), not `""` — the derivation still
genuinely moves (proving the latch matters), just to a different value. Both polls SHALL assert
`/tmp` instead of `""`; every latch-stability assertion around them (toggle/tile/header/iframe
`src` staying at the seeded `GIT_ROOT`, the `@rk_win_code_root` option unchanged, the iframe
element identity check) is unaffected and MUST NOT change.

- **GIVEN** `splitPaneOutsideRepo(id)` has run (a second pane split to `/tmp`, made active by tmux)
- **WHEN** `expectDerivedGitRoot(page, id, expected)` polls the live `gitRoot`
- **THEN** `expected` is `/tmp`, not `""` — the derivation moved to the raw-cwd fallback, exactly
  as R1 specifies

- **GIVEN** the same split has happened
- **WHEN** the test asserts the Code tile, its header basename, the iframe `src`, the
  `@rk_win_code_root` option, and the iframe element identity
- **THEN** all of these remain exactly as before this change (still seeded at `GIT_ROOT`) — the
  latch's stability contract is untouched by this fix

Doc comments in the same file describing the derivation as "goes empty" (lines 12-19's file header,
`splitPaneOutsideRepo`'s comment at lines 86-90, and the `Proves:`/steps JSDoc at lines 163-188 and
238-256) SHALL be reworded to describe it as "changes to the raw-cwd fallback (`/tmp`)" instead of
"goes empty" — same accuracy correction as R4, scoped to this file.

### Tests: Remaining Comment-Accuracy Sweep (added post-review-cycle-1)

#### R8: Two more stale "non-repo → code unavailable" comments corrected
Review's holistic-diff pass found two more comments describing the superseded hard git-root
contract, outside the files R6 already audited — no test behavior changes for either, comment-only:

- `app/frontend/tests/e2e/present-auto-expand.spec.ts:37,80` — claims `cwd: "/tmp"` means "NON-repo
  → code unavailable"; SHALL be corrected to reflect the cwd fallback (test assertions there don't
  reference the Code lens, so behavior is unaffected)
- `app/frontend/tests/e2e/_tmux.ts:137` — references "the code-surface spec's availability-negative
  case", which this change eliminated; SHALL be corrected or removed

- **GIVEN** a developer reads either comment
- **WHEN** this change ships
- **THEN** the comment no longer claims `/tmp` makes code unavailable

### Non-Goals

- Renaming the `gitRoot` (frontend) / `GitRoot` (backend struct field) / `codeRoot` names or JSON
  keys — out of scope; see Design Decisions below.
- Changing `config.FindGitRoot`'s behavior or any of its other (non-code-lens) call sites.
- Introducing a new "workspace root" concept distinct from `gitRoot`.
- Changing editor-state sharing semantics for windows that already share a git toplevel — unchanged.
- Any change to `hasCode()`, `codeRootFor()`, `codeRootSeed()`, or `codeServerSrc()` logic — they
  are correct as-is once the backend supplies a non-empty `gitRoot` more often.

### Design Decisions

#### Widen `deriveGitRoot`'s fallback rather than rename or add a field
**Decision**: Add a cwd fallback branch inside the existing `deriveGitRoot` function, keeping the
`GitRoot`/`gitRoot` field name and JSON key unchanged.
**Why**: A repo-wide grep confirmed the frontend-facing `Window.GitRoot` field has exactly one
consumer — the code lens (`hasCode`/`code-folder-latch`) — so widening its derivation carries no
cross-feature risk. The CLI (`cmd/rk/code.go`'s `codeTargetFolder`) already ships this exact
"toplevel, else cwd" fallback pattern, so this mirrors an established, accepted precedent rather
than inventing a new one. A same-name fallback also avoids a rename ripple across the ~10 e2e spec
files and unit tests that reference `gitRoot` by name.
**Rejected**: Introducing a distinct `workspaceRoot` field alongside `gitRoot`, decoupling "is this
a git repo" from "what folder does code-server target." Cleaner in the abstract, but unwarranted
churn given the single-consumer finding — it would touch every file in R4/R6 for naming purity
alone, with no behavioral benefit.
*Introduced by*: 260907-a482-code-server-outside-git-root

#### Non-git windows key their code-server folder on their own raw cwd
**Decision**: Two windows outside any git repository, on different cwds, get distinct code-server
folders (no synthetic shared root invented for the non-git case).
**Why**: Matches the CLI's existing per-invocation `codeTargetFolder` resolution — there is no
natural shared identity to invent outside a git worktree, and inventing one (e.g., a fixed
sentinel) would falsely conflate unrelated directories' editor state.
**Rejected**: A single shared "no-repo" folder/sentinel across all non-git windows — would corrupt
editor state (open tabs, dirty buffers) across genuinely unrelated directories.
*Introduced by*: 260907-a482-code-server-outside-git-root

## Tasks

### Phase 1: Core Implementation

- [x] T001 Add the cwd fallback to `deriveGitRoot` in `app/backend/internal/sessions/sessions.go`
      (lines 664-683): when `config.FindGitRoot(cwd)` returns `""`, return `cwd` itself instead
      (guarding the existing `cwd == ""` early-return unchanged) <!-- R1 -->
- [x] T002 [P] Update the `deriveGitRoot` doc comment (`sessions.go:655-663`) and the `GitRoot`
      struct-field comment (`app/backend/internal/tmux/tmux.go:802-807`) to describe the cwd
      fallback instead of "Returns \"\" when the cwd is not inside a git repo" <!-- R1 --> <!-- R4 -->

### Phase 2: Integration & Edge Cases

- [x] T003 Update `TestDeriveGitRoot` in `app/backend/internal/sessions/sessions_test.go`: the
      `"non-repo cwd yields empty"` subtest (lines 357-364) now asserts `deriveGitRoot(w) == plain`
      (the non-repo temp dir), not `""`; rename the subtest description accordingly; leave the
      `"no cwd derivable yields empty"` subtest (lines 366-371) unchanged <!-- R5 -->
- [x] T004 Update `app/frontend/tests/e2e/code-surface.spec.ts`'s test "the Code tile top-bar
      toggle appears only on a git-repo window..." (lines 215-255): flip the `/tmp`-cwd branch
      (lines 243-255) to assert the Code tile toggle IS visible, `View: Code` IS offered, and the
      code-server folder resolves to `/tmp`; update the test name, its JSDoc intent comment
      (lines 197-214), and the file-header comment's `makeWindow` note (lines 57-59) accordingly
      <!-- R6 -->
- [x] T005 Update `app/frontend/tests/e2e/right-panel.spec.ts`'s test "a window with no git root
      and no web tab shows the tty + web toggles only" (lines 238-255): assert the Code toggle IS
      present (folder=`/tmp`); rename the test and its JSDoc intent comment (lines 225-237)
      accordingly <!-- R6 -->
- [x] T006 Audit `app/frontend/tests/e2e/web-view-lens.spec.ts`'s five `/tmp`-cwd fixtures (lines
      214, 327, 368, 414, 452) and the file-header/helper comments describing the rationale (lines
      25-28, 85-88, 192-194): for each surrounding test, if it never asserts Code-lens
      absence/presence directly, correct only the stale "code unavailable" rationale comment
      (test behavior unchanged); if it does assert Code-lens absence, flip it per the T004/T005
      pattern <!-- R6 -->

### Phase 3: Documentation & Comment Accuracy

- [x] T007 [P] Update `docs/specs/right-panel.md`'s Surface Registry `code` row (line 92) and the
      `code` lens keying note (~line 104) to describe the cwd-fallback derivation and the
      no-shared-root-outside-git behavior, replacing the hard git-root requirement / "keyed by git
      root" language <!-- R3 -->
- [x] T008 [P] Update the remaining frontend doc comments treating `gitRoot` as strictly "the git
      toplevel": `app/frontend/src/lib/window-view.ts` (lines 33-36, 78-79),
      `app/frontend/src/lib/code-folder-latch.ts` (lines 6, 23, 32),
      `app/frontend/src/lib/right-panel.ts` (line 13), `app/frontend/src/components/code-surface.tsx`
      (lines 14, 35), and `app/frontend/src/types.ts` (line 185) <!-- R4 -->

### Phase 4: Rework — Missed Coverage (added post-review-cycle-1)

- [x] T009 Fix `app/frontend/tests/e2e/code-folder-latch.spec.ts`: change both
      `expectDerivedGitRoot(page, id, "")` polls (lines 213, 269) to
      `expectDerivedGitRoot(page, id, "/tmp")`; reword the "goes empty" doc comments (file header
      lines 12-19, `splitPaneOutsideRepo` lines 86-90, the two tests' JSDoc at lines 163-188 and
      238-256) to "changes to the raw-cwd fallback (`/tmp`)"; leave every latch-stability
      assertion (toggle/tile/header/iframe `src`/option/element-identity) unchanged <!-- R7 -->
- [x] T010 [P] Correct the two remaining stale comments: `app/frontend/tests/e2e/present-auto-expand.spec.ts:37,80`
      and `app/frontend/tests/e2e/_tmux.ts:137` (comment-only, no assertion changes) <!-- R8 -->

## Execution Order

- T001 blocks T003, T004, T005, T006, T009 — the tests must be updated against the actual new
  `deriveGitRoot` behavior, not written speculatively ahead of it.
- T002, T007, T008, T010 are documentation/comment-only and can run in parallel with anything
  (marked `[P]` where independent of each other).

## Acceptance

### Functional Completeness

- [x] A-001 R1: A window whose active pane's cwd is outside any git repository is offered the
      `code` lens/rail button/switcher segment, with the code-server folder equal to that raw cwd
- [x] A-002 R1: A window whose active pane's cwd IS inside a git repository is unaffected — folder
      resolves to the git toplevel, identical to pre-change behavior
- [x] A-003 R2: `config.FindGitRoot` and all of its other call sites (`fork.go`, `closed.go`,
      `operator.go`, `riff.go`) are unchanged — no regression in fork, closed-session, operator, or
      riff behavior
- [x] A-004 R3: `docs/specs/right-panel.md`'s Surface Registry `code` row and keying note
      accurately describe the cwd-fallback derivation

### Behavioral Correctness

- [x] A-005 R1: `deriveGitRoot` returns `""` only for the genuine edge case of an unresolvable cwd
      (no panes and no worktree path) — never for a resolvable non-git cwd
- [x] A-006 R6: No e2e spec asserts "no Code toggle for a `/tmp`-cwd window" as a general
      contract — only a genuinely unresolvable-cwd scenario (if any) may assert unavailability

### Scenario Coverage

- [x] A-007 R5: `TestDeriveGitRoot`'s `"non-repo cwd"` subtest passes asserting the fallback-to-cwd
      return value; the `"no cwd derivable"` subtest continues to pass asserting `""`
- [x] A-008 R6: `code-surface.spec.ts` and `right-panel.spec.ts`'s updated `/tmp`-cwd assertions
      pass under `just test-e2e`; `web-view-lens.spec.ts`'s audited tests pass with either
      corrected comments or flipped assertions as applicable

- [x] A-014 R7: `code-folder-latch.spec.ts`'s two tests pass under `just test-e2e "code-folder-latch"`,
      asserting the live derivation moves to `/tmp` (not `""`) while every latch-stability
      assertion is unchanged
- [x] A-015 R8: `present-auto-expand.spec.ts` and `_tmux.ts` no longer carry comments claiming
      `/tmp` makes the Code lens unavailable

### Edge Cases & Error Handling

- [x] A-009 R1: A window with zero panes and an empty `WorktreePath` still yields
      `deriveGitRoot() == ""` (`hasCode` remains `false`) — the sole remaining empty case

### Code Quality

- [x] A-010 Pattern consistency: The new fallback branch in `deriveGitRoot` mirrors
      `cmd/rk/code.go`'s `codeTargetFolder` fallback shape ("toplevel, else cwd") rather than
      introducing a new abstraction
- [x] A-011 No unnecessary duplication: No new field, type, or helper is introduced where widening
      the existing `deriveGitRoot` return suffices (existing utilities in `internal/config`,
      `internal/sessions` reused)
- [x] A-012 New/changed behavior MUST include tests covering it (code-quality.md Principles): the
      Go unit test and the audited/updated e2e specs cover the fallback
- [x] A-013 Comment Narration anti-pattern avoided: every comment touched in T002/T007/T008 states
      only non-obvious rationale (invariants, cross-file contracts) — none narrates the change,
      mirrors sibling code, or cites this change's ID/PR number

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change widens an existing derivation (`deriveGitRoot`'s cwd fallback) without making
  existing code redundant; the superseded negative-assertion test code was removed in the diff
  itself. (Cycle 2 review re-verified: no file, function, branch, or config is left unused.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `web-view-lens.spec.ts`'s five `/tmp`-cwd tests are audited rather than blanket-flipped | Their JSDoc intent comments describe the web-lens switching contract, not the code-lens gate; most don't assert Code-toggle presence/absence directly, so a blanket flip risks asserting behavior the tests were never designed to check | S:60 R:65 A:60 D:55 |

1 assumption (0 certain, 1 confident, 0 tentative).
