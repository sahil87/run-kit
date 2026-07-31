# Plan: Consolidate tmux subprocess runner core into internal/tmux

**Change**: 260731-zeiy-consolidate-tmux-runner-core
**Intake**: `intake.md`

## Requirements

### internal/tmux: Exported runner core

#### R1: Exported `Run`/`RunOutput`/`RunOpts` runner core
`internal/tmux` SHALL export the tmux subprocess runner core:

```go
type RunOpts struct {
    Env []string // nil inherits the process environment
    Dir string   // "" inherits the process CWD
}
func Run(ctx context.Context, args []string, opts RunOpts) error
func RunOutput(ctx context.Context, args []string, opts RunOpts) ([]byte, error)
```

The fixed contract (the existing convention, now in one place):
- MUST use `exec.CommandContext(ctx, "tmux", args...)` — explicit argv slice, never shell strings (Constitution §I).
- MUST NOT add any timeout internally — the ctx is caller-owned; every call site keeps its own timeout budget.
- `Run` uses `cmd.Run()`; `RunOutput` uses `cmd.Output()` (stdout returned, excluded from error text). Both MUST capture stderr separately and, on failure, wrap it as `fmt.Errorf("%w: %s", err, strings.TrimSpace(stderr))`, falling back to the bare error when trimmed stderr is empty.
- `opts.Env == nil` MUST inherit the process env; `opts.Dir == ""` MUST inherit the process CWD (matching `runTmuxWithEnv`'s current semantics exactly).

- **GIVEN** a tmux invocation that exits non-zero writing a diagnostic to stderr
- **WHEN** `Run` or `RunOutput` is called
- **THEN** the returned error wraps the exec error (`errors.As` → `*exec.ExitError` still works via `%w`) and its message ends with the trimmed stderr text
- **AND** when stderr is empty/whitespace-only, the bare exec error is returned unchanged

- **GIVEN** `RunOpts{Env: customEnv, Dir: someDir}`
- **WHEN** the runner executes
- **THEN** the subprocess runs with that env and working directory; with the zero `RunOpts{}` it inherits the process env and CWD

#### R2: In-package callers migrate onto the core
`runTmuxWithEnv` (tmux.go:1126) SHALL be subsumed by `Run` (its body becomes `Run`; the private helper is deleted). `CreateSession`'s call becomes `Run(ctx, full, RunOpts{Env: CleanEnvForServer(), Dir: ServerBirthDir()})`. The in-package stdout-capture helpers `tmuxExecServer`/`tmuxExecRawServer` SHALL rebase onto `RunOutput`, keeping their line-splitting / raw-string wrapper roles and their `serverArgs(server)` prefixing.

- **GIVEN** the migrated package
- **WHEN** `grep` runs for `exec.CommandContext(ctx, "tmux"` in `tmuxExecServer`/`tmuxExecRawServer`/`runTmuxWithEnv`
- **THEN** no private copy of the runner idiom remains at those sites; all route through `Run`/`RunOutput`

### internal/daemon: Delegate the daemon runners

#### R3: daemon runners delegate, keeping `-L serverSocket` targeting
`runTmuxInDir` SHALL keep prepending `-L serverSocket` (deliberate const-socket targeting) and delegate to `tmux.Run(ctx, fullArgs, tmux.RunOpts{Dir: dir})`. `runTmuxOutput` SHALL apply the same prefix and delegate to `tmux.RunOutput(ctx, fullArgs, tmux.RunOpts{})`. The thin `runTmux`/`runTmuxInDir`/`runTmuxOutput` wrappers remain as package-local argv-prefix helpers — only the runner bodies are deleted, along with the "Mirrors runTmux's … convention" comment.

- **GIVEN** the daemon test suite (`TestRunTmuxInDir_SetsClientCwd` et al.)
- **WHEN** `go test ./internal/daemon/...` runs
- **THEN** all tests pass — dir override and stderr-in-error behavior are byte-compatible

### internal/riff: Delegate the four spawn-engine sites

#### R4: riff sites delegate, keeping `tmuxArgv` targeting + `childEnv` and call-site `SubprocessErr` wrapping
All four sites SHALL keep building argv via `tmuxArgv(spec, ...)` and keep `childEnv(spec)` (passed as `RunOpts{Env: childEnv(spec)}`):
- `resolveWindowIDFromPane` (:458) → `tmux.RunOutput(...)`, error still discarded at the call site (documented best-effort contract; no "quiet" variant in the core).
- `runTmuxNewWindowCapturePaneID` (:474) → `tmux.RunOutput(...)`; on error, wrap into `SubprocessErr` at the call site — the core's stderr-in-error text replaces the manual `exitErr.Stderr` extraction.
- `runTmuxArgv` (:498) → `tmux.Run(...)`, wrapping into `SubprocessErr`.
- `listWindowNames` (:520) → `tmux.RunOutput(...)`, wrapping into `SubprocessErr`.

Known accepted delta: `runTmuxArgv`/`listWindowNames` move from `CombinedOutput()` (stdout+stderr in error text) to stderr-only capture — tmux diagnostics go to stderr; no code or test parses these strings.

- **GIVEN** a riff tmux invocation that fails
- **WHEN** the migrated site handles the error
- **THEN** the returned `SubprocessErr` carries the core's stderr-in-error text and each site's per-path targeting (`-L spec.Server` / bare+restored `$TMUX`) is unchanged

### cmd/rk: Delegate the agent-hook sites

#### R5: agent_hook sites delegate, preserving the never-fail contract
`writeAgentStateImpl` (:409) and `writeChatImpl` (:432) SHALL keep building argv via `tmuxSocketArgs(tmux.OriginalTMUX)` (deliberate `-S` targeting) and become `_ = tmux.Run(cctx, args, tmux.RunOpts{})`, with the error still deliberately swallowed and the "Errors are intentionally ignored (never-fail contract)" comments retained.

- **GIVEN** an agent-hook option write that fails
- **WHEN** `writeAgentStateImpl`/`writeChatImpl` run
- **THEN** no error propagates (never-fail) and the invocation went through `tmux.Run` with the site's own `agentHookCmdTimeout` ctx

### Testing

#### R6: Unit tests for the core; full backend suite green
New unit tests in `internal/tmux` SHALL cover `Run`/`RunOutput`: the stderr-wrap convention, the empty-stderr bare-error fallback, and the Env/Dir overrides. Migrated call sites are covered by the existing suite. The verification gate is `go test ./...` in `app/backend` (run via `just test-backend`).

- **GIVEN** the completed change
- **WHEN** `just test-backend` runs
- **THEN** all packages pass

### Non-Goals

- NO unification of socket-targeting — the four flavors (`-L` const daemon socket / `-L spec.Server` / bare+restored `$TMUX` / `-S` from `tmux.OriginalTMUX`) are deliberate per-site semantics; each caller keeps its own argv-prefix builder.
- NO timeout centralization — timeouts stay at call sites (caller-owned ctx, differing budgets).
- NO behavior change beyond the diagnostic-text-only delta at riff's two `CombinedOutput` sites.
- Other direct `exec.CommandContext("tmux", ...)` sites with materially different contracts (e.g. `probeServerAlive` — boolean probe, no stderr capture) are out of scope.

### Design Decisions

#### Runner core lives in a new `internal/tmux/run.go`
**Decision**: Place `RunOpts`/`Run`/`RunOutput` (plus small shared private helpers) in a new file `internal/tmux/run.go` rather than appending to `tmux.go`.
**Why**: The package already splits by topic (`board.go`, `direnv.go`, `reaper.go`); `tmux.go` is >2000 lines and the intake explicitly allows "a small new file in the package".
**Rejected**: Appending to `tmux.go` — grows an already-oversized file for a self-contained seam.
*Introduced by*: 260731-zeiy-consolidate-tmux-runner-core

## Tasks

### Phase 2: Core Implementation

- [x] T001 Create `app/backend/internal/tmux/run.go` exporting `RunOpts`, `Run`, `RunOutput` with the fixed contract (caller-owned ctx, argv-slice CommandContext, stderr-in-error with empty-stderr fallback, nil-Env/empty-Dir inheritance) <!-- R1 -->
- [x] T002 Migrate in-package callers in `app/backend/internal/tmux/tmux.go`: delete `runTmuxWithEnv` (CreateSession → `Run(ctx, full, RunOpts{Env: CleanEnvForServer(), Dir: ServerBirthDir()})`); rebase `tmuxExecServer`/`tmuxExecRawServer` onto `RunOutput`, keeping their line-split/raw wrappers <!-- R2 -->

### Phase 3: Integration & Edge Cases

- [x] T003 [P] Migrate `app/backend/internal/daemon/daemon.go`: `runTmuxInDir` → `tmux.Run(ctx, fullArgs, tmux.RunOpts{Dir: dir})`, `runTmuxOutput` → `tmux.RunOutput(ctx, fullArgs, tmux.RunOpts{})`, both keeping the `-L serverSocket` prepend; drop the "Mirrors runTmux's …" comment and the now-unused `os/exec` import <!-- R3 -->
- [x] T004 [P] Migrate the four `app/backend/internal/riff/riff.go` sites (`resolveWindowIDFromPane`, `runTmuxNewWindowCapturePaneID`, `runTmuxArgv`, `listWindowNames`) onto `tmux.Run`/`tmux.RunOutput` with `RunOpts{Env: childEnv(spec)}`, keeping `tmuxArgv` targeting and call-site `SubprocessErr` wrapping; drop the manual `exitErr.Stderr` extraction <!-- R4 -->
- [x] T005 [P] Migrate `app/backend/cmd/rk/agent_hook.go` `writeAgentStateImpl`/`writeChatImpl` to `_ = tmux.Run(cctx, args, tmux.RunOpts{})`, retaining the never-fail comments and `tmuxSocketArgs` targeting <!-- R5 -->

### Phase 4: Polish

- [x] T006 Add `app/backend/internal/tmux/run_test.go` unit tests: stderr-wrap on failing tmux invocation, empty-stderr bare-error fallback, Env override observable via `show-environment -g` on an isolated test socket, Dir override observable via `#{session_path}` (package conventions: `testSocketName`, LookPath skip, kill-server cleanup) <!-- R6 -->
- [x] T007 Run `just test-backend` from the repo root; fix any failures until green <!-- R6 -->

## Execution Order

- T001 blocks T002–T006 (all delegate to the new core)
- T003, T004, T005 are independent of each other ([P])
- T007 runs last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `internal/tmux` exports `Run`, `RunOutput`, and `RunOpts{Env, Dir}` implementing the stderr-in-error convention with empty-stderr fallback, no internal timeout, and nil-Env/empty-Dir inheritance
- [x] A-002 R2: `runTmuxWithEnv` no longer exists; `CreateSession` calls `Run` with `CleanEnvForServer()`/`ServerBirthDir()`; `tmuxExecServer`/`tmuxExecRawServer` route through `RunOutput` keeping their wrapper semantics
- [x] A-003 R3: `internal/daemon`'s runners contain no `exec.CommandContext` copy — they prepend `-L serverSocket` and delegate to the core; the "Mirrors runTmux's" comment is gone
- [x] A-004 R4: all four riff sites delegate to the core with `RunOpts{Env: childEnv(spec)}`, keep `tmuxArgv` targeting, and keep `SubprocessErr` wrapping at call sites
- [x] A-005 R5: both agent_hook sites call `_ = tmux.Run(...)` with `tmuxSocketArgs(tmux.OriginalTMUX)` argv and retained never-fail comments

### Behavioral Correctness

- [x] A-006 R1: the core adds no timeout — every migrated call site still owns its ctx/timeout budget (daemon `cmdTimeout`, riff `TmuxTimeout`, `agentHookCmdTimeout`, tmux `withTimeout()`)
- [x] A-007 R4: the only observable behavior delta is riff's `runTmuxArgv`/`listWindowNames` error text carrying stderr-only instead of combined output (diagnostic-text-only; nothing parses it)

### Removal Verification

- [x] A-008 R2: no private copy of the `exec.CommandContext("tmux", …)+capture-stderr+wrap` runner idiom remains at the 9 consolidated sites across the 4 packages (out-of-scope sites like `probeServerAlive` excepted)

### Scenario Coverage

- [x] A-009 R6: unit tests in `internal/tmux/run_test.go` cover stderr-wrap, empty-stderr fallback, and Env/Dir overrides; `just test-backend` passes

### Edge Cases & Error Handling

- [x] A-010 R1: on failure with whitespace-only stderr, the bare exec error is returned (no trailing `": "`), and `errors.As(err, *exec.ExitError)` still succeeds through the `%w` wrap

### Code Quality

- [x] A-011 Pattern consistency: new code follows internal/tmux naming and file-per-topic layout; migrated wrappers keep their documented roles
- [x] A-012 No unnecessary duplication: the runner idiom exists exactly once, in `internal/tmux`
- [x] A-013 No shell strings: all subprocess calls remain argv-slice `exec.CommandContext` (Constitution §I); no inline tmux runner construction outside `internal/tmux`

### Security

- [x] A-014 R1: the exported core never interpolates arguments into a shell; argv passes through verbatim; ctx/timeouts remain caller-owned so no call site loses its timeout

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/backend/internal/daemon/daemon.go:91` `runTmux` — now a one-line passthrough to `runTmuxInDir(ctx, "", args...)` whose only remaining value is the empty-dir default; the ~20 in-package call sites could target `runTmuxInDir` directly, but the wrapper is explicitly retained by plan Assumption 4 (intake "MAY remain"). Deferred, not redundant.
- `app/backend/cmd/rk/agent_hook.go:375,387,412,423` — four doc comments still say the impl writes "via `exec.CommandContext`"; the calls now go through `tmux.Run`. Stale wording only (the Constitution §I claim stays true, since `tmux.Run` *is* argv-slice `exec.CommandContext`) — candidate for a comment refresh, not a code deletion.
- `app/backend/internal/tmuxctl/client.go:588,624` — two long comments explain that `cmd.Run()` does not populate `ExitError.Stderr` while `cmd.Output()` does. Still accurate for tmuxctl's own unconverted exec paths, but now that `internal/tmux.RunOutput` sets `cmd.Stderr` explicitly (which also suppresses `ExitError.Stderr`), a future tmuxctl migration onto the core would make `isDuplicateSessionError`'s `ee.Stderr` fallback branch dead. Flagged for whoever migrates tmuxctl next; nothing to delete today.
- No production code was made unused by this change beyond `runTmuxWithEnv` (already deleted in T002) and the five inline runner bodies (already deleted in T003–T005).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Core lives in a new file `internal/tmux/run.go` (not appended to tmux.go) | Intake allows either; package already splits by topic and tmux.go is >2000 lines | S:70 R:95 A:90 D:75 |
| 2 | Confident | `tmuxExecServer`/`tmuxExecRawServer` adopt the core's empty-stderr bare-error fallback, dropping today's trailing `": "` when stderr is empty | The intake's stated contract; callers pattern-match non-empty diagnostic text only, so the empty-stderr edge changes no matching behavior | S:65 R:90 A:85 D:75 |
| 3 | Confident | riff `SubprocessErr` messages embed the core error via `%v` (stderr inside) instead of a separate `\n%s` stderr block; the `errors.As(*exec.ExitError)` extraction block is deleted | Intake: "the core's stderr-in-error text replaces the manual exitErr.Stderr extraction"; message shape is not parsed anywhere | S:75 R:90 A:85 D:80 |
| 4 | Certain | daemon keeps its thin `runTmux`/`runTmuxInDir`/`runTmuxOutput` wrappers as argv-prefix helpers | Intake explicitly permits ("MAY remain"); ~20 call sites in the package use them | S:85 R:95 A:95 D:90 |
| 5 | Confident | Core unit tests exercise the real tmux binary on isolated `rk-test-*` sockets per package convention (testSocketName + LookPath skip + kill-server cleanup), asserting Env via `show-environment -g` and Dir via `#{session_path}` | Matches existing integration-test patterns in `tmux_test.go`/`daemon_test.go`; no test seam or fake needed for a subprocess runner | S:60 R:90 A:85 D:70 |

5 assumptions (1 certain, 4 confident, 0 tentative).
