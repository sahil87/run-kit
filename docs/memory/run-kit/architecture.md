# run-kit Architecture

## System Overview

run-kit is a web-based agent orchestration dashboard. Three independent processes:

1. **Bash supervisor** (`supervisor.sh`) — manages Next.js + terminal relay as a single deployment unit
2. **Next.js 15 app** (port 3000) — REST API, SSE, and UI via App Router
3. **Terminal relay** (port 3001) — WebSocket-to-tmux bridge via `node-pty`

The tmux server is an external dependency — never started or stopped by run-kit.

## Data Model

**No database.** State derived at request time from:
- **tmux server** — `tmux list-sessions`, `tmux list-windows` via `lib/tmux.ts`
- **Filesystem** — `fab/current`, `.status.yaml` via `lib/fab.ts`
- **Config** — `run-kit.yaml` via `lib/config.ts`

## Backend Libraries

| Module | Responsibility |
|--------|---------------|
| `src/lib/tmux.ts` | All tmux operations via `execFile` with argument arrays + timeouts |
| `src/lib/worktree.ts` | Wraps fab-kit `wt-*` scripts (never reimplements) |
| `src/lib/fab.ts` | Reads fab state (progress-line, current change, change list) |
| `src/lib/config.ts` | Loads/validates `run-kit.yaml`, caches singleton |
| `src/lib/sessions.ts` | Fetches all sessions, maps to projects, enriches with fab state |
| `src/lib/validate.ts` | Input validation for names/paths before subprocess calls |
| `src/lib/types.ts` | Shared TypeScript types + named constants |

## API Layer

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/health` | GET | Returns `200 { "status": "ok" }` for supervisor health checks |
| `/api/sessions` | GET | Returns `ProjectSession[]` with project mapping + fab enrichment |
| `/api/sessions` | POST | Actions: `createSession`, `createWindow`, `killWindow`, `sendKeys` |
| `/api/sessions/stream` | GET | SSE — polls tmux every 2.5s, emits full snapshot on change |

## Terminal Relay

WebSocket server on port 3001. Clients connect via URL path: `ws://localhost:3001/:session/:window`.

Per connection:
1. Creates independent pane via `tmux split-window` (agent pane 0 untouched)
2. Spawns `tmux attach-session -t <paneId>` via `node-pty` for real terminal I/O
3. Relays I/O between WebSocket and pty
4. On disconnect: kills pty + pane (no orphaned panes)

## Supervisor

~50-line bash script. Polling loop checks for `.restart-requested` file.

On detection: `pnpm build` → kill both processes → start both → `GET /api/health` (10s timeout).
On failure: `git revert HEAD` → rebuild → restart prior version.
Signal trapping: SIGINT/SIGTERM → `stop_services` → clean exit.

## Design Decisions

- **SSE (not WebSocket) for session state** — simpler, server-push only, naturally resilient
- **Full snapshots (not diffs)** — small payload (<100 sessions), simple client logic
- **Independent panes per browser client** — no cursor fights, agent pane untouched
- **Exact name matching for session-to-project mapping** — predictable, unmatched → "Other"

## Security

- All subprocess calls use `execFile` with argument arrays (never `exec` or shell strings)
- All `execFile` calls include timeout (10s tmux, 30s build)
- User input validated via `lib/validate.ts` before reaching any subprocess

## Changelog

| Date | Change | Reference |
|------|--------|-----------|
| 2026-03-02 | Initial architecture — greenfield v1 | `260302-fl88-web-agent-dashboard` |
