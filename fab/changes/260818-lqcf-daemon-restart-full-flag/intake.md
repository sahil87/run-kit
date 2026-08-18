# Intake: Daemon Restart Full Flag

**Change**: 260818-lqcf-daemon-restart-full-flag
**Created**: 2026-08-18

## Origin

Conversational (`/fab-discuss` session investigating `rk daemon`). User request:

> I wanted kind of a "full-restart" option - that deletes the rk-daemon server also, and starts a fresh tmux server for rk-daemon

The session first established why the rk-daemon tmux server effectively never dies on its own (see Why), then walked the design consequences (what else lives on that socket, guards, tunnel handling). The user accepted the recommendation of a `--full` flag on the existing `rk daemon restart` verb with the stop → audited kill-server → start sequence.

## Why

**Problem.** A normal `rk daemon restart` only recycles the `rk-daemon` *session*. The rk-daemon tmux *server* is deliberately immortal — three legs hold it up: the sibling sessions (`rk-jobs`, `rk-code-server`, `rk-remotes`), the `_rk-ctl` anchor session, and `exit-empty off` (both planted by `tmuxctl.productionDial` on every dial — change 260602-a1wo). Empirically confirmed in-session: a fresh `-f /dev/null` scratch server was adopted (anchor + exit-empty off) by the live daemon within one second.

That immortality is correct for normal operation, but it means there is **no supported way to get a genuinely fresh rk-daemon tmux server** — stale server-scoped state (options, environment, a CWD pinned on a dead inode, accumulated zombie windows, a wedged server process) survives every restart. Today the only escape is a hand-typed `tmux -L rk-daemon kill-server`, exactly the class of command the tmux-guard exists to make people nervous about.

**Consequence if unfixed.** Recovering from a corrupted rk-daemon server stays a manual, undocumented, footgun-adjacent procedure with no remote-tunnel follow-up and no audit trail.

**Why this approach.** A flag on the existing `restart` verb (not a new `nuke` command) keeps the surface minimal (Constitution IV, toolkit help-dump churn) and puts the destructive variant behind an explicit opt-in on the verb users already reach for.

## What Changes

### `rk daemon restart --full`

New flag on the existing `rk daemon restart` command (`app/backend/cmd/rk/daemon_start.go` family). Sequence:

1. **Graceful stop** — the existing `daemon.Stop()` path (C-c to the daemon pane, kill-session fallback), so the serve process shuts down cleanly.
2. **Audited kill-server** — `tmux -L rk-daemon kill-server` via `internal/daemon`'s `runTmux` (a new `daemon.KillServer` helper), preceded by the standard teardown audit line (`slog.Warn("tmux teardown", "audit", "kill", "op", "kill-server", "server", serverSocket, ...)`). The explicit `-L` passes the tmux-guard shim by design. This takes down `rk-daemon` remnants, `rk-jobs`, `rk-code-server`, `rk-remotes`, and the `_rk-ctl` anchor.
3. **Normal start** — the existing `Start()`/`StartWithBinary()` path births the fresh server (CWD pinned via `tmux.ServerBirthDir()`, `startSession` unchanged); `ensureCodeServer` respawns the editor on daemon boot as it already does.
4. **Remote-tunnel handling** — see below.

Plain `rk daemon restart` (no flag) is byte-identical to today.

### Guards

- **Refuse under `$TMUX` on the rk-daemon socket**: when the invoking pane's `$TMUX` resolves to the rk-daemon socket, error out before touching anything — the command would kill its own pane mid-run. This structurally covers the rk-jobs suicide class (the 260813 bug's shape): the `shll update` chain runs inside an rk-jobs window on that socket.
- **Manual verb only**: nothing in the auto-update chain (`shll update` → `rk daemon restart`) gains `--full`. The flag is for a human at a terminal.

### Remote tunnels: capture-then-reconnect

`rk-remotes` tunnel windows die with the server and **nothing reconnects them on daemon start** (sessions-outlive-the-daemon IS the persistence mechanism; no supervisor by design). `--full` therefore:

1. Before the kill, derives which registered remotes currently have their tunnel up (the existing `TunnelUp` derivation over `list-windows`).
2. After the start, re-runs the idempotent `rk remote connect` flow for exactly those remotes (BatchMode ssh fails fast on auth problems; progress to the chatter channel per Principle 9).
3. Remotes whose tunnels were already down are left alone.

