# Intake: Deterministic Daemon Lifecycle

**Change**: 260527-901h-deterministic-daemon-lifecycle
**Created**: 2026-05-27
**Status**: Draft

## Origin

> Make the `rk serve` daemon lifecycle deterministic by closing the split-brain detection gap where a foreground `rk serve` and a `rk serve -d` daemon both contend for the same port but neither knows about the other. Three coupled fixes: (1) port-based liveness detection before `daemon.Start()`, (2) stale-socket reaping, (3) daemon startup logging to a file. Change type: fix.

Initiated conversationally during a `/fab-discuss` session. We were investigating why a live `rk` server was running on the box but no `rk-daemon` tmux session was visible in run-kit. The investigation (process-tree inspection, tmux socket probing, port-ownership checks) produced an empirically confirmed root-cause chain, reproduced on a throwaway socket. This intake encodes those findings directly.

### Investigation findings (empirically confirmed)

1. The live `rk serve` (PID 121792) is a **direct child of the interactive `zsh`** over SSH (`sshd → zsh (pts/5) → rk serve`), attached to `pts/5` with `STAT=Sl+` (foreground process group). Its environment has `TERM=tmux-256color` but **no `TMUX` socket pointer** — it is *not* running inside a tmux pane. It holds `127.0.0.1:3000` (`ss -ltnp` → `users:(("rk",pid=121792,fd=6))`).
2. A `rk-daemon` socket file exists at `/tmp/tmux-1001/rk-daemon` (created 21:26, ~24 min *after* the foreground serve started at 21:02), but `tmux -L rk-daemon list-sessions` reports **"no server running on /tmp/tmux-1001/rk-daemon"** — the socket is orphaned; the tmux server behind it is dead.
3. **`has-session` does NOT create a socket or spawn a server.** Probing a nonexistent socket errors with "error connecting to … (No such file or directory)" and exit 1. So `daemon.IsRunning()` (which calls `has-session`) is *not* the source of the orphan socket.
4. **`tmux -L <sock> new-session -d -s rk-daemon -n serve <cmd>` where `<cmd>` exits immediately** reproduces the exact live state: `new-session` returns exit 0, the socket file is left behind, and `list-sessions`/`has-session` report "no server running on …". A single-window tmux server has nothing to keep it alive once its only command exits, so the server shuts down and orphans the socket.
5. **Root cause**: a `rk serve -d` was run at 21:26. `daemon.IsRunning()` returned false (the foreground serve is not in a tmux session, so `has-session` for `=rk-daemon`/`=rk` found nothing), so `daemon.Start()` created the session and launched a second `rk serve` inside it. That inner serve tried to bind `:3000`, hit `address already in use`, and `os.Exit(1)`'d (`serve.go:133` inside the `ListenAndServe` goroutine). The single-window tmux server died, orphaning the socket. The error message vanished with the session — never seen by the user.

The underlying defect is a **split-brain detection gap**: tmux-session presence is used as a proxy for "is rk serving," but it is a leaky proxy. A foreground serve serves without a session; a crashed daemon leaves a socket without a server. `daemon.IsRunning()` is blind to a foreground serve even though both contend for the same real resource — the bound port.

## Why

1. **Problem**: `rk serve -d` can silently fail and leave the system in a confusing state — an orphaned `rk-daemon` socket, no visible session, and no error message — because daemon liveness is detected via tmux-session presence rather than the resource that actually matters (the bound port). A foreground `rk serve` is invisible to the daemon's `IsRunning()` check, so the daemon happily starts a second serve that immediately dies on a port collision.
2. **Consequence if unfixed**: Users get a misleading "rk daemon started" message even when the daemon died on startup; orphaned sockets accumulate; and post-mortem is impossible because the only diagnostic (the bind error) is written to a tmux session that closes instantly. Operators cannot reason about "is rk running and how was it launched."
3. **Why this approach**: Anchoring liveness detection to the **bound port** (not the tmux session) closes the split-brain gap at the source — it is the one signal that is true regardless of launch method (foreground vs daemon). Reaping the stale socket makes daemon state self-healing. Writing startup output to a log file makes failures diagnosable without violating Constitution §VI (tmux sessions survive server restarts) — the log is a passive artifact, not a supervisor. Alternatives rejected: (a) a PID file / lock file would reintroduce persistent state the No-Database principle discourages and can itself go stale; (b) parsing `ps` for `rk serve` processes is brittle and platform-specific; (c) keeping the failed tmux window alive with `remain-on-exit on` only helps if the user happens to attach, and leaves a zombie window — a log file is greppable and always available.

