# Intake: Guard createAnchor against resurrecting a killed tmux server

**Change**: 260602-poka-guard-anchor-no-resurrect
**Created**: 2026-06-02
**Status**: Draft

## Origin

Initiated from a `/fab-discuss` session investigating why **killing any tmux server from run-kit never sticks** — the server reappears within ~250ms regardless of whether it was empty or had sessions. The investigation traced the live behavior through three sub-agent code traces (kill path, tmuxctl trigger chain, and `createAnchor`/server-liveness semantics) before settling on a root-cause fix.

> User's raw framing: *"I'm unable to kill any tmux server from run-kit — irrespective of if it is empty or not."* Follow-up questions narrowed the cause to the `_rk-ctl` control-mode anchor and, ultimately, to `createAnchor`'s use of `tmux new-session`, which implicitly starts a server. The user explicitly confirmed: (a) an explicit UI kill should always win (a warning modal already exists), (b) `_rk-ctl`/tmuxctl is still load-bearing for live "tab-switch" UI updates and must NOT be removed, and (c) the change should be the **tightest possible root-cause fix** — guard only, with the de-adopt/Client-close, foreign-socket ownership boundary, and tombstone coordination all deferred to separate changes.

Interaction mode: conversational (multi-turn discussion → SRAD-graded decisions), not one-shot.

## Why

**Problem.** `internal/tmuxctl/client.go:createAnchor` runs `tmux new-session -d -s _rk-ctl -L <socket>` on every dial and every reconnect. `tmux new-session` has an implicit side effect: if no server is running on the socket, it **starts one**. This is invoked from `productionDial → resolveBootstrap → createAnchor`. The `productionDial` function is also the reconnect FSM's dial (`client.go:205-223`, ~250ms→5s backoff). So when a user kills a server via the API (`api/servers.go:handleServerKill → tmux.KillServer → tmux -L <socket> kill-server`), the server process exits, but the still-alive Client's reconnect FSM fires ~250ms later, re-dials, and `createAnchor`'s `new-session` **recreates the dead server**. The recreated socket file also fires an fsnotify `CREATE` that makes the Supervisor `openSocket` a fresh Client — a self-reinforcing resurrection loop. Kill loses this race every time.

**Consequence if unfixed.** Server kill is effectively non-functional while `rk serve` is running. The only workaround is to stop `rk serve` first — which defeats the purpose of a kill button in the UI. This also blocks downstream cleanup work (e.g. removing orphaned debug/design sockets) because run-kit actively keeps every socket it dials immortal.

**Why this approach over alternatives.**
- The anchor's *only legitimate job* is to add the `_rk-ctl` keepalive session to a server that is **already alive**, holding its session count above zero so `exit-empty off` cannot reap it (Constitution VI). It was never meant to *create* servers. Real server creation goes through a completely separate path — `tmux.CreateSession` (`tmux.go:747`), used by `rk riff` and session-create.
- **Rejected: remove `_rk-ctl`/control-mode entirely.** The control-mode stream is load-bearing — it drives sub-millisecond active-window/tab-switch UI updates (introduced in commit `e3ae8b2` to dissolve a two-master race; without it, latency regresses to the 12s safety-net poll). Confirmed still in active use. Out.
- **Rejected: tombstone/de-adopt coordination in the Supervisor.** This was the leading design until the root cause was found. Once `createAnchor` refuses to start a dead server, the reconnect FSM's re-dial simply *fails and backs off* instead of resurrecting — so the tombstone is unnecessary for correctness. Deferred.
- **Chosen: guard `createAnchor` at the source.** Make the anchor-ensure operation *do what it intends* — join an already-running server, decline otherwise. Smallest blast radius, fixes the defect at its root, and a genuinely dead server correctly stays dead (its sessions are already gone; resurrecting an empty husk helps no one).

## What Changes

### Guard `createAnchor` to never start a server

`createAnchor` must only ever **join** a server that is already running, and **decline** (return a non-nil error) when no server is listening on the socket. The discriminator is a side-effect-free liveness probe:

```
tmux -L <socket> list-sessions
```

- **exit 0** → server is alive (including the alive-but-zero-session `exit-empty off` floor case) → safe to create the anchor.
- **exit 1** with `no server running` / `failed to connect` → server process is dead → decline.

