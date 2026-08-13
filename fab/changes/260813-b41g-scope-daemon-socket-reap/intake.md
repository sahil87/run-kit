# Intake: Scope the Daemon Socket Reap to the Daemon Session

**Change**: 260813-b41g-scope-daemon-socket-reap
**Created**: 2026-08-13

## Origin

Promptless dispatch via `/fab-proceed` from a live debugging conversation (verified on the dogfood host 2026-08-13). Synthesized description:

> When run-kit auto-updates, code-server does not come back, and the update job itself is killed mid-run. The update runs as a managed window in the `rk-jobs` sibling session on the rk-daemon tmux socket (`daemon.RunJob`): pane → `shll update …` → `rk update --skip-brew-update` → brew upgrade → `daemon.RestartWithBinary` → `Stop()` (kills only the exact-match `=rk-daemon` session — correct, siblings survive) → `StartWithBinary()` → `reapStaleDaemonSocket()` unconditionally runs `tmux -L rk-daemon kill-server` — killing the ENTIRE rk-daemon tmux server: `rk-jobs` (the updater's own pane — the updater SIGHUPs itself mid-run), `rk-code-server`, and `rk-remotes` (SSH tunnels).
>
> Decision (user-selected — "option 1: scope the reap down"): replace the `kill-server` in `reapStaleDaemonSocket` with an exact-match `kill-session -t "=rk-daemon"` (consider the legacy `=rk` session name too), keeping the same best-effort posture.

Key decisions from the conversation: option 1 (scoped kill-session) chosen over option 2 (probe `list-sessions` and only `kill-server` at zero live sessions — more machinery for the same coverage) and over deleting `reapStaleDaemonSocket` entirely (considered; user explicitly chose the scoped kill-session).

## Why

**Problem.** Every daemon restart that goes through `Start()`/`StartWithBinary()` — including every auto-update — destroys all sibling sessions on the `rk-daemon` tmux socket. `reapStaleDaemonSocket` (`app/backend/internal/daemon/daemon.go:205-219`) unconditionally runs `tmux -L rk-daemon kill-server`. It was added in PR #197 ("port-based liveness, stale-socket reap") when the daemon session was the socket's **only** tenant, to clean an orphaned socket left by a previously-crashed inner serve. Sibling sessions arrived later: `rk-code-server` (260811-a2bo), `rk-jobs` (260812-z1ya / PR #568), `rk-remotes`. The reap's "orphaned socket" rationale is now stale, and its only live-fire case today is a server alive with sibling sessions but no `rk-daemon` session — exactly the restart-via-job path — so the unconditional `kill-server` is pure collateral damage.

**Consequences if unfixed** (all verified on the dogfood host today):
- The auto-update job SIGHUPs **itself** mid-run: `~/.rk/update.log`'s 2026-08-13 09:23:49 run truncates abruptly at `WARN tmux teardown audit=kill op=kill-server … callers=daemon.reapStaleDaemonSocket` at shll roster step [5/7]; steps [6/7] and [7/7] never ran, shll's summary never printed. 26 such teardown lines exist in update.log.
- **code-server is absent after every auto-update.** The daemon comes back only because `startSession`'s `new-session` wins a SIGHUP-delivery race inside the dying updater process; `ensureCodeServer()` runs immediately after in that same process and loses the race. After the restart, `tmux -L rk-daemon list-sessions` shows only `rk-daemon` + `_rk-ctl` (both created 09:23:49) — `rk-code-server` / `rk-jobs` / `rk-remotes` are gone.
- `rk-remotes` SSH tunnels are torn down on every restart.

**Why this approach.** Scoping the kill to the exact daemon session removes the collateral damage while keeping the belt-and-braces cleanup: against a genuinely dead socket, the kill errors harmlessly ("no server running" / "can't find session", suppressed to Debug). The load-bearing part of the change is **removing the `kill-server`**, not what replaces it — `Start()`/`StartWithBinary()` invoke the reap only after `IsRunning()` returned false (neither `=rk-daemon` nor legacy `=rk` exists), so the scoped kill-session is largely a race-window safety net between the `IsRunning` probe and `startSession`.

## What Changes

### 1. `reapStaleDaemonSocket` — exact-match `kill-session` instead of `kill-server`

File: `app/backend/internal/daemon/daemon.go` (currently lines 205-219).

Current body:

```go
func reapStaleDaemonSocket(ctx context.Context) {
	slog.Warn("tmux teardown", "audit", "kill", "op", "kill-server", "server", serverSocket, "target", serverSocket, "callers", "daemon.reapStaleDaemonSocket")
	if err := runTmux(ctx, "kill-server"); err != nil {
		slog.Debug("daemon socket reap finished with error", "err", err)
	}
}
```

New behavior — kill only the daemon's own session(s), exact-match, covering both the current and legacy names (mirroring `runningSessionCtx`'s dual probe):

