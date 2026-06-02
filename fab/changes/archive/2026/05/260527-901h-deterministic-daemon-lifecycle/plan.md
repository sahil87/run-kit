# Plan: Deterministic Daemon Lifecycle

**Change**: 260527-901h-deterministic-daemon-lifecycle
**Status**: In Progress
**Intake**: `intake.md`
**Spec**: `spec.md`

## Tasks

### Phase 1: Setup

- [x] T001 Add named constants in `app/backend/internal/daemon/daemon.go`: `daemonLogEnvVar = "RK_DAEMON_LOG"`, `daemonLogDirName = "rk"`, `daemonLogFilename = "daemon.log"`, `portProbeTimeout = 400 * time.Millisecond`, and `localhostAddr = "127.0.0.1"`. Add `net` to imports.

### Phase 2: Core Implementation

- [x] T002 [P] Add `probeHost(host string) string` helper in `app/backend/internal/daemon/daemon.go` that returns `localhostAddr` when host is `""`, `"0.0.0.0"`, or `"::"`, otherwise returns the literal host (loopback substitution per spec Requirement 1).
- [x] T003 [P] Add `portInUse(host string, port int) bool` helper in `app/backend/internal/daemon/daemon.go` using `net.DialTimeout("tcp", net.JoinHostPort(probeHost(host), strconv.Itoa(port)), portProbeTimeout)`; closes the connection on success and returns `true`; treats any dial error (refused/timeout) as `false`. <!-- clarified: signature dropped the `ctx` parameter — `net.DialTimeout` already bounds the probe via `portProbeTimeout`, so threading a context added no value. Implementation in daemon.go matches this. -->
- [x] T004 Add `guardPortAvailable() error` helper that calls `config.Load()` + `portInUse(...)` and returns the port-in-use error containing the substrings `already serving on <host>:<port>`, `not under the rk-daemon`, and `RK_PORT` (per spec scenario assertions). <!-- clarified: signature dropped the `ctx` parameter — only `portInUse` is called inside, which is itself non-context-bound. Implementation in daemon.go matches this. -->
- [x] T005 Add `reapStaleDaemonSocket(ctx context.Context)` helper in `app/backend/internal/daemon/daemon.go` that calls `runTmux(ctx, "kill-server")`; on error, logs at `slog.Debug` with the error message and never propagates (no-op semantics). Add `log/slog` import.
- [x] T006 Modify `Start()` in `app/backend/internal/daemon/daemon.go`: after the existing `IsRunning()` guard, call `guardPortAvailable()` (return its error if non-nil), then call `reapStaleDaemonSocket` with a fresh `cmdTimeout`-bounded context, then proceed with executable resolution and `startSession`. <!-- clarified: `guardPortAvailable` is no-ctx (see T004); the fresh context belongs only to the reap. -->
- [x] T007 Modify `StartWithBinary(binPath string)` in `app/backend/internal/daemon/daemon.go`: same port-probe guard + reap calls as `Start()`, placed after `IsRunning()` and before the symlink resolution.
- [x] T008 Modify `startSession(exe string)` in `app/backend/internal/daemon/daemon.go` to resolve `os.UserCacheDir()` via a small `resolveDaemonLogPath() (string, bool)` helper; on success, append `-e <daemonLogEnvVar>=<path>` to the tmux `new-session` args before the `-d -s SessionName -n WindowName exe serve` tail. On `os.UserCacheDir()` failure, the helper emits a single `slog.Warn("daemon log path unavailable", "err", err)` and returns `("", false)` so `startSession` calls `new-session` WITHOUT the `-e` flag (preserve current behavior). <!-- clarified: extracted the path resolution into `resolveDaemonLogPath` to keep `startSession` short and to localize the `slog.Warn`. Implementation in daemon.go matches this. -->
- [x] T009 Modify `app/backend/cmd/rk/serve.go` foreground-serve setup: between the existing `logLevel` block and `slog.New(slog.NewTextHandler(...))`, check `os.Getenv("RK_DAEMON_LOG")`. When set and non-empty: `os.MkdirAll(filepath.Dir(path), 0o755)`, `os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)`, wrap with `io.MultiWriter(os.Stderr, f)` and pass that to `slog.NewTextHandler`. On ANY error, fall back to stderr-only and emit single `slog.Warn("daemon log unavailable", "path", path, "err", err)` after the logger is constructed. Add `io`, `path/filepath` imports if absent.

### Phase 3: Integration & Edge Cases

