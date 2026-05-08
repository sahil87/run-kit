# <img src="assets/logo.svg" alt="run-kit logo" width="32" height="32"> run-kit

> Part of [@sahil87's open source toolkit](https://ai.shll.in) — see all projects there.

[![Latest release](https://img.shields.io/github/v/release/sahil87/run-kit)](https://github.com/sahil87/run-kit/releases) [![Downloads](https://img.shields.io/github/downloads/sahil87/run-kit/total)](https://github.com/sahil87/run-kit/releases) [![Stars](https://img.shields.io/github/stars/sahil87/run-kit?style=social)](https://github.com/sahil87/run-kit/stargazers)

Web-based agent orchestration dashboard. Spawn Claude Code workspaces with `rk riff`, then monitor and drive them from the browser — sidebar of tmux servers, sessions, and panes; live terminal windows; mobile-friendly; keyboard-first.

## Why run-kit?

- **One command to start an agent workspace** — `rk riff` creates a git worktree, a tmux window, and one or more Claude Code panes in a single shot. Run several in parallel with `-N`.
- **Browser dashboard for tmux** — every tmux session and pane shows up in a sidebar. Click a pane to get a live terminal in the browser, or open it on your phone over Tailscale.
- **No database, no daemon magic** — state is derived from tmux and the filesystem. Agent sessions survive `rk` restarts because the daemon never touches them.
- **Keyboard-first** — `Cmd+K` command palette is the primary discovery mechanism. Touch targets are tuned for mobile.

## Screenshots

<img alt="Desktop — terminal session with sidebar (servers, sessions, panes) and host stats" src="https://github.com/user-attachments/assets/fbbe6171-e265-424a-b3fa-1a3194de3a09" />

<p>
  <img width="32%" alt="Mobile menu — drawer with servers, sessions, and panes" src="https://github.com/user-attachments/assets/1326355e-6031-4620-9ce9-355b82bf8313" />
  <img width="32%" alt="Mobile dashboard — session and window overview" src="https://github.com/user-attachments/assets/35645b54-d6d4-463f-8dc3-9d44e4c76dd5" />
  <img width="32%" alt="Mobile terminal session" src="https://github.com/user-attachments/assets/f07a0166-7674-41fe-8376-ef34fd2a1afb" />
</p>

## Installation

```sh
brew tap sahil87/tap
brew install rk
```

To upgrade later, run `rk update` — it pulls the latest version via Homebrew and restarts the daemon so the new binary takes effect immediately.

## Quick start

```bash
rk serve -d                  # start the dashboard daemon (default :3000)
open http://localhost:3000   # open the dashboard

# in any tmux session:
rk riff --skill /fab-discuss # spawn an agent workspace
```

## Commands

| Command | What it does |
|---------|--------------|
| [`rk serve`](#serve) | Start the HTTP server (foreground or daemon). |
| [`rk riff`](#riff) | Create a worktree + tmux window + Claude Code pane(s). |
| `rk status` | Show a tmux session summary. |
| `rk context` | Print agent-optimized environment info (server URL, ports, etc.). |
| `rk doctor` | Check runtime dependencies. |
| `rk init-conf` | Scaffold default tmux.conf and `tmux.d/` drop-in directory to `~/.rk/`. |
| `rk update` | Upgrade via Homebrew and restart the daemon. |
| `rk completion` | Generate shell completion scripts. |
| `rk help` | Help about any command. |

Run `rk <command> --help` for full flag details.

### serve

Start the HTTP server. Configurable via `RK_HOST` (default `127.0.0.1`) and `RK_PORT` (default `3000`).

```bash
rk serve                                # foreground on 127.0.0.1:3000
RK_HOST=0.0.0.0 RK_PORT=8080 rk serve   # bind all interfaces, port 8080
rk serve -d                             # background daemon in a tmux session
rk serve --restart                      # idempotent restart
rk serve --stop                         # graceful shutdown
```

### riff

Spawn an agent workspace — a git worktree, a tmux window inside it, and one or more Claude Code panes. The headline feature; see the [riff guide](docs/wiki/riff.md) for the full reference.

```bash
rk riff                                              # 1 pane, default skill (/fab-discuss)
rk riff --skill /fab-fff                             # 1 pane, specific slash-command
rk riff --skill /fab-fff --cmd "just dev"            # 2 panes (agent + dev server)
rk riff --skill /a --cmd x --cmd y --layout main-vertical
rk riff ship                                         # invoke the 'ship' preset
rk riff ship --count 3                               # 3 parallel ship workspaces
rk riff -- --worktree-name pacing-canyon             # name the worktree
```

Highlights:

- **Pane array model** — `--skill` and `--cmd` are repeatable; argv order becomes pane order. Bare `--skill` opens a blank Claude session; bare `--cmd` drops into `$SHELL`.
- **Presets** — define common pane/layout combos in `fab/project/config.yaml` under `riff.presets.<name>`.
- **Layouts** — `auto` (default), `tiled`, `even-horizontal`, `even-vertical`, `main-horizontal`, `main-vertical`.
- **Parallel** — `-N <N>` spawns N workspaces in parallel; failures roll back successful ones.
- **wt passthrough** — flags after `--` go to `wt create` (e.g. `--base`, `--reuse`, `--worktree-name`).

Prerequisites: must be inside a tmux session, [`wt`](https://github.com/sahil87/wt) on `PATH`, and the launcher (default `claude --dangerously-skip-permissions`) available. Override the launcher per-project via `agent.spawn_command` in `fab/project/config.yaml`.

## HTTPS

Some browser features (e.g., copy to clipboard) require a secure context and only work over HTTPS. Accessing rk from other machines on your tailnet also requires HTTPS. To enable it:

1. Enable HTTPS at [DNS > HTTPS Certificates](https://login.tailscale.com/admin/dns).
2. Run `tailscale serve --bg http://localhost:3000`.
3. Open `https://<machine>.<tailnet>.ts.net`.

For custom hostnames, Funnel, and other options, see the [Tailscale guide](docs/wiki/tailscale.md).

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) (v20+)
- [pnpm](https://pnpm.io/)
- [tmux](https://github.com/tmux/tmux) installed and on your `PATH`
- [just](https://github.com/casey/just) task runner
- [Go](https://go.dev/) (1.22+)
- [air](https://github.com/air-verse/air) Go live-reload for development
- [direnv](https://direnv.net/) for automatic `.env` loading via `.envrc`

```sh
brew install node pnpm tmux just direnv go
go install github.com/air-verse/air@latest
```

Run `just doctor` to verify all dependencies are installed.

### Getting started

```bash
just doctor
just setup
just dev   # watch mode (Go backend + Vite dev server)
# OR
just prod  # run from built binary
```

## Architecture notes

### Self-improvement loop

rk runs as a daemon in a dedicated tmux session, managed via CLI flags on `rk serve`:

- `rk serve -d` — start daemon in a tmux session (`rk-daemon` server)
- `rk serve --restart` — idempotent restart (stop existing if running, start new)
- `rk serve --stop` — graceful shutdown via SIGINT

Key properties:

- **Tmux-based** — daemon runs in a dedicated tmux server (`rk-daemon`), separate from agent sessions (`runkit`)
- **Kill-and-restart** — no polling loop or signal files; restart sends C-c then starts the new binary
- **Idempotent** — `--restart` works whether or not a daemon is currently running
- **tmux-independent** — the daemon server never touches agent tmux sessions; agent sessions survive restarts unaffected
