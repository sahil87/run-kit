# Intake: Daemon Lifecycle for `run-kit serve`

**Change**: 260320-hkm8-daemon-lifecycle-serve
**Created**: 2026-03-20
**Status**: Draft

## Origin

> Discussion session exploring binary self-update strategies for run-kit. User wanted a way for `run-kit update` (Homebrew upgrade) to restart the running server with the new binary. Evaluated four approaches: kill-and-restart via tmux, signal-based restart with supervisor loop, exec-into-new-binary, and socket handoff. User chose kill-and-restart (approach 1) for its simplicity — the tmux pane provides the process boundary, no wrapper loop needed. This eliminates the existing `supervisor.sh` polling approach entirely.

Key decisions from discussion:
- `run-kit serve --restart` is idempotent: stop existing daemon if running, start new one regardless — "ensure the latest binary is serving as a daemon"
- `run-kit serve -d` starts the daemon (errors if already running, or could also be idempotent — TBD)
- `run-kit serve --stop` stops the daemon without restarting
- No supervisor loop, no `.restart-requested` signal file — direct kill-and-restart via tmux

## Why

The current daemon approach uses `scripts/supervisor.sh` — a bash script that builds the binary, runs it, polls every 5 seconds for a `.restart-requested` file, checks inode changes, and restarts on crash or signal. This has several problems:

1. **Unnecessary complexity**: The supervisor is a polling loop around what should be a simple start/stop operation
2. **Stale binary risk**: The supervisor builds from source (`just build`), but Homebrew installs to a different path — `run-kit update` can't restart the supervisor's binary
3. **Two deployment models**: Homebrew users get `run-kit update` but can't use `just up`; dev users get `just up` but not `run-kit update`. The daemon should work for both
4. **Indirection**: `just up` → `supervisor.sh` → `just build` → `./dist/run-kit` is three layers when the tmux pane can just run `run-kit serve` directly

If we don't fix it: Homebrew users have no clean way to restart the server after updates, and the supervisor script remains dead code for production installs.

## What Changes

### New flags on `run-kit serve`

Three new flags on the existing `serve` command in `app/backend/cmd/run-kit/serve.go`:

#### `--daemon` / `-d`
Start the server in a detached tmux session. Creates a dedicated tmux server+session (e.g., `-L rk-daemon` server, `rk` session, `serve` window) and sends `run-kit serve` as the command. The CLI process exits after confirming the tmux session started.

```
$ run-kit serve -d
run-kit daemon started (rk-daemon/rk/serve)
```

If a daemon is already running, print a message and exit (not an error):
```
$ run-kit serve -d
run-kit daemon already running (rk-daemon/rk/serve)
```

#### `--restart`
Idempotent restart: if a daemon tmux session exists, send `C-c` to stop the old process, wait for exit, then send `run-kit serve\n`. If no daemon exists, start one (same as `-d`).

```
$ run-kit serve --restart
Restarting run-kit daemon...
run-kit daemon started (rk-daemon/rk/serve)
```

This is what `run-kit update` calls after `brew upgrade`.

#### `--stop`
Stop the daemon: send `C-c` to the tmux pane. If no daemon exists, print a message and exit cleanly.

```
$ run-kit serve --stop
run-kit daemon stopped
```

### Tmux session layout for the daemon

The daemon uses a **separate tmux server** (socket name: `rk-daemon`) to avoid polluting the user's tmux sessions or the `runkit` server used for agent sessions.

- **Server**: `-L rk-daemon`
- **Session**: `rk`
- **Window**: `serve`
- **Command**: `run-kit serve` (foreground mode inside the tmux pane)

Detection of "is daemon running" checks: `tmux -L rk-daemon has-session -t rk 2>/dev/null`.

### Update integration

`run-kit update` (`app/backend/cmd/run-kit/upgrade.go`) auto-restarts the daemon after a successful `brew upgrade` by calling `run-kit serve --restart` internally. The Homebrew symlink update means the new `run-kit serve` inside the tmux pane resolves to the new binary.

```
$ run-kit update
Current version: v0.1.10
Updating v0.1.10 → v0.1.11...
Updated to v0.1.11.
Restarting run-kit daemon...
run-kit daemon started (rk-daemon/rk/serve)
```

### Removals

