# Intake: Prevent exit-empty tmux server death

**Change**: 260602-a1wo-prevent-exit-empty-server-death
**Created**: 2026-06-02
**Status**: Draft

## Origin

> Prevent run-kit tmux servers from dying via tmux exit-empty. Investigated live after the user's `kit` tmux server (holding two real sessions: fab-kit + run-kit) was destroyed. Conversational mode — diagnosed from `~/.cache/rk/daemon.log` and source, with the user actively challenging conclusions.

This change was initiated from a `/fab-discuss` debugging session. The user reported a recurring symptom: tmux servers managed by run-kit get killed unexpectedly. Diagnosis sequence:

1. **First hypothesis (mine, wrong-ish):** relay churn drained the server to zero → `exit-empty on` reaped it. Correct mechanism, imprecise trigger.
2. **User correction:** "kit had two running sessions — it was not empty." Confirmed certain. This ruled out naive "relays drained to zero."
3. **User's alternative hypothesis:** were kit's sessions linked to the `sss` server and killed when sss was cleaned up? **Ruled out:** each run-kit "server" is a separate tmux server on its own socket (`-L <name>` → `/tmp/tmux-1001/<name>`); tmux has no cross-socket linking primitive; sss was cleaned at 12:04 vs kit dying at 12:28 (24-min gap). The `runKit`-named session under `server=sss` was a naming coincidence.
4. **Root cause located in source:** `tmuxctl/client.go resolveBootstrap` creates the `_rk-ctl` anchor **only when the server is empty at first control-mode connect**. Servers that already have real sessions get attached-to-a-real-session and **no anchor floor**. When the last real session later closes, only `rk-relay-*` ephemerals remain; the next relay disconnect drains to zero; tmux default `exit-empty=on` reaps the whole server.
5. **User's design insight:** "This is just bad design. `_rk-ctl` should be independent of how many sessions are running. Why not ALWAYS have it?" — which is the core of the fix.
6. **User question on multi-`rk serve`:** confirmed the model holds — `tmux -CC attach` is independent per client; concurrent anchor creation is already benign via `isDuplicateSessionError`.
7. A prior change **explicitly deferred** this exact fix — `app/backend/api/sse.go:603` comment: *"Constitution VI prevention (exit-empty off / anchor) is a separate change."* This is that change. It is the ≥3rd recurrence (runWork → utils → kit).

## Why

**Problem:** run-kit-managed tmux servers are destroyed out from under the user, taking live agent sessions with them. Confirmed ≥3 times (`runWork`, `utils`, `kit`). This directly violates **Constitution VI** ("Agent sessions running in tmux windows SHALL NOT be affected by server restarts, crashes, or deployments").

**Mechanism (precise):** The `_rk-ctl` anchor session is the only run-kit-owned thing that can hold a server's session count above zero. But `resolveBootstrap` (`tmuxctl/client.go`) creates it **only** when `firstSessionName(ctx, socket) == ""` — i.e. only on a server that is *already* empty when the control-mode client first attaches. A server that has real user sessions at attach time gets the control client bound to one of *those* sessions and **no anchor is created**. There is no anchor teardown anywhere (`createAnchor` exists; no `killAnchor`), and `@rk_ctl_keepalive` is a label with **no runtime consumer** (it does not actually keep anything alive). So:

```
server has real sessions at attach  →  no _rk-ctl floor created
   ↓ (user's last real session later closes — shell exits / agent finishes)
only rk-relay-* ephemerals remain
   ↓ (next WebSocket disconnects, relay.go:122 deferred KillSessionCtx)
session count → 0
   ↓ tmux default exit-empty=on
WHOLE SERVER REAPED  (no run-kit kill-server; nothing audited)
```

**Consequence if unfixed:** continued, undiagnosable loss of live agent sessions; the observability-only detector added at `sse.go:603` did **not** even fire for `kit` (all 140 firings were test servers), so the team's own diagnostic has a gap.

