# run-kit

Web-based agent orchestration dashboard. Monitor and interact with tmux sessions from the browser — session overview, live terminal windows, and fab-kit integration for change tracking.

## Prerequisites

- [Node.js](https://nodejs.org/) (v20+)
- [pnpm](https://pnpm.io/)
- [tmux](https://github.com/tmux/tmux) installed and on your `PATH`
- [just](https://github.com/casey/just) task runner
- [air](https://github.com/air-verse/air) Go live-reload for development
- [Caddy](https://caddyserver.com/) *(optional, for local HTTPS)*

```sh
brew install node pnpm tmux just caddy
go install github.com/air-verse/air@latest
```

Run `just doctor` to verify all dependencies are installed.

## Getting Started

1. **Install dependencies and browsers**

   ```sh
   pnpm install
   pnpm exec playwright install --with-deps chromium
   ```

   > **Note:** Use `chromium`, not `chrome` — Chrome doesn't ship ARM64 Linux binaries.
   > The `--with-deps` flag installs required system libraries (will prompt for sudo).

2. **Start in development mode**

   ```sh
   pnpm dev
   ```

   This starts the Go API server and the Vite dev server. The API serves on port 3000 by default; Vite proxies `/api` and `/relay` requests to it. Ctrl+C stops both.

3. **Start in production mode**

   Build and run both services with the supervisor:

   ```sh
   pnpm supervisor
   ```

   The supervisor manages the Go server as a single unit, with health checks and automatic rollback on failure. It reads `run-kit.yaml` for port/host configuration.

## Configuration

Create an optional `run-kit.yaml` at the repo root to override defaults:

```yaml
server:
  port: 3000        # Go server port (default: 3000)
  host: 127.0.0.1   # Bind address (default: 127.0.0.1)
```

All values are optional — defaults apply when the file is absent or a key is omitted. The Vite dev server reads `run-kit.yaml` at startup to configure its proxy targets automatically.

CLI args override `run-kit.yaml` (useful for one-off overrides):

```sh
./bin/run-kit --port 4000 --host 0.0.0.0
```

**Security note:** The default host `127.0.0.1` restricts access to localhost. Setting `host: 0.0.0.0` exposes the terminal relay to the network.

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
