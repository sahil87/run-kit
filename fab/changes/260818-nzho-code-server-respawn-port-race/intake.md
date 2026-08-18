# Intake: Code-Server Respawn Port Race

**Change**: 260818-nzho-code-server-respawn-port-race
**Created**: 2026-08-18

## Origin

Conversational (`/fab-discuss` session investigating `rk daemon`). User report:

> Whenever the code-server updates, after daemon restart, the code-server fails to restart properly. So you are left with a run-kit with no running code-server.

Accompanied by a `shll update` screenshot (2026-08-18 06:07) showing the exact failure narrated in rk's own logs. The root cause was traced live in the session (code + log-timestamp evidence below); the user approved drafting this fix with the recommended direction.

## Why

**Problem.** Every `rk code-server update` that actually flips versions (including the one embedded in the `shll update` auto-update chain) kills the running editor and then fails to respawn it — the operator is left with a dashboard whose code lens is dead until someone manually runs `rk code-server start`.

**Root cause — a kill→probe race, all inside one second.** The evidence from the 06:07:30 log lines:

1. `respawnCodeServerSession` (`app/backend/cmd/rk/code_server.go:229`) calls `codeServerKillFn()` → `KillCodeServerSession` (`app/backend/internal/daemon/codeserver.go:399`), which returns **as soon as `tmux kill-session` succeeds**. kill-session only SIGHUPs the pane; the node-based code-server process takes hundreds of ms to a few seconds to shut down and unbind its port.
2. `respawnCodeServerSession` immediately calls `codeServerStartFn()` → `ensureCodeServerCore` (`codeserver.go:200`), whose skip order is fixed: session-exists (now false), unresolvable-port, then `portInUse(localhostAddr, port)` (`codeserver.go:216`).
3. The port probe finds the **dying old instance still bound** and takes the externally-managed carve-out: `EnsureExternallyManaged`, logged as "code-server port already serving; respecting the externally managed instance" — and the respawn prints "Port already serving — respecting the externally managed code-server; the updated binary was not respawned."
4. The old process finishes dying seconds later. Nothing is serving. The lens degrades to not-running.

**Consequence if unfixed.** Every version-changed update reproducibly kills the editor. This is the successor failure to the 260813 reap bug (`kill-server` → `kill-session` in `reapStaleDaemonSocket`) — that fix landed and works (the screenshot shows siblings surviving the daemon restart); this race is the *next* link in the same chain.

**Why this approach.** The externally-managed carve-out (`codeserver.go:216-219`) is legitimate and must stay — it is the mirror of dev.sh's preset-port carve-out and protects a genuinely foreign instance. It is only *wrong* in the one window where rk itself just killed its own session. So the fix belongs in the respawn seam (wait for the port we just freed to actually free), not in loosening the general ensure-path check.

## What Changes

### `respawnCodeServerSession` waits for the port to free after killing its own session

In `app/backend/cmd/rk/code_server.go`, between the kill and the start:

1. Determine whether the kill actually killed rk's own session (a pre-kill session-existence check, or `KillCodeServerSession` returning a `killed bool` — implementer's choice; the signal must distinguish "killed ours" from "nothing to kill").
2. **Only when a session was killed**: poll until the resolved code-server port (`config.Load().ResolvedCodeServerPort()`) stops accepting connections — bounded, ~5s budget at ~200ms cadence — before calling `codeServerStartFn()`.
3. On budget expiry with the port still bound, fall through to `codeServerStartFn()` unchanged — it classifies externally-managed and prints the existing truthful message. No new failure mode; the wait only closes the race window.

Sketch of the target flow:

```go
killed, err := codeServerKillFn()          // or: existed-before check + existing kill
if err != nil { return respawnFailed, err }
if killed {
    waitForPortFree(port, 5*time.Second)   // poll ~200ms; expiry is non-fatal
}
outcome, err := codeServerStartFn()
```

### Both respawn consumers inherit the fix

`respawnCodeServerSession` is shared by the update flow's version-changed respawn (`runCodeServerUpdateFlow`) and install's foreign-session migration (`migrateForeignCodeServerSession`, `code_server.go:261`). Fixing the shared helper covers both; no per-caller logic.

### The ensure path is untouched

`ensureCodeServerCore`'s skip order and the externally-managed carve-out stay byte-identical for all other callers (daemon boot `ensureCodeServer`, CLI `StartCodeServer` without a preceding kill).

### Tests

The respawn path already runs through seam vars (`codeServerDaemonRunningFn`, `codeServerKillFn`, `codeServerStartFn` — the repo's seam-var idiom). Extend the existing `cmd/rk` tests to cover: (a) killed-session → port-still-bound-then-freed → respawn proceeds (no externally-managed misclassification); (b) killed-session → port never frees within budget → falls through to the externally-managed outcome; (c) no session existed → no wait, start called immediately; (d) genuinely external instance (no kill) → carve-out preserved. The port-probe wait needs its own seam (injectable `portInUse`/clock or shrunken poll vars, matching `internal/remote`'s readiness-poll test pattern).

## Affected Memory

- `run-kit/architecture`: (modify) the code-server lifecycle section — respawn-after-update now waits for its own port to free before the externally-managed classification can fire.

## Impact

- `app/backend/cmd/rk/code_server.go` — the respawn seam (primary change)
- `app/backend/internal/daemon/codeserver.go` — only if `KillCodeServerSession` gains the `killed bool` return (signature change propagates to its callers/seam var)
- `app/backend/cmd/rk/code_server_test.go` (or sibling) — new race-window cases
- No API, frontend, or tmux-config surface. No new config knobs.

## Open Questions

- None blocking. The wait budget/cadence and expiry behavior are recorded as a Tentative assumption below (Assumption 4) — `/fab-clarify` if 5s feels wrong.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Root cause is the kill→probe race: `KillCodeServerSession` returns before the process unbinds; `ensureCodeServerCore`'s `portInUse` then misclassifies the dying instance as externally managed | Traced in code (`code_server.go:229` → `codeserver.go:399` → `codeserver.go:216`) and confirmed by same-second log timestamps in the user's screenshot | S:90 R:85 A:95 D:90 |
| 2 | Confident | Fix lives in the respawn seam (wait-for-port-free after killing our own session), not in loosening the ensure path's externally-managed check | Discussed — user approved this direction; the carve-out is correct for genuinely foreign instances and must survive | S:80 R:75 A:85 D:80 |
| 3 | Confident | "We killed ours" is derived from pre-kill session existence (bool return or pre-check); absent session ⇒ no wait | Only signal that distinguishes the race window from a cold start; mechanism choice left to apply | S:65 R:80 A:80 D:70 |
| 4 | Tentative | Wait budget ~5s at ~200ms cadence; on expiry fall through to today's externally-managed classification (truthful degradation, no new error path) <!-- assumed: 5s/200ms wait budget with non-fatal expiry — mirrors internal/remote's 15s/300ms readiness poll scaled to a local unbind --> | Reasonable guess; node shutdown is typically sub-second, and expiry behavior preserves the status quo | S:50 R:85 A:60 D:55 |
| 5 | Confident | `migrateForeignCodeServerSession` inherits the fix via the shared `respawnCodeServerSession` helper; no separate path | Both callers documented as sharing the helper (`code_server.go:222-228` comment) | S:70 R:80 A:85 D:80 |

5 assumptions (1 certain, 3 confident, 1 tentative, 0 unresolved).
