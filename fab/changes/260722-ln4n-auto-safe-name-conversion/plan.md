# Plan: Automatic Safe-Name Conversion at Naming Entry Points

**Change**: 260722-ln4n-auto-safe-name-conversion
**Intake**: `intake.md`

## Requirements

### Frontend: Shared Name-Transform Module

#### R1: One canonical transform per name kind in `src/lib/names.ts`
A new shared module `app/frontend/src/lib/names.ts` SHALL export one pure transform per name kind, promoting the logic out of `create-session-dialog.tsx`'s `toTmuxSafeName` (which is removed):

- `toSafeSessionName(raw)` — converts spaces, **hyphens**, colons, periods, and every char in the backend forbidden set (`; & | ` backtick ` $ ( ) { } [ ] < > ! # * ?` plus control chars `\n \r \t`) to `_`; collapses `_` runs; strips leading `_`; preserves case; caps at 128 chars (backend `MaxNameLength`). The hyphen→`_` rule is session-specific (session-group collision avoidance).
- `toSafeWindowName(raw)` — same rule but **keeps hyphens**.
- `toSafeServerName(raw)` — converts anything outside `[a-zA-Z0-9_-]` to `_`; collapses; strips leading `_`; caps at 64 chars (`MaxServerNameLength`).
- `toSafeWorktreeName(raw)` — the window rule plus `/`→`_` and leading hyphens stripped (no leading `-` per `ValidateWorktreeName`).
- `finalizeSafeName(name)` — commit-time finisher: strips leading/trailing `_` runs (the trailing `_` stays visible while typing and is trimmed only at commit).
- `deriveNameFromPath(p)` — moved here from `create-session-dialog.tsx`; keeps its segment-extraction behavior, now composing the session transform + finalize (so both ends are trimmed exactly as the old `toTmuxSafeName` did).

Chars outside the listed unsafe sets (e.g. `/`, `@`, `%`, `+` for session/window names) pass through unchanged — conversion, not stripping, only for the listed set.

- **GIVEN** the raw input `"My problem"` **WHEN** `toSafeSessionName` is applied **THEN** the result is `"My_problem"` (case preserved, space converted).
- **GIVEN** the raw input `"riff-foo bar"` **WHEN** `toSafeWindowName` is applied **THEN** the result is `"riff-foo_bar"` (hyphen kept, space converted).
- **GIVEN** the raw input `"a b!c"` **WHEN** `toSafeServerName` is applied **THEN** the result is `"a_b_c"`.
- **GIVEN** the raw input `"-agent/x y"` **WHEN** `toSafeWorktreeName` is applied **THEN** the result is `"agent_x_y"`.
- **GIVEN** the live value `"My_problem_"` **WHEN** `finalizeSafeName` runs at commit **THEN** the committed name is `"My_problem"`.

#### R2: Live conversion at session-name entry points
Every session-name input SHALL apply `toSafeSessionName` in its `onChange` (the user watches the conversion as they type): the create-session dialog's typed-name field (`create-session-dialog.tsx`), the session rename dialog input (`app.tsx`, state in `use-dialog-state.ts`), and the sidebar inline session rename (`sidebar/session-row.tsx` input).

- **GIVEN** the create-session dialog **WHEN** the user types `"My problem"` in the name field **THEN** the input displays `"My_problem"` and the created session is named `"My_problem"`.
- **GIVEN** a session rename input **WHEN** the user types a hyphen **THEN** an underscore appears (session-specific hyphen steering).
- **GIVEN** an empty name field **WHEN** the user presses space **THEN** the field stays empty (leading unsafe chars are dropped as typed).

