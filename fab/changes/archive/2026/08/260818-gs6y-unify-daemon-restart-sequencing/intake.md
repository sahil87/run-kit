# Intake: Unify Daemon Restart Sequencing

**Change**: 260818-gs6y-unify-daemon-restart-sequencing
**Created**: 2026-08-18

## Origin

Conversational (`/fab-discuss` session). The user reported:

> I did "rk daemon restart --full" but code-server did not start. It starts if only "rk daemon restart" is done. Why are we even facing issues like there? Can you take a holistic look at the architecture of "rk daemon <subcommands>" and report if there's a way to unify the multiple pathways to completely eleminate bugs like there

Root-cause analysis in the session confirmed the mechanism (see Why) and produced a three-item unification proposal. The user approved items 1+2 for this change ("Create an intake for 1+2"); item 3 (identity-based externally-managed classification via port-owner lookup) was explicitly left out of scope.

## Why

**The bug.** `rk daemon restart --full` reliably comes back up without code-server. The `--full` flow (`cmd/rk/daemon_restart.go`) is `Stop()` → `KillServer()` → `Start()`. `KillServer` kills the entire rk-daemon tmux server including the `rk-code-server` sibling session — but tmux kill only SIGHUPs the pane process, and the node-based code-server takes up to a few seconds to exit and unbind its port. `Start()` reaches `ensureCodeServer()` within milliseconds, whose port probe (`internal/daemon/codeserver.go` `ensureCodeServerCore`, skip 3) finds the *dying* instance still bound and misclassifies it as an externally managed instance → skip. The old process then exits, nothing is respawned, and no supervisor loop ever retries (Constitution VI). Plain `restart` is unaffected only because `Stop()`'s exact-match `=rk-daemon` kill never touches the sibling, so ensure skips on session-exists — correctly.

**The recurrence pattern.** This exact race was already diagnosed and fixed once — PR #647 added `waitForCodeServerPortFree` in `cmd/rk/code_server.go` (5s timeout / 200ms poll), used by the `rk code-server update` respawn (kill → wait → respawn). PR #648 added `--full` one commit later, composed the same kill-then-ensure sequence, and did not carry the invariant. The structural cause is twofold:

1. **The port-release invariant lives at one call site, not at the source.** The hazard is created by the kill primitives (`KillServer`, `KillCodeServerSession` — SIGHUP is asynchronous) and suffered by the ensure path (port-probe classification), but the wait lives in neither — it lives in one of three callers. Every new kill+ensure composition re-creates the race by default.
2. **Three separate restart sequencers** each hold a different subset of the invariants: the `rk daemon restart` RunE (force port-kill, `--full` kill-server, remote reconnect — but not the port race), `daemon.Restart`/`RestartWithBinary` (plain stop→start, used by `rk update`), and the code-server update respawn (the only one with the port-free wait). Notably `rk daemon restart` does not call `daemon.Restart()` at all — the CLI re-implements the orchestration inline.

**If not fixed:** `--full` stays broken, and every future composition of these primitives (new flags, new callers) is one forgotten invariant away from the same class of bug.

## What Changes

### 1. Release-synchronous kill primitives (`internal/daemon`)

Make the kill primitives own the port-release invariant, so composition is safe by construction:

