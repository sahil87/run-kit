# Intake: Daemon Stop — Copy-Mode Read-Only Fix

**Change**: 260715-3zwr-daemon-stop-copy-mode-readonly
**Created**: 2026-07-15

## Origin

Promptless dispatch (`/fab-proceed`-style create-intake subagent, `{questioning-mode} = promptless-defer`) from a synthesized description of a live diagnostic conversation held 2026-07-15 on the operator box. The conversation diagnosed the failure, confirmed the root cause by exact live reproduction, chose the fix, and rejected one alternative — this intake transfers those decisions across the pipeline boundary.

> `rk daemon stop` fails with `Error: stopping daemon: sending C-c to daemon: exit status 1: client is read-only`, leaving the daemon running. Root cause: the daemon pane was left in tmux copy-mode; `send-keys C-c` to a pane in a mode dispatches the mode key-table binding (`copy-mode C-c` → `send-keys -X cancel`) through a resolved client — the only attached client is run-kit's own read-only SSE control bridge, so tmux rejects the dispatch. Compounding bug: `Stop()` early-returns on the send-keys failure, so the grace-timer → `kill-session` fallback never runs. Fix: pre-cancel any pane mode with `copy-mode -q` before the C-c send, and fall through to the grace/kill path when the send fails.

## Why