**Why this approach over alternatives:**
- *Always-on anchor (chosen)* — run-kit-owned, debuggable (visible in `list-sessions`), directly expresses intent ("run-kit holds a floor on servers it subscribes to"). Decouples "session floor" from "attach target."
- *`exit-empty off` alone (rejected as primary)* — blunter; changes tmux global behavior for states run-kit doesn't manage; leaves truly-empty servers (anchor-create failed) lingering invisibly. Kept only as a **backstop** for the brief reconnect-race window where the anchor is momentarily absent.
- *Cross-process refcounted anchor teardown (rejected)* — would let empty servers eventually die, but requires shared state across multiple `rk serve` processes, which **Constitution II forbids** (no database / no persistent shared state). No single `rk serve` can safely know it is the last one that wants a given server's anchor.

## What Changes

### 1. Always create the `_rk-ctl` anchor (session floor) — `tmuxctl/client.go`

`resolveBootstrap` must **always** ensure `_rk-ctl` exists on the server, regardless of how many real sessions are present. Decouple two concerns it currently conflates:

- **Session floor** (always): run `createAnchor` (idempotent; `isDuplicateSessionError` already makes the concurrent-`rk` race benign) + `setAnchorKeepalive` unconditionally.
- **Control-mode attach target** (conditional): continue to attach to the first real user session if one exists, else attach to `_rk-ctl`. (Per empirical verification, attaching to `_rk-ctl` would *also* be correct — `%session-window-changed` is global — but preserving "attach to real session if present" is zero-risk and keeps the change minimal.)

Current (problematic):
```go
func resolveBootstrap(ctx, socket) (string, error) {
    first, err := firstSessionName(ctx, socket)
    if err == nil && first != "" {
        return first, nil          // ← no anchor created; no floor
    }
    createAnchor(...); setAnchorKeepalive(...)
    return tmux.ControlAnchorSessionName, nil
}
```

Target (always-floor):
```go
func resolveBootstrap(ctx, socket) (string, error) {
    // Always ensure the anchor floor exists (idempotent; dup-session benign).
    if err := createAnchor(ctx, socket); err != nil && !isDuplicateSessionError(err) {
        return "", fmt.Errorf("create anchor: %w", err)
    }
    if err := setAnchorKeepalive(ctx, socket); err != nil {
        slog.Debug("tmuxctl: set anchor keepalive failed (non-fatal)", "socket", socket, "err", err)
    }
    // Attach target: prefer an existing real session; else the anchor.
    if first, err := firstSessionName(ctx, socket); err == nil && first != "" {
        return first, nil
    }
    return tmux.ControlAnchorSessionName, nil
}
```

### 2. Set `exit-empty off` imperatively on every server run-kit touches