#### R3: Live conversion at window-name entry points
Every window-name input SHALL apply `toSafeWindowName` in its `onChange`: the top-bar `WindowHeading` inline rename (`top-bar.tsx`, which also serves the palette's "Window: Rename" CustomEvent path), the sidebar inline window rename (`sidebar/window-row.tsx` input), and the "New iframe window" name field (`app.tsx`). The create dialog's window mode has no name input (windows are created unnamed and auto-named by tmux) — nothing to wire there.

- **GIVEN** the window heading inline edit **WHEN** the user types `"my problem"` **THEN** the input displays `"my_problem"` and Enter commits `"my_problem"`.
- **GIVEN** a window rename input **WHEN** the user types `"riff-foo"` **THEN** hyphens are preserved (window-kind divergence).

#### R4: Live conversion at server-name entry points
Both server-name inputs SHALL apply `toSafeServerName` in their `onChange`: the Host Overview create-server dialog (`host-overview-page.tsx`) and the AppShell create-server dialog (`app.tsx`). The existing regex-based disabled guards remain as defense in depth (they always pass post-transform).

- **GIVEN** a server-name input **WHEN** the user types `"my server!"` **THEN** the input displays `"my_server_"` and the created server is `"my_server"` (trailing `_` trimmed at commit).

#### R5: Live conversion at the worktree-name entry point
The riff/spawn dialog's worktree-name field (`spawn-agent-dialog.tsx`) SHALL apply `toSafeWorktreeName` in its `onChange`.

- **GIVEN** the worktree field **WHEN** the user types `"-my agent"` **THEN** the input displays `"my_agent"` (leading hyphen dropped, space converted).

#### R6: Commit-time finalization and empty-name fall-through
Every commit/submit site whose input carries a live transform SHALL apply `finalizeSafeName` before use (create-session `handleCreate` incl. the collision check, `use-dialog-state.handleRenameSession`, sidebar `handleSessionRenameCommit`/`handleRenameCommit`, top-bar `commit`, `handleCreateServer` in both server dialogs, `handleCreateIframeWindow`, spawn-dialog submit). An input that is empty after conversion falls through to the existing empty-name guards — no new error surface.

- **GIVEN** a rename input holding `"My_"` (trailing separator kept live) **WHEN** the user commits **THEN** the API receives `"My"`.
- **GIVEN** an input where only unsafe chars were typed (live value empty) **WHEN** the user commits **THEN** the existing empty-commit guard cancels; no API call is made.

### Backend: New-Name Charset Tightening

#### R7: `ValidateNewName` rejects spaces for to-be-created / renamed-to names
`app/backend/internal/validate/validate.go` SHALL gain `ValidateNewName(name, label string) string` layering "no spaces" over the permissive `ValidateName`, applied at exactly the four call sites where the value names a to-be-created or renamed-to entity: session create (`api/sessions.go` `handleSessionCreate` body.Name), session rename new-name (`handleSessionRename` body.Name), window create name (`api/windows.go` `handleWindowCreate` non-empty body.Name), window rename name (`handleWindowRename` body.Name). The backend stays reject-only (no server-side conversion) and keeps allowing hyphens in session names (UI-only steering).

- **GIVEN** `POST /api/sessions` with `{"name": "My problem"}` **WHEN** the handler validates **THEN** it returns 400 with a "cannot contain spaces" error and creates nothing.
- **GIVEN** `POST /api/windows/@N/rename` with `{"name": "a b"}` **WHEN** the handler validates **THEN** it returns 400.
- **GIVEN** `POST /api/sessions` with `{"name": "my-session"}` **THEN** it succeeds (hyphens legal on the backend).

#### R8: Existing-name lookups stay permissive
All call sites where the value names an **existing** entity SHALL keep the permissive `ValidateName`: session URL params for rename/color/kill (`sessions.go`), session-order names, `windows.go` session param and `TargetSession` (move), `upload.go` session param, and both `riff.go` session values (`handleRiffSpawn` body.Session and `handleRiffPresets` — classified as existing: riff derives the repo root from the named session's cwd; nothing is created with that name). Pre-existing spacey names created outside run-kit remain operable but cannot be the target of a run-kit create/rename. `ValidateServerName` and `ValidateWorktreeName` are unchanged.

- **GIVEN** a session literally named `"My problem"` (created via raw tmux) **WHEN** the user renames it via `POST /api/sessions/My%20problem/rename` with `{"name": "My_problem"}` **THEN** the rename succeeds (spacey old name accepted, tightened new name passes).

### Testing

#### R9: Coverage across all three layers with companion docs
Vitest table tests SHALL cover each transform in `src/lib/names.test.ts` (charset conversion per kind, hyphen divergence, case preservation, collapse/leading-strip/finalize, length caps, empty results); Go table tests SHALL cover `ValidateNewName` plus handler-level space-rejection and permissive-old-name cases; Playwright SHALL gain a typed-space → underscore live-conversion assertion in `window-heading.spec.ts`, and `sync-latency.spec.ts`'s UI session-rename expectations SHALL be updated for the hyphen→`_` session conversion. Per the constitution's Test Companion Docs rule, every touched `.spec.ts` ships its sibling `.spec.md` update in the same commit.

- **GIVEN** the e2e window rename input **WHEN** the test types `"my problem"` **THEN** the input value is asserted `"my_problem"` and the committed sidebar name is `"my_problem"`.
- **GIVEN** `sync-latency.spec.ts` test 2 fills `${SESSION_A}-renamed` into the session rename input **THEN** the asserted (and cleaned-up) name is the underscored transform of that string.

### Non-Goals

- No backend-side name conversion (constitution §I; WYSIWYG/optimistic-update parity).
- No change to `ValidateServerName` / `ValidateWorktreeName` backend rules.
- No caret-position management beyond React-controlled-input defaults — mid-string edits that change length may move the caret to the end (accepted intake edge).
- No migration/renaming of pre-existing spacey sessions.

### Design Decisions

#### Live transform + commit finalizer split
**Decision**: The live `onChange` transform strips leading separators but keeps a trailing `_` visible; a separate `finalizeSafeName` trims it at commit.
**Why**: Trimming the trailing `_` live would delete the separator the user just typed ("My " + "p" would become "Myp") and break mid-word entry; commit-trim is the one minimal WYSIWYG deviation.
**Rejected**: Strict-WYSIWYG (commit exactly what is shown, trailing `_` included) — leaves awkward trailing separators on committed names for no user benefit.
*Introduced by*: 260722-ln4n-auto-safe-name-conversion

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/frontend/src/lib/names.ts` (toSafeSessionName, toSafeWindowName, toSafeServerName, toSafeWorktreeName, finalizeSafeName, deriveNameFromPath) plus table-style Vitest coverage in `app/frontend/src/lib/names.test.ts` <!-- R1 -->

### Phase 2: Core Implementation

- [x] T002 [P] Add `ValidateNewName` to `app/backend/internal/validate/validate.go` with table tests in `validate_test.go` (space rejection, ValidateName inheritance, boundary cases) <!-- R7 -->
- [x] T003 Switch the four new-name call sites to `ValidateNewName` (`api/sessions.go` create + rename body.Name, `api/windows.go` create non-empty name + rename body.Name); add handler tests for space rejection and a permissive spacey-old-name rename <!-- R7, R8 -->
- [x] T004 Rewire `app/frontend/src/components/create-session-dialog.tsx`: remove `toTmuxSafeName`/`deriveNameFromPath` definitions, import from `@/lib/names`, apply `toSafeSessionName` in the name input `onChange`, finalize in `handleCreate` and the collision check <!-- R1, R2, R6 -->
- [x] T005 Rewire `app/frontend/src/app.tsx` (deriveNameFromPath import; session-rename dialog input → session transform; iframe window-name input → window transform + finalize in `handleCreateIframeWindow`; create-server dialog input → server transform + finalize in `handleCreateServer`) and `app/frontend/src/hooks/use-dialog-state.ts` (`handleRenameSession` finalize) <!-- R2, R3, R4, R6 -->
- [x] T006 Rewire sidebar inline renames: `sidebar/session-row.tsx` input → session transform, `sidebar/window-row.tsx` input → window transform, `sidebar/index.tsx` commit handlers finalize; update `sidebar.test.tsx` rename expectations (hyphenated typed value commits underscored) <!-- R2, R3, R6 -->
- [x] T007 [P] Rewire `app/frontend/src/components/top-bar.tsx` WindowHeading edit input → window transform + finalize in `commit`; add a conversion test in `top-bar.test.tsx` <!-- R3, R6 -->
- [x] T008 [P] Rewire `app/frontend/src/components/host-overview-page.tsx` server input → server transform + finalize in `handleCreate` <!-- R4, R6 -->
- [x] T009 [P] Rewire `app/frontend/src/components/spawn-agent-dialog.tsx` worktree field → worktree transform + finalize at submit <!-- R5, R6 -->

### Phase 3: Integration & Edge Cases

- [x] T010 Extend `app/frontend/tests/e2e/window-heading.spec.ts` with a typed-space → underscore live-conversion test; update sibling `window-heading.spec.md` <!-- R9, R3 -->
- [x] T011 Update `app/frontend/tests/e2e/sync-latency.spec.ts` test 2 (UI session rename) for the hyphen→underscore session conversion (expected name + afterAll cleanup); update sibling `sync-latency.spec.md` <!-- R9, R2 -->
- [x] T012 Run `just test-backend`, `just test-frontend`, then targeted e2e (`just pw test window-heading sync-latency sidebar-keyboard-nav`), then full `just test-e2e`; fix any fallout <!-- R9 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `src/lib/names.ts` exists with the four per-kind transforms plus `finalizeSafeName`/`deriveNameFromPath`; `toTmuxSafeName` no longer exists in `create-session-dialog.tsx`
- [x] A-002 R2: All three session-name inputs convert live in `onChange` via `toSafeSessionName`
- [x] A-003 R3: All three window-name inputs (WindowHeading, sidebar row, iframe dialog) convert live via `toSafeWindowName`
- [x] A-004 R4: Both server-name inputs the plan enumerated (host-overview + AppShell/app.tsx) convert live via `toSafeServerName`. NOTE (should-fix): a THIRD server-name input exists — the board-route create-server dialog (`src/components/board/board-page.tsx:1179`) — which the plan's R4 inventory missed and which still does a raw `setCreateServerName(e.target.value)` with no live transform (its `handleCreateServerSubmit` also skips `finalizeSafeName`). Decision 5 mandates "every naming entry point".
- [x] A-005 R5: The spawn-dialog worktree field converts live via `toSafeWorktreeName`
- [x] A-006 R7: `ValidateNewName` exists and is applied at exactly the four new-name call sites (sessions.go:32,78; windows.go:41,177)

### Behavioral Correctness

- [x] A-007 R1: Session transform converts hyphens; window/worktree transforms keep them; case is preserved; length caps at 128/64 (verified in `names.test.ts` + regex trace)
- [x] A-008 R6: Commit sites finalize (trailing `_` trimmed); the committed name equals the API-submitted name (WYSIWYG incl. optimistic updates)
- [x] A-009 R8: Existing-name lookups (session URL params sessions.go:61,93,171,193; TargetSession windows.go:332; session param windows.go:19; upload.go:23; both riff session values riff.go:123,224) still use permissive `ValidateName`

### Scenario Coverage

- [x] A-010 R1: `names.test.ts` covers "My problem"→"My_problem", hyphen divergence, collapse/trim, caps, forbidden-set conversion (195 tests pass)
- [x] A-011 R7: Go tests cover space rejection on create/rename for sessions and windows, plus a spacey-old-name rename that succeeds (validate + api packages green)
- [x] A-012 R9: e2e asserts live typed-space→underscore conversion in the window heading; touched `.spec.ts` files (`window-heading`, `sync-latency`) have updated `.spec.md` siblings in the same working tree

### Edge Cases & Error Handling

- [x] A-013 R2: Leading unsafe chars are dropped as typed (space in empty field produces nothing — `squash` strips leading `_`); empty-after-conversion input falls through to existing empty-name guards with no new error surface
- [x] A-014 R7: Window create with an omitted/empty name still succeeds — `windows.go:39` guards `if body.Name != ""` before `ValidateNewName` (tmux auto-naming path untouched)

### Code Quality

- [x] A-015 Pattern consistency: transforms live in `src/lib/` with colocated `.test.ts`, matching the established shared-pure-logic pattern; Go validator mirrors existing validate.go doc-comment style
- [x] A-016 No unnecessary duplication: all wired surfaces import from `@/lib/names`; no per-component transform copies remain (`toTmuxSafeName` absent from `src/`/`tests/`)

### Security

- [x] A-017 R7: Backend charset only tightens (`ValidateNewName` layers over `ValidateName`, no relaxation of `forbiddenChars`); validation stays reject-only before any subprocess (constitution §I); no `exec` changes

## Notes

- **Apply verification results** (2026-07-22): `just test-backend` all packages
  ok; `just test-frontend` 95 files / 1672 tests passed; full `just test-e2e`
  162 passed, 2 flaky-passed, 2 skipped, 2 failed — the 2 failures
  (`sync-latency` "5. Kill window via Ctrl+click" and `sidebar-window-sync`
  "kill-then-create at same index") were **verified pre-existing** by stashing
  this change and re-running on the base tree (commit 95e4000): identical
  failures, kill-flow only, no naming surface involved. `just build` fails on a
  missing `VERSION` file in this worktree — also identical on the base tree
  (environmental, not fallout); the frontend production build itself succeeds
  and `tsc --noEmit` is clean.
- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/backend/internal/validate/validate.go:220` — `ValidateWorktreeName`'s explicit `strings.Contains(name, " ")` space check is now redundant with the new-name posture (`ValidateNewName` centralizes the no-spaces rule for created entities); the intake deliberately kept it explicit, so this is a note only, not a removal recommendation.
- `app/frontend/src/components/create-session-dialog.tsx` — the removed `toTmuxSafeName`/`deriveNameFromPath` local definitions are already deleted and re-homed in `@/lib/names`; no residual dead copy remains (verified — no `toTmuxSafeName` reference anywhere in `src/`/`tests/`).
- None beyond the above — this change is additive (a new shared module + a new backend validator) and rewires existing call sites rather than making broad swaths of code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The create dialog's window mode has no name input (windows create unnamed, tmux auto-names) — the intake's "create-window mode" inventory row needs no wiring | Verified in `create-session-dialog.tsx` (name field hidden for `mode === "window"`, `createWindow` called with `undefined` name) | S:85 R:90 A:95 D:90 |
| 2 | Confident | Two entry points beyond the intake's table also get transforms: the AppShell create-server dialog and the "New iframe window" name field (both `app.tsx`) | Intake decision 5 mandates "every naming entry point"; both are real typed-name inputs found during grounding | S:60 R:85 A:90 D:80 |
| 3 | Certain | `riff.go` `body.Session` (spawn) and the presets `session` query are EXISTING-session references → stay on permissive `ValidateName` | `deriveRepoRoot` reads the named session's cwd; nothing is created under that name — deterministic from handler semantics (intake row 12) | S:80 R:80 A:90 D:90 |
| 4 | Confident | `finalizeSafeName` strips leading+trailing `_` runs; applied at commit after `trim()`; live transforms strip leading only | Matches the old `toTmuxSafeName` end-trim shape and intake row 13's commit-trim contract | S:55 R:85 A:85 D:80 |
| 5 | Confident | `sync-latency.spec.ts` test 2 and `sidebar.test.tsx` rename expectations updated to the underscored names the session transform now produces | Tests conform to spec (constitution Test Integrity); hyphen→`_` on session renames is the specified behavior, not a regression | S:55 R:80 A:85 D:80 |
| 6 | Confident | `deriveNameFromPath` now also converts spaces in directory basenames (previously passed through) | The tightened backend rejects spacey creates; a suggestion the backend would reject is a bug, and the intake routes the helper through the session transform | S:50 R:80 A:85 D:75 |
| 7 | Tentative | No caret-position management: transforms re-run on the whole value; caret may jump to end on mid-string length-changing edits | Intake accepts this edge ("the transform never fights the user mid-word" covers the common append case); full caret preservation adds complexity for a rare interaction | S:40 R:75 A:60 D:55 |

7 assumptions (2 certain, 4 confident, 1 tentative).
