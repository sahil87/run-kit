# Plan: rk reaper command

**Change**: 260529-fww2-rk-reaper-command
**Status**: In Progress
**Intake**: `intake.md`
**Spec**: `spec.md`

## Tasks

### Phase 1: Refactor (shared scan helper)

- [x] T001 Extract the raw socket-dir candidate-collection loop from `ListServers` (`app/backend/internal/tmux/tmux.go`, ~lines 1035-1086) into a `socketDirPath()` helper (returns `/tmp/tmux-{uid}`) plus an exported `ScanSocketDir(ctx) ([]string, error)` that returns the raw socket-file names (ReadDir + `IsDir`/`os.ModeSocket` filter). Refactor `ListServers` to call `ScanSocketDir`, preserving probe-success-only + sorted behavior exactly.
- [x] T002 Extract the socket-probe used by `ListServers` (`tmux -L <name> list-sessions` via `exec.CommandContext` with a 2s timeout) into a reusable `probeServerAlive(ctx, name) bool` helper in `app/backend/internal/tmux/tmux.go`, and have the `ListServers` probe loop call it. Behavior unchanged.

### Phase 2: Core Implementation (reaper logic in internal/tmux)

- [x] T003 Add the pure classification function `classifyReap(name string, probeAlive bool) reapAction` and the `reapAction` enum (`reapSkip`, `reapKill`, `reapRemoveSocket`) in a new file `app/backend/internal/tmux/reaper.go`. Rules: `.lock` suffix → removeSocket; `== ControlAnchorSessionName` → skip; `IsGoTestServerName && probeAlive` → kill; `IsGoTestServerName && !probeAlive` → removeSocket; otherwise → skip. Order the branches so `.lock` and anchor are checked before the test-name branch.
- [x] T004 Add `ReapResult` struct (Killed, RemovedSockets []string; DryRunPlan []ReapPlanEntry carrying name+action for dry-run summaries) and the thin I/O routine `ReapTestServers(ctx context.Context, dryRun bool) (ReapResult, error)` in `app/backend/internal/tmux/reaper.go`. It scans via `ScanSocketDir`, probes each candidate via `probeServerAlive`, classifies via `classifyReap`, and (non-dry-run) performs the action — `KillServer(name)` for kill; `os.Remove(filepath.Join(socketDirPath(), name))` for removeSocket. Reuse `IsGoTestServerName`, `KillServer`, `ControlAnchorSessionName`.
- [x] T005 Factor the per-candidate execution into an internal seam `reapCandidates(ctx, dir string, candidates []string, probe func(ctx context.Context, name string) bool, dryRun bool) (ReapResult, error)` that `ReapTestServers` calls with `socketDirPath()` + `probeServerAlive`. Collect per-entry errors via `slog` (Warn) and return a joined aggregate error at the end, mirroring `sweepOrphanedRelaySessions` (`serve_sweep.go:28-62`); a single failure MUST NOT abort iteration.

### Phase 3: Command wiring

- [x] T006 Create the thin cobra command `app/backend/cmd/rk/reaper.go`: `reaperCmd` (`Use: "reaper"`, clear Short/Long) with a `--dry-run` bool flag. `RunE` calls `tmux.ReapTestServers(ctx, dryRun)` and renders the summary only (counts + names of killed servers and removed sockets/locks; in dry-run, list candidates grouped by action and state nothing was touched; zero-candidate case prints a "nothing to reap" message). No scan/probe/remove/kill logic in `cmd/rk`. Match the idiom of `cmd/rk/status.go`.
- [x] T007 Register `reaperCmd` in `app/backend/cmd/rk/root.go` via `rootCmd.AddCommand(reaperCmd)` in `init()`, matching the existing registration style.

### Phase 4: Tests