- [x] T010 [P] Add unit tests in `app/backend/internal/daemon/daemon_test.go`:
  - `TestProbeHost` — table-driven: `""`, `"0.0.0.0"`, `"::"` → `127.0.0.1`; `"example.com"`, `"10.0.0.1"`, `"127.0.0.1"` → literal.
  - `TestPortInUse_Free` — `portInUse("127.0.0.1", <unbound-port>)` returns false within timeout (use `net.Listen` on `:0` then `Close` to obtain a known-free port).
  - `TestPortInUse_Held` — start an `net.Listener` on `:0`, extract its port, assert `portInUse("127.0.0.1", port)` returns true; close listener.
  - `TestPortInUse_LoopbackSubstitution` — start a listener on `127.0.0.1:0`, assert `portInUse("0.0.0.0", port)` returns true (exercises the wildcard-substitution path against a real listener). <!-- clarified: added during implementation to give Requirement 1's loopback substitution end-to-end coverage beyond the pure `probeHost` table; test is present in daemon_test.go. -->
- [x] T011 [P] Add `TestStart_RefusesWhenPortInUse` in `app/backend/internal/daemon/daemon_test.go`: use `withServerSocket(t, testSocket)` for isolation, bind a listener on `127.0.0.1:<random>`, override `RK_HOST`/`RK_PORT` via `t.Setenv`, call `Start()`, assert error message contains `already serving on`, `not under the rk-daemon`, and `RK_PORT`. Skip when tmux missing or when prod daemon is running.
- [x] T012 [P] Add `TestReapStaleDaemonSocket_NoOp` in `app/backend/internal/daemon/daemon_test.go`: use `withServerSocket(t, testSocket)`, ensure no server is running on the test socket, call `reapStaleDaemonSocket(ctx)`, assert it does not panic or block. (Behavioral guarantee: returns no error path that needs assertion; the test simply exercises the call.)

### Phase 4: Polish

- [x] T013 Run `cd app/backend && go build ./...` to verify the package compiles.
- [x] T014 Run `cd app/backend && go test ./internal/daemon/... -count=1` and verify all daemon tests pass.
- [x] T015 Run `cd app/backend && go test ./... -count=1` (full suite) and verify everything passes. If failures appear, stop and report.

## Execution Order

- T001 blocks T002–T009 (all subsequent code work depends on the new constants).
- T002 + T003 + T005 are independent helpers; can be authored in parallel ([P]).
- T004 depends on T003 (calls `portInUse`).
- T006 + T007 both depend on T004 + T005 (use the helpers); T007 may follow T006 immediately.
- T008 is independent of the port-probe/reap chain — touches only `startSession`.
- T009 (serve.go) is independent of all daemon.go changes.
- T010–T012 require T002–T005 in place (test the helpers / new behavior).
- T013–T015 are last (verification gates).

## Acceptance

### Functional Completeness

- [x] A-001 Port-based liveness detection: `Start()` and `StartWithBinary()` both invoke a `net.DialTimeout`-based probe (bounded by the `portProbeTimeout` constant, 400ms) AFTER `IsRunning()` and refuse with the required substrings when the port is held. <!-- clarified: tie the bound to the named constant for symmetry with A-024. -->
- [x] A-002 Loopback substitution: `probeHost` returns `127.0.0.1` for `""`, `"0.0.0.0"`, `"::"` and the literal host otherwise.
- [x] A-003 Probe propagation: the error returned from `Start()`/`StartWithBinary()` reaches cobra's `RunE` in `serve.go` so the process exits non-zero.
- [x] A-004 Stale-socket reaping: when `IsRunning()` is false and the port is free, `runTmux(ctx, "kill-server")` is invoked on `serverSocket` before `startSession`.
- [x] A-005 Reap idempotency: when there is no server running on the daemon socket, the reap is a no-op (errors logged at `slog.Debug` and not surfaced).
- [x] A-006 Reap scope: the reap goes through `runTmux` (never bare `exec.Command("tmux", ...)`) so `-L rk-daemon` is always prepended; the agent-session `runkit` server is untouched.
- [x] A-007 Daemon log env var: `startSession` sets `RK_DAEMON_LOG=<os.UserCacheDir()>/rk/daemon.log` on the `tmux new-session` invocation via tmux's `-e` flag.
- [x] A-008 Inner serve log redirect: `serve.go` honors `RK_DAEMON_LOG` by tee-ing slog to both stderr and the file (`io.MultiWriter`) with append mode, file mode `0o644`, dir mode `0o755`.
- [x] A-009 Documentation drift placeholder: spec's "Documentation Drift" requirement is metadata for hydrate; no code or memory edits required in this stage.

