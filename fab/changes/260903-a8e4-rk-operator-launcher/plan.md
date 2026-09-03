# Plan: rk operator — own the operator-launcher mechanics in run-kit

**Change**: 260903-a8e4-rk-operator-launcher
**Intake**: `intake.md`

> **Base branch**: `260903-7ajq-typed-kickoff-fix` (PR #806) — depends on `inject.DeliverWhenReady`, which exists only there. Ship's PR base is that branch, NOT main; merge order #806 first. Do not rebase onto main.

## Requirements

### CLI: the `rk operator` command

#### R1: Command surface
run-kit SHALL provide a top-level `operator` command (`rk operator [--workers <provider>]`) in `app/backend/cmd/rk/operator.go`, registered in `root.go`, structured like `tutorial.go`: package-level `operator*Fn` seams, a testable `runOperator(cmd)` core, and the `riff.ExitCodeError` RunE wrapper (bare stderr message + carried exit code).

- **GIVEN** run-kit installed
- **WHEN** `rk operator --help` runs
- **THEN** the command exists with `--workers` documented, help covering the preconditions (tmux + fab-kit), server-wide singleton semantics, and the typed kickoff

#### R2: Hard preconditions — exit 1, ordered before any tmux subprocess
`rk operator` MUST hard-refuse (exit 1, `riff.ExitPrecondition`) when (a) not inside tmux (`tmux.OriginalTMUX` empty — the riff/tutorial pattern) or (b) `fab` is not on PATH (`exec.LookPath("fab")` fails) — the message names **fab-kit** as the required companion tool. There is NO degrade to a default launcher for missing fab (user decision). No tmux subprocess runs before both pass.

- **GIVEN** `$TMUX` unset OR fab absent from PATH
- **WHEN** `rk operator` runs
- **THEN** it exits 1 with the matching guidance and zero tmux subprocesses ran

#### R3: Server-wide singleton probe
Enumerate ALL sessions' windows on the current server (`tmux list-windows -a -F '#{window_id}\t#{@rk_win_role}\t#{window_name}'`, restored-`$TMUX` child env). Probe priority: (1) a window whose `@rk_win_role` equals `operator` (`tmux.RoleOption` convention); (2) fallback: exact window name `operator`, matched as the **last** tab-separated field (the `findTutorialWindowID` cut rule extended for the extra column — tab-containing names never match; prefix/substring never match). On hit: `select-window -t <@N>` + best-effort `switch-client` (failure ignored — the window may live in another session), report exactly `Switched to existing operator tab.`, exit 0. The matcher SHALL be a pure, unit-tested function.

- **GIVEN** a window role-marked `operator` in another session, plus a window merely NAMED `operator`
- **WHEN** `rk operator` runs
- **THEN** the role-marked window wins, is selected by `@N` id, switch-client is attempted, and no new window is created

#### R4: Create path — atomic create-and-mark
With no hit: `tmux new-window -P -F '#{pane_id}'` capturing the pane id, window named `operator`, cwd = `config.FindGitRoot(os.Getwd())` falling back to `os.Getwd()` when empty, on the current server. Immediately stamp the role via rk role's FULL write-path sequence — `tmux.ClearWindowRoleExcept` (server-scoped radio), the `tmux.RoleOption` write, `tmux.MoveWindowIntoOperatorSession` promotion (the role.go:134-156 sequence; helpers are already exported) — reproducing exactly the end state today's `rk role operator` self-mark yields. Report the launch (assumption 14's tutorial-mirroring form, e.g. `Opened operator tab (window "operator").`).

- **GIVEN** no operator window on the server
- **WHEN** `rk operator` runs
- **THEN** an `operator` window exists at the repo root (or cwd), carries `@rk_win_role=operator`, has been promoted per the role write path, and the launch is reported

#### R5: Launcher resolution
`riff.ResolveLauncher(ctx, root, "operator")` → `fab agent operator --print`. fab is guaranteed present by R2(b); a failing resolution (non-zero/timeout/malformed) silently yields `riff.DefaultLauncher` — the accepted residual matching fab operator's own degrade-to-builtin posture.

- **GIVEN** the create path
- **WHEN** the launcher resolves
- **THEN** `ResolveLauncher` is called with tier exactly `"operator"` and the repo root

#### R6: Composition — bare launcher + validated workers env
`riff.SkillPaneCommand(launcher, "")` composes the bare launcher (kickoff is typed, never positional). When `--workers <v>` is set: validate `v` against `^[A-Za-z0-9_-]+$` — invalid is a usage error (exit 2) BEFORE any tmux subprocess; valid prefixes the **agent command only** inside the shell string (`FAB_AGENT_WORKERS=<v> <launcher>` at layer 1, before the interactive wrap — fab-kit's `withWorkersEnv` semantics). Unset flag = byte-identical bare composition (constitution §I: the value enters the unescaped shell string, the charset gate is the security boundary).

- **GIVEN** `--workers 'kimi; rm -rf /'`
- **WHEN** `rk operator` runs
- **THEN** it exits 2 with a usage error and runs nothing
- **GIVEN** `--workers kimi`
- **WHEN** the window composes
- **THEN** layer 1 is `FAB_AGENT_WORKERS=kimi <launcher>` inside the standard wrap; without the flag the composition is byte-identical to `SkillPaneCommand(launcher, "")`

#### R7: Typed kickoff — provider-agnostic
Deliver `/fab-operator` via `inject.DeliverWhenReady`: per-invocation engine (`rk-send-<pid>` buffer via the mux_send pattern), the shared CLI inject adapter, state reader `tmux.PaneAgentState` (the bounded reader mux_await uses), deadline/pacing mirroring `tutorialDeliverDeadline` (25s var, test-shrinkable). On ANY delivery failure: stderr paste-it-yourself note carrying `/fab-operator`, exit 0 — the window and agent exist either way.

- **GIVEN** the created window's agent boots
- **WHEN** delivery runs
- **THEN** `/fab-operator` is typed and verified through the inject engine; a delivery miss leaves the window alive with the stderr note and exit 0

#### R8: Tests
`operator_test.go` — seam-stubbed, no live tmux, green under `env -u TMUX -u TMUX_PANE go test ./cmd/rk/`. Matrix: both preconditions (zero tmux calls before passing); probe priority (role beats name; name fallback; no prefix/substring; tab-containing names); workers validation + composition (valid/invalid/unset); tier plumbing = `"operator"`; delivery wiring + degrade note; create path stamps the role sequence.

#### R9: Docs + conformance
README `## Command reference` row for `run-kit operator`; Long help per R1; the new surface checked against `shll standards` (help-dump, Principle 9).

### Non-Goals

- fab-kit changes (delegation follow-up filed as fab-kit backlog `[rkop]`); the `fab operator` subcommand family; the daemon operator-actuation seam; the `_rk-operator` home-session convention (the create path uses the existing promotion helper, changes nothing about it).

### Design Decisions

#### Operator launcher mechanics owned by rk, kickoff typed
**Decision**: `rk operator` owns spawn + singleton + role-stamp + typed kickoff; fab keeps profile resolution (`fab agent operator --print`) and the choreography subcommands.
**Why**: window mechanics and the `@rk_win_role` identity convention are rk's layer (cli-layering); typed delivery via `inject.DeliverWhenReady` removes the claude-only positional kickoff; atomic create-and-mark closes the create-then-mark gap.
**Rejected**: migrating `fab operator` in place (leaves the substrate duplication and the cross-repo identity gap); moving the subcommand family to rk (pipeline choreography, fab's layer).
*Introduced by*: 260903-a8e4-rk-operator-launcher

#### fab-on-PATH is a hard precondition
**Decision**: `rk operator` exits 1 when fab is absent — no default-launcher degrade.
**Why**: user decision; an operator without fab-kit is meaningless (the `/fab-operator` skill would not exist), and a degraded bare agent would look like an operator without being one.
**Rejected**: tutorial-style fail-open (honest failure beats a fake operator).
*Introduced by*: 260903-a8e4-rk-operator-launcher

## Tasks

### Phase 1: Scaffold

- [x] T001 `app/backend/cmd/rk/operator.go`: cobra `operatorCmd` (`--workers` flag), the `runOperatorWithExitCode` wrapper (riff.ExitCodeError discipline), both hard preconditions (tmux via `tmux.OriginalTMUX`, fab via `exec.LookPath` — LookPath behind a seam for tests), `operator*Fn` seams (tmux run/output, resolve-launcher, deliver, lookpath); register in `root.go` <!-- R1, R2 -->

### Phase 2: Core

- [x] T002 Singleton probe in `operator.go`: `list-windows -a -F '#{window_id}\t#{@rk_win_role}\t#{window_name}'` with restored-`$TMUX` env; pure `findOperatorWindowID(listOutput)` matcher (role-option priority, exact-name last-field fallback); `select-window -t <@N>` + best-effort `switch-client`; the exact switch report <!-- R3 -->
- [x] T003 Create path: `new-window -P -F '#{pane_id}' -c <gitroot-else-cwd> -n operator <shellCmd>`; atomic role stamp via the role.go sequence (`tmux.ClearWindowRoleExcept` → `tmux.RoleOption` write → `tmux.MoveWindowIntoOperatorSession`), launch report <!-- R4 -->
- [x] T004 Launcher + composition: `riff.ResolveLauncher(ctx, root, "operator")`; `--workers` charset validation (`^[A-Za-z0-9_-]+$`, invalid → usage exit 2 pre-subprocess); `FAB_AGENT_WORKERS=<v>` prefix on the agent command only; `riff.SkillPaneCommand(launcher, "")` bare otherwise — a pure composition helper with unit-pinned output <!-- R5, R6 -->
- [x] T005 Typed kickoff: `inject.DeliverWhenReady` wiring (per-invocation `rk-send-<pid>` engine, shared CLI adapter, `tmux.PaneAgentState` bounded reader, tutorial-mirrored pacing vars); stderr degrade note carrying `/fab-operator`, exit 0 on delivery failure <!-- R7 -->

### Phase 3: Integration & Edge Cases

- [x] T006 `app/backend/cmd/rk/operator_test.go`: the full R8 matrix (preconditions incl. zero-subprocess assertion, probe priority table, workers valid/invalid/unset, tier plumbing, delivery + degrade, role-stamp sequence order) <!-- R8 -->
- [x] T007 Gates: `go build ./...`; `go test ./cmd/rk/ ./internal/riff/ ./internal/inject/`; `env -u TMUX -u TMUX_PANE go test ./cmd/rk/`; gofmt on new files (never `internal/riff/shell.go`) <!-- R8 -->

### Phase 4: Polish

- [x] T008 [P] README command-reference row; Long help final pass; `shll standards` check (help-dump, Principle 9) for the new surface <!-- R9 -->

## Execution Order

- T001 blocks everything; T002–T005 in order (T004's composition feeds T003's new-window argv); T006–T007 after core; T008 independent.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `rk operator` registered top-level with `--workers`, tutorial-style seams and exit-code wrapper
- [x] A-002 R2: outside tmux → exit 1 (tmux guidance); fab absent → exit 1 naming fab-kit; zero tmux subprocesses before both pass; no default-launcher degrade for missing fab
- [x] A-003 R3: role-option hit selected over a name hit; name fallback exact-match on the last tab field; select by `@N` + best-effort switch-client; exact switch report
- [x] A-004 R4: create path opens `operator` at gitroot-else-cwd, captures the pane id, and applies the full role write-path sequence (radio clear, option write, promotion)
- [x] A-005 R5: `ResolveLauncher` called with tier `"operator"`; DefaultLauncher residual on resolution failure
- [x] A-006 R6: workers validation gate (exit 2 pre-subprocess) and agent-command-scoped env prefix; unset = byte-identical bare composition (pinned)
- [x] A-007 R7: kickoff `/fab-operator` delivered via `inject.DeliverWhenReady`; delivery failure → stderr note + exit 0
- [x] A-008 R9: README row + Long help + standards check done

### Behavioral Correctness

- [x] A-009 R3: a `tutorial`-style prefix/substring/tab-containing name never matches; a role-marked window in ANOTHER session still wins
- [x] A-010 R6: `--workers 'x; y'` (or any non-charset value) never reaches a shell string

### Scenario Coverage

- [x] A-011 R8: the full test matrix exists and passes under `env -u TMUX -u TMUX_PANE go test ./cmd/rk/`

### Edge Cases & Error Handling

- [x] A-012 R7: delivery failure leaves the window + agent alive, note on stderr, exit 0
- [x] A-013 R4: `FindGitRoot` returning `""` falls back to `os.Getwd()`

### Code Quality

- [x] A-014 Pattern consistency: mirrors tutorial.go/riff.go shapes (seams, ExitCodeError, comment discipline — no narration, no change-ID refs)
- [x] A-015 No duplication: delivery via inject composite; role stamp via exported role helpers; no local settle/echo loops
- [x] A-016 Subprocess discipline: argv-slice `exec.CommandContext` with bounded contexts everywhere; the launcher remains the sole unescaped shell element

### Security

- [x] A-017 R6: only the resolved launcher and the charset-validated workers prefix enter the shell string; the kickoff rides `send-keys` argv (never a shell); nothing user-controlled is unescaped

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- **Stacking**: base = PR #806's branch; ship targets it, never main.

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant (the inline role write-path in `role.go` was extracted into `stampOperatorRole` and is shared, not left duplicated).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `exec.LookPath("fab")` goes behind a package-level seam so tests can simulate fab-absent without PATH surgery | The tutorial seam pattern; PATH manipulation in tests is flaky | S:60 R:90 A:90 D:85 |
| 2 | Confident | The workers charset gate runs at flag-validation time (before preconditions' tmux checks conceptually — before ANY subprocess), classified usage exit 2 | Intake fixes exit 2 and pre-subprocess; ordering among pure checks is free | S:60 R:90 A:85 D:80 |
| 3 | Confident | The create-path stamp shares ONE implementation with `rk role operator`: runRole's set branch was extracted into `stampOperatorRole(ctx, prefix, windowID)` in role.go (same messages, same order — clear → write → demote displaced → move in), called by both commands; operator tests stub role.go's existing seams | Plan A-015 forbids duplicating the role write path; the sequence lived inline in runRole, so extraction is the no-duplication route | S:75 R:80 A:85 D:80 |
| 4 | Confident | An empty `--workers ""` value is the unset case (byte-identical bare composition), not a usage error | The charset gate exists to keep shell-significant characters out of the unescaped string; an empty value introduces none, and gating on non-empty keeps the check a pure function of the package var (no cobra Changed-state dependency in the testable core) | S:60 R:85 A:80 D:75 |
| 5 | Confident | An empty pane id from `new-window -P` is a subprocess-class error (exit 3), not a delivery degrade | tmux prints the pane id on success; empty output is a malfunction — riff's parsePaneID discipline (SubprocessErr) — and the stamp needs the pane to resolve its window id, so proceeding would reopen the create-then-mark gap | S:60 R:85 A:80 D:75 |
| 6 | Confident | The usage exit 2 rides the CLI-local `usageError`/`exitCode` path (returned to execute(), cobra prints `Error: …`) rather than riff.ExitCodeError + os.Exit | Matches every other cmd/rk flag-validation failure (mux send/await); the ExitCodeError wrapper is reserved for the precondition/subprocess classes the tutorial pattern fixes | S:55 R:90 A:85 D:75 |

6 assumptions (0 certain, 6 confident, 0 tentative).
