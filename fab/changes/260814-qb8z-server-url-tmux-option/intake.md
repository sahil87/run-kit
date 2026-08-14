# Intake: Server URL via tmux Option

**Change**: 260814-qb8z-server-url-tmux-option
**Created**: 2026-08-15

## Origin

Backlog item `[qb8z]` (2026-08-14 memory-distillation batch, relocated from `docs/memory/run-kit/architecture.md` by PR #602), invoked one-shot via `/fab-new`:

> Give rk-born tmux servers their deployment real server URL without re-leaking RK_* env — e.g. `-e` injection at server birth or an @rk_url-style tmux option. Re-leaking env is explicitly NOT the fix: panes fall back to the 127.0.0.1:3000 default on non-default deployments; tmux server env is set once at birth, goes stale across daemon restarts, and sprays into every child; Constitution X prefers derivation over pushed state (hooks/options should carry only what cannot be derived from tmux/filesystem/git at request time). This is the design-heavy item in the batch — pick and JUSTIFY the mechanism (server-birth env injection vs an @rk_url-style tmux user option vs something else) before implementing, weighing staleness-across-restart, env-spray-to-children, and the derivation-over-push principle.

The invocation also carries a ship-time convention: when shipped, tick `[x]` for id `qb8z` in `fab/backlog.md` **in the MAIN worktree** (`~/code/sahil87/run-kit`) — all backlog done-markings land there.

## Why

**The pain point.** `sanitizeEnv` (`app/backend/internal/tmux/tmux.go:1227`) deliberately strips all `RK_*` vars from the environment of every tmux server rk births — that strip is a prior *fix* (it stopped run-kit's direnv-polluted project config from leaking into unrelated repos) and is shared by every birth-capable seam (`CreateSession`, `tmuxctl.createAnchor`, board pin-session create, layout restore, `daemon.startSession`) via `CleanEnvForServer()`. The side effect: a pane inside an rk-born server has no `RK_HOST`/`RK_PORT`, so `config.Load()` (`app/backend/internal/config/config.go`) falls back to `127.0.0.1:3000`. Two CLI consumers resolve the server origin this way from inside panes:

- **`rk url`** (`cmd/rk/url.go`) — the documented server-URL discovery seam agents use (the Visual Display Recipe, `rk skill` guidance, and fab skills all route through it). On a non-default deployment it prints a wrong origin, and its own doc comment already flags smarter discovery as "a deferred enhancement; this command is the seam that keeps that door open."
- **`rk notify`** (`cmd/rk/notify.go`) — POSTs to `http://{host}:{port}/api/notify` and is **fail-silent by contract**, so on a non-default deployment an operator-escalation notify from a pane silently no-ops. Nothing surfaces; the notification is just lost.

Non-default deployments are real, not hypothetical: `RK_PORT=3020` (the e2e/test deployment), remote hosts (`internal/remote` — memory notes the remote daemon derives its origin via `rk url`), and any `.env.local` port override.

**If we don't fix it.** Every pane-side consumer of the origin stays silently wrong off port 3000: lost notifications, agents building URLs against a dead port, and pressure to re-leak `RK_*` env (which would regress the sanitizeEnv fix).

**Why this approach.** The chosen mechanism is a **daemon-owned, per-tmux-server user option (`@rk_origin`) plus a request-time read rung in the CLI's origin resolution**. Full justification against the alternatives is in What Changes § Design Decision — in short, the live deployment origin is a per-tmux-server fact that only the covering daemon knows, it exists nowhere on the filesystem (and Constitution II forbids putting it there), and tmux user options are the established rk channel for exactly this class of underivable, ephemeral, per-server state (`@rk_server_rank`, `@rk_session_order` precedents). Options don't spray into child environments and are heal-able after daemon restarts; env injection fails on both counts.

## What Changes

### Design Decision: mechanism selection (the backlog's explicit ask)

**Chosen**: the daemon writes the full origin string (exactly what `rk url` prints, e.g. `http://127.0.0.1:3001`) to a **server-scoped tmux user option `@rk_origin`** (`set-option -s`) on every tmux server it covers, and pane-side CLI consumers gain a derivation rung that reads it at request time. Weighed against the backlog's three criteria plus Constitution X:

| Mechanism | Staleness across daemon restart | Env spray to children | Derivation-over-push (Constitution X) | Verdict |
|---|---|---|---|---|
| `-e` injection at server birth (session env) | **Fails** — tmux server env is set once at birth; servers outlive daemons by design (Constitution VI), so a port change strands every existing server forever | **Fails** — session env is inherited by every child process; this IS the re-leak the backlog rules out | Pure push, uncorrectable | Rejected |
| `set-environment` / `update-environment` post-birth | Only new panes see updates; existing panes keep stale values | **Fails** — same inheritance spray; regresses the `sanitizeEnv` fix | Push into env, the channel we deliberately scrubbed | Rejected |
| State file under `$XDG_STATE_HOME/rk/` written by the daemon | Heal-able | Clean | **Fails Constitution II** — a request-time read of a disk state store is neither of the two carve-outs (write-only backups, seed caches); also can't disambiguate which deployment covers which tmux server when two coexist (prod :3000 + test :3020) | Rejected |
| Port-owner probe (`lsof`/`/proc` scan for `rk serve`, or HTTP-probe candidate ports) | Always live | Clean | Purest derivation, but platform-divergent, slow, and **ambiguous with multiple deployments** — a probe finds *a* server, not *the one covering this tmux server*; `url.go` already defers it as a heavier enhancement | Rejected (stays the open door `rk url`'s comment describes) |
| **Per-server tmux user option, daemon-written, read at request time** | **Heals** — the daemon rewrites it on its existing covering pass (SSE hub safety poll, ≤12s — `api/sse.go:72`), so a restart on a new port converges within one pass | **Clean** — tmux options are not environment; nothing is inherited by child processes | The origin is precisely the state Constitution X permits pushing: an ephemeral runtime fact of the daemon process that **cannot** be derived from tmux/filesystem/git within a pane. The reader still *derives at request time* (one `show-options` call), never caches. When the fact IS available both ways (explicit `RK_*` env in the caller's shell), derivation-from-env wins — see the precedence rung below | **Chosen** |

Per-server scoping is load-bearing, not incidental: "which deployment covers this tmux server" is inherently a per-tmux-server question (prod on :3000 and the e2e deployment on :3020 cover *different* sockets on the same box), and the covering daemon is the only party that can answer it authoritatively. Server-scoped user options are an established rk pattern with existing setter/reader precedent (`SetServerRank` / `SetSessionOrder`, `tmux.go:2380–2441`).

`@rk_origin` (not `@rk_server_url`): `@rk_url` is already taken as the window-scoped present/iframe URL — reusing the name at a different scope would invite tmux's hierarchical-lookup leakage (the same reason `@rk_session_flair` was scope-split from `@rk_flair`). "Origin" matches the existing language in `internal/remote/ssh.go` ("origin via `rk url`").

### New option + writer seams (backend, `internal/tmux` + daemon/hub)

- New exported constant `OriginOption = "@rk_origin"` in `internal/tmux`, registered alongside `ServerRankOption`/`SessionOrderOption`.
- Setter/getter following the `SetServerRank` pattern (`set-option -s` / `show-options -s -v`, `withTimeout`, explicit argv — Constitution I).
- **Writer**: the serve/daemon process composes its origin once from its own loaded config (`http://{cfg.Host}:{cfg.Port}`) and stamps it **write-if-different** on every tmux server it covers, on the SSE hub's existing per-server snapshot/safety-poll pass (`api/sse.go`, ≤12s cadence — the same infrastructure that repaints covered servers). Write-if-different keeps the steady state read-only (no churn on every poll).
- Effect at birth: rk-born servers are covered by the hub immediately, so the option appears within one pass of birth; servers born by an older build or started by the user directly are healed identically. An additional synchronous stamp at daemon-side birth seams MAY be added in the plan if the ≤12s window proves to matter for riff-spawned agents that call `rk url` instantly.
- Staleness across restart: a daemon restarted on a new port overwrites the old value within one covering pass; while no daemon is running, the option reflects the last covering deployment — the same trust level as any liveness-free heuristic (`rk url` is documented as not a liveness probe, unchanged).
- Multi-deployment overlap (two live daemons enumerating the same tmux server) resolves last-writer-wins; with the test deployment isolated to its own socket this is a misconfiguration corner, accepted and documented rather than engineered around.
- Layout snapshots (`internal/snapshot`) do NOT capture/restore `@rk_origin` — the live daemon re-stamps a restored server within one pass, so persisting it would only round-trip staleness.

### Consumer rung: shared origin resolver for pane-side CLI commands

A shared resolver (new helper in `internal/config` or a small `internal/origin` package) with explicit precedence:

1. **Explicit env wins**: if `RK_HOST` or `RK_PORT` is set in the caller's environment, resolve exactly as today via `config.Load()` (an operator who sets env is overriding deliberately).
2. **Tmux option**: else, when running inside tmux (`$TMUX` set), read `@rk_origin` from the covering server's socket (the `$TMUX` socket path — a socket-path variant of the existing `-L`-based helpers). The value is validated before use (parses as an `http`/`https` URL) — an unparseable/empty value falls through.
3. **Default**: else `http://127.0.0.1:3000`, unchanged.

Consumers updated to use it: **`rk url`** and **`rk notify`** (both currently `config.Load()`-direct). `rk url`'s help/doc text updates to describe the new rung (CLI-surface change — check against `shll standards` per Constitution Toolkit Standards). `rk serve` and the daemon lifecycle commands (`daemon start/stop/status/restart`) deliberately do NOT read the option — the server defines the truth the option mirrors, and daemon lifecycle targets the env-selected deployment by design.

### Ship-time convention

When the change ships, tick `- [x] [qb8z] …` in `fab/backlog.md` **in the main worktree** (`~/code/sahil87/run-kit`), not this worktree — the standing convention for backlog done-markings.

## Affected Memory

- `run-kit/tmux-sessions`: (modify) `@rk_*` user-option registry gains `@rk_origin` — server scope, daemon writer (hub covering pass, write-if-different), CLI reader (`rk url`/`rk notify` resolver rung), excluded from snapshot/restore
- `run-kit/architecture`: (modify) CLI subcommands section — `rk url`/`rk notify` origin resolution gains the env → `@rk_origin` → default precedence; daemon section — the hub stamps covered servers with the deployment origin

## Impact

- `app/backend/internal/tmux/tmux.go` — `OriginOption` constant, server-scoped setter/getter (follows `SetServerRank` at :2399–2441); possibly a `$TMUX`-socket-path read variant
- `app/backend/api/sse.go` (or the hub's snapshot seam) — write-if-different origin stamp on the per-server covering pass
- `app/backend/internal/config/` (or new `internal/origin/`) — shared resolver with env → option → default precedence
- `app/backend/cmd/rk/url.go`, `cmd/rk/notify.go` — switch to the resolver; `url.go` help-text update (toolkit-standards check)
- Tests: Go unit tests for resolver precedence and option round-trip (existing live-socket test patterns in `tmux_test.go`); no frontend or UI change; no API surface change
- `fab/backlog.md` (main worktree, at ship): tick `[qb8z]`

## Open Questions

- None — the backlog item supplied the decision criteria, and config/constitution/codebase precedent resolve the remaining choices (graded below).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Mechanism = daemon-written per-tmux-server user option + request-time CLI read rung; rejected `-e`/session-env injection, `set-environment`, state file, port-owner probe | Backlog names the candidates and the three weighing criteria; Constitution II/VI/X plus the `sanitizeEnv` history make the option channel the only one passing all three (justification table in What Changes) | S:85 R:55 A:85 D:75 |
| 2 | Confident | Option is `@rk_origin`, server-scoped (`set-option -s`), value = full origin string exactly as `rk url` prints | `@rk_url` is taken at window scope (hierarchical-lookup leakage precedent: `@rk_flair`/`@rk_session_flair` split); "origin" matches existing `internal/remote` language; server scope has `@rk_server_rank` precedent | S:55 R:60 A:70 D:55 |
| 3 | Confident | Resolver precedence: explicit `RK_HOST`/`RK_PORT` env → validated `@rk_origin` → `127.0.0.1:3000` default; `rk serve` + daemon lifecycle commands never read the option | Explicit env is a deliberate operator override (Constitution X: when available both ways, derivation-from-caller-env wins); the server defines the truth the option mirrors, so it must not read it back | S:60 R:75 A:80 D:70 |
| 4 | Confident | Consumers in scope = `rk url` + `rk notify` via one shared resolver seam; other `config.Load()` callers unchanged | These are the two pane-side origin consumers with observable failures (wrong URL, silently lost notify); the shared seam lets others adopt later without re-design | S:65 R:80 A:75 D:65 |
| 5 | Confident | Writer = write-if-different stamp on the SSE hub's existing ≤12s per-server covering pass; birth-seam synchronous stamp deferred to plan if needed; multi-deployment overlap resolves last-writer-wins | The safety poll already touches every covered server (row-color repaint precedent); write-if-different avoids churn; overlap is a misconfiguration corner not worth engineering around | S:60 R:70 A:70 D:55 |
| 6 | Confident | Layout snapshots exclude `@rk_origin` from capture/restore | The live daemon re-stamps a restored server within one pass; persisting the value only round-trips staleness (write-only-backup spirit of Constitution II) | S:45 R:85 A:75 D:60 |
| 7 | Certain | At ship, tick `[x]` for `qb8z` in `fab/backlog.md` in the MAIN worktree (`~/code/sahil87/run-kit`) | Explicit instruction in the invocation; standing convention | S:95 R:90 A:95 D:95 |

7 assumptions (1 certain, 6 confident, 0 tentative, 0 unresolved).