The embedded `tmux.conf` is only applied via `-f` on run-kit-*created* servers — it never reaches hand-created or foreign servers (the exact gap that let `kit` inherit tmux's default `exit-empty on`). So set it imperatively. Best site: the `tmuxctl` supervisor `openSocket` path (runs for every observed socket) and/or alongside anchor creation. `set-option -g exit-empty off` (server-scoped, idempotent).

### 2a. Ordering constraint (restart-reconnect edge case)

On a daemon restart that reconnects to a server with N existing real sessions, `resolveBootstrap` self-heals: it runs `createAnchor` and installs the `_rk-ctl` floor that the old (only-when-empty) code never created. Re-creation is idempotent — the second+ restart hits `"duplicate session"`, which `isDuplicateSessionError` already treats as benign.

**Critical ordering:** `set-option -g exit-empty off` MUST be applied **before** `createAnchor` (and on every `openSocket`/reconnect), so that during the close-then-reopen window — where the old `-CC` client is closed before the new one runs `createAnchor`, and the server could momentarily have zero sessions if real sessions also closed in that window — tmux does not reap the server before the floor is installed. Setting `exit-empty off` only *after* `createAnchor` leaves a reapable sliver. This is the backstop's primary job, not a theoretical race. Note: detaching a `-CC` control client does NOT kill the `_rk-ctl` *session* (a session outlives client detach), so the floor survives a normal detach; the risk is specifically the zero-session window during restart.

### 3. Server-lifetime contract: explicit kill only

Document and enforce that a managed server dies **only** via `kill-server` / `rk reaper` (`260529-fww2-rk-reaper-command`). Empty (anchor-only) servers persist by design — this is the accepted tradeoff that makes accidental death impossible. No automatic reaping of anchor-only servers in this change.

### 4. Update the deferred-fix comment — `app/backend/api/sse.go:603`

The block comment says prevention "is a separate change." Update it to reference this change as the implementation, and reassess whether the observability WARN is still needed (likely keep it as defense-in-depth).

## Affected Memory

- `run-kit/tmux-sessions.md`: (modify) the `_rk-ctl` anchor section — change "created when needed (zero pre-existing sessions)" to "always created as a permanent session floor"; document `exit-empty off` application and the explicit-kill-only lifetime contract.

## Impact

- **Code:** `app/backend/internal/tmuxctl/client.go` (`resolveBootstrap`, possibly `createAnchor`/`setAnchorKeepalive` call sites), `app/backend/internal/tmuxctl/supervisor.go` (`openSocket` — exit-empty application site), `app/backend/internal/tmux/` (exit-empty helper + possibly embedded conf for run-kit-created servers), `app/backend/api/sse.go` (comment update).
- **Behavior:** every tmux server run-kit attaches control-mode to will carry a hidden `_rk-ctl` session for its lifetime; empty servers no longer auto-die.
- **No API surface change.** Anchor stays filtered from user-facing UIs (existing `tmux.ControlAnchorSessionName` filtering).
- **Tests:** `tmuxctl` client/supervisor tests (anchor always created; attach-target selection), and the exit-empty application. The relay startup sweep already guards `_rk-ctl` — add/confirm a regression test.
- **Verified non-regression:** `%session-window-changed` is global (empirically confirmed on tmux 3.6a this machine) → active-window highlight derivation is unaffected by attach-target choice.

## Open Questions

- Exact site for `exit-empty off`: `tmuxctl/openSocket` (covers every observed socket) vs. alongside `createAnchor` in `resolveBootstrap` vs. an `internal/tmux` helper invoked from both. Plan stage to choose the single canonical site.
- Should the `sse.go:603` observability WARN be kept (defense-in-depth) or removed now that prevention exists? Lean keep.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Root cause is `resolveBootstrap` creating `_rk-ctl` only-when-empty, leaving servers-with-real-sessions without a floor | Read from source (`client.go:372`); confirmed no anchor teardown exists; daemon log shows zero anchor-keepalive events for kit | S:5 R:5 A:5 D:5 |
| 2 | Certain | Fix part 1 = always create the anchor as a permanent floor, decoupled from the attach target | User's explicit design directive ("why not ALWAYS have it"); minimal diff to one function | S:5 R:5 A:5 D:5 |
| 3 | Certain | Attaching control-mode to `_rk-ctl` does NOT regress active-window highlight | Empirically verified `%session-window-changed` is global on tmux 3.6a this session; confirms memory [[tmux-control-mode-event-scope]] | S:5 R:5 A:4 D:5 |
| 4 | Confident | Fix part 2 = set `exit-empty off` imperatively (not via `-f` conf) as the reconnect-race backstop | Embedded conf only reaches run-kit-created servers via `-f`; kit inherited default `on`. User questioned whether exit-empty off is needed — agreed: backstop only, not primary | S:4 R:4 A:4 D:4 |
| 5 | Certain | Lifetime contract = explicit kill only; empty/anchor-only servers persist by design | User chose "Explicit kill only" option; no cross-process refcounting per Constitution II | S:5 R:5 A:5 D:5 |
| 6 | Certain | sss-linkage hypothesis is impossible | Separate sockets; no cross-socket tmux linking; 24-min causal gap | S:5 R:5 A:5 D:5 |
| 7 | Confident | Concurrent multi-`rk serve` anchor creation stays safe | `isDuplicateSessionError` already treats the race as benign; `tmux -CC attach` is per-client independent | S:5 R:4 A:4 D:4 |
| 8 | Tentative | Single canonical site for `exit-empty off` is `tmuxctl openSocket` | Covers every observed socket including foreign/hand-created; plan stage to confirm vs. alternatives | S:3 R:3 A:3 D:3 |
| 9 | Confident | Keep the `sse.go:603` observability WARN as defense-in-depth, update its comment | Detector had a gap (didn't fire for kit) but is still useful for unforeseen external kills | S:4 R:4 A:3 D:4 |

9 assumptions (5 certain, 3 confident, 1 tentative, 0 unresolved).