## What Changes

### 1. Port-based liveness detection (the split-brain fix)

Before `daemon.Start()` / `daemon.StartWithBinary()` launch the inner serve, probe whether the configured `RK_HOST:RK_PORT` is already accepting TCP connections, using `net.DialTimeout` with a short timeout (≈300–500 ms). The probe MUST use the same host/port resolution the foreground serve uses (`config.Load()` → `cfg.Host`, `cfg.Port`), so the daemon checks the address it would actually try to bind.

Behavior:
- If the port is **already accepting connections**, refuse to start and return a clear, actionable error that distinguishes daemon-managed from foreground serves. Proposed message:

  ```
  rk is already serving on 127.0.0.1:3000, but not under the rk-daemon tmux session
  (likely a foreground `rk serve`). Stop it first, or set a different RK_PORT.
  ```

  When the port is held *and* a live `rk-daemon` session exists, prefer the existing "daemon already running" message (that path is already handled by `IsRunning()` in `serve.go:57`). The new port probe is specifically for the case where `IsRunning()` is false but something is nonetheless serving the port.

- If the port is **free**, proceed to create the session as today.

Note on `RK_HOST=0.0.0.0`: the `.env` in this repo sets `RK_HOST=0.0.0.0`. A dial probe to `0.0.0.0` is not meaningful; the daemon SHALL probe `127.0.0.1` (loopback substitution) when the configured host is `0.0.0.0`, empty, or `::`, since a serve bound to `0.0.0.0` is reachable on loopback. <!-- clarified: loopback substitution chosen — dial 127.0.0.1 when host is 0.0.0.0/empty/::, otherwise dial literal host. -->

Placement: a helper such as `portInUse(host string, port int) bool` in `internal/daemon` (or a small `internal/netprobe`-style helper), called from `Start`/`StartWithBinary` after the `IsRunning()` guard and before `startSession`. The `serve.go` daemon-flag path (`serve.go:56-66`) surfaces the returned error.

### 2. Stale-socket reaping (self-healing state)

A socket file with no server behind it is a lie. When the daemon determines no live session exists but a socket file is present at the daemon socket path, it SHALL reap the orphan before creating a new session.

Detection: `IsRunning()` already returns false in this state (because `has-session` against a dead socket returns non-zero). The reaping logic should run inside `Start()`/`StartWithBinary()` after `IsRunning()` returns false and before `startSession()`:
- The reap SHALL invoke `tmux -L rk-daemon kill-server` via the existing `runTmux` helper. This stays inside the `internal/tmux/` abstraction (code-quality rule), inherits the existing `cmd.CommandContext`+timeout enforcement, is a no-op when no server is running, and removes the socket as a side effect. Direct `os.Remove` of the resolved socket path is explicitly rejected as it bypasses the tmux abstraction. <!-- clarified: reap via `runTmux(ctx, "kill-server")` — stays within internal/tmux abstraction; idempotent. -->
- The reap MUST be idempotent and MUST NOT error when there is nothing to reap (no socket file, or a live server — in the live-server case `IsRunning()` would have been true and we never reach here).

Constraint: reaping MUST NOT touch the *agent-session* tmux server (default socket) or any session other than the daemon's own socket. It is scoped strictly to `serverSocket` (`rk-daemon`). This protects Constitution §VI (agent tmux sessions survive server restarts) and §I (no collateral kills).

### 3. Daemon startup logging (diagnosability)

The daemonized inner serve currently writes its slog output to `os.Stderr`, which is the tmux pane — lost the instant the session closes on a startup failure. The daemon's inner serve SHALL additionally (or instead) write startup output to a log file so post-mortem diagnosis is possible.