- **`KillCodeServerSession`**: after a successful kill (`killed == true`), block — bounded — until the code-server port stops accepting connections, then return. Reuses the existing wait shape from `cmd/rk/code_server.go:51-79`: 5s timeout, 200ms poll, expiry non-fatal (the caller's externally-managed classification then fires exactly as today — the wait closes the race window, adds no failure mode). The timeout/poll values move into `internal/daemon` as vars (test seams, matching the `stopGracePeriod`/`stopPollInterval` idiom). An unresolvable port (0) skips the wait. `killed == false` (nothing to kill) never waits.
- **`KillServer`**: probe `rk-code-server` session existence BEFORE the kill; after a successful kill, run the same bounded port-free wait — but **only if the session existed pre-kill**. The conditionality is load-bearing: when the session never existed, a busy code-server port belongs to a genuinely externally managed instance that will not release it, and an unconditional wait would burn the full 5s timeout on every `--full` restart for those users.
- **Delete `waitForCodeServerPortFree`** and its seams (`codeServerPortFreeTimeout`, `codeServerPortFreePoll`, `codeServerPortBusyFn`) from `cmd/rk/code_server.go`; the `rk code-server update` respawn (currently kill → `if killed` → wait at `code_server.go:272-281`) drops the explicit wait and relies on the now-synchronous kill. Its race-window tests move/adapt to `internal/daemon`.

This alone fixes the reported `--full` bug: `KillServer` returns only after the code-server port is actually free, so `Start()` → `ensureCodeServer()` no longer sees the dying instance.

### 2. One restart sequencer (`internal/daemon`)

Collapse the three restart sequencings into a single options-driven state machine:

```go
type RestartOptions struct {
    Force  bool   // reclaim the daemon port from a non-daemon holder between stop and start
    Full   bool   // kill the whole rk-daemon tmux server (siblings included) between stop and start
    Binary string // start with this binary path (EvalSymlinks'd) instead of os.Executable — the upgrade path
}

func Restart(opts RestartOptions) error
```

Sequencing owned by `daemon.Restart`, in order:

1. **Full guard**: when `opts.Full`, refuse if invoked from inside the rk-daemon server (`tmux.OriginalTMUX` basename check — `insideDaemonServer` moves from `cmd/rk/daemon_restart.go` into `internal/daemon`, which already imports `internal/tmux`). Putting the guard inside `Restart` makes it impossible for future callers to bypass.
2. `Stop()` if running.
3. When `opts.Full`: `KillServer()` (now release-synchronous per §1).
4. When `opts.Force`: port-owner lookup + SIGTERM of a non-daemon holder (same semantics as today's restart `--force` block, including the surface-lookup-errors rule and the refuse-to-kill-self check).
5. `Start()` / `StartWithBinary(opts.Binary)`.

Callers rewired:

- **`cmd/rk/daemon_restart.go` RunE** becomes thin: parse flags, capture the up-tunnel set before calling (only when `--full`), call `daemon.Restart(opts)`, print outcomes, run `reconnectRemotes` after. **Remote reconnect stays in the CLI wrapper** — `internal/remote` imports `internal/daemon` (verified), so the daemon package cannot own it without an import cycle; it is post-restart best-effort and does not affect restart correctness.
- **`cmd/rk/upgrade.go`**: `restartDaemonFn = daemon.RestartWithBinary` → `daemon.Restart(RestartOptions{Binary: path})` (wrapped to preserve the seam signature or the seam updated).
- **`daemon.Restart()` (niladic) and `RestartWithBinary`**: folded into the options form. Callers are module-internal only (upgrade.go + tests); no compatibility wrappers needed beyond what keeps the diff readable.
- **`POST /api/restart`** is untouched: it spawns `rk daemon restart` in an rk-jobs window and funnels into the CLI path.

### 3. Port-owner helpers move to `internal/ports`

Restart `--force` step 4 needs the port-owner lookup/terminate machinery, which currently lives in `cmd/rk/daemon_portowner.go` (~225 lines, no `rk/internal` imports — self-contained lsof/ss + syscall). Move `findPortOwner`/`terminateOwner`/`PortOwner` (and their tests) into `internal/ports`, which already owns lsof execution/parsing (`lsof.go`) — a reuse consolidation, not new surface. `cmd/rk/daemon_start.go` (`rk daemon start --force`, whose start-catch-retry semantics are deliberately unchanged) imports them from the new location; `ownerIsDaemon` stays in cmd or moves to `internal/daemon` as fits (it needs `daemon.InnerServePID`).

### Explicitly out of scope

- Item 3 of the session's proposal: identity-based externally-managed classification (port-owner command inspection in `ensureCodeServerCore`). The kill-side wait is expected to be sufficient; revisit only if a misclassification recurs.
- `rk daemon start --force` semantics (start, catch port-in-use, kill owner, retry) — unchanged, only its helpers' import path moves.
- The ensure-path skip order and `EnsureOutcome` surface — unchanged.
- CLI flag surface of `rk daemon restart` — unchanged (`--force`, `--full`, same help semantics).

## Affected Memory

- `run-kit/architecture`: (modify) daemon lifecycle section — restart sequencing now owned by `daemon.Restart(RestartOptions)`; kill primitives are release-synchronous w.r.t. the code-server port; port-owner helpers live in `internal/ports`.

## Impact

- `app/backend/internal/daemon/daemon.go` — `KillServer` pre-kill probe + wait; `Restart(opts)` replaces `Restart`/`RestartWithBinary`; full-guard moves in.
- `app/backend/internal/daemon/codeserver.go` — `KillCodeServerSession` gains the bounded wait; wait vars land here (or daemon.go).
- `app/backend/cmd/rk/daemon_restart.go` — RunE thins to flag-parse + capture-tunnels + `daemon.Restart` + reconnect; `insideDaemonServer` moves out.
- `app/backend/cmd/rk/code_server.go` — `waitForCodeServerPortFree` + seams deleted; update respawn simplified.
- `app/backend/cmd/rk/daemon_portowner.go` → `app/backend/internal/ports/` (move + package rename; `daemon_start.go` import updates).
- `app/backend/cmd/rk/upgrade.go` — restart seam updated.
- Tests: `daemon_restart_test.go` sequencing tests migrate to drive `daemon.Restart` seams; code_server race-window tests move to `internal/daemon`; portowner tests move with the file. Existing seam vars (`daemonStopFn` etc.) relocate or are replaced by internal/daemon seams.
- No API, frontend, CLI-flag, or config changes. No new dependencies.

## Open Questions

- None — all decision points were resolved in the originating discussion and are recorded below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fix at the kill side (release-synchronous `KillServer`/`KillCodeServerSession`), not by adding a wait to the `--full` call site or inside `ensureCodeServerCore` | Discussed — user approved item 1 verbatim; ensure-side wait was rejected in-session because it taxes genuinely externally-managed setups ~5s on every daemon start | S:90 R:70 A:90 D:85 |
| 2 | Certain | Collapse restart sequencing into `daemon.Restart(RestartOptions{Force, Full, Binary})`; CLI RunE becomes a thin wrapper | Discussed — user approved item 2 verbatim | S:90 R:65 A:85 D:85 |
| 3 | Certain | Remote-tunnel reconnect stays in the CLI wrapper | Verified import cycle: `internal/remote` imports `internal/daemon`; discussed in-session as the accepted caveat | S:85 R:60 A:95 D:90 |
| 4 | Confident | `KillServer`'s port wait is conditional on the `rk-code-server` session existing pre-kill; `KillCodeServerSession` waits only when `killed == true` | Unconditional waiting would stall 5s per `--full` restart for externally-managed users — the same asymmetry the rejected ensure-side design suffered; existing `killed` return already encodes this | S:70 R:80 A:85 D:75 |
| 5 | Confident | Port-owner helpers move to `internal/ports` (not a new package, not a callback hook kept in cmd) | `internal/ports` already owns lsof execution/parsing and `daemon_portowner.go` has zero `rk/internal` imports (verified); a callback hook would leave the sequencer not owning `--force` — weaker unification | S:70 R:75 A:80 D:55 |
| 6 | Confident | Wait bounds reuse #647's values (5s / 200ms) as `internal/daemon` vars, expiry non-fatal | Proven values from the shipped fix; var-not-const matches the package's established test-seam idiom | S:75 R:90 A:90 D:85 |
| 7 | Confident | `--full` inside-daemon-server guard moves into `daemon.Restart` | daemon already imports `internal/tmux`; guard-in-primitive matches the change's safe-by-construction theme; behavior identical for the CLI | S:65 R:85 A:80 D:70 |
| 8 | Tentative | `daemon.Restart()`/`RestartWithBinary` are folded into the options form outright (no deprecation wrappers) | Only module-internal callers exist (upgrade.go + tests); if review prefers keeping thin wrappers for diff hygiene, trivially reversible | S:55 R:90 A:75 D:60 |

8 assumptions (3 certain, 4 confident, 1 tentative, 0 unresolved).
