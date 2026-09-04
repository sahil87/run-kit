# Plan: Terminal Relay — Reap Children, Gate the Pre-Attach Reload

**Change**: 260904-71yx-terminal-relay-reap-gate-reload
**Intake**: `intake.md`

## Requirements

### Terminal Relay: Child Reaping (A.1)

#### R1: Every forked attach child is reaped exactly once
Every `tmux attach-session` child forked by a successful `pty.StartWithSize` in `attachStream` (`app/backend/api/terminals_ws.go`) MUST be reaped — `cmd.Wait()` called by exactly one goroutine per `Cmd` — on every path that forked it: the normal teardown path (`stream.teardown()`, reached via `closeStream`, socket teardown, and `failClosed`) and the publish-race branch (stream removed while attaching, where the `cmd` was never published into the stream so teardown cannot cover it). Kill precedes Wait (the `internal/tmuxctl/client.go:317-322` contract) so the reap never hangs on a live attach client. A placeholder stream (nil `cmd` — pre-publish failure or the control pseudo-stream) MUST remain a no-op through teardown.

- **GIVEN** a live relay stream whose attach child is running
- **WHEN** the stream closes (client `close` op, PTY EOF, or socket teardown)
- **THEN** the child process is killed AND `Wait` returns — no `<defunct>` zombie remains and the `os/exec` watchCtx goroutine is released

- **GIVEN** a stream torn down while `attachStream` is still between `pty.StartWithSize` and publish
- **WHEN** the publish-race branch (`tc.streams[op.ID] != st`) fires
- **THEN** that branch itself kills AND reaps the never-published `cmd`

#### R2: Reap regression tests
A regression test SHALL close a stream with a live child and assert the child is reaped (Wait returned / no zombie state), covering the teardown path and the publish-race path (directly or via a shared helper both paths call). The `app/backend/api` test suite MUST remain `-race`-clean.

- **GIVEN** the new tests in the `api` package
- **WHEN** `go test -race ./api/...` runs
- **THEN** the reap assertions pass and no data race is reported

### Terminal Relay: Pre-Attach Reload Off the Critical Path (A.2)

#### R3: Zero reload execs on the attach critical path
`attachStream` MUST NOT execute any tmux subprocess for config reload synchronously between the `open` op and `pty.StartWithSize`. The managed-check + reload in `reloadConfigForAttach` move behind a synchronous per-server once-guard (taken on the attach goroutine, mirroring the legacy-sweep guard pattern) and run asynchronously; at most one reload attempt per server per daemon lifetime. The managed-only gate semantics are preserved inside the async body: an external (unmarked) server never receives rk's conf; a managed-check read failure fails closed (skip) AND releases the once-guard so a later attach may retry (a transient read wobble must not permanently disable the reload for that server). The legacy-option sweep keeps its existing synchronous once-guard take + async execution + hub wake on change. The attach itself is unchanged: `-f confPath` still rides the attach args, so a fresh server gets the conf at client birth regardless.

- **GIVEN** a managed server and two successive attaches to it
- **WHEN** each attach runs
- **THEN** neither attach blocks on a tmux exec for reload, the reload runs exactly once (async), and the second attach skips it via the guard

- **GIVEN** an external (unmarked) server
- **WHEN** an attach runs
- **THEN** no reload is attempted (gate preserved)

- **GIVEN** a managed-check read failure on the first attach
- **WHEN** a second attach runs
- **THEN** the reload is retried (guard released on error)

#### R4: Reload test seams and tests updated to the new shape
The `attachIsManaged` / `attachReloadConfig` / `attachMigrateLegacy` test seams SHALL be preserved. `TestReloadConfigForAttach` and `TestReloadConfigForAttachLegacySweep` SHALL be updated to the async + once-guarded shape (channel-based observation like the existing sweep subtests), pinning: managed reload fires async, external skip, fail-closed skip with guard release (retry on next attach), once-per-server, and the sweep's existing at-most-once behavior.

- **GIVEN** the updated tests with stubbed seams
- **WHEN** the suite runs
- **THEN** all reload-gate semantics above are pinned without a live tmux server

### Non-Goals

