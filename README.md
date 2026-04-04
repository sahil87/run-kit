# <img src="assets/logo.svg" alt="run-kit logo" width="32" height="32"> run-kit

Web-based agent orchestration dashboard. Monitor and interact with tmux sessions from the browser — session overview, live terminal windows, and fab-kit integration for change tracking.

<img width="1093" height="643" alt="image" src="https://github.com/user-attachments/assets/37c80d61-4819-4c3a-b27a-246791f284a3" />

## Installation

```sh
brew tap sahil87/tap
brew install rk
```

## Usage

```bash
rk serve -d          # start daemon (default :3000)
rk serve --restart   # restart daemon (idempotent)
rk serve --stop      # graceful shutdown
rk update            # upgrade via Homebrew and restart
```

## Prerequisites (development)

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

## Getting Started

```bash
just doctor
just setup
just dev  # watch mode
# OR
just prod # Runs from built binary
```

## HTTPS

To access rk over HTTPS (e.g., from other machines on your tailnet), see:

- [Tailscale guide](docs/wiki/tailscale.md) — zero-config with Tailscale Serve (recommended)

## Self-Improvement Loop

rk runs as a daemon in a dedicated tmux session. Lifecycle is managed via CLI flags on `rk serve`:

- `rk serve -d` — start daemon in a tmux session (`rk-daemon` server)
- `rk serve --restart` — idempotent restart (stop existing if running, start new)
- `rk serve --stop` — graceful shutdown via SIGINT

`rk update` automatically restarts the daemon after upgrading via Homebrew, so the new binary takes effect immediately.

Key properties:

- **Tmux-based** — daemon runs in a dedicated tmux server (`rk-daemon`), separate from agent sessions (`runkit`)
- **Kill-and-restart** — no polling loop or signal files; restart sends C-c then starts the new binary
- **Idempotent** — `--restart` works whether or not a daemon is currently running
- **tmux-independent** — the daemon server never touches agent tmux sessions; agent sessions survive restarts unaffected
