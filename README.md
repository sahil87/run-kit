# <img src="assets/logo.svg" alt="run-kit logo" width="32" height="32"> run-kit

> Part of [@sahil87's open source toolkit](https://ai.shll.in) — see all projects there.

[![Latest release](https://img.shields.io/github/v/release/sahil87/run-kit)](https://github.com/sahil87/run-kit/releases) [![Downloads](https://img.shields.io/github/downloads/sahil87/run-kit/total)](https://github.com/sahil87/run-kit/releases) [![Stars](https://img.shields.io/github/stars/sahil87/run-kit?style=social)](https://github.com/sahil87/run-kit/stargazers)

Web-based agent orchestration dashboard. Monitor and interact with tmux sessions from the browser — session overview, live terminal windows, and fab-kit integration for change tracking.

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

Some browser features (e.g., copy to clipboard) require a secure context and only work over HTTPS. Accessing rk from other machines on your tailnet also requires HTTPS. To enable it:

1. Enable HTTPS at [DNS > HTTPS Certificates](https://login.tailscale.com/admin/dns).
2. Run `tailscale serve --bg http://localhost:3000`.
3. Open `https://<machine>.<tailnet>.ts.net`.

For custom hostnames, Funnel, and other options, see the [Tailscale guide](docs/wiki/tailscale.md).

## Self-Improvement Loop

rk runs as a daemon in a dedicated tmux session. Lifecycle is managed via CLI flags on `rk serve`:

- `rk serve -d` — start daemon in a tmux session (`rk-daemon` server)
- `rk serve --restart` — idempotent restart (stop existing if running, start new)
- `rk serve --stop` — graceful shutdown via SIGINT

Key properties:

- **Tmux-based** — daemon runs in a dedicated tmux server (`rk-daemon`), separate from agent sessions (`runkit`)
- **Kill-and-restart** — no polling loop or signal files; restart sends C-c then starts the new binary
- **Idempotent** — `--restart` works whether or not a daemon is currently running
- **tmux-independent** — the daemon server never touches agent tmux sessions; agent sessions survive restarts unaffected
