# Intake: Update Runs in a Daemon-Managed tmux Window

**Change**: 260812-z1ya-update-daemon-tmux-window
**Created**: 2026-08-12

## Origin

Conversational (`/fab-discuss` → `/fab-new`). The user's raw framing:

> Today whenever we click on the update button from the top right menu or press Command K and check for updates, the updates happen in some sort of an exec call made by Go. The problem here is this is completely opaque for the user. Here's a suggestion: why not use the rk-daemon tmux server that we already have? For whatever commands that we want to exec, we just spawn a new tmux window there and we run it there. The mechanism already exists. Just instead of controlling the lifecycle of a process, the Go server now starts controlling the lifecycle of a tmux window. The advantage here is in case the update gets stuck, the user can actually go there and see where it is stuck.

Key decisions reached in the discussion (all explicit user choices):

1. **No fallback path**: if the rk daemon (tmux) isn't running, the update endpoint refuses (409). The daemon is the de-facto way of running run-kit; the detached-spawn path is removed, not kept as a fork.
2. **Standardize via a subcommand**, scoped to **managed windows on the daemon server** — NOT a generic "send a command to any pane on any server" surface (that would reimplement tmux addressing, where the historical footguns live).
3. **`remain-on-exit failed`** keeps the pane only on non-zero exit: success cleans up, failure evidence stays visible.
4. **Second click while in-flight** returns the window target so the UI can jump to it (navigation, not a 409 footgun).
5. **Stale failed windows** are reaped by the next run of the same job; the user can also kill them from the dashboard. No timer, no new reaper.
6. **Completion signaling is unchanged** — the 2-minute post-remediation recheck and the daemon-restart side effect stay; only the spawn *mechanism* changes.
7. The same seam covers **both consumers**: the update spawn (`update.log`) and the daemon-restart spawn (`restart.log`) — both currently ride `spawnSelfFn`.

## Why

**Problem.** `POST /api/update` (app/backend/api/update.go) and `POST /api/restart` (app/backend/api/restart.go) spawn a detached `Setsid` child (`shll update <tools…>`, `rk update`, or `rk daemon restart`) with stdout/stderr appended to `~/.rk/update.log` / `~/.rk/restart.log`. This is fire-and-forget: no exit-code observation, no in-flight visibility, no way to answer "is an update running right now?" (the handler comment explicitly documents that a second click just spawns again). When a brew upgrade hangs, the only diagnostic is a log file the user must know exists and must SSH in to read.

**Consequence of not fixing.** The one-click update stays a black box. A stuck update looks identical to a completed one until the 2-minute recheck (or the 6h ticker) happens to flip the chip, and diagnosing it requires shell access — defeating the point of a web dashboard whose whole purpose is remote visibility into terminal work.

**Why this approach.** Running the job in a tmux window on the existing `rk-daemon` socket converts opacity into the product's own core competency:

