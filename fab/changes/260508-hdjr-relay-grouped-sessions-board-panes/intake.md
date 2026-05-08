# Intake: Relay Grouped Sessions for Board Panes

**Change**: 260508-hdjr-relay-grouped-sessions-board-panes
**Created**: 2026-05-08
**Status**: Draft

## Origin

This change emerged from a `/fab-discuss` session inspecting the just-merged pane-boards feature (`260507-4vuv-pane-boards`, PR #186). The user reported two visible bugs on the board view:

1. Unable to scroll the desktop pane row left/right (a CSS sizing issue — fixed in the same conversation, commit `14040ef`)
2. **All board pane terminals show the same content despite correct headers**

Investigation traced bug #2 to the relay layer (`app/backend/api/relay.go`), not the frontend:

```go
s.tmux.SelectWindow(session, winIdx, server)              // mutates session active window
attachArgs = append(attachArgs, "attach-session", "-t", session)
```

This sequence is correct for the AppShell single-pane case (only one terminal visible at a time). On a board view, multiple `BoardPane`s render simultaneously and may share a tmux session — and tmux clients attached to the same session always mirror the same active window. Whichever relay calls `SelectWindow` last wins, so all panes show the same window.

The conversation also reviewed an unrelated open PR (#178, "terminal multiplexing engine") to confirm it does not address this bug — it's a frontend pool optimization that keeps the relay's `SelectWindow + attach-session` pattern intact.

> **User input**: "Fix board pane terminals showing identical content (relay grouped-session refactor): when multiple board panes attach to the same tmux session (different windows), all attached relays mirror the same active window because tmux clients in a session always share active-window state. Fix by giving each WebSocket relay its own ephemeral grouped session via `tmux new-session -d -s rk-relay-<rand> -t <real_session>` per server, then `select-window` and `attach-session` against the ephemeral. On WebSocket close, kill-session the ephemeral. On rk serve startup, sweep orphaned `rk-relay-*` sessions across all known servers. Cross-server boards already work (different sockets); fix is per-server."

## Why

### The problem

A board pane is a live xterm attached via `/relay/<session>/<window>?server=<server>`. The backend relay calls `tmux select-window -t <session>:<winIdx>` to make the requested window active, then `tmux attach-session -t <session>` to stream output. Tmux's session-client model has a single "active window per session" that all attached clients mirror — so when N relays attach to one session targeting different windows, the last `SelectWindow` wins and all N PTYs display the same window.

This is not a bug in run-kit's code per se; the `SelectWindow + attach-session` pattern is correct for the single-window AppShell route where only one terminal is visible at a time. Boards are the first feature that violates that one-terminal-per-session implicit invariant.

A latent secondary symptom of the same root cause: opening two browser tabs to two different windows of the same session also yanks each other's focus. Boards just made the symptom common and visible.

### What happens if we don't fix it

The board feature shipped with this bug in `260507-4vuv-pane-boards` (PR #186, merged). Today, any board that pins ≥2 windows from the same tmux session (a common case — the board feature is designed for "watch multiple agent windows in one session") is functionally broken. Users will conclude the board feature is unusable and revert to single-window navigation, undoing the value the boards feature was built to deliver.

### Why this approach over alternatives

- **Tmux session groups (`new-session -t <real>`) over re-architecting the relay**: tmux supports grouped sessions natively — sessions in a group share window membership but have **independent active-window state**. This is the exact tmux feature the bug needs; using it is one `new-session` call per WebSocket plus a `kill-session` on close.
- **Backend fix over frontend pool (PR #178)**: PR #178 keeps `localWsRef` per `TerminalClient` (which boards already do) but the underlying relay still calls `SelectWindow + attach-session` — the bug persists. The fix has to live where the tmux command sequence lives.
- **Ephemeral sessions over `pipe-pane` / `capture-pane`**: piping pane output produces a read-only stream and loses interactivity. Boards must remain fully interactive.
- **Per-WebSocket ephemerals over per-pane / per-tab caching**: each `attach-session` is a tmux client, and each client contributes one set of "active window" state. The natural unit of isolation is one ephemeral session per WebSocket, lifetime-bound to the WS.

## What Changes

### 1. Relay creates a per-WebSocket ephemeral grouped session

**File**: `app/backend/api/relay.go`

**Current sequence** (lines ~78–86, 126):

```go
windows, err := s.tmux.ListWindows(r.Context(), session, server)
if err := s.tmux.SelectWindow(session, winIdx, server); err != nil { ... }
// ...
attachArgs = append(attachArgs, "attach-session", "-t", session)
```

**New sequence**:

```go
// Generate a unique ephemeral name. Format: rk-relay-<8 hex chars>.
// PID is included for the startup sweep to optionally narrow to "this server's" sessions
// — but the sweep MUST be ready to delete any rk-relay-* across PIDs since we cannot
// guarantee the previous PID is what created them (e.g., crash-restart).
ephemeral := fmt.Sprintf("rk-relay-%s", randHex(8))

// Verify the real session exists and create the grouped ephemeral on the same server.
// new-session -t <real> creates a session in the same group, sharing windows but with
// independent active-window state. -d = detached (no terminal attached yet).
if err := s.tmux.NewGroupedSession(ctx, server, session, ephemeral); err != nil {
    conn.WriteMessage(websocket.CloseMessage,
        websocket.FormatCloseMessage(4004, "Session not found"))
    return
}
defer s.tmux.KillSession(context.Background(), server, ephemeral)  // best-effort cleanup

// Set the ephemeral's active window — this does NOT affect the real session's active window.
if err := s.tmux.SelectWindow(ephemeral, winIdx, server); err != nil {
    conn.WriteMessage(websocket.CloseMessage,
        websocket.FormatCloseMessage(4004, "Window not found"))
    return
}

// Attach to the ephemeral, not the real session.
attachArgs = append(attachArgs, "attach-session", "-t", ephemeral)
```

**Notes**:

- The `defer KillSession` runs even if `pty.Start` fails after the ephemeral was created. Use a fresh `context.Background()` (not `ctx` which may already be cancelled at cleanup time).
- Cleanup is best-effort — log on failure but do not surface to the client. Orphans are reaped by the startup sweep.
- The frontend WebSocket URL does not change. The ephemeral name is purely internal.

### 2. New tmux helper: `NewGroupedSession`

**File**: `app/backend/internal/tmux/tmux.go`

```go
// NewGroupedSession creates an ephemeral session in the same group as `realSession`
// on the given tmux server. The new session shares windows with realSession but has
// independent active-window state — clients attached to it can navigate independently
// of other clients attached to the real session or other group members.
//
// The ephemeral session must be killed via KillSession when no longer needed.
func (t *Tmux) NewGroupedSession(ctx context.Context, server, realSession, ephemeral string) error {
    ctx, cancel := context.WithTimeout(ctx, TmuxTimeout)
    defer cancel()
    _, err := tmuxExecServer(ctx, server,
        "new-session", "-d", "-s", ephemeral, "-t", realSession)
    return err
}
```

### 3. Reuse existing `KillSession` (already takes server)

`tmux.go:576` — `tmuxExecServer(ctx, server, "kill-session", "-t", session)` — already correctly scoped per server. No change needed.

### 4. Startup sweep across all known servers

**File**: `app/backend/cmd/rk/main.go` or wherever `rk serve` initializes (TBD per spec analysis).

On `rk serve` start:

1. Call `ListServers()` to enumerate all tmux servers known to run-kit (uses existing infrastructure).
2. For each server, list sessions matching `rk-relay-*` and kill them.

```go
func sweepOrphanedRelaySessions(ctx context.Context, t *Tmux) {
    servers, err := t.ListServers(ctx)
    if err != nil { /* log and return — non-fatal at startup */ return }
    for _, srv := range servers {
        sessions, err := t.ListSessions(ctx, srv.Name)
        if err != nil { continue }
        for _, s := range sessions {
            if !strings.HasPrefix(s.Name, "rk-relay-") { continue }
            _ = t.KillSession(ctx, srv.Name, s.Name)  // best-effort
        }
    }
}
```

The sweep runs once at startup; orphans from a prior `rk serve` crash are reclaimed. Concurrent live relays of the new instance are unaffected because their ephemerals are created **after** the sweep (the sweep runs synchronously at startup before HTTP listeners bind).

### 5. Backwards compatibility

- The frontend WebSocket URL remains `/relay/<session>/<window>?server=<server>` — unchanged.
- The AppShell single-pane route gets the same ephemeral-session treatment. This is a minor behavior change: two browser tabs viewing different windows of the same session no longer interfere with each other (latent bug fixed as a side effect).
- No new env vars, no new config files, no schema changes.

## Affected Memory

- `run-kit/architecture.md`: (modify) — Add a note in the relay section that each WebSocket runs against a per-connection ephemeral grouped session named `rk-relay-<rand>`, and that orphans are reaped at server startup.
- `run-kit/tmux-sessions.md`: (modify) — Document the `rk-relay-*` session-name convention and the grouped-session pattern (`new-session -t`). Note that these sessions are invisible to the user-facing session list (filter `rk-relay-*` in any user-facing session list — see Open Questions).

## Impact

### Backend (Go)

- **Modified files**:
  - `app/backend/api/relay.go` — replace `SelectWindow + attach-session -t <session>` with `NewGroupedSession + SelectWindow + attach-session -t <ephemeral>`; `defer KillSession` for cleanup
  - `app/backend/internal/tmux/tmux.go` — add `NewGroupedSession` helper; existing `KillSession` and `SelectWindow` reused unchanged
  - `app/backend/cmd/rk/serve.go` (or equivalent) — add startup sweep call before HTTP listeners bind
  - `app/backend/api/sessions.go` (or equivalent) — filter `rk-relay-*` from user-facing session listings (see Open Questions)
- **New tests**:
  - `app/backend/internal/tmux/tmux_test.go` — unit test `NewGroupedSession` against a real tmux instance (matching existing test style)
  - `app/backend/api/relay_test.go` — end-to-end test that two simultaneous relay connections to the same session targeting different windows produce different PTY output
- **No new dependencies, no migrations, no DB**

### Frontend (TypeScript/React)

- **No changes**. The WebSocket URL contract is unchanged; `BoardPane` and `TerminalClient` already create one WebSocket per pane via `localWsRef`.

### Tests

- E2E: `app/frontend/tests/e2e/boards-pin-flow.spec.ts` should be extended (or a new spec added) to verify multi-window-same-session board content correctness. The current test only pins one window and asserts the pane header — that's why this bug shipped.

### Constitution alignment

- **I. Security First** — `randHex(8)` produces a name that's non-guessable, but session names are not security-sensitive (tmux sessions are user-scoped). No new injection surface — the ephemeral name is fixed-format, not user-controlled.
- **II. No Database** — state remains derived from tmux. The ephemeral session is itself tmux state.
- **III. Wrap, Don't Reinvent** — uses the existing `tmuxExecServer` helper for all subprocess calls.
- **VI. Tmux Sessions Survive Server Restarts** — existing principle. The startup sweep is the **opposite direction**: it removes orphan `rk-relay-*` sessions left by a crashed prior instance, not user sessions. The principle's intent (don't kill user work) is preserved because the sweep matches a fixed prefix that no user would create.

## Open Questions

- **Should `rk-relay-*` sessions be hidden from `tmux list-sessions` consumers in run-kit's UI?** Resolved: yes, mandatory. Filter by `!strings.HasPrefix(name, "rk-relay-")` everywhere user-facing session lists are generated. This is no longer optional because the upcoming multi-server SessionProvider refactor will aggregate sessions from all tmux servers in the sidebar — unfiltered ephemerals would appear in the user-visible tree.
- **Does `select-window` on the ephemeral session correctly target a window by index?** Grouped sessions share window membership but each session has its own indexing. Empirically `select-window -t <ephemeral>:<idx>` should resolve to the same window-id as the real session at that index, but verify in the spec stage with a manual smoke test.
- **What happens if the user `kill-window`s a window while a board pane is attached to the ephemeral pointing at it?** The ephemeral inherits the kill (group membership). The PTY closes, the WebSocket closes with code 4004, the existing reconnect path triggers. Likely no new failure mode; confirm in spec.
- **Is there a thundering-herd concern when a board with N panes opens?** N parallel `new-session -t` calls against the same tmux server — tmux serializes commands per server. For N ≤ ~16 (a reasonable board size) this should be fine; for very large boards the spec stage should consider batching or rate-limiting.
- **Should the startup sweep run async (best-effort, log only) or block server start?** Blocking is safer (no race with new relays) but delays `rk serve` start by tens of milliseconds per server. Default plan: synchronous — it's already tens of ms territory and the simplicity wins.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use tmux grouped sessions (`new-session -d -s <ephemeral> -t <real>`) per WebSocket — one ephemeral per relay connection | Discussed — tmux's documented mechanism for "two clients in the same windows but different active-window state"; matches the bug's root cause exactly | S:95 R:80 A:90 D:95 |
| 2 | Certain | Ephemeral session naming convention: `rk-relay-<8 hex chars>` | Discussed — fixed prefix enables sweep matching; 8 hex = 4B namespace, collision-free for any realistic concurrent count | S:90 R:90 A:85 D:85 |
| 3 | Certain | Cleanup is `defer KillSession` in the relay handler with `context.Background()` (not the request context, which may already be cancelled at cleanup time) | Discussed — request context cancellation is the trigger for cleanup, so reusing it would deadlock the kill | S:95 R:85 A:85 D:90 |
| 4 | Certain | Startup sweep iterates all servers from `ListServers()` and kills any session matching `rk-relay-*` | Discussed — ephemerals are per-server, sweep must match; prefix is fixed and unique to run-kit | S:90 R:80 A:85 D:90 |
| 5 | Certain | Sweep runs synchronously before HTTP listeners bind | Discussed — eliminates race with new relays creating ephemerals at startup; perf cost is tens of ms | S:85 R:85 A:80 D:85 |
| 6 | Certain | Frontend contract unchanged: WebSocket URL stays `/relay/<session>/<window>?server=<server>` | Discussed — ephemeral name is purely internal to the relay; no API surface change | S:95 R:95 A:95 D:95 |
| 7 | Certain | The AppShell single-pane route also gets the ephemeral-session treatment (no special-case for boards) | Discussed — fixes a latent bug (two tabs same session interfering) and avoids dispatch logic in the relay; uniform behavior is simpler | S:90 R:75 A:85 D:85 |
| 8 | Certain | Cross-server boards already work — fix is strictly per-server | Discussed — each tmux server is its own Unix socket and process; sessions on different servers cannot interfere by construction | S:95 R:95 A:95 D:95 |
| 9 | Certain | PR #178 (terminal pool) does NOT address this bug and is orthogonal | Discussed — PR #178 keeps `SelectWindow + attach-session -t <session>` in the relay; the bug persists with or without it | S:95 R:95 A:90 D:95 |
| 10 | Certain | Filter `rk-relay-*` from user-facing session lists (`/api/sessions`, SSE `sessions` event, etc.) — mandatory, not optional | Resolved during intake review — the upcoming multi-server SessionProvider refactor will aggregate sessions across all tmux servers in the sidebar; unfiltered ephemerals would appear in the user-visible tree. The filter is a precondition for that downstream change. | S:90 R:80 A:90 D:90 |
| 11 | Confident | `select-window -t <ephemeral>:<windowIndex>` resolves to the same window as the real session at that index | Open Question #2 — empirically true based on tmux's group semantics, but verify with a spec-stage smoke test | S:70 R:75 A:75 D:75 |
| 12 | Confident | When a window is killed mid-attach, existing reconnect path (close code 4004) handles it cleanly without new code | Open Question #3 — likely no new failure mode given how groups inherit window kills, but verify in spec | S:70 R:70 A:75 D:75 |
| 13 | Confident | E2E test coverage gap: existing `boards-pin-flow.spec.ts` only pins one window — the bug shipped because no test exercised same-session multi-pane | Discussed — must extend tests to cover the failure mode that just shipped | S:90 R:90 A:80 D:85 |

13 assumptions (10 certain, 3 confident, 0 tentative, 0 unresolved).