Proposed design:
- Log path under the user cache dir: resolve via `os.UserCacheDir()` → `<cache>/rk/daemon.log` (e.g. `~/.cache/rk/daemon.log` on Linux). `os.MkdirAll(dir, 0o755)` on the parent (consistent with existing `os.MkdirAll` usage in `internal/settings/settings.go:57`, `cmd/rk/initconf.go:29`).
- The serve process learns it is the daemon via an **environment variable** `RK_DAEMON_LOG=<path>` set by `startSession` when it spawns the inner `<exe> serve` (passed through tmux's environment inheritance, or explicitly via `tmux send-environment`/the `new-session` env). The serve startup checks for `RK_DAEMON_LOG` and, when present, configures its slog handler with an `io.MultiWriter(os.Stderr, file)` — **tee mode**: output goes to both the file (durable record) and stderr (the tmux pane, preserved for live `tmux attach` visibility). Env var was chosen over a hidden `--log-file` cobra flag to keep the public flag surface minimal. <!-- clarified: env var RK_DAEMON_LOG + tee to file & stderr — durable record + preserved attach visibility, no public-flag surface increase. -->
- The log MUST capture at minimum: the bind address, `server starting`, and any bind/startup error before `os.Exit(1)`. The existing `slog.Error("server error", "err", err)` at `serve.go:133` must reach the file so a port collision is greppable.
- Append mode (not truncate) so successive daemon starts accrete history; size is expected to be tiny.

This is a passive log artifact — no supervisor, no watcher, no signal file — so it does not violate Constitution §VI or the Self-Improvement Safety constraint.

### Out of scope (explicitly)

- **`rk serve --stop` killing a foreground serve.** Discussed and deliberately deferred. Recommended future behavior: `--stop` stops the daemon as today and *additionally probes the port*, reporting (non-destructively) when a foreground serve holds it — e.g. "No rk daemon running, but 127.0.0.1:3000 is held by PID <n>; stop it in its own terminal." An opt-in `--stop --force`/`--any` that SIGTERMs the port owner regardless of launch method was floated but is out of scope for this change. Reasoning: reaching across shells to kill an interactive foreground process is a blast-radius increase that warrants its own change and explicit consent. The port-probe error in fix #1 already prevents the confusing double-start that motivated the whole investigation.

## Affected Memory

- `run-kit/architecture`: (modify) Document the daemon lifecycle determinism guarantees — port-based liveness detection, stale-socket reaping, and the daemon log file location/behavior. The architecture memory is the right home since this is about how the server process is launched and supervised (or deliberately not supervised).

## Impact

- **`app/backend/internal/daemon/daemon.go`** — primary. `Start`, `StartWithBinary`, `startSession`, `IsRunning`/`isRunningCtx`, and the constants block. Add port-probe helper and socket-reap logic. Both `Start` and `StartWithBinary` paths must gain the new guards (the latter is used by `cmd/rk/upgrade.go:100` via `RestartWithBinary`).
- **`app/backend/cmd/rk/serve.go`** — the daemon-flag path (`serve.go:56-66`) surfaces the new port-in-use error. The foreground serve startup (`serve.go:91-147`) gains daemon-log redirection when launched as the daemon's inner process (env/flag detection).
- **`app/backend/internal/daemon/daemon_test.go`** — extend. Existing tests use an overridable `serverSocket` (`rk-daemon-test`) and assert constants/targets; add coverage for port-in-use refusal and stale-socket reaping against an isolated socket.
- **`app/backend/internal/config`** — read-only consumer (`config.Load()` for host/port resolution in the probe). No changes expected.
- **`app/backend/cmd/rk/upgrade.go`** — no direct edit, but `RestartWithBinary` now inherits the port guard + reap; verify the upgrade flow still restarts cleanly (the old daemon is stopped first, freeing the port before the new one starts).
- Constitution touchpoints: §I (all subprocess calls via `exec.CommandContext` with timeouts — the reap, if it uses `kill-server`, goes through `runTmux` which already enforces this), §II (No Database — the log file is an append-only diagnostic artifact, not state to derive behavior from; liveness is still derived from port + tmux), §VI (tmux sessions survive server restarts — reaping is scoped to the daemon socket only).

## Open Questions

<!-- Resolved during /fab-clarify on 2026-05-28:
     - Loopback substitution for wildcard host: YES (probe 127.0.0.1 when RK_HOST is 0.0.0.0/empty/::)
     - Reap mechanism: tmux -L rk-daemon kill-server via runTmux (not os.Remove)
     - Daemon log delivery: env var RK_DAEMON_LOG + tee to file & stderr
     - Inner-serve daemon-detection mechanism: env var (not hidden --log-file flag)
-->

- Should the port-in-use refusal exit non-zero from `rk serve -d` (so scripts can detect it) while still printing the human-readable message? (Expected: yes — return the error so cobra exits non-zero.) — *(resolved in #11)*

## Clarifications

### Session 2026-05-28 (tentative resolution)

| # | Action | Detail |
|---|--------|--------|
| 4 | Changed | Reap mechanism explicitly fixed to `tmux -L rk-daemon kill-server` via `runTmux` (rejected `os.Remove`) |
| 9 | Confirmed | Loopback substitution for wildcard host (probe 127.0.0.1 when RK_HOST is 0.0.0.0/empty/::) |
| 10 | Confirmed | Daemon-detection via env var `RK_DAEMON_LOG`; logs teed to file + stderr via `io.MultiWriter` |

### Session 2026-05-28 (bulk confirm, auto-clarify)

| # | Action | Detail |
|---|--------|--------|
| 5 | Confirmed | Daemon log at `os.UserCacheDir()/rk/daemon.log`, append mode |
| 6 | Confirmed | Daemon log is passive (no supervisor/watcher/signal file) |
| 7 | Confirmed | `rk serve --stop` killing a foreground serve is out of scope |
| 8 | Confirmed | Port guard + reap apply to both `Start` and `StartWithBinary` |
| 11 | Confirmed | Port-in-use refusal returns non-zero (cobra) while printing human message |

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Change type is `fix` | Investigation identified a concrete defect (orphaned socket + silent daemon death from split-brain detection); user stated "Change type: fix" | S:95 R:90 A:95 D:95 |
| 2 | Certain | Liveness anchored to the bound port via `net.DialTimeout`, not tmux-session presence | Empirically confirmed the port is the only launch-method-independent signal; user explicitly chose this in discussion | S:95 R:70 A:90 D:90 |
| 3 | Certain | Socket reaping is scoped strictly to the `rk-daemon` socket, never the agent-session tmux server | Constitution §VI (agent sessions survive restarts) and §I (no collateral kills) are non-negotiable | S:90 R:60 A:95 D:90 |
| 4 | Certain | Reap uses `tmux -L rk-daemon kill-server` (via `runTmux`) rather than direct `os.Remove` | Clarified — user confirmed; abstraction-consistency with code-quality "all tmux interaction goes through internal/tmux/"; idempotent | S:95 R:75 A:75 D:65 |
| 5 | Certain | Daemon log at `os.UserCacheDir()/rk/daemon.log`, append mode, parent created with `os.MkdirAll(.,0o755)` | Clarified — user confirmed (auto-clarify); matches existing `os.MkdirAll` conventions; cache dir is the conventional home for diagnostic logs | S:95 R:80 A:75 D:70 |
| 6 | Certain | Daemon log is passive (no supervisor/watcher/signal file) so it respects Constitution §VI and Self-Improvement Safety | Clarified — user confirmed (auto-clarify); the constitution explicitly forbids a supervisor loop / `.restart-requested` signal; a log file introduces none of those | S:95 R:75 A:90 D:75 |
| 7 | Certain | `rk serve --stop` killing a foreground serve is OUT of scope; defer to a future change | Clarified — user confirmed (auto-clarify); non-destructive port-detection reporting recommended now, opt-in `--force` later; blast-radius warrants separate consent | S:95 R:65 A:80 D:70 |
| 8 | Certain | Both `Start` and `StartWithBinary` gain the port guard + reap (not just `Start`) | Clarified — user confirmed (auto-clarify); `StartWithBinary` is the upgrade path (`upgrade.go:100` via `RestartWithBinary`); leaving it unguarded would reopen the gap during upgrades | S:95 R:75 A:85 D:75 |
| 9 | Certain | For wildcard/empty `RK_HOST` (`0.0.0.0`/empty/`::`), probe `127.0.0.1` (loopback substitution); otherwise probe the literal host | Clarified — user confirmed; a `0.0.0.0` bind is reachable on loopback and dialing `0.0.0.0` is not meaningful | S:95 R:70 A:55 D:50 |
| 10 | Certain | Inner serve learns it is the daemon via env var `RK_DAEMON_LOG=<path>` set by `startSession`; logs are teed to both file AND stderr via `io.MultiWriter` | Clarified — user confirmed; env var minimizes public flag surface; tee preserves attach visibility while guaranteeing a durable record | S:95 R:65 A:55 D:45 |
| 11 | Certain | Port-in-use refusal returns a non-zero error from `rk serve -d` (cobra exits non-zero) while printing the human message | Clarified — user confirmed (auto-clarify); scripts/automation must detect the refusal; idiomatic cobra `RunE` pattern already used in `serve.go` | S:95 R:80 A:85 D:80 |

11 assumptions (11 certain, 0 confident, 0 tentative, 0 unresolved).