- **Watchable in the dashboard for free.** `ListServers` (internal/tmux/tmux.go:1995) deliberately surfaces *every* live tmux server — the "surface every server" contract — so the job window appears on the existing terminal route with zero new UI plumbing. The user watches brew scroll by in the browser.
- **Survival semantics come for free.** The current `Setsid` dance exists only because `rk update`/`rk daemon restart` kill the serving process mid-run. A tmux window survives the daemon restart by Constitution VI (the tmux layer is independent of the Go server), so the detachment hack becomes unnecessary rather than replicated.
- **In-flight state becomes derivable.** Window existence on the daemon socket answers "is an update running?" from tmux at request time — pure Constitution II. Today that question is unanswerable.
- **The pattern is established, twice.** The daemon already manages a code-server *sibling session* on the rk-daemon socket (internal/daemon/codeserver.go, PR #565) and SSH tunnels as windows in the `rk-remotes` sibling session (internal/remote). This change adds a third instance of the same shape, not a new invention.

**Alternatives rejected:**

- *Keep detached spawn, stream update.log to the UI* — builds a bespoke log-viewer channel when the product already has a terminal relay; still can't answer "is it running"; still no interactivity when brew prompts.
- *Generic `rk` pane/window exec subcommand (any server, any pane)* — reimplements tmux's addressing surface where the collision footguns live (session/window target hijacking, `$TMUX` routing); rejected in discussion in favor of daemon-scoped managed windows.
- *Window inside the `rk-daemon` session itself* — `daemon.Stop()` kills that session (kill-session fallback on the exact-match `=rk-daemon` target); the update triggers a daemon restart mid-run, so the job would kill itself. Sibling session on the same socket is the codeserver-documented answer (see codeserver.go's CodeServerSessionName comment).

## What Changes

### 1. New internal primitive + CLI surface: `rk daemon run`

A daemon-scoped "run this argv in a managed window" primitive in `internal/daemon`, wrapped by a new `rk daemon run` subcommand (new file `cmd/rk/daemon_run.go`, registered beside start/stop/restart/status in cmd/rk/daemon.go).

```
rk daemon run --window <name> -- <cmd> [args…]
```

Semantics (the safety rails are the point — this encodes the hard-won tmux lessons):

- **Gate**: requires the daemon to be running (`daemon.IsRunning()`); otherwise error — no server birth, per decision 1. (Any tmux command on a dead socket would silently birth a server; the gate prevents that class.)
- **Session**: ensure a `rk-jobs` sibling session exists on the `rk-daemon` socket (`new-session -d -s rk-jobs` when absent — mirroring `rk-remotes`/`rk-code-server`; survives `daemon.Stop()` because Stop targets `=rk-daemon` exactly).
- **Window dedup** (exact-match `=rk-jobs:=<name>` targets throughout):
  - window exists with a **live** pane → the job is in-flight: print the existing target and exit with a distinguishable outcome (no second spawn),
  - window exists with a **dead** pane (remained after a failure) → kill it, then spawn fresh (decision 5's reap-on-rerun),
  - window absent → spawn fresh.
- **Spawn**: `new-window -d -t =rk-jobs: -n <name> -P -F '#{window_id}' <argv…>` via the existing `runTmux` seam (`exec.CommandContext` + argv + timeout, Constitution I). tmux joins the trailing argv words with spaces into `sh -c` — every component is rk-controlled or validated (see Security below), same posture as the codeserver spawn.
- **Post-spawn window options** (best-effort, non-fatal if the tmux version predates them):
  - `set-option -w -t <target> remain-on-exit failed` (tmux ≥ 3.2) — pane persists only on non-zero exit,
  - `pipe-pane -o -t <target> 'cat >> ~/.rk/<name>.log'` — the durable log survives the window (continuity with today's `update.log`/`restart.log`).
- **Output**: the spawned (or found) window's identity — server socket, session, window name, `@N` window id — so callers (API handlers, scripts) can build a dashboard link. Machine-readable output shape decided at plan time alongside toolkit-standards conformance (help-dump + Principle 9 checks apply to the new surface).

The API handlers call the shared internal function directly (same process — no self-exec through the CLI); the subcommand is the standardized surface for scripts, other toolkit tools, and debugging.

### 2. `POST /api/update` — spawn into the managed window

`handleUpdate` / `handleShllUpdate` / `handleSelfUpdate` (app/backend/api/update.go) change their spawn mechanism only; every existing gate stays:

- **New daemon gate**: daemon not running → `409 {"error": "updates require the rk daemon — start it with rk serve -d"}` (exact copy at plan time). Replaces the need for detachment entirely.
- Existing gates unchanged: shll-present scoped path with `ValidateToolName`-filtered argv; non-force empty-match 409; shll-absent brew-409 + qualify-409; force semantics.
- **Spawn**: instead of `spawnSelfFn`, run the job via the internal primitive — window name `update`, argv `shll update <tools…>` (or full-roster `shll update`, or self `rk update` on the shll-absent path).
- **Response carries the watch target**. Fresh spawn: `202 {"status":"updating", "watch":{"server":"rk-daemon","session":"rk-jobs","window":"update","window_id":"@N"}}`. In-flight (live pane already there): `200 {"status":"already-running", "watch":{…}}` — decision 4. Exact JSON shape finalized at plan time; the `{}` -posting existing client must keep working (it ignores unknown keys).
- The 2-minute `RecheckAfter` post-remediation recheck stays verbatim (decision 6).

### 3. `POST /api/restart` — same seam, second consumer

`handleRestart` (app/backend/api/restart.go) keeps its dev-build 409, then runs `rk daemon restart` in window `restart` via the same primitive, with the same watch-target response shape. The restart job's window survives the daemon session bounce because it lives in `rk-jobs` (sibling-session survival is the load-bearing property here).

### 4. Detached-spawn path removal

`spawnSelfFn`, `openRkLog`, and the `Setsid` detachment machinery in update.go are deleted with both consumers migrated (decision 1: no fallback fork). `updateLogRelPath`/`restartLogRelPath` continuity is preserved by the primitive's `pipe-pane` tee to the same `~/.rk/<name>.log` paths. Tests currently seaming through `spawnSelfFn` are rewritten against the new primitive's seam.

### 5. Frontend — minimal jump affordance

The update chip / palette actions (check for updates, update, restart) consume the `watch` target:

- on `202` fresh spawn: the existing "updating…" state additionally links to the job window's terminal route so the user can watch,
- on `200 already-running`: navigate straight to the window (decision 4 — the double-click becomes navigation).

Scope is deliberately minimal: no new components, no SSE additions — the terminal route and relay already render the window. Exact placement (chip click-through vs toast link) decided at plan time within existing ui-patterns.

### Security (Constitution I)

- All tmux interaction rides the existing `runTmux`/`internal/tmux` argv seams with `exec.CommandContext` + timeouts — no shell strings constructed in Go.
- The one `sh -c` boundary is tmux's own shell-command join inside `new-window` (identical to the shipped codeserver spawn). Every word crossing it is rk-controlled (binary paths, flags, constant log path) or already validated (`ValidateToolName` on manifest tool names — rejects leading `-`, whitespace, control chars). The `--window` name from CLI users is validated with the same tool-name-class rules before becoming a tmux target.
- Exact-match `=session:=window` targets everywhere (the bare-target hijack class from tmux-sessions memory).

## Affected Memory

- `run-kit/architecture`: (modify) update/restart spawn mechanism moves from detached Setsid child to managed `rk-jobs` sibling-session windows; new `rk daemon run` primitive + subcommand; API response shape change
- `run-kit/toolkit-standards`: (modify) new command surface `rk daemon run` gets the help-dump + Principle 9 audit entry
- `run-kit/ui-patterns`: (modify) update chip / palette watch-target navigation affordance

## Impact

- **Backend**: `app/backend/internal/daemon/` (new run primitive, ~1 new file + registration), `app/backend/cmd/rk/` (new `daemon_run.go`), `app/backend/api/update.go` + `update_test.go` (spawn seam replacement, daemon gate, response shape), `app/backend/api/restart.go` + tests.
- **Frontend**: update chip / palette action handlers in `app/frontend/src/` (consume `watch` target, navigate to terminal route). Small.
- **Behavior/API**: `/api/update` and `/api/restart` response bodies gain a `watch` key; new 409 when the daemon isn't running; new 200 already-running response. Existing clients POSTing `{}` and reading `status` keep working.
- **Removal**: the detached-spawn machinery in update.go.
- **Tests**: Go handler tests re-seamed; new primitive unit tests (session-ensure, dedup branches, dead-pane reap); e2e coverage per code-quality.md where feasible (route-level mock of the new response shape).

## Open Questions

- None — all blocking decisions were resolved in the originating discussion (see Origin).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | No fallback: daemon not running → 409; detached-spawn path deleted | Discussed — explicit user decision ("ok to even not allow updates in case rk daemon isn't running") | S:95 R:80 A:95 D:95 |
| 2 | Certain | Subcommand scoped to managed windows on the daemon server, not generic pane addressing | Discussed — user agreed to the scoping after the collision-footgun argument | S:95 R:85 A:95 D:90 |
| 3 | Certain | `remain-on-exit failed` keeps failure evidence; success cleans up | Discussed — explicit user enthusiasm ("Wow - love this") | S:95 R:90 A:90 D:95 |
| 4 | Certain | In-flight second click returns the window target for UI navigation, not a 409 | Discussed — user chose "latter" between 409 and jump-to-window | S:95 R:90 A:95 D:90 |
| 5 | Certain | Stale failed window reaped by the next run; user can also kill from dashboard; no timer/reaper addition | Discussed and agreed | S:90 R:90 A:90 D:90 |
| 6 | Certain | Completion signaling unchanged (2-min RecheckAfter + daemon-restart side effect) | Discussed and agreed — spawn mechanism changes, verdict plumbing does not | S:90 R:85 A:95 D:95 |
| 7 | Confident | Jobs live in a `rk-jobs` sibling session on the rk-daemon socket, windows named per job (`update`, `restart`) | Codeserver + rk-remotes precedents; sibling session is required for survival of `daemon.Stop()` (codeserver.go documents the mechanism); session name itself is easily renamed | S:75 R:85 A:90 D:80 |
| 8 | Confident | Handlers call the internal primitive directly; the CLI subcommand wraps the same function (no self-exec) | Same-process call is strictly simpler; subcommand remains the standardized external surface the user asked for | S:70 R:85 A:90 D:85 |
| 9 | Confident | `pipe-pane` tee preserves `~/.rk/update.log` / `~/.rk/restart.log` continuity | Keeps today's durable diagnostic paths; scrollback alone dies with the window | S:70 R:90 A:85 D:85 |
| 10 | Confident | `remain-on-exit failed` + `pipe-pane` are best-effort: a failing set-option (ancient tmux) degrades to default window-close behavior, never blocks the spawn | One obvious default (codeserver's best-effort posture); dashboards target modern tmux (≥3.2 for `failed`) | S:60 R:90 A:80 D:80 |
| 11 | Confident | Frontend scope is minimal: consume `watch` target + navigate; no new components or SSE work | Terminal route + relay already render the window; ui-patterns favors reuse | S:70 R:85 A:85 D:80 |
| 12 | Certain | New CLI surface `rk daemon run` is checked against shll toolkit standards (help-dump, Principle 9) at plan/apply time | Constitution § Toolkit Standards mandates it; toolkit-standards memory documents the per-command audit pattern | S:85 R:90 A:95 D:95 |

12 assumptions (7 certain, 5 confident, 0 tentative, 0 unresolved).