**The pain point.** `rk daemon stop` (and everything layered on it — `rk daemon restart`, `rk update`'s `RestartWithBinary`, `POST /api/restart`) is permanently wedged whenever the daemon pane (`=rk-daemon:=serve`) is in tmux copy-mode. The failure was observed on the operator box (homebrew run-kit 3.4.5 daemon, tmux 3.6a) and reproduced exactly during diagnosis:

1. The daemon pane is left in copy-mode (e.g. by someone scrolling the daemon log in an attached view).
2. `send-keys C-c` to a pane in a mode does NOT inject the key — tmux looks the key up in the mode's key table (`copy-mode C-c` is bound to `send-keys -X cancel`, a non-read-only command) and dispatches that binding through a resolved target client.
3. The only client attached to the `rk-daemon` session is run-kit's own SSE control bridge, which attaches read-only **by design** (`tmux -CC attach-session -t =<bootstrap> -r` — `app/backend/internal/tmuxctl/client.go:356-386`, `productionDial`). tmux's `key_bindings_dispatch` rejects the dispatch with exactly `client is read-only`.

**Eliminated causes** (from the live diagnosis — do not re-investigate): NOT a socket-permission or tmux server-access/ACL problem (`server-access -l` shows the owner with W; one-shot write commands like `set-option` succeed). A zero-key `send-keys -l ''` also succeeds — the failure is per-key mode-table dispatch only.

**The consequence of not fixing.** `Stop()` (`app/backend/internal/daemon/daemon.go:348-402`) wraps the send-keys error and returns at line 361-363, so its grace-timer → `kill-session` fallback (lines 368-401) never runs — even though that force-kill would have stopped the daemon. The operator is stuck: graceful stop is impossible, and the tool that owns the fallback refuses to use it. Manual recovery (`tmux -L rk-daemon copy-mode -q ...` or `kill-session`) is required. This also silently breaks unattended paths: `rk update` auto-restart and the web UI's Restart Daemon action.

**Why this approach.** Pre-cancelling the mode removes the root cause (the key is then injected normally and SIGINT reaches the serve process — graceful shutdown preserved), and the fall-through removes the compounding bug (any *future* graceful-delivery failure degrades to force-kill instead of wedging). The alternative — replacing the key-based C-c with a direct SIGINT to `#{pane_pid}` (which IS the serve process, since `new-session` runs the binary directly) — is immune to all key-table dispatch but is a larger behavioral change to a load-bearing shutdown path; the conversation kept send-keys as primary and recorded SIGINT as the non-selected alternative.

## What Changes

All changes are in `app/backend/internal/daemon/daemon.go` `Stop()` plus its tests (`daemon_test.go`). No CLI-surface, API, or frontend changes.

### 1. `Stop()`: pre-cancel pane mode before sending C-c

Before the existing C-c send (currently `daemon.go:358-363`), run `copy-mode -q` against the same resolved target `Stop()` already computes, via the existing `runTmux` helper under its own fresh `cmdTimeout` context — matching `Stop()`'s established per-command-context pattern (each one-shot tmux command gets a fresh `cmdTimeout`-bounded context, never the grace deadline):

```go
// Pre-cancel any pane mode (e.g. copy-mode). A pane in a mode consumes C-c
// via the mode key table, and dispatch through the read-only -CC bridge
// client fails with "client is read-only" — the key never reaches the
// process. copy-mode -q is idempotent (exit 0 when not in a mode).
modeCtx, modeCancel := context.WithTimeout(context.Background(), cmdTimeout)
defer modeCancel()
if err := runTmux(modeCtx, "copy-mode", "-q", "-t", targetFor(session)); err != nil {
    slog.Debug("daemon stop: copy-mode pre-cancel failed", "err", err)
}
```

Key points, all confirmed in the diagnosis:

- **Idempotent**: verified on tmux 3.6a that `copy-mode -q` exits 0 when the pane is not in a mode — safe to run unconditionally on every `Stop()`.
- **Target**: MUST use `targetFor(session)` with the session name `Stop()` resolved via `runningSessionCtx` (not the `target()` constant form), so the legacy-session path (`LegacySessionName = "rk"`) keeps working.
- **Best-effort**: a pre-cancel failure is logged and does NOT abort `Stop()` — the send-keys attempt and (with change 2) the kill fallback still follow (Assumptions row 4).

### 2. `Stop()`: no early-return on send-keys failure — fall through to grace/kill

Replace the early return at `daemon.go:361-363`:

```go
// current (bug):
if err := runTmux(sendCtx, "send-keys", "-t", targetFor(session), "C-c"); err != nil {
    return fmt.Errorf("sending C-c to daemon: %w", err)
}
```

with a logged fall-through:

```go
// fixed: graceful-delivery failure degrades to the force-kill fallback
// instead of wedging Stop().
if err := runTmux(sendCtx, "send-keys", "-t", targetFor(session), "C-c"); err != nil {
    slog.Warn("daemon stop: C-c send failed; relying on grace-timeout kill fallback", "err", err)
}
```

The existing grace-timer loop (`stopGracePeriod` 12s timer, `stopPollInterval` 200ms polls, then `kill-session -t =<session>` with the vanished-session success re-probes) is unchanged and now reachable on send failure. The full grace period is still waited before the kill even when the send failed (no shortened-grace special case — keep the loop untouched).

`Restart()` / `RestartWithBinary()` need no changes — they call `Stop()`.

### 3. Tests (required by code-quality: new/changed behavior gets Go tests)

`internal/daemon/daemon_test.go` already exposes the seams (`serverSocket` override, `stopGracePeriod`/`stopPollInterval` shrink — see the existing helpers at daemon_test.go:50-63 and integration tests `TestStartAndStop`, `TestStop_TimeoutThenSessionVanished`, `TestStop_TimeoutStuckSessionIsKilled` that run real tmux on an isolated socket). Add, following those patterns:

- **Copy-mode regression test** (the shipped bug): start a session on an isolated test socket, drive its pane into copy-mode (`tmux -L <sock> copy-mode -t <target>`), call `Stop()`, assert nil error and session gone. This is the primary regression test for the pre-cancel.
- **Send-failure fall-through test**: assert `Stop()` no longer returns the send error and instead reaches the kill fallback. Reproducing the exact read-only-client dispatch in-test is heavyweight (needs an attached `-CC ... -r` client); an acceptable proxy is any deterministic send-keys failure or a seam-level test — exact mechanism is an apply-time decision (Assumptions row 7).

### Verification recipe (from the live diagnosis)

Manual end-to-end check the apply/review stages can reuse (substitute the isolated test socket for `rk-daemon` when not on the operator box):

```sh
tmux -L rk-daemon copy-mode -t '=rk-daemon:=serve'        # put pane in copy-mode
tmux -L rk-daemon send-keys -t '=rk-daemon:=serve' C-c    # reproduces: "client is read-only"
tmux -L rk-daemon copy-mode -q -t '=rk-daemon:=serve'     # exits the mode (idempotent, exit 0)
```

With the fix, `rk daemon stop` MUST succeed from the in-copy-mode state (gracefully — C-c reaches the serve process after the pre-cancel), and MUST also eventually succeed (via kill fallback) if the C-c send fails for any other reason.

### Constraints

- Constitution §I / Process Execution: all tmux interaction via `exec.CommandContext` with argument slices + timeouts — the existing `runTmux` helper already complies; the pre-cancel goes through it.
- Constitution Self-Improvement Safety: the restart mechanism remains "send C-c → wait graceful → fresh start"; this change strengthens (not replaces) that contract by making C-c delivery reliable and the documented kill fallback actually reachable.

## Affected Memory

- `run-kit/architecture`: (modify) § Daemon Lifecycle — `Stop()`'s sequence gains the copy-mode pre-cancel step and the send-keys-failure fall-through (C-c → grace → kill is now reachable even when graceful delivery fails); note the read-only -CC bridge-client interaction as the root cause.

## Impact

- `app/backend/internal/daemon/daemon.go` — `Stop()` only (two localized edits + one new `slog` import usage; `slog` is already imported).
- `app/backend/internal/daemon/daemon_test.go` — new integration tests using existing seams.
- Consumers fixed transitively (no changes needed): `rk daemon stop [--force]`, `rk daemon restart`, `rk update` (`RestartWithBinary`), `POST /api/restart`.
- No API, frontend, or docs/spec surface changes; memory update at hydrate per Affected Memory.

## Open Questions

None — the design was fully resolved in the live diagnostic conversation (root cause confirmed by reproduction; fix and rejected alternative both explicit).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fix is a `copy-mode -q -t targetFor(session)` pre-cancel via the existing `runTmux` helper under a fresh `cmdTimeout` context, before the C-c send | Discussed — chosen as primary in the live conversation; `copy-mode -q` idempotency verified on tmux 3.6a; matches `Stop()`'s established per-command-context pattern | S:90 R:85 A:90 D:90 |
| 2 | Certain | On send-keys failure, do NOT early-return — fall through to the existing grace-timer/kill-session path | Discussed — explicitly chosen; the kill fallback is proven working (`TestStop_TimeoutStuckSessionIsKilled`) and was only unreachable | S:90 R:85 A:90 D:90 |
| 3 | Certain | Direct-SIGINT-to-`pane_pid` alternative is rejected; key-based C-c stays the primary graceful path | Discussed — conversation kept send-keys as primary and listed SIGINT as the non-selected alternative (larger behavioral change to a load-bearing shutdown path) | S:85 R:80 A:85 D:85 |
| 4 | Confident | `copy-mode -q` failure is best-effort: log at `slog.Debug` and proceed to send-keys, never abort `Stop()` | Not explicitly stated in conversation, but forced by the fall-through principle (row 2): any pre-cancel failure is recovered by the now-reachable kill fallback; aborting would reintroduce the wedge | S:60 R:80 A:80 D:70 |
| 5 | Confident | Send-keys failure is logged at `slog.Warn` with the error when falling through | Codebase convention — `Stop()` already `slog.Warn`s its teardown; a silent swallow would hide graceful-delivery regressions | S:55 R:85 A:80 D:75 |
| 6 | Confident | Full `stopGracePeriod` (12s) is still waited before kill even when the C-c send failed — no shortened-grace special case | Conversation said "fall through to the grace-timer/kill-session path"; simplest reading keeps the loop untouched, and a shortened grace is an unrequested optimization | S:65 R:85 A:75 D:70 |
| 7 | Confident | Tests follow existing `daemon_test.go` integration patterns (isolated socket + shrunken grace/poll seams): a copy-mode regression test is required; the send-failure fall-through test may use a proxy failure mechanism rather than a real read-only `-CC` client | Seams exist and are named in the description; exact fall-through-test mechanism is an apply-time decide-and-record | S:60 R:80 A:80 D:65 |
| 8 | Certain | Pre-cancel targets the resolved session via `targetFor(session)` so the legacy `rk`-named daemon path keeps working | Stated explicitly in the description ("must target the same resolved session Stop() computes") | S:90 R:85 A:90 D:90 |
| 9 | Certain | Scope is `internal/daemon/daemon.go` `Stop()` + `daemon_test.go` only; no CLI/API/frontend surface changes | Stated verbatim in the description; `Restart`/`RestartWithBinary`/`--force` paths all route through `Stop()` unchanged | S:85 R:80 A:85 D:85 |

9 assumptions (5 certain, 4 confident, 0 tentative, 0 unresolved).
