# run-kit

Web-based agent orchestration dashboard. Monitor and interact with tmux sessions from the browser — session overview, live terminal windows, and fab-kit integration for change tracking.

## Installation

This is a private repo — Homebrew needs a GitHub token to download release assets. Add this to your shell profile (`.zshrc` / `.bashrc`):

```sh
export HOMEBREW_GITHUB_API_TOKEN=ghp_yourtoken
```

The token needs `repo` scope (for private repo access). Then:

```sh
brew tap wvrdz/tap git@github.com:wvrdz/homebrew-tap.git
brew install wvrdz/tap/run-kit
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

To access run-kit over HTTPS (e.g., from other machines on your tailnet), see:

- [Tailscale guide](docs/wiki/tailscale.md) — zero-config with Tailscale Serve (recommended)
- [Caddy guide](docs/wiki/caddy.md) — manual setup with Caddy reverse proxy

## Self-Improvement Loop

run-kit supports a self-improvement cycle where an agent can modify the codebase and trigger a safe restart. This requires the **supervisor** (`pnpm supervisor`), not `pnpm dev`.

The flow:

1. Agent commits code changes to the repository
2. Agent creates the restart signal: `touch .restart-requested`
3. Supervisor detects the file (polls every 2s) and runs `pnpm build`
4. If the build succeeds, supervisor restarts both Next.js and the terminal relay
5. Supervisor polls `GET /api/health` — if it returns 200 within 10s, the restart is complete
6. If the build or health check fails, supervisor rolls back (`git revert HEAD`), rebuilds, and restarts the previous version

Key properties:

- **Signal-based** — restarts only happen via the `.restart-requested` file, never on file change
- **Build-gated** — compile errors are caught before the server goes down
- **Health-verified** — `/api/health` must return 200 before the restart is considered successful
- **Atomic rollback** — failed restarts revert to the last known-good commit automatically
- **tmux-independent** — the supervisor never touches tmux; agent sessions survive restarts unaffected