```go
// sketch — apply may restructure, behavior is the contract
func reapStaleDaemonSocket(ctx context.Context) {
	for _, session := range []string{SessionName, LegacySessionName} {
		slog.Warn("tmux teardown", "audit", "kill", "op", "kill-session", "server", serverSocket, "target", session, "callers", "daemon.reapStaleDaemonSocket")
		if err := runTmux(ctx, "kill-session", "-t", "="+session); err != nil {
			slog.Debug("daemon session reap finished with error", "session", session, "err", err)
		}
	}
}
```

Contract points:
- **Same best-effort posture as today**: errors ("can't find session", "no server running") suppressed to `slog.Debug`; never blocks startup. Call sites in `Start()` and `StartWithBinary()` are unchanged (same placement, same `cmdTimeout` context).
- **Argv-slice `runTmux` calls** (Constitution I) — already the pattern; the `=` prefix forces exact-match lookup so `rk-jobs`/`rk-code-server`/`rk-remotes`/`_rk-ctl` can never be prefix-matched.
- Result: sibling sessions untouched; the update job survives to finish its roster; `ensureCodeServer` runs to completion so code-server returns after auto-updates; rk-remotes tunnels stop being killed on every restart.

### 2. Doc comment rewrite

`reapStaleDaemonSocket`'s doc comment says it cleans "an orphaned socket left behind by a previously-crashed inner serve" — stale since siblings arrived. Rewrite to state: (a) it is a race-window safety net (runs only after `IsRunning()` returned false), (b) it kills only the exact-match daemon session(s), never the server, because the socket hosts sibling sessions (`rk-jobs`, `rk-code-server`, `rk-remotes`), and (c) the historical `kill-server` behavior destroyed those siblings on every restart (the 260813 auto-update bug).

### 3. Audit line follows the op

