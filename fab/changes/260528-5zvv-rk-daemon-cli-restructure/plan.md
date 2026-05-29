# Plan: rk daemon CLI Restructure

**Change**: 260528-5zvv-rk-daemon-cli-restructure
**Status**: In Progress
**Intake**: `intake.md`
**Spec**: `spec.md`

## Tasks

### Phase 1: Setup

- [x] T001 Add `InnerServePID() (int, error)` helper in `app/backend/internal/daemon/daemon.go`. Use `runTmux`-style invocation (`tmux -L rk-daemon list-panes -t =rk-daemon:=serve -F '#{pane_pid}'`) — but capture stdout (current `runTmux` discards it), so add a small internal `runTmuxOutput(ctx, args...) ([]byte, error)` helper alongside it. Parse a single integer PID from stdout via `strconv.Atoi(strings.TrimSpace(...))`. Return `(0, error)` when the daemon session is absent. Bounded by `cmdTimeout` (5s) via `context.WithTimeout`.
- [x] T002 Add unit test for `InnerServePID` in `app/backend/internal/daemon/daemon_test.go` covering: (a) when no daemon session exists, returns `(0, error)`; (b) when a session is started via `startOn(testSocket, SessionName)`, returns `(pid, nil)` with a positive integer. Use `withServerSocket(t, testSocket)` for socket isolation. Skip on `!hasTmux()`/`testing.Short()` per existing convention. <!-- clarified: removed [P] marker — T002 depends on T001 (uses the new helper), cannot run in parallel with it. -->


### Phase 2: Core Implementation — daemon subcommands compile alongside `rk serve` flags