This is exactly what `internal/tmux/tmux.go:probeServerAlive` (`tmux.go:1359`) already does, and it is already used by `ListServers` and the reaper for the same live-vs-dead distinction:

```go
// probeServerAlive reports whether a tmux server is reachable on the named
// socket by running `tmux -L <name> list-sessions` with a short timeout.
func probeServerAlive(ctx context.Context, name string) bool {
	probeCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	cmd := exec.CommandContext(probeCtx, "tmux", "-L", name, "list-sessions")
	return cmd.Run() == nil
}
```

`list-sessions` does **not** start a server as a side effect (unlike `new-session` or a `has-session -s` that targets a session). It is the clean probe.

### Restructure `resolveBootstrap` to fold the probe into the existing `list-sessions` (no added round-trip)

Today `resolveBootstrap` (`client.go:408-426`) calls, in order: `createAnchor` (which `new-session`s) → `setAnchorKeepalive` → `firstSessionName` (which already runs `list-sessions`). The naive guard would add a *second* `list-sessions`. Instead, **reorder so the `list-sessions` runs first and serves double duty**:

1. Run `list-sessions` once, up front.
   - If it fails as server-dead → return an error (decline) **before** `createAnchor` runs. `productionDial` propagates the error; the reconnect FSM backs off harmlessly.
   - If it succeeds → the server is alive; **reuse the same output** to determine the first real (non-anchor) session — folding in the work `firstSessionName` currently does separately.
2. Only after confirming the server is alive, call `createAnchor` (which now can never resurrect, because we only reach it when the server is already up) and `setAnchorKeepalive`.
3. Return the attach target: the first real session if one exists, else `_rk-ctl`.

Current sketch of `resolveBootstrap` for reference:

```go
func resolveBootstrap(ctx context.Context, socket string) (string, error) {
	// Always ensure the anchor floor exists.
	if err := createAnchor(ctx, socket); err != nil && !isDuplicateSessionError(err) {
		return "", fmt.Errorf("create anchor: %w", err)
	}
	if err := setAnchorKeepalive(ctx, socket); err != nil {
		slog.Debug("tmuxctl: set anchor keepalive failed (non-fatal)", "socket", socket, "err", err)
	}
	if first, err := firstSessionName(ctx, socket); err == nil && first != "" {
		return first, nil
	}
	return tmux.ControlAnchorSessionName, nil
}
```