The teardown audit WARN (PR #206 observability) must reflect the new op: `op=kill-session`, `target=<session>`, `callers=daemon.reapStaleDaemonSocket` — the same shape as `daemon.Stop(timeout)`'s existing kill-session audit at `daemon.go:419`.

**Verified — no machine consumer of the audit line.** `internal/snapshot`'s `.died-{ts}` tombstone "audited kill" marking is driven by the **in-process** `Snapshotter.NoteAuditedKill` call (`snapshotter.go:252-258`), wired only from the API server-kill path (`cmd/rk/serve.go:178` → `api/tmuxctl_bridge.go`); nothing parses `tmux teardown` slog lines. The op change is human/log-facing only, and `docs/memory/run-kit/layout-snapshots.md` needs no update.

### 4. Tests — prove siblings survive the reap

`internal/daemon` has the package seams for this: the `serverSocket` var (overridable in tests, `daemon_test.go:53-55`) and existing scratch-socket integration tests (including `TestReapStaleDaemonSocket_NoOp` at `daemon_test.go:679`). Extend/update:
- Sibling-survival test: on a scratch socket, create sibling sessions (e.g. names matching `rk-jobs` / `rk-code-server` and a would-be prefix-collision like `rk-daemon-x`), run `Start()` (or `reapStaleDaemonSocket` directly), assert the siblings still exist and the daemon session came up.
- Legacy-name test: a stale `=rk` session is reaped.
- Keep/adjust `TestReapStaleDaemonSocket_NoOp` for the dead-socket happy path (errors suppressed, no failure).

### Non-goals

- `Stop()` is unchanged — it already kills only the exact-match session and is correct.
- No `list-sessions` probing (rejected option 2), no deletion of `reapStaleDaemonSocket` (rejected), no change to `startSession`/`ensureCodeServer` ordering, no change to `daemon.RunJob`/jobs.go.

## Affected Memory

- `run-kit/architecture`: (modify) Daemon Lifecycle section — the startup reap is now session-scoped (`kill-session -t "=rk-daemon"` / legacy `=rk`, never `kill-server`); sibling sessions (`rk-jobs`, `rk-code-server`, `rk-remotes`) survive daemon restarts, so update jobs run to completion and code-server persists across auto-updates.

(`run-kit/layout-snapshots` checked and unaffected — the tombstone audited-kill seam is the in-process `NoteAuditedKill` wiring, not the audit log lines.)

## Impact

- **Code**: `app/backend/internal/daemon/daemon.go` (`reapStaleDaemonSocket` + doc comment), `app/backend/internal/daemon/daemon_test.go` (extend scratch-socket tests). No API, frontend, or CLI surface changes.
- **Behavior**: daemon restarts (`rk daemon start`/`restart`, `rk update`, POST /api/restart via `RestartWithBinary`) stop destroying sibling sessions on the rk-daemon socket. Cold-start behavior is unchanged in effect (kill against nothing errors harmlessly, Debug-suppressed).
- **Risk**: low. The only scenario where `kill-server` did something `kill-session` won't is a socket with *zero* daemon sessions but live sibling sessions — exactly the case we must NOT kill. A truly orphaned socket with no sessions at all is already cleaned by tmux itself (a tmux server with no sessions exits, barring exit-empty overrides on the daemon socket's own config).
- **Verification gates**: `cd app/backend && go test ./internal/daemon/...`, then the project gates (`just test`, `just build`).

## Open Questions

None — all decision points were resolved in the originating conversation or verified against the codebase during intake.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Replace `kill-server` with exact-match `kill-session -t "=rk-daemon"` in `reapStaleDaemonSocket`; keep the function (no deletion), no list-sessions probe | Discussed — user explicitly chose option 1 over option 2 and over deleting the function | S:95 R:70 A:95 D:95 |
| 2 | Confident | Also reap the legacy `=rk` session (`daemon.LegacySessionName`), mirroring `runningSessionCtx`'s dual probe | Conversation said "consider the legacy name too"; dual-name kill is harmless (exact-match, Debug-suppressed) and consistent with `IsRunning`/`Stop` legacy handling | S:65 R:85 A:85 D:70 |
| 3 | Certain | Keep the best-effort posture: errors suppressed to `slog.Debug`, never block startup; call sites and `cmdTimeout` context unchanged | Stated verbatim in the decision; matches current code shape | S:95 R:80 A:90 D:90 |
| 4 | Certain | Audit WARN becomes `op=kill-session` with `target=<session>`, same shape as `daemon.Stop(timeout)`'s existing kill-session audit | Required by the description; existing in-repo precedent at daemon.go:419 | S:90 R:85 A:95 D:90 |
| 5 | Certain | Snapshot tombstone seam unaffected — no `internal/snapshot` or layout-snapshots memory change | Verified during intake: `NoteAuditedKill` is in-process, wired only from the API kill path; no code parses `tmux teardown` log lines | S:80 R:90 A:95 D:90 |
| 6 | Confident | Keep the pre-kill audit WARN unconditional (fires even on cold start against a dead socket), per the existing audit convention | Preserves today's observability posture; gating it on liveness would be new machinery the decision didn't ask for | S:55 R:90 A:75 D:65 |
| 7 | Certain | Rewrite `reapStaleDaemonSocket`'s doc comment (stale "orphaned socket" rationale → race-window safety net on a multi-tenant socket) | Explicitly required by the description | S:90 R:95 A:95 D:95 |
| 8 | Certain | Tests extend the existing `internal/daemon` scratch-socket pattern (`serverSocket` seam) to prove sibling survival + legacy-name reap | Description names the seams; code-quality.md mandates tests for bug fixes; `TestReapStaleDaemonSocket_NoOp` already exists to build on | S:80 R:85 A:90 D:80 |

8 assumptions (6 certain, 2 confident, 0 tentative, 0 unresolved).