- [x] T003 Create `app/backend/cmd/rk/daemon_portowner.go` exporting (package-private) the shared port-owner lookup: `type PortOwner struct { PID int; Command string; Source string }`, a package-level `var findPortOwner = findPortOwnerImpl` (injectable in tests), and the real `findPortOwnerImpl(ctx context.Context, host string, port int) (*PortOwner, error)`. Implementation: try `lsof -ti:<port>` first; on error or empty output, fall back to `ss -tlnp '( sport = :<port> )'` and parse the `users:(...,pid=N,...)` field. Resolve the holder's command via `/proc/<pid>/comm` on Linux, `ps -p <pid> -o comm=` on macOS (`runtime.GOOS == "darwin"`). Return `(nil, nil)` when nothing is bound; `(nil, error)` only when both tools are missing or both error. Add a `terminateOwner(ctx context.Context, owner *PortOwner) error` helper: `syscall.Kill(pid, syscall.SIGTERM)`, poll up to 5s (200ms intervals) for the PID to exit via `syscall.Kill(pid, 0)`, then `syscall.Kill(pid, syscall.SIGKILL)` if still alive. All `exec.CommandContext` calls use a 5s `context.WithTimeout`. Host arg passed through for display only — query uses port only.
- [x] T004 Create `app/backend/cmd/rk/daemon.go` declaring `var daemonCmd = &cobra.Command{ Use: "daemon", Short: "...", Long: "..." }` (no `RunE`; relies on cobra default help behavior). The Long description SHALL list the four subcommands and describe the daemon's relationship to `rk serve`. Add an `init()` that calls `daemonCmd.AddCommand(daemonStartCmd)`, `daemonCmd.AddCommand(daemonStopCmd)`, `daemonCmd.AddCommand(daemonRestartCmd)`, `daemonCmd.AddCommand(daemonStatusCmd)`. Add `rootCmd.AddCommand(daemonCmd)` inside `app/backend/cmd/rk/root.go`'s existing `init()` alongside the other registrations.
- [x] T005 [P] Create `app/backend/cmd/rk/daemon_start.go` with `var daemonStartCmd = &cobra.Command{ Use: "start", ... }`. `RunE`: read `force` flag; call `daemon.Start()`. On success, print `rk daemon started (<ServerSocket>/<SessionName>/<WindowName>)`. On error: if `!force` or the error is not the port-in-use refusal (substring match: `already serving on`), return the error. With `--force` on port-in-use: call `findPortOwner(cmd.Context(), cfg.Host, cfg.Port)` (load `cfg := config.Load()`); if `owner == nil` return original error wrapped; if owner PID matches `daemon.InnerServePID()` return non-zero with "daemon already running on port; refusing to --force-kill self"; otherwise `terminateOwner`, print `Killed port owner: PID <P> (<command>)`, then retry `daemon.Start()`. `init()` registers `BoolP("force", "f", false, "...")`.
- [x] T006 [P] Create `app/backend/cmd/rk/daemon_stop.go` with `var daemonStopCmd = &cobra.Command{ Use: "stop", ... }`. `RunE`: read `force` flag; `wasRunning := daemon.IsRunning()`. If running, call `daemon.Stop()` and print `rk daemon stopped`. If `!force`: if `!wasRunning` print `rk daemon not running`; return nil (port MUST NOT be probed). With `--force`: load `cfg := config.Load()`, call `findPortOwner`; if nil, return nil silently; if owner PID matches `daemon.InnerServePID()` return non-zero "manual investigation needed"; otherwise `terminateOwner`, print `Killed port owner: PID <P> (<command>)`. `init()` registers `--force/-f`.
- [x] T007 [P] Create `app/backend/cmd/rk/daemon_restart.go` with `var daemonRestartCmd = &cobra.Command{ Use: "restart", ... }`. `RunE`: read `force` flag; if `daemon.IsRunning()` print `Restarting rk daemon...` then `daemon.Stop()`. If `--force`: `findPortOwner`; if owner exists and is not our daemon (`InnerServePID` mismatch or error), `terminateOwner` and print kill message. Then `daemon.Start()` and print started message. `init()` registers `--force/-f`.
- [x] T008 [P] Create `app/backend/cmd/rk/daemon_status.go` with `var daemonStatusCmd = &cobra.Command{ Use: "status", ... }`. `RunE`: read `json` flag. Gather state: `running := daemon.IsRunning()`, optional `innerPID, _ := daemon.InnerServePID()` (best-effort), `cfg := config.Load()`, `owner, _ := findPortOwner(ctx, cfg.Host, cfg.Port)`. Classify port state: `free` (owner nil), `held-by-daemon` (owner.PID == innerPID and innerPID > 0), or `held-by-other`. With `--json`: emit JSON object via `encoding/json` to `cmd.OutOrStdout()` per spec § Requirement: `rk daemon status --json`. Without: emit the human-text shape from intake §5 (Daemon: running/not running, Socket, Session, Target, Port: ... — free|held by the rk daemon (PID P)|held by PID P (command, foreground) plus hint line). The command MUST NOT signal any process. `Long` description includes a one-line note: "Not to be confused with `rk status` (tmux session summary)." `init()` registers `Bool("json", false, "...")` — no `--force` flag.

### Phase 3: Tests for new subcommands (before removal of old flags)