- [x] T008 [P] Add `TestClassifyReap` in `app/backend/internal/tmux/reaper_test.go` covering ALL cases: live-test→kill, dead-test→removeSocket, `.lock` (live & dead)→removeSocket, live-non-test→skip, dead-non-test→skip, `rk-e2e-*` (live & dead)→skip, `_rk-ctl` anchor→skip.
- [x] T009 [P] Add temp-dir tests in `app/backend/internal/tmux/reaper_test.go` exercising `reapCandidates` with a fake prober: (a) dry-run performs NO `os.Remove` (assert files still present) and populates the dry-run plan; (b) non-dry-run removes dead-test + `.lock` socket files and leaves non-test/anchor/e2e files present; (c) one os.Remove failure (e.g. missing/locked entry) is logged-and-skipped and surfaces an aggregate error while other entries still process. Kill is exercised only via classification (no real tmux server spawned).
- [x] T010 Verify existing `ListServers`/`IsGoTestServerName` tests still pass after the refactor (`just test-backend`); added `TestFilterSocketEntries` temp-dir test (exercises the extracted `filterSocketEntries` against a real unix socket + dirs/regular files) since `ScanSocketDir` hardcodes `/tmp/tmux-{uid}`.

## Execution Order

- T001 → T002 (probe extraction touches the loop T001 reshapes) → T003/T004/T005 (reaper depends on scan + probe + classify) → T006 → T007.
- T008, T009, T010 (Phase 4) depend on Phase 2/3 code existing; T008 and T009 are independent of each other ([P]).

## Acceptance

### Functional Completeness

- [ ] A-001 Shared scan helper: `ScanSocketDir` (or equivalently named exported helper) exists in `internal/tmux`, returns raw socket-file names via the `/tmp/tmux-{uid}` ReadDir + `IsDir`/`os.ModeSocket` filter, and is the single definition of that convention.
- [ ] A-002 `ListServers` calls the shared scan helper and retains its observable behavior: returns only sorted probe-success socket names; dead sockets are still dropped.
- [ ] A-003 Reaper enumerates candidates via the raw scan helper (NOT `ListServers`), so dead test sockets are visible to it.
- [ ] A-004 A pure `classifyReap(name, probeAlive)` returns exactly one of kill / removeSocket / skip per the spec's rules, with no real-tmux dependency.
- [ ] A-005 `ReapTestServers(ctx, dryRun)` exists in `internal/tmux`, scans + probes + classifies + (non-dry-run) acts, and returns a `ReapResult` carrying killed names, removed names, and (dry-run) classified candidates.
- [ ] A-006 `reaperCmd` is registered as a top-level command in `root.go` via `rootCmd.AddCommand`, NOT nested under serve/daemon, NOT invoked from any startup path; `rk reaper --help` lists a `--dry-run` flag.
- [ ] A-007 `cmd/rk/reaper.go` is thin: parses `--dry-run`, calls the `internal/tmux` reaper helper, renders the summary; no socket scanning, probing, `os.Remove`, or `KillServer` in `cmd/rk`.

### Behavioral Correctness

- [ ] A-008 Default `rk reaper` kills live orphan test servers and removes dead test sockets + `*.lock` files, then prints a summary with total count plus names of killed servers and removed sockets/locks.
- [ ] A-009 `--dry-run` lists each candidate annotated with its classified action and performs NO kill and NO `os.Remove`; all candidate entries remain on disk afterward.
- [ ] A-010 Reaping is unconditional for matched test names (incl. fixed-name `rk-tmuxctl-test`, `rk-daemon-test`) and `.lock` files — no PID-liveness gate, no `kill(pid,0)`, no `rk-test-<pid>-<ns>` parsing.
- [ ] A-011 Nothing-to-reap case kills/removes nothing and prints a zero-count / "nothing to reap" message.

### Scenario Coverage

- [ ] A-012 Test coverage exercises classify for live-test→kill, dead-test→remove, `.lock`→remove, live-non-test→skip, `rk-e2e-*`→skip, anchor→skip.
- [ ] A-013 A test asserts `--dry-run` (via the `reapCandidates` seam) performs no `os.Remove` and (separately) the non-dry-run path removes the expected files.