- **`scripts/supervisor.sh`** — deleted entirely
- **`.restart-requested` signal file** — no longer created or checked
- **`Caddyfile.example`** — removed; Tailscale Serve is the recommended HTTPS path
- **`docs/wiki/caddy.md`** — removed; Caddy guide no longer needed
- **`config/tmux.conf`** — removed; embedded copy in `app/backend/internal/tmux/tmux.conf` is now canonical
- **CI tmux.conf copy step** — removed from `.github/workflows/release.yml` (no longer needed)
- **Constitution reference** — the `.restart-requested` file and signal-based restart mention updated

### Justfile updates

- `up`/`down`/`restart` → use new CLI flags (`run-kit serve -d/--stop/--restart`)
- New `dev-run-kit` recipe — run any `run-kit` CLI command from source (`just dev-run-kit serve -d`)
- New `dev-backend` / `dev-frontend` recipes — run Go or Vite dev servers independently
- Removed Caddyfile setup from `just setup`

### Tmux config consolidation

The embedded copy at `app/backend/internal/tmux/tmux.conf` is now the single source of truth. The `config/tmux.conf` file and the CI copy step are removed. Enhanced with TUI compatibility (passthrough, extended-keys, OSC 52 clipboard, focus-events, true color), 100k scrollback, heavy pane borders with status bar (command, path, git branch, worktree badge), and vi copy mode.

### Command palette bug fix

Fix: selecting a palette action via Enter that opens a dialog (e.g., Keyboard Shortcuts) caused the dialog to immediately close. Root cause: the Enter keypress's default behavior activated the dialog's auto-focused Close button. Fix: `e.preventDefault()` on Enter in the palette's key handler.

## Affected Memory

- `run-kit/architecture`: (modify) Update daemon/supervisor section, CLI subcommands, internal packages, repo structure
- `run-kit/tmux-sessions`: (modify) Minor updates

## Impact

- **CLI**: `app/backend/cmd/run-kit/serve.go` — new flags, daemon management logic
- **CLI**: `app/backend/cmd/run-kit/upgrade.go` — auto-restart after upgrade
- **Internal**: `app/backend/internal/daemon/` — new package for tmux daemon helpers
- **Scripts**: `scripts/supervisor.sh` — deleted
- **Scripts**: `scripts/build.sh` — removed tmux.conf copy step
- **Scripts**: `scripts/doctor.sh` — removed caddy check
- **Config**: `justfile` — `up`/`down`/`restart` updated + new dev recipes
- **Config**: `config/tmux.conf` — deleted (canonical copy is embedded)
- **CI**: `.github/workflows/release.yml` — removed tmux.conf copy step
- **Frontend**: `app/frontend/src/components/command-palette.tsx` — `e.preventDefault()` on Enter
- **Docs**: `fab/project/constitution.md` — restart mechanism updated
- **Docs**: `README.md` — updated self-improvement section, removed Caddy reference
- **Docs**: `docs/wiki/caddy.md` — deleted
- **Docs**: `docs/wiki/tailscale.md` — simplified (sole HTTPS guide)
- **Docs**: `docs/specs/architecture.md` — minor supervisor reference cleanup

## Open Questions

None — all resolved during discussion.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Kill-and-restart via tmux, not supervisor loop | Discussed — user explicitly chose approach 1 over signal-based restart | S:95 R:90 A:95 D:95 |
| 2 | Certain | `--restart` is idempotent (start if not running) | Discussed — user confirmed "ensure the latest binary is serving" semantics | S:95 R:85 A:90 D:95 |
| 3 | Certain | Separate tmux server for daemon (`rk-daemon`) | Constitution requires tmux session isolation; `runkit` server is for agent sessions | S:80 R:80 A:90 D:85 |
| 4 | Certain | `supervisor.sh` and `.restart-requested` are removed | Discussed — user confirmed supervisor is unnecessary after this change | S:90 R:85 A:90 D:95 |
| 5 | Certain | Daemon detection via `tmux has-session` | Clarified — user confirmed tmux has-session is the right approach | S:95 R:90 A:85 D:80 |
| 6 | Certain | Stop via `C-c` (SIGINT) to tmux pane | Clarified — user confirmed; matches existing graceful shutdown in serve.go | S:95 R:85 A:90 D:80 |
| 7 | Certain | `run-kit serve -d` errors if daemon already running | Clarified — user confirmed; `-d` = start (errors if exists), `--restart` = ensure running | S:95 R:85 A:95 D:95 |
| 8 | Certain | `run-kit update` auto-restarts daemon after upgrade | Clarified — user chose auto-restart, no explicit flag needed | S:95 R:80 A:95 D:95 |

8 assumptions (8 certain, 0 confident, 0 tentative, 0 unresolved).
