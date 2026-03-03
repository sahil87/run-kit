# run-kit Architecture

## System Overview

run-kit is a web-based agent orchestration dashboard. Three independent processes:

1. **Bash supervisor** (`supervisor.sh`) — manages Next.js + terminal relay as a single deployment unit
2. **Next.js 15 app** (default port 3000) — REST API, SSE, and UI via App Router
3. **Terminal relay** (default port 3001) — WebSocket-to-tmux bridge via `node-pty`

Ports and bind host are configurable via CLI args > `run-kit.yaml` > hardcoded defaults. See `src/lib/config.ts`.

The tmux server is an external dependency — never started or stopped by run-kit.

## Data Model

**No database.** State derived at request time from:
- **tmux server** — `tmux list-sessions`, `tmux list-windows` via `lib/tmux.ts`. Project roots derived from window 0's `pane_current_path`
- **Filesystem** — `fab/current`, `.status.yaml` via `lib/fab.ts`. Fab-kit projects auto-detected via `fs.access()` on `fab/project/config.yaml` at the derived project root

## Backend Libraries

| Module | Responsibility |
|--------|---------------|
| `src/lib/tmux.ts` | All tmux operations via `execFile` with argument arrays + timeouts |
| `src/lib/worktree.ts` | Wraps fab-kit `wt-*` scripts (never reimplements) |
| `src/lib/fab.ts` | Reads fab state (progress-line, current change, change list) |
| `src/lib/sessions.ts` | Derives project roots from tmux, auto-detects fab-kit, enriches with fab state |
| `src/lib/validate.ts` | Input validation for names/paths before subprocess calls |
| `src/lib/config.ts` | Server config (port, relayPort, host) — reads CLI args > `run-kit.yaml` > defaults |
| `src/lib/types.ts` | Shared TypeScript types + named constants |

## API Layer

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/health` | GET | Returns `200 { "status": "ok" }` for supervisor health checks |
| `/api/sessions` | GET | Returns `ProjectSession[]` — one per tmux session, with auto-detected fab enrichment |
| `/api/sessions` | POST | Actions: `createSession`, `createWindow`, `killSession`, `killWindow`, `sendKeys` |
| `/api/sessions/stream` | GET | SSE — polls tmux every 2.5s, emits full snapshot on change |

## Terminal Relay

WebSocket server (default port 3001, configurable via `config.relayPort`). Binds to `config.host` (default `127.0.0.1`). Clients connect via URL path: `ws://{host}:{relayPort}/:session/:window`. The client reads the relay port from `NEXT_PUBLIC_RELAY_PORT` env var (baked into the Next.js client bundle at build time).

Per connection:
1. Creates independent pane via `tmux split-window` (agent pane 0 untouched)
2. Spawns `tmux attach-session -t <paneId>` via `node-pty` for real terminal I/O
3. Relays I/O between WebSocket and pty
4. On disconnect: kills pty + pane (no orphaned panes)

## Supervisor

~130-line bash script. Reads `run-kit.yaml` at startup via grep-based parsing (no `yq` dependency) for port/host config. Polling loop checks for `.restart-requested` file.

On detection: `pnpm build` → kill both processes → start both with configured ports/host → `GET /api/health` (10s timeout).
On failure: `git revert HEAD` → rebuild → restart prior version.
Signal trapping: SIGINT/SIGTERM → `stop_services` → clean exit.

## Design Decisions

- **SSE (not WebSocket) for session state** — simpler, server-push only, naturally resilient
- **Full snapshots (not diffs)** — small payload (<100 sessions), simple client logic
- **Independent panes per browser client** — no cursor fights, agent pane untouched
- **Every tmux session is a project** — no config, no "Other" bucket. Project root derived from window 0's `pane_current_path`
- **Config resolution: CLI > YAML > defaults** — `src/lib/config.ts` reads `run-kit.yaml` (optional, gitignored) and CLI args. Relay port delivered to client via `NEXT_PUBLIC_RELAY_PORT` env var (Next.js build-time injection)

## Security

- All subprocess calls use `execFile` with argument arrays (never `exec` or shell strings)
- All `execFile` calls include timeout (10s tmux, 30s build)
- User input validated via `lib/validate.ts` before reaching any subprocess

## Changelog

| Date | Change | Reference |
|------|--------|-----------|
| 2026-03-02 | Initial architecture — greenfield v1 | `260302-fl88-web-agent-dashboard` |
| 2026-03-03 | Removed `run-kit.yaml` config — derive project state from tmux | `260303-yohq-drop-config-derive-from-tmux` |
| 2026-03-03 | Added `killSession` API action — kills entire tmux session | `260303-vag8-unified-top-bar` |
| 2026-03-03 | Configurable port/host binding via `config.ts` + `run-kit.yaml` | `260303-q8a9-configurable-port-host` |