- [x] T009 Create `app/backend/cmd/rk/daemon_test.go` covering:
  - `TestDaemonCmdRegistered`: `rootCmd.Commands()` contains a command named `daemon` whose subcommands include `start`, `stop`, `restart`, `status`.
  - `TestDaemonStatusNoForceFlag`: `rootCmd.SetArgs([]string{"daemon", "status", "--force"})` then `rootCmd.Execute()` returns an error containing `unknown flag`.
  - `TestDaemonStatusJSON_Stopped_Free`: inject a stub `findPortOwner` returning `(nil, nil)`; override `daemon.IsRunning` is not feasible (it's a function in another package), so the test stubs `findPortOwner` and exercises the JSON path against whatever IsRunning reports. Capture stdout via `rootCmd.SetOut`/`SetErr` (`bytes.Buffer`) and assert `json.Unmarshal` succeeds with `daemon.running` boolean and `port.state` string. Skip when `daemon.IsRunning()` returns true (production daemon — avoid touching it).
  - `TestDaemonStartForce_RefusesSelfKill`: stub `findPortOwner` to return a `PortOwner` with PID equal to a value we set via stubbing `innerServePID` — see implementation note in T005 (use a package-level `var innerServePIDFn = daemon.InnerServePID` overridable in test). The test asserts the error message contains `refusing to --force-kill self`.
  - `TestDaemonRestart_NoForce_NoDaemon`: with no daemon running and a known-free port (use `freeTCPPort`-style helper or env-pin `RK_HOST`/`RK_PORT`), `rk daemon restart` should attempt start and (in this no-tmux-mutation test mode) at minimum not panic. Skip when production daemon is running or tmux is missing.
  Use the cobra `RootCmd.SetArgs`+`SetOut`/`SetErr` pattern (mirrors `root_test.go`).
- [x] T010 Add a small targeted unit test in `app/backend/cmd/rk/daemon_test.go` (same file as T009) for `findPortOwnerImpl` integration: <!-- clarified: removed [P] marker — T010 edits the same file as T009. -->
 skip with `t.Skip("lsof not on PATH")` when `exec.LookPath("lsof")` errors; otherwise bind a `net.Listener` on `127.0.0.1:0`, call `findPortOwnerImpl(ctx, "127.0.0.1", port)`, assert the returned PID equals `os.Getpid()` and `Source == "lsof"`.

### Phase 4: Destructive removal (only after all four subcommands compile and pass tests)

- [x] T011 Edit `app/backend/cmd/rk/serve.go`: delete the three flag registrations from `serveCmd`'s `init()` (the `daemon`/`restart`/`stop` `Bool`/`BoolP` calls at the bottom of the file); delete the mutual-exclusivity check and the `switch` dispatch block inside `serveCmd.RunE` (the block from `daemonFlag, _ := cmd.Flags().GetBool("daemon")` through the closing `}` of the `case stopFlag:` arm). `RunE` should drop straight to `cfg := config.Load()`. Update the `Long` description's example block to remove `rk serve -d` and point operators to `rk daemon start`. Run `cd app/backend && go build ./...` to confirm. <!-- clarified: the `rk/internal/daemon` import is NOT removed — `daemon.LogEnvVar` is still consumed by `setupSlog` (PR #197 single-source-of-truth). -->

- [x] T012 [P] Update `app/backend/cmd/rk/root_test.go` — `TestRootCmdHasSubcommands` MUST add `"daemon": false` to the expected map (the test currently checks for `serve`, `update`, `doctor`, `status`, `context`, `init-conf`). No other tests should reference the removed `rk serve` daemon flags; if any exist, delete them.

### Phase 5: Verification

- [x] T013 Run `cd app/backend && go test ./cmd/rk/... ./internal/daemon/...` — all tests must pass. Re-run after fixing any failures.
- [x] T014 [P] Run `cd app/backend && go vet ./...` and `cd app/backend && gofmt -l .` — both must produce no output.

## Execution Order

- T001 blocks T002 (test depends on helper).
- T001 blocks T005, T006, T007, T008 (those call `daemon.InnerServePID`).
- T003 blocks T005, T006, T007, T008 (those call `findPortOwner`/`terminateOwner`).
- T004 blocks T005, T006, T007, T008 (parent must exist before subcommands wire to it — but in practice all created in a single edit window; cobra wiring tolerates declaration order via `init()`).
- T005, T006, T007, T008 are independent from each other once T001+T003+T004 are done — marked `[P]`.
- T009 blocks T011 (the destructive removal must come after the new subcommands pass tests).
- T011 blocks T013 (final test sweep).

## Acceptance

### Functional Completeness

- [x] A-001 Top-level `rk daemon` parent: `rootCmd.AddCommand(daemonCmd)` exists in `root.go`; `daemonCmd` has no `RunE`; `rk daemon` with no subcommand prints cobra help listing `start`, `stop`, `restart`, `status`.
- [x] A-002 File layout: `app/backend/cmd/rk/` contains `daemon.go`, `daemon_start.go`, `daemon_stop.go`, `daemon_restart.go`, `daemon_status.go`, `daemon_portowner.go`.
- [x] A-003 `rk daemon start` (no `--force`) invokes `daemon.Start()` and prints `rk daemon started (<socket>/<session>/<window>)` on success; returns the underlying error on failure with the PR #197 port-probe substrings intact.
- [x] A-004 `rk daemon start --force` is lazy: only invokes `findPortOwner`/`terminateOwner` on the port-in-use error path; happy path does NOT touch `findPortOwner`.
- [x] A-005 `rk daemon start --force` refuses to kill itself: when owner PID matches `daemon.InnerServePID()`, the error message contains `refusing to --force-kill self` and no signal is sent.
- [x] A-006 `rk daemon stop` (no `--force`) calls `daemon.Stop()` when running and prints `rk daemon stopped`; prints `rk daemon not running` and exits 0 otherwise; MUST NOT probe the port.
- [x] A-007 `rk daemon stop --force` stops the daemon (if running), then probes the port; SIGTERMs a non-daemon owner; silent no-op when port is free.
- [x] A-008 `rk daemon restart` (no `--force`) is equivalent to today's `rk serve --restart`: Stop-then-Start, with PR #197 port-probe refusal surfacing if a foreign holder blocks Start.
- [x] A-009 `rk daemon restart --force` proactively clears non-daemon port holders between Stop and Start.
- [x] A-010 `rk daemon status` is read-only: prints daemon state (running/not running + socket/session/window/target when running) AND port state (`free` | `held by the rk daemon (PID P)` | `held by PID P (command, foreground)`); no SIGTERM, SIGKILL, or tmux mutation.
- [x] A-011 `rk daemon status` does NOT accept `--force`; passing it surfaces cobra's `unknown flag` error.
- [x] A-012 `rk daemon status --json` emits a JSON object with `daemon.{running,…}` and `port.{host,port,state,…}` fields; valid `json.Unmarshal`-able; no trailing diagnostic text on stdout.
- [x] A-013 `rk daemon status --help` long-text includes a one-line note distinguishing it from `rk status` (tmux session summary).

### Behavioral Correctness

- [x] A-014 `findPortOwner` uses port only — host argument is display-only; queries are `lsof -ti:<port>` primary, `ss -tlnp '( sport = :<port> )'` fallback; returns `(nil, nil)` on no holder, `(nil, error)` only when both tools fail.
- [x] A-015 `terminateOwner` sends SIGTERM, polls up to 5s for exit, SIGKILLs on timeout; uses `syscall.Kill`, never a shell `kill`.
- [x] A-016 All subprocess calls in `daemon_portowner.go` use `exec.CommandContext` with a 5s `context.WithTimeout`; no `exec.Command` (without context) and no shell-string construction.
- [x] A-017 `daemon.InnerServePID()` exists in `internal/daemon`; runs `tmux -L rk-daemon list-panes -t =rk-daemon:=serve -F '#{pane_pid}'`; returns `(0, error)` when the daemon session is absent.

### Removal Verification

- [x] A-018 `app/backend/cmd/rk/serve.go` no longer registers `--daemon`/`-d`, `--restart`, or `--stop` flags on `serveCmd`; no mutual-exclusivity check or `switch` dispatch remains in `serveCmd.RunE`.
- [x] A-019 `rk serve -d`, `rk serve --restart`, and `rk serve --stop` each surface cobra's `unknown flag` error (no deprecation forwarder, no warning).
- [x] A-020 `serve.go` no longer uses `rk/internal/daemon` for lifecycle dispatch — only `daemon.LogEnvVar` (consumed by `setupSlog`) remains. <!-- clarified: the import is retained for `LogEnvVar` per PR #197 architecture; removing it would require relocating `LogEnvVar`, which is out of scope. Initial wording in T011/A-020 was overaggressive. -->


### Scenario Coverage

- [x] A-021 Test `TestDaemonCmdRegistered` (or equivalent) asserts the `daemon` subcommand and its four children are wired into `rootCmd`.
- [x] A-022 Test `TestDaemonStatusNoForceFlag` (or equivalent) asserts `rk daemon status --force` produces cobra's unknown-flag error.
- [x] A-023 Test `TestDaemonStatusJSON_*` (or equivalent) asserts JSON shape includes `daemon.running` boolean and `port.state` enum values.
- [x] A-024 Test `TestDaemonStartForce_RefusesSelfKill` (or equivalent) drives the `--force` self-check branch via injected stubs and asserts the refusal message.
- [x] A-025 `daemon.InnerServePID` has a unit test covering both no-session and running-session cases (existing daemon-test conventions: `useTestSocket`/`withServerSocket`, skip on `!hasTmux()`/`testing.Short()`).

### Edge Cases & Error Handling

- [x] A-026 `rk daemon stop --force` when port is already free: exits 0 with no `Killed port owner` line.
- [x] A-027 `rk daemon stop --force` when port is still held by what looks like our own daemon after `daemon.Stop()`: returns non-zero with a "manual investigation needed" error message; no signal sent.
- [x] A-028 `rk daemon start --force` when daemon already running: short-circuits on `daemon.Start()`'s `daemon already running` error (no `--force` reclaim path); error is returned as-is.
- [x] A-029 `findPortOwner` when both `lsof` and `ss` are unavailable: returns `(nil, error)` with a descriptive message naming both tools.

### Code Quality

- [x] A-030 Pattern consistency: new daemon CLI files follow the one-file-per-subcommand layout already used by `serve.go`, `doctor.go`, `status.go`, `upgrade.go`; cobra command vars named `daemon{Verb}Cmd`; `init()` registers flags and (for parent) child commands.
- [x] A-031 No unnecessary duplication: `Start`/`Stop`/`Restart`/`IsRunning`/`ServerSocket`/`SessionName`/`WindowName`/`LogEnvVar` from `internal/daemon` are reused unchanged; no re-implementation of tmux session lifecycle in the CLI layer.
- [x] A-032 No magic strings: socket/session/window names come from `daemon.ServerSocket`/`SessionName`/`WindowName` constants; PR #197 error substrings are matched via well-known substring `already serving on` defined inside the daemon package.
- [x] A-033 Tests use `rootCmd.SetArgs` + `SetOut`/`SetErr` capture (mirrors `root_test.go` and the spec's required pattern); port-owner lookup is injected via a package-level `var findPortOwner` overridable in tests.

### Security

- [x] A-034 Constitution §I: every subprocess in `daemon_portowner.go` (`lsof`, `ss`, `ps`) uses `exec.CommandContext` with a 5s `context.WithTimeout`; no shell-string interpolation; signal delivery uses `syscall.Kill` not a shell `kill` invocation.
- [x] A-035 Constitution §III: re-uses existing `internal/daemon` helpers (`Start`, `Stop`, `Restart`, `IsRunning`, `StartWithBinary`, `RestartWithBinary`); the only new internal/daemon export is `InnerServePID()`.
- [x] A-036 Constitution §IV: net flag-surface reduction at the user-facing level (three flags removed from `rk serve`; one subcommand with four children added under `rk daemon`).

## Notes

- The plan deliberately interleaves implementation of the four `daemon_*` subcommands as `[P]` tasks — they share no code beyond the helpers from T001 and T003, and each lives in its own file.
- The destructive flag-removal (T011) is sequenced LAST in implementation phases per the orchestrator brief: all four subcommands must compile and pass their tests before the old flag surface is deleted. This keeps the working tree compilable across the change.
- T002 and T010 use the existing `withServerSocket(t, testSocket)` + `useTestSocket(t)` test scaffolding from `daemon_test.go` — no new test infrastructure required.

## Deletion Candidates

- None — this change adds new functionality (the `rk daemon` subcommand tree) and explicitly removes the old `rk serve` daemon flags via T011 (already deleted in the apply). No additional redundant code surfaced during review.