The restructure: probe-first (reusing `firstSessionName`'s listing, distinguishing dead-server from empty-but-alive), then conditionally `createAnchor`. `firstSessionName` may be merged into the probe step or refactored to surface the server-dead vs alive-but-empty distinction (`list-sessions` exit-1-with-"no server" vs exit-0-empty-output). Net tmux round-trips stay flat at **4**: `SetExitEmptyOff`, the unified `list-sessions` probe+first-session, `createAnchor`, `setAnchorKeepalive`.

### Behavior after the fix

- **Kill flow:** `kill-server` runs → server dies → reconnect FSM re-dials → `SetExitEmptyOff` fails non-fatally (server dead) → `resolveBootstrap` probes, finds no server, **declines** → `productionDial` returns error → FSM backs off (250ms→5s) and does **not** recreate the server. The fsnotify `CREATE`-driven re-open also cannot fire because nothing recreates the socket. The server stays dead. ✅
- **First connect to a freshly-created live server:** server already listening (see Verification), probe succeeds, anchor created, control mode attaches. Unchanged. ✅
- **Alive-but-zero-session server (exit-empty floor):** `list-sessions` returns exit 0 with empty output, probe succeeds, anchor still created — Constitution VI floor preserved. ✅

## Affected Memory

- `run-kit/tmux-sessions.md`: (modify) The `tmuxctl` / `_rk-ctl` control-anchor behavior is documented in this domain file. Add the invariant that `createAnchor` only joins an already-running server (never starts one), and that this is what makes UI-initiated server kill actually stick.

## Impact

- **`internal/tmuxctl/client.go`** — primary. `resolveBootstrap` restructure (probe-first ordering); `createAnchor` guarded to decline on a dead server; `firstSessionName` possibly merged into / refactored alongside the probe step to expose the dead-vs-empty distinction.
- **`internal/tmux/tmux.go`** — reuse `probeServerAlive` directly if callable from the `tmuxctl` package, or mirror its `list-sessions` + `exec.CommandContext` + 2s-timeout pattern locally in `tmuxctl` if a cross-package call is undesirable. (Decision deferred to apply — see Assumptions.)
- **Tests** — `internal/tmuxctl/client_test.go` and/or `internal/tmuxctl/integration_test.go`: new coverage for the three scenarios below. Run via `just test-backend` (never `go test` directly, per project convention).
- **No API/frontend changes.** The kill HTTP handler (`api/servers.go`) is untouched in this change — correctness comes entirely from the anchor guard.

## Open Questions

- Should `tmuxctl` call `tmux.probeServerAlive` directly (cross-package, but DRY), or mirror the `list-sessions` probe pattern locally within `tmuxctl` to keep the package self-contained? (Resolved as Tentative — see Assumptions; finalized at apply.)
- Should `firstSessionName` be retired in favor of a single combined `probe + first-session` helper, or kept and called only after the probe? (Implementation detail — apply-time decision.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Root cause is `createAnchor`'s `tmux new-session` implicitly starting a dead server on reconnect | Code-traced end-to-end (productionDial → resolveBootstrap → createAnchor; reconnect FSM at client.go:205-223). `new-session` create-if-absent is documented tmux behavior. | S:95 R:70 A:95 D:90 |
| 2 | Certain | Scope is guard-only; defer Client-close, foreign-socket ownership boundary, and tombstone coordination to separate changes | User explicitly chose "Guard only (tightest)". Once the guard lands, the FSM backs off instead of resurrecting, so tombstone/de-adopt is unnecessary for correctness. | S:95 R:60 A:80 D:95 |
| 3 | Certain | The probe must be the side-effect-free `tmux -L <socket> list-sessions` (exit 0 = alive incl. empty; exit 1 = dead) | Matches existing `probeServerAlive` (tmux.go:1359), already used by ListServers + reaper. `list-sessions` never starts a server, unlike `new-session`/`has-session -s`. | S:90 R:75 A:95 D:90 |
| 4 | Certain | No first-dial regression: the guard rejects only the genuinely-dead reconnect case, never a fresh-but-live server | `tmux new-session -d` is synchronous (CreateSession returns only after the server is listening); the only first-dial triggers are the startup scan and fsnotify CREATE, both of which follow socket-file existence i.e. server readiness. Integration test integration_test.go:32-98 creates then immediately Open()s a server and is not flaky. | S:90 R:65 A:90 D:85 |
| 5 | Certain | Constitution VI (sessions survive) is preserved: the alive-but-zero-session exit-empty floor still gets its anchor | `list-sessions` returns exit 0 for an alive server with zero sessions, so the probe passes and `createAnchor` still runs in that case. Only a truly dead server (exit 1) is declined. | S:90 R:70 A:90 D:90 |
| 6 | Confident | Fold the probe into the existing `firstSessionName` `list-sessions` call so net tmux round-trips stay flat at 4 | resolveBootstrap already runs list-sessions via firstSessionName after createAnchor; reordering it to run first lets one call both detect dead-server and pick the first session. Verified current round-trip count. | S:80 R:80 A:85 D:75 |
| 7 | Certain | `_rk-ctl` / control-mode must NOT be removed — it is load-bearing for live tab-switch UI updates | User confirmed; commit e3ae8b2 introduced it to dissolve the URL-vs-window_active two-master race. Removing it regresses tab-switch latency from <1ms to the 12s safety-net poll. | S:90 R:50 A:90 D:90 |
| 8 | Tentative | `tmuxctl` will reuse `tmux.probeServerAlive` directly rather than re-implementing the probe locally | DRY favors reuse and `probeServerAlive` is package-exported-adjacent, but it is currently lowercase/unexported; apply may need to export it or mirror the pattern. Low blast radius — either is mechanically trivial and easily reversed. | S:55 R:85 A:70 D:60 |
| 9 | Certain | Tests cover three scenarios: (a) reconnect to dead server declines without resurrecting, (b) first-connect to fresh live server still succeeds, (c) alive-but-empty server still gets the anchor | Directly maps to the three behavioral guarantees; code-quality.md requires tests for changed behavior; existing integration_test.go establishes the harness pattern. | S:85 R:80 A:90 D:85 |

9 assumptions (7 certain, 1 confident, 1 tentative, 0 unresolved).