- Changes B–F of the daemon reliability plan (sse.go races, poll-loop structure, /api/servers probing, socket-file hygiene, git-fallback storm) — sibling changes in other worktrees.
- Any `/ws/terminals` protocol, close-code, or frontend change.
- Reaping or lifecycle changes to tmux servers themselves (Constitution §VI — only rk's own attach client processes are killed/reaped).

### Design Decisions

#### Reap ownership: kill→Wait inside teardown's Once, in-branch reap for the unpublished cmd
**Decision**: `stream.teardown()` gains `cmd.Wait()` immediately after the existing `Kill()` inside its `sync.Once`; the publish-race branch reaps its own never-published `cmd` in place. A tiny shared helper (kill-then-wait, nil-safe) serves both call sites.
**Why**: teardown is already the single sync.Once-guarded cleanup owner for a published cmd, so exactly-one-Wait falls out structurally; the publish-race cmd is invisible to teardown by construction (st.cmd still nil), so that branch is necessarily its own owner. Mirrors the repo's one proven kill→reap contract (`internal/tmuxctl/client.go:317-322`). SIGKILL-first means Wait returns promptly and never parks a caller.
**Rejected**: a dedicated per-stream reaper goroutine deferring `Wait` (adds a goroutine per stream to fix a goroutine leak; ownership split across two goroutines invites double-Wait); reaping in `pumpPTY` (not every forked cmd gets a pump — the publish race forks and never pumps).
*Introduced by*: 260904-71yx-terminal-relay-reap-gate-reload

#### A.2 shape: async body behind a per-Server once-guard with error release
**Decision**: `reloadConfigForAttach` takes a synchronous per-server once-guard stored on the `Server` struct (a `sync.Map`, the `MarkLegacyMigrationAttempt` pattern), then runs managed-check + reload + (guarded) sweep in one goroutine; the guard entry is deleted on managed-check error so a transient failure retries on a later attach.
**Why**: combines both plan options — zero execs under the switch mask (async) AND no per-attach exec storm on the daemon (once per server per lifetime; the daemon-start `RefreshSweep` already covers conf-staleness propagation for live servers, so per-attach repetition bought nothing). Server-struct storage gives tests free isolation (each test's fresh `&Server{}` starts unguarded — no global reset function needed) and dies with the daemon, which is exactly the intended lifetime.
**Rejected**: hash-stamp comparison per attach (still pays a synchronous read exec under the logo, plus new stamp-tracking state); pure async with no guard (unblocks the mask but keeps 2 execs per attach feeding the fork-storm root cause); putting the guard in `internal/tmux` as a package global (would need a `ResetForTest` sibling and shares state across `Server` instances in tests for no benefit).
*Introduced by*: 260904-71yx-terminal-relay-reap-gate-reload

## Tasks

### Phase 2: Core Implementation

- [x] T001 A.1 — add a nil-safe kill→reap helper in `app/backend/api/terminals_ws.go` (kill then `Wait`, tmuxctl contract) and call it from `stream.teardown()` (replacing the bare `Kill()` at the current `:846-848`) and from the publish-race branch in `attachStream` (replacing the bare `Kill()` at the current `:543-545`); placeholder/control streams stay no-ops <!-- R1 -->
- [x] T002 A.2 — restructure `reloadConfigForAttach` in `app/backend/api/terminals_ws.go`: add a per-server `sync.Map` once-guard on `Server`, take it synchronously, move managed-check + reload + existing sweep logic into one goroutine, delete the guard entry on managed-check error (retry semantics), preserve the managed-only gate, the `attachIsManaged`/`attachReloadConfig`/`attachMigrateLegacy` seams, the sweep's own once-guard, and the hub wake; call site at `attachStream` unchanged <!-- R3 -->

### Phase 3: Integration & Edge Cases

- [x] T003 A.1 tests — in `app/backend/api/terminals_ws_test.go`: regression test that a `stream` with a live pty child (e.g. `sh -c 'sleep 30'` via `pty.StartWithSize`) is reaped by `teardown()` (`ProcessState` populated / Wait returned, bounded poll), plus coverage of the publish-race reap via the shared helper; placeholder-stream teardown stays a no-op <!-- R2 -->
- [x] T004 A.2 tests — rewrite `TestReloadConfigForAttach` (and adjust `TestReloadConfigForAttachLegacySweep` if needed) in `app/backend/api/terminals_ws_test.go` to the async + once-guarded shape: managed reload fires async (channel observation), external skip, fail-closed skip with guard release + retry, once-per-server across two calls on the same `Server`, sweep at-most-once preserved <!-- R4 -->
- [x] T006 `-race`-cleanliness fixes surfaced by T004 (both verified pre-existing at HEAD via a clean-tree repro before fixing): make `tmux.ResetLegacyMigrationForTest` clear keys (`sync.Map.Clear`) instead of reassigning the map (`app/backend/internal/tmux/legacy_options.go` — a reassignment is a plain write racing any in-flight guard user), and capture the `reloadMigrateLegacy` seam before the sweep-goroutine spawn in `handleTmuxReloadConfig` (`app/backend/api/tmux_config.go` — a test's cleanup restore raced the goroutine's read; same capture-before-spawn rule the new `reloadConfigForAttach` uses) <!-- R2 -->
- [x] T005 Verification gates — `go test -race ./api/...` then `go test ./...` in `app/backend`; `just build`; confirm suite `-race`-clean (3× consecutive clean `-race` runs of `./api/`; `just test` smoke recorded under Notes) <!-- R2 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `cmd.Wait()` is reachable on every path a child was forked — teardown (published cmd) and the publish-race branch (unpublished cmd) — and on no path twice
- [x] A-002 R3: no tmux subprocess for managed-check or reload executes synchronously on the attach path between `open` and `pty.StartWithSize`

### Behavioral Correctness

- [x] A-003 R1: closing a stream leaves no `<defunct>` child and releases the exec watcher goroutine (test-verified via `ProcessState`/Wait-returned)
- [x] A-004 R3: reload runs at most once per server per daemon lifetime; managed-check error releases the guard so a later attach retries; external servers never receive the conf

### Scenario Coverage

- [x] A-005 R2: regression test closes a stream with a live child and asserts reap; publish-race reap covered
- [x] A-006 R4: async-reload, external-skip, fail-closed-with-retry, and once-per-server scenarios pinned via the existing seams without a live tmux server

### Edge Cases & Error Handling

- [x] A-007 R1: teardown on a placeholder stream (nil cmd — failed attach, control pseudo-stream) remains a no-op; a failed `pty.StartWithSize` forks nothing and triggers no reap
- [x] A-008 R3: the legacy-option sweep's once-guard, async execution, and hub-wake-on-change behavior are unchanged

### Code Quality

- [x] A-009 Pattern consistency: reap follows the `internal/tmuxctl` kill→Wait contract; the once-guard mirrors the `MarkLegacyMigrationAttempt` pattern; comments state constraints only (no narration, no change-ID citations)
- [x] A-010 No unnecessary duplication: one shared reap helper serves both kill sites; no new tmux invocation paths outside `internal/tmux`
- [x] A-011 Subprocess discipline: no new `exec` calls; existing `exec.CommandContext` usage untouched (Constitution §I)
- [x] A-012 Tests conform to the requirements (Test Integrity): seams preserved, tests updated to the new spec shape rather than the implementation bent to old tests

## Notes

- Verification run (apply, 2026-09-04): `go test -race ./api/ ./internal/tmux/` clean (3× consecutive fresh `-race` runs of `./api/`); full `go test ./...` green; `npx tsc --noEmit` green; `just build` green; `just test` green (backend 0m22s, frontend 0m27s, e2e 15m03s). One environmental gotcha, not a code issue: `just build` stages the gitignored `build/codebridge/{VERSION,rk-code-bridge.vsix}` embed artifacts, which flips `cmd/rk`'s `TestCodeExecPrintsResultJSON` into the bundled-VSIX state (version-skew note on stderr) — dev state was restored by deleting the two staged files before the final smoke.
- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Reap mechanism: kill→Wait inside teardown's `sync.Once` + in-branch reap for the publish race, via one shared helper | Intake constraint set + tmuxctl precedent; exactly-one-Wait falls out of existing ownership structure | S:85 R:85 A:90 D:85 |
| 2 | Confident | A.2 combines the plan's two options: fully async AND once-per-server guard, with guard release on managed-check error | Plan granted the choice; async alone leaves the fork-storm contribution, guard alone leaves first-attach latency; error-release preserves today's retry-on-wobble behavior | S:80 R:80 A:80 D:65 |
| 3 | Confident | Once-guard lives on the `Server` struct, not `internal/tmux` package state | Fresh `&Server{}` per test = free isolation without a reset seam; guard lifetime = daemon lifetime by construction | S:70 R:85 A:80 D:70 |
| 4 | Certain | Scope is one file + its tests; five tasks | Intake Impact section; plan Change A file list | S:90 R:90 A:95 D:90 |
| 5 | Confident | Two pre-existing `-race` defects adjacent to the touched seams are fixed in-change (T006: race-safe `ResetLegacyMigrationForTest`, seam capture in `handleTmuxReloadConfig`) rather than left flaking | Plan requires the touched package `-race`-clean; both verified pre-existing at HEAD by repro on a clean tree; both fixes are two-line and pattern-identical to the change's own design | S:70 R:85 A:85 D:75 |

5 assumptions (2 certain, 3 confident, 0 tentative).

## Deletion Candidates

None — this change fixes in place (the two bare `Kill()` sites now call the shared `killAndReapAttach` helper; the reload body moved behind a guard) without making any existing file, symbol, or branch redundant.
