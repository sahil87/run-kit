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
| `src/lib/validate.ts` | Input validation for names/paths + tilde expansion with `$HOME` security boundary |
| `src/lib/config.ts` | Server config (port, relayPort, host, tlsCert, tlsKey) — reads CLI args > `run-kit.yaml` > defaults |
| `src/lib/types.ts` | Shared TypeScript types + named constants |

## API Layer

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/health` | GET | Returns `200 { "status": "ok" }` for supervisor health checks |
| `/api/sessions` | GET | Returns `ProjectSession[]` — one per tmux session, with auto-detected fab enrichment |
| `/api/sessions` | POST | Actions: `createSession` (with optional `cwd`), `createWindow`, `killSession`, `killWindow`, `sendKeys` |
| `/api/directories` | GET | Server-side directory listing for autocomplete — `?prefix=~/code/wvr` returns matching dirs under `$HOME` |
| `/api/sessions/stream` | GET | SSE — polls tmux every 2.5s, emits full snapshot on change |

## Terminal Relay

WebSocket server (default port 3001, configurable via `config.relayPort`). Binds to `config.host` (default `127.0.0.1`). When TLS certs exist at `config.tlsCert`/`config.tlsKey`, the relay creates an HTTPS server (WSS); otherwise falls back to HTTP (WS). Clients connect via URL path: `ws[s]://{host}:{relayPort}/:session/:window`. The relay port is passed from the server component (`page.tsx` imports `config`) as a prop to `TerminalClient` — never via build-time env vars. The client (`terminal-client.tsx`) auto-detects `wss:`/`ws:` from `window.location.protocol`.

Per connection:
1. Creates independent pane via `tmux split-window` (agent pane 0 untouched)
2. Spawns `tmux attach-session -t <paneId>` via `node-pty` for real terminal I/O
3. Relays I/O between WebSocket and pty
4. On disconnect: kills pty + pane (no orphaned panes)

## Supervisor

~160-line bash script. Reads `run-kit.yaml` at startup via grep-based parsing (no `yq` dependency) for port/host config. Detects TLS certs (`certs/localhost.pem`, `certs/localhost-key.pem`) at startup. Polling loop checks for `.restart-requested` file.

When certs exist: starts Next.js via `tsx src/https-server.ts` (custom HTTPS server) instead of `pnpm start`, uses `curl -k` for health checks over HTTPS. When certs absent: standard `pnpm start` + HTTP health checks (unchanged).

On detection: `pnpm build` → kill both processes → start both with configured ports/host → `GET /api/health` (10s timeout).
On failure: `git revert HEAD` → rebuild → restart prior version.
Signal trapping: SIGINT/SIGTERM → `stop_services` → clean exit.

## Chrome Architecture

The root layout (`src/app/layout.tsx`) owns a fixed `h-screen flex-col` skeleton with three zones:

1. **Top chrome** (`shrink-0`) — `TopBarChrome` component, always-rendered two-line top bar
2. **Content** (`flex-1 overflow-y-auto min-h-0`) — page content, scrollable
3. **Bottom slot** (`shrink-0`) — `BottomSlot` component for future bottom bar injection

All three zones use `max-w-4xl mx-auto w-full px-6` for identical width/padding — pages cannot override this.

**ChromeProvider** (`src/contexts/chrome-context.tsx`) — React Context for slot injection. Pages set breadcrumbs, line2Left, line2Right, bottomBar, and isConnected via `useChrome()` setters in `useEffect`, with cleanup on unmount. Context value is memoized to prevent unnecessary re-renders.

**TopBarChrome** (`src/components/top-bar-chrome.tsx`) — reads from ChromeProvider. Line 1: icon breadcrumbs + connection indicator + ⌘K badge. Line 2: always rendered with `min-h-[36px]`, even when slots are empty (prevents layout shift).

Pages do NOT render their own top bar or outer containers — they set chrome slots and render only their content area.

## Design Decisions