### Scenario Coverage

- [x] A-010 Foreground-serve-already-holds-port scenario: covered by `TestStart_RefusesWhenPortInUse`.
- [x] A-011 Wildcard-host-loopback-substitution scenario: covered by `TestProbeHost` (substitution table) + `TestPortInUse_LoopbackSubstitution` (end-to-end against a real `127.0.0.1` listener with probe host `0.0.0.0`). <!-- clarified: the actual coverage path uses `TestPortInUse_LoopbackSubstitution` rather than `TestStart_RefusesWhenPortInUse` parameterized — `TestStart_RefusesWhenPortInUse` sets `RK_HOST=127.0.0.1` directly. The substitution path is still validated end-to-end via the dedicated test. -->
- [x] A-012 Daemon-already-running shortcuts probe scenario: structurally guaranteed — `IsRunning()` returns before the probe runs (verified by source inspection).
- [x] A-013 Probe-timeout-bounded scenario: the 400ms `net.DialTimeout` bounds the probe; structurally guaranteed by `portProbeTimeout` constant.
- [x] A-014 Reap-no-op cold-start scenario: covered by `TestReapStaleDaemonSocket_NoOp`.
- [x] A-015 Reap-never-touches-runkit scenario: structurally guaranteed — reap goes through `runTmux` which prepends `-L serverSocket`; no test required.
- [x] A-016 Daemon-log-unset behavior unchanged scenario: structurally guaranteed — `serve.go` only enters the MultiWriter path when `RK_DAEMON_LOG` is non-empty.
- [x] A-017 Log-open-fails fallback scenario: structurally guaranteed — error path in `serve.go` falls back to stderr-only with one `slog.Warn`.
- [x] A-018 UserCacheDir-fails fallback scenario: structurally guaranteed — `startSession` proceeds without the `-e` env arg.

### Edge Cases & Error Handling

- [x] A-019 Wildcard substitution: empty/`0.0.0.0`/`::` all map to `127.0.0.1` (covered by `TestProbeHost`).
- [x] A-020 Probe timeout: dial to an unreachable address returns false within 400ms (validated by structural use of `net.DialTimeout`).
- [x] A-021 Reap no-op on missing socket: tmux's "no server running" exit is suppressed; reap returns to caller.
- [x] A-022 Log open failure: permission/path errors do not abort daemon startup; single `slog.Warn` emitted.
- [x] A-023 UserCacheDir failure: `startSession` proceeds without `RK_DAEMON_LOG`; daemon still starts.

### Code Quality

- [x] A-024 No magic strings: env-var name, log filename, directory name, probe timeout, and loopback address are named constants.
- [x] A-025 Subprocess discipline: all new subprocess invocations go through `runTmux` (which already enforces `exec.CommandContext` + `cmdTimeout`); no bare `exec.Command` is introduced.
- [x] A-026 Pattern consistency: helpers follow existing daemon.go naming (lowercase package-private; `Ctx`-suffix only when context-vs-non-context variants exist).
- [x] A-027 No unnecessary duplication: reap reuses `runTmux`; port-probe is a single helper called from both `Start` and `StartWithBinary`.
- [x] A-028 No god functions: new helpers each stay under 30 lines; modified `startSession` remains short.
- [x] A-029 No inline tmux command construction: the new `new-session -e RK_DAEMON_LOG=...` invocation goes through `runTmux`, not a fresh `exec.Command`.

### Security

- [x] A-030 Input validation: no user-controlled input flows into the new subprocess arguments (`RK_DAEMON_LOG` path is server-derived from `os.UserCacheDir()`; the port-probe target is read from `config.Load()` which validates port range).
- [x] A-031 No shell strings: all new exec paths use `exec.CommandContext` via `runTmux`; no shell strings introduced.
- [x] A-032 Scope of reap: `kill-server` is targeted at `serverSocket` only (the `runTmux` prefix), never at the user's default tmux server.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. The new helpers (`probeHost`, `portInUse`, `guardPortAvailable`, `reapStaleDaemonSocket`, `resolveDaemonLogPath`, `setupSlog`) are each load-bearing and call sites exist in `Start`, `StartWithBinary`, `startSession`, and `serveCmd.RunE`. The pre-existing `slog.New(slog.NewTextHandler(os.Stderr, ...))` line in `serve.go` was replaced (not duplicated) by the new `setupSlog` call, so there is no residual dead path.