### Edge Cases & Error Handling

- [ ] A-014 Per-entry kill/remove failures are logged via `slog` and skipped; a single failure does not abort the sweep; an aggregate error is returned when ≥1 entry failed, and nil when all succeed (mirrors `sweepOrphanedRelaySessions`).
- [ ] A-015 Hard exclusions hold: `rk-e2e-*` (live or dead), `_rk-ctl` anchor, and any live non-test server are never killed or removed.

### Code Quality

- [ ] A-016 Pattern consistency: New code follows naming and structural patterns of surrounding `internal/tmux` and `cmd/rk` code.
- [ ] A-017 No unnecessary duplication: `IsGoTestServerName`, `KillServer`, `ControlAnchorSessionName`, and the socket-dir scan/probe are reused — the five test prefixes are NOT re-declared in the reaper.
- [ ] A-018 No god functions: scan, probe, classify, and reap are separate focused functions; classify is pure.

### Security

- [ ] A-019 Subprocess execution within `internal/tmux` continues to use `exec.CommandContext` with a timeout (Constitution §I); the kill path is `tmux.KillServer`. No new persistent state store is introduced (Constitution §II); candidates are derived from the socket dir at invocation time.

## Notes

- Backend-only change. Verification: `just test-backend` + `just build` (or `go build ./...`). No frontend/e2e.
- `serve.go` and `sweepOrphanedRelaySessions` MUST remain unmodified.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Exported scan helper is named `ScanSocketDir(ctx) ([]string, error)`; path construction extracted to unexported `socketDirPath()` | Spec offered `ScanSocketDir` as the example name; clear and consistent with package naming | S:90 R:85 A:90 D:85 |
| 2 | Certain | Reaper lives in a new file `internal/tmux/reaper.go` (not appended to `tmux.go`) | tmux.go is already ~1200 lines; `board.go` precedent shows the package splits cohesive features into separate files | S:85 R:90 A:90 D:80 |
| 3 | Certain | Public reaper signature is `ReapTestServers(ctx context.Context, dryRun bool) (ReapResult, error)` | Spec explicitly recommended this name/shape; matches `sweepOrphanedRelaySessions` partial-failure result shape | S:95 R:75 A:90 D:90 |
| 4 | Certain | `reapAction` is an unexported int enum (`reapSkip`, `reapKill`, `reapRemoveSocket`); `classifyReap` is the pure function over `(name, probeAlive)` | Spec mandates a pure, unit-testable classify fn; enum is the idiomatic Go shape | S:90 R:85 A:90 D:85 |
| 5 | Certain | Dry-run mutation-free is tested via an internal `reapCandidates(ctx, dir, candidates, probe, dryRun)` seam with a temp dir + fake prober, avoiding real tmux | Spec explicitly permits a temp-dir-based test of the socket scan + os.Remove path; no real tmux needed | S:88 R:80 A:88 D:80 |
| 6 | Certain | Socket probe extracted to `probeServerAlive(ctx, name) bool` reused by both `ListServers` and the reaper | Spec says "reuse/extract the same probe ListServers uses"; single source for the probe | S:90 R:80 A:88 D:82 |
| 7 | Confident | `ReapResult.DryRunPlan` is a slice of `{Name, Action}` entries so the command can print candidates grouped by action; killed/removed name slices serve the default summary | Spec says ReapResult carries killed names, removed names, and (dry-run) classified candidates; exact field shape left to plan | S:80 R:80 A:80 D:70 |
| 8 | Confident | Branch order in `classifyReap`: `.lock` first, then anchor, then test-name(+probe), else skip | `.lock` carries no test prefix so it must be its own branch; anchor guard before the test branch is defense-in-depth and matches spec intent | S:82 R:80 A:82 D:75 |

8 assumptions (6 certain, 2 confident, 0 tentative, 0 unresolved).