On a machine with no outbound remotes (the common VM case) this is a no-op.

### Non-goals

- No change to `reapStaleDaemonSocket` (session-scoped reap stays as-is — the 260813 fix is untouched).
- No change to `rk daemon stop` or plain `restart`.
- No `--full`-specific code-server respawn logic — the daemon-boot `ensureCodeServer` covers it. (Adjacent: the respawn port race is change `260818-nzho-code-server-respawn-port-race`; the kill-server → daemon-boot gap is wide enough that the ensure-path probe is unlikely to hit the same race, and if it ever does, that change's wait helper is the reuse point.)
- No resurrection risk to manage: the reconnect FSM's probe-first dial (260602-poka) declines dead sockets, so other live rk instances cannot half-resurrect the socket between kill and fresh start.

### Tests

`internal/daemon`: `KillServer` audit line + argv shape (seam-var tmux runner, matching existing daemon tests). `cmd/rk`: flag parsing, guard refusal under a stubbed rk-daemon `$TMUX`, sequence ordering (stop → kill → start → reconnect) via seam vars, no-remotes no-op, and plain-restart unchanged. Remote reconnect selection (up-before ⇒ reconnect, down-before ⇒ skip) through `internal/remote`'s existing seams.

## Affected Memory

- `run-kit/architecture`: (modify) daemon lifecycle — the `--full` variant, its sequence, and the audited kill-server carve-out on the infrastructure socket.
- `run-kit/remote-hosts`: (modify) tunnel lifecycle — the one caller that reconnects tunnels after killing the server (an explicit exception to "no auto-reconnect": user-initiated, one-shot, not a supervisor).

## Impact

- `app/backend/cmd/rk/daemon_start.go` (or the daemon cmd file housing `restart`) — flag, guard, orchestration
- `app/backend/internal/daemon/daemon.go` — `KillServer` helper
- `app/backend/internal/remote/` — exported hook for "connected set" + reconnect (reusing `Connect`)
- Tests alongside each
- Help output changes ⇒ check against `shll standards` (help-dump, Principle 9) per Constitution's Toolkit Standards clause

## Open Questions

- None blocking. The reconnect-vs-print-guidance choice for tunnels is recorded as Tentative (Assumption 4) — `/fab-clarify` to flip it to guidance-only if auto-ssh on a restart verb feels too eager.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Surface is `--full` on the existing `rk daemon restart`, not a new verb | Discussed — user accepted the recommendation; Constitution IV minimal-surface | S:90 R:80 A:90 D:95 |
| 2 | Certain | Sequence: graceful `Stop()` → audited `tmux -L rk-daemon kill-server` → normal `Start()`; explicit `-L` passes the guard shim by design | Discussed in-session; all building blocks exist and were verified in code | S:85 R:75 A:90 D:85 |
| 3 | Certain | Refuse when the invoking pane's `$TMUX` resolves to the rk-daemon socket; flag never wired into the auto-update chain | Discussed — covers the rk-jobs mid-update suicide class (260813 shape) structurally | S:85 R:80 A:90 D:90 |
| 4 | Tentative | Tunnel handling: capture the up-set pre-kill, auto-reconnect exactly those via idempotent `rk remote connect` post-start (alternative: print reconnect guidance only) <!-- assumed: auto-reconnect of previously-up tunnels — connect is idempotent and BatchMode fails fast, but guidance-only is a defensible simpler v1 --> | Two defensible options; reversible (the sweep is one call site); recommendation given, not user-confirmed | S:55 R:70 A:55 D:45 |
| 5 | Confident | code-server returns via the new daemon's boot-time `ensureCodeServer`; no `--full`-specific respawn | Existing mechanism; port-race adjacency owned by 260818-nzho | S:65 R:75 A:75 D:70 |
| 6 | Confident | Killing the multi-tenant socket is safe from resurrection races: probe-first dial (260602-poka) declines dead sockets; the kill is the feature's explicit opt-in, not a violation of the session-only reap rule | Verified in `tmuxctl/client.go` (`errServerDead`, probe-first ordering) | S:70 R:70 A:85 D:75 |

6 assumptions (3 certain, 2 confident, 1 tentative, 0 unresolved).