- **SSE (not WebSocket) for session state** — simpler, server-push only, naturally resilient
- **Full snapshots (not diffs)** — small payload (<100 sessions), simple client logic
- **Independent panes per browser client** — no cursor fights, agent pane untouched
- **Every tmux session is a project** — no config, no "Other" bucket. Project root derived from window 0's `pane_current_path`
- **Config resolution: CLI > YAML > defaults** — `src/lib/config.ts` reads `run-kit.yaml` (optional, gitignored) and CLI args. Includes `tlsCert`/`tlsKey` paths (default: `certs/localhost.pem`/`certs/localhost-key.pem`). Relay port delivered to client via server component prop (runtime, not build-time)
- **Optional HTTPS via `mkcert`** — run `just certs` to generate locally-trusted TLS certs. When certs exist, both Next.js and relay serve over HTTPS/WSS; when absent, HTTP/WS (no breaking change). Dev mode uses `--experimental-https-cert`/`--experimental-https-key` flags; production mode uses `src/https-server.ts` (custom HTTPS server wrapping Next.js)
- **Byobu session-group filtering** — `listSessions()` filters out derived session-group copies to avoid duplicate projects. See `docs/memory/run-kit/tmux-sessions.md`
- **Layout-owned chrome (not per-page TopBar)** — React Context for slot injection. Pages inject content via `useEffect` setters; layout renders it in fixed positions. Prevents layout shift and ensures consistent width/padding across all pages. Old `TopBar` component deleted.

## Testing

Vitest with jsdom environment. Config at `vitest.config.ts` (repo root). Setup file at `src/test-setup.ts` imports `@testing-library/jest-dom/vitest` for extended DOM matchers.

Test scripts: `pnpm test` (single run), `pnpm test:watch` (watch mode).

Test files co-located with source using `.test.{ts,tsx}` suffix (test-alongside strategy per `code-quality.md`). Path alias `@/` resolves to `src/` in both app and test contexts.

Current coverage: `validate.ts` (input validation + tilde expansion), `config.ts` (CLI arg parsing, port validation, defaults, TLS cert paths), `command-palette.tsx` (keyboard interaction, filtering, open/close), `tmux.ts` (listSessions parsing + byobu filtering, listWindows activity computation), `use-keyboard-nav.ts` (j/k/Enter navigation, input skip, clamping, custom shortcuts), `api/sessions/route.ts` POST handler (5-action dispatch, validation, error propagation).

## Security

- All subprocess calls use `execFile` with argument arrays (never `exec` or shell strings)
- All `execFile` calls include timeout (10s tmux, 30s build)
- User input validated via `lib/validate.ts` before reaching any subprocess
- Directory listing restricted to `$HOME` via `expandTilde()` — rejects `..` traversal, absolute paths outside home, and `~username` syntax. Symlinks under `$HOME` are not resolved (accepted risk for local dev tool)
- TLS private keys stored in `certs/` (gitignored), never committed or embedded in config values

## Changelog

| Date | Change | Reference |
|------|--------|-----------|
| 2026-03-02 | Initial architecture — greenfield v1 | `260302-fl88-web-agent-dashboard` |
| 2026-03-03 | Removed `run-kit.yaml` config — derive project state from tmux | `260303-yohq-drop-config-derive-from-tmux` |
| 2026-03-03 | Added `killSession` API action — kills entire tmux session | `260303-vag8-unified-top-bar` |
| 2026-03-03 | Configurable port/host binding via `config.ts` + `run-kit.yaml` | `260303-q8a9-configurable-port-host` |
| 2026-03-03 | Relay port via server component prop (replaced build-time env var) | — |
| 2026-03-03 | Filter byobu session-group copies from `listSessions()` | — |
| 2026-03-05 | Added Vitest testing infrastructure with validate, config, and command-palette tests | `260303-07iq-setup-vitest` |
| 2026-03-05 | Added feature tests for tmux.ts, use-keyboard-nav.ts, and api/sessions POST handler | `260305-vq7h-feature-tests-tmux-keyboard-api` |
| 2026-03-05 | Added `/api/directories` endpoint, `createSession` CWD support, `expandTilde` security boundary | `260305-zkem-session-folder-picker` |
| 2026-03-06 | Chrome architecture — layout-owned flex-col skeleton, ChromeProvider context, TopBarChrome, icon breadcrumbs, always-visible kill buttons | `260305-emla-fixed-chrome-architecture` |
| 2026-03-06 | Optional HTTPS/WSS via `mkcert` — TLS config in `config.ts`, conditional HTTPS relay, custom production server, `just certs` recipe | `260306-m42a-https-dev-server` |
