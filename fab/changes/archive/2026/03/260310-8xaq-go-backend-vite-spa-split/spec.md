# Spec: Go Backend + Vite SPA Split

**Change**: 260310-8xaq-go-backend-vite-spa-split
**Created**: 2026-03-10
**Affected memory**: `docs/memory/run-kit/architecture.md`, `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- New features beyond parity with current Next.js implementation — this is a structural refactor, not a feature release
- API versioning (e.g., `/v1/api/...`) — can be introduced later when multi-client divergence requires it
- Mobile app clients — the API is designed to support them, but no mobile client is built in this change
- SSR in the frontend — the SPA is purely client-rendered
- Database or persistent state store — constitution principle "No Database" remains in effect

## Repository Structure

### Requirement: Monorepo Layout

The repository SHALL be restructured into a pnpm workspaces monorepo with two packages:
- `packages/api/` — Go module (backend)
- `packages/web/` — Vite + React SPA (frontend)

Root-level directories (`e2e/`, `fab/`, `docs/`) SHALL remain at the repository root. `pnpm-workspace.yaml` SHALL include only `packages/web` (Go is independent of the Node.js package manager).

#### Scenario: Fresh clone and build
- **GIVEN** a clean clone of the repository
- **WHEN** `pnpm install` is run at the root
- **THEN** dependencies for `packages/web/` are installed
- **AND** `packages/api/` is unaffected (Go modules managed independently via `go mod`)

### Requirement: Source Directory Removal

The entire `src/` directory SHALL be removed. All backend logic moves to `packages/api/`. All frontend logic moves to `packages/web/src/`. The following root-level files SHALL be removed: `next.config.ts`, `next-env.d.ts`, root `tsconfig.json`, root `vitest.config.ts`, `postcss.config.mjs`.

#### Scenario: No stale Next.js artifacts
- **GIVEN** the change is applied
- **WHEN** listing repository root files
- **THEN** `next.config.ts`, `next-env.d.ts`, `postcss.config.mjs`, and `src/` do not exist
- **AND** `tsconfig.json` and `vitest.config.ts` exist only in `packages/web/`

## Go Backend: HTTP Server

### Requirement: Single-Binary Server

The Go backend SHALL compile to a single static binary via `go build -o bin/run-kit ./cmd/run-kit` from `packages/api/`. The binary SHALL serve REST API, SSE, WebSocket terminal relay, and SPA static files on a single port (default 3000).

#### Scenario: Server startup
- **GIVEN** the Go binary is built
- **WHEN** `./bin/run-kit` is executed
- **THEN** the server listens on `127.0.0.1:3000`
- **AND** responds to `GET /api/health` with `200 {"status": "ok"}`

### Requirement: chi Router with Middleware

The HTTP server SHALL use the `go-chi/chi` router. Middleware chain SHALL include CORS (permissive by default), request logging, and panic recovery.

#### Scenario: CORS preflight
- **GIVEN** the Go server is running
- **WHEN** an OPTIONS request is sent to `/api/sessions` with `Origin: http://localhost:5173`
- **THEN** the response includes `Access-Control-Allow-Origin` header
- **AND** status is 200

### Requirement: Configuration Resolution

Server configuration SHALL follow the resolution order: CLI arguments > `run-kit.yaml` > hardcoded defaults. Configuration fields: `port` (default 3000), `host` (default `127.0.0.1`). YAML parsing via `gopkg.in/yaml.v3`.

#### Scenario: CLI overrides YAML
- **GIVEN** `run-kit.yaml` contains `port: 4000`
- **WHEN** the server starts with `--port 5000`
- **THEN** the server listens on port 5000

#### Scenario: Defaults when no config
- **GIVEN** no `run-kit.yaml` and no CLI args
- **WHEN** the server starts
- **THEN** the server listens on `127.0.0.1:3000`

### Requirement: Graceful Shutdown

The server SHALL handle SIGINT and SIGTERM by initiating graceful shutdown: stop accepting new connections, drain active requests (5-second timeout), close SSE fan-out, then exit.

#### Scenario: SIGTERM graceful shutdown
- **GIVEN** the Go server is running with active SSE clients
- **WHEN** SIGTERM is received
- **THEN** the server stops accepting new connections
- **AND** existing requests complete within 5 seconds
- **AND** the process exits cleanly

## Go Backend: API Endpoints

### Requirement: Health Check

`GET /api/health` SHALL return `200 {"status": "ok"}`.

#### Scenario: Health check
- **GIVEN** the Go server is running
- **WHEN** `GET /api/health` is requested
- **THEN** response is `200 {"status": "ok"}`

### Requirement: Sessions GET

`GET /api/sessions` SHALL return `ProjectSession[]` — one per tmux session, with auto-detected fab enrichment. Session enrichment SHALL run in parallel (goroutines) with preserved tmux ordering. The response JSON structure SHALL match the current implementation.

#### Scenario: Sessions with fab-kit project
- **GIVEN** tmux has session "my-project" with window 0 pane path at a fab-kit project root
- **WHEN** `GET /api/sessions` is requested
- **THEN** response includes a session with `name: "my-project"`, `fabState` populated, and `windows` array

### Requirement: Sessions POST Actions

`POST /api/sessions` SHALL support action dispatch: `createSession` (with optional `cwd`), `createWindow`, `killSession`, `killWindow`, `renameWindow`, `sendKeys`. Request body SHALL be JSON with an `action` field. All inputs SHALL be validated before reaching any subprocess.

#### Scenario: Create session with CWD
- **GIVEN** the Go server is running
- **WHEN** `POST /api/sessions` with `{"action": "createSession", "name": "test", "cwd": "~/code/project"}`
- **THEN** a new tmux session "test" is created at the expanded path
- **AND** response status is 200

#### Scenario: Kill window
- **GIVEN** tmux session "proj" has window 2
- **WHEN** `POST /api/sessions` with `{"action": "killWindow", "session": "proj", "window": "2"}`
- **THEN** window 2 is killed
- **AND** response status is 200

#### Scenario: Invalid action rejected
- **GIVEN** the Go server is running
- **WHEN** `POST /api/sessions` with `{"action": "dropDatabase"}`
- **THEN** response status is 400
- **AND** body includes an error message

### Requirement: SSE Session Stream

`GET /api/sessions/stream` SHALL implement Server-Sent Events. A module-level goroutine SHALL poll tmux every 2.5 seconds and fan out full snapshots to all connected clients on change. Deduplication: single poll regardless of client count. 30-minute connection lifetime cap. Client disconnection SHALL be handled without error or goroutine leak.

#### Scenario: Client receives update
- **GIVEN** a browser is connected to `/api/sessions/stream` via EventSource
- **WHEN** a tmux session is created externally
- **THEN** the client receives an SSE event with the updated sessions within 2.5 seconds

#### Scenario: Connection cleanup
- **GIVEN** a client is connected to the SSE stream
- **WHEN** the client disconnects
- **THEN** the server removes the client from the fan-out list
- **AND** no goroutine leaks

### Requirement: Directory Listing

`GET /api/directories?prefix=...` SHALL return directory listing for autocomplete. Paths SHALL be restricted to `$HOME` — reject `..` traversal, absolute paths outside home, `~username` syntax. Hidden directories (`.`-prefixed) SHALL be excluded from results.

#### Scenario: Directory autocomplete
- **GIVEN** `~/code/` contains `run-kit/` and `fab-kit/`
- **WHEN** `GET /api/directories?prefix=~/code/` is requested
- **THEN** response includes both directories, sorted, hidden dirs excluded

#### Scenario: Path traversal rejection
- **GIVEN** a request with `prefix=~/../../etc/`
- **WHEN** the endpoint processes it
- **THEN** response status is 400

### Requirement: File Upload

`POST /api/upload` SHALL accept `multipart/form-data` with `file` and `session` fields. Server SHALL resolve project root via tmux window listing, write to `.uploads/{YYMMDD-HHmmss}-{sanitized-name}`, auto-manage `.gitignore`, and return the file path. 50MB size limit enforced server-side. Filename sanitization: strip path separators, null bytes, leading dots, collapse dot sequences.

#### Scenario: Upload file
- **GIVEN** tmux session "proj" exists with project root at `~/code/project`
- **WHEN** `POST /api/upload` with a 1MB file and `session: "proj"`
- **THEN** file is written to `~/code/project/.uploads/{timestamp}-{filename}`
- **AND** `.gitignore` includes `.uploads/`
- **AND** response includes the file path

#### Scenario: Oversize file rejected
- **GIVEN** the Go server is running
- **WHEN** `POST /api/upload` with a 60MB file
- **THEN** response status is 413

## Go Backend: Terminal Relay

### Requirement: WebSocket Terminal Relay

The terminal relay SHALL handle WebSocket connections at `/relay/{session}/{window}` on the same port as the API. SHALL use `gorilla/websocket` for WebSocket handling and `creack/pty` for PTY allocation.

Per connection:
1. Create independent pane via `tmux split-window` (agent pane 0 untouched)
2. Spawn `tmux attach-session -t <paneId>` via `creack/pty`
3. Relay I/O between WebSocket and pty
4. On disconnect: kill pty + pane

#### Scenario: Terminal connection and I/O
- **GIVEN** tmux session "proj" has window 1
- **WHEN** a WebSocket client connects to `/relay/proj/1`
- **THEN** a new pane is created via split-window
- **AND** pty output is relayed to the WebSocket
- **AND** WebSocket messages are written to the pty

### Requirement: Pane Cleanup on Disconnect

When a WebSocket client disconnects, the server SHALL kill the associated pty and tmux pane. No orphaned panes SHALL remain.

#### Scenario: Disconnect cleanup
- **GIVEN** an active terminal relay with pane %5
- **WHEN** the WebSocket connection closes
- **THEN** pty is killed, pane %5 is killed
- **AND** no orphaned pane remains

## Go Backend: tmux Integration

### Requirement: Process Execution Security

All tmux commands SHALL use `os/exec.CommandContext` with argument slices (never shell strings or `sh -c`). All calls SHALL include timeouts via `context.WithTimeout` (10 seconds for tmux, 30 seconds for build operations).

#### Scenario: Command timeout
- **GIVEN** a call to list tmux sessions
- **WHEN** tmux hangs for more than 10 seconds
- **THEN** the context deadline cancels the command
- **AND** the function returns an error

### Requirement: Feature Parity with tmux.ts

The Go tmux package SHALL implement: `listSessions` (with byobu session-group filtering), `listWindows` (with `isActiveWindow` flag), `sendKeys`, `createSession` (with optional CWD), `createWindow`, `killSession`, `killWindow`, `renameWindow`, `splitWindow`.

#### Scenario: Byobu filtering
- **GIVEN** tmux has "proj" and "proj-1" (byobu session-group copy)
- **WHEN** `listSessions` is called
- **THEN** only "proj" is returned

#### Scenario: Active window flag
- **GIVEN** tmux session "proj" has 3 windows, window 1 is active
- **WHEN** `listWindows("proj")` is called
- **THEN** window 1 has `isActiveWindow: true`, others `false`

### Requirement: Input Validation

User input SHALL be validated before passing to any subprocess. Validation SHALL include: tilde expansion with `$HOME` security boundary (reject `..` traversal, absolute paths outside home, `~username`), filename sanitization (strip path separators, null bytes, leading dots, collapse dot sequences).

#### Scenario: Path traversal blocked
- **GIVEN** input path `~/../../etc/passwd`
- **WHEN** path validation runs
- **THEN** validation returns an error
- **AND** no subprocess is invoked

## Go Backend: SPA Static Serving

### Requirement: SPA Fallback

The Go server SHALL serve static files from the built SPA directory (default `packages/web/dist/`, configurable). Any request not matching `/api/*` or `/relay/*` SHALL serve `index.html` for client-side routing. Requests matching actual static file paths SHALL serve the file directly.

#### Scenario: Deep link
- **GIVEN** the Go server serves the built SPA
- **WHEN** a browser navigates directly to `/p/my-project`
- **THEN** the server responds with `index.html`
- **AND** TanStack Router handles client-side routing

#### Scenario: Static asset
- **GIVEN** `dist/assets/main.js` exists
- **WHEN** a browser requests `/assets/main.js`
- **THEN** the server responds with the JavaScript file

## Frontend: Vite SPA

### Requirement: Vite Build

The frontend SHALL use Vite with React plugin. Output SHALL be static files in `packages/web/dist/`. No SSR. Tailwind CSS 4 + existing `globals.css`. PostCSS config in `packages/web/`.

#### Scenario: Production build
- **GIVEN** `packages/web/` has dependencies installed
- **WHEN** `pnpm build` is run in `packages/web/`
- **THEN** `dist/` is created with `index.html`, JS bundles, and CSS

### Requirement: TanStack Router

Client-side routing SHALL use TanStack Router with type-safe params. Same three routes: `/` (dashboard), `/p/$project` (project view), `/p/$project/$window` (terminal view). Terminal route SHALL accept optional `name` search param.

#### Scenario: Type-safe route params
- **GIVEN** the SPA is loaded
- **WHEN** user navigates to `/p/my-project/2?name=main`
- **THEN** TanStack Router provides typed params: `project: "my-project"`, `window: "2"`, `name: "main"`

### Requirement: API Client Module

A typed API client module (`packages/web/src/api/`) SHALL wrap all `fetch()` calls with TypeScript types. The module SHALL use relative URLs (e.g., `/api/sessions`) — no hardcoded host/port. This enables both Vite proxy in dev and same-origin in production.

#### Scenario: Typed fetch
- **GIVEN** the Go backend is reachable
- **WHEN** `getSessions()` is called
- **THEN** it fetches `/api/sessions` and returns typed `ProjectSession[]`

### Requirement: Component Migration

Existing components SHALL be migrated to `packages/web/src/components/` with minimal changes. Components already using client patterns (interactivity, hooks) SHALL be migrated as-is. Server Component patterns (data fetching via props from server) SHALL be replaced with page-level fetching or context consumption.

#### Scenario: Component renders identically
- **GIVEN** `SessionCard` receives a `ProjectSession` prop
- **WHEN** the component renders
- **THEN** output is visually identical to the current implementation

### Requirement: Context Providers

`ChromeProvider` and `SessionProvider` SHALL be migrated to `packages/web/src/contexts/`. `SessionProvider` SHALL use `EventSource` to `/api/sessions/stream`. Split context pattern (state/dispatch) SHALL be preserved. `SessionProvider` SHALL forward `isConnected` to `ChromeProvider`.

#### Scenario: SSE via SessionProvider
- **GIVEN** the SPA loads
- **WHEN** `SessionProvider` mounts
- **THEN** `EventSource` connects to `/api/sessions/stream`
- **AND** `useSessions()` provides session data to all pages

### Requirement: WebSocket Terminal Connection

Terminal page SHALL connect via `ws://${location.host}/relay/{session}/{window}`. Same host — no separate port config. Reconnection with exponential backoff (1s, 2s, 4s, 8s, 16s, max 30s) SHALL be preserved.

#### Scenario: Same-port WebSocket
- **GIVEN** SPA served from `http://localhost:3000`
- **WHEN** terminal page opens for session "proj", window "1"
- **THEN** WebSocket connects to `ws://localhost:3000/relay/proj/1`

### Requirement: Page Components

Page components SHALL be rewritten from Next.js App Router to plain React components:
- `pages/dashboard.tsx` — fetches sessions from API via `useSessions()` context
- `pages/project.tsx` — same
- `pages/terminal.tsx` — WebSocket to `ws://${location.host}/relay/{session}/{window}`

Pages set chrome slots via `useChromeDispatch()` and render only content area.

#### Scenario: Dashboard loads sessions
- **GIVEN** the SPA navigates to `/`
- **WHEN** `Dashboard` page renders
- **THEN** sessions are consumed from `SessionProvider` context (not fetched per-page)
- **AND** session cards are rendered

## Development Workflow

### Requirement: Concurrent Dev Servers

`dev.sh` SHALL run Go backend and Vite dev server concurrently. Vite `server.proxy` SHALL forward `/api/*` and `/relay/*` (including WebSocket upgrades with `ws: true`) to the Go server.

#### Scenario: API proxy
- **GIVEN** `dev.sh` is running (Go on :3000, Vite on :5173)
- **WHEN** browser at `http://localhost:5173` fetches `/api/sessions`
- **THEN** Vite proxies to `http://localhost:3000/api/sessions`

#### Scenario: WebSocket proxy
- **GIVEN** `dev.sh` is running
- **WHEN** terminal page connects to `ws://localhost:5173/relay/proj/1`
- **THEN** Vite proxies the WebSocket upgrade to Go

## Build & Deployment

### Requirement: Supervisor Update

`supervisor.sh` SHALL be updated:
1. Build Go binary: `cd packages/api && go build -o ../../bin/run-kit ./cmd/run-kit`
2. Build frontend: `cd packages/web && pnpm build`
3. Start Go server (single process, single port)
4. Health check: `GET /api/health` (10s timeout)
5. Rollback: `git revert HEAD` → rebuild → restart

#### Scenario: Restart cycle
- **GIVEN** `.restart-requested` file detected
- **WHEN** supervisor processes restart
- **THEN** Go binary rebuilt, frontend rebuilt, server restarted
- **AND** health check passes within 10 seconds

### Requirement: Caddyfile Update

`Caddyfile.example` SHALL reverse proxy all traffic to the single Go server. Go handles routing; Caddy handles TLS termination.

#### Scenario: Caddy proxies to Go
- **GIVEN** Caddy configured with example Caddyfile
- **WHEN** request arrives at `https://run-kit.local/api/sessions`
- **THEN** Caddy proxies to `http://localhost:3000/api/sessions`

## Testing

### Requirement: Go Unit Tests

Go SHALL have unit tests using the `testing` package with table-driven tests. Test cases SHALL be ported from existing Vitest tests covering: input validation + tilde expansion (`validate`), config parsing + port validation + defaults (`config`), session parsing + byobu filtering + window activity (`tmux`), session enrichment (`sessions`).

#### Scenario: Go test suite
- **GIVEN** Go module at `packages/api/`
- **WHEN** `go test ./...` is run
- **THEN** all tests pass covering the same edge cases as original Vitest tests

### Requirement: Frontend Unit Tests

Frontend tests SHALL use Vitest with jsdom in `packages/web/`. Existing frontend tests (`command-palette`, `use-keyboard-nav`) SHALL be migrated. Config at `packages/web/vitest.config.ts`.

#### Scenario: Frontend tests
- **GIVEN** `packages/web/` with dependencies
- **WHEN** `pnpm test` runs in `packages/web/`
- **THEN** all migrated tests pass

### Requirement: E2E Test Configuration

Playwright config SHALL start the Go backend + Vite dev server (or built SPA). Test logic SHALL remain unchanged — tests verify browser behavior. Existing suites (chrome stability, breadcrumbs, bottom bar, compose buffer, kill button, mobile) SHALL pass.

#### Scenario: E2E against new stack
- **GIVEN** Go + Vite stack
- **WHEN** `pnpm test:e2e` runs
- **THEN** Playwright starts both servers
- **AND** all existing test suites pass

## Project Config Updates

### Requirement: Source Paths

`fab/project/config.yaml` `source_paths` SHALL be updated to `[packages/api/, packages/web/src/]`.

#### Scenario: Updated config
- **GIVEN** the change is applied
- **WHEN** `config.yaml` is read
- **THEN** `source_paths` is `["packages/api/", "packages/web/src/"]`

## Deprecated Requirements

### Next.js Framework
**Reason**: Replaced by Go backend + Vite SPA. Next.js coupled frontend and backend, blocking independent iteration.
**Migration**: Backend → Go (`packages/api/`). Frontend → Vite SPA (`packages/web/`). API routes → chi handlers. Server Components → client-side fetching.

### Separate Terminal Relay Port
**Reason**: Two-port architecture (Next.js :3000, relay :3001) was a Node.js artifact. Go serves everything on one port.
**Migration**: WebSocket relay at `/relay/{session}/{window}` on same port.

### node-pty Dependency
**Reason**: Replaced by `creack/pty` (native Go). Eliminates native module compilation.
**Migration**: `creack/pty` provides equivalent PTY spawning and I/O.

### ws (WebSocket) Library
**Reason**: Replaced by `gorilla/websocket` (native Go).
**Migration**: `gorilla/websocket` handles WebSocket upgrade and I/O.

## Design Decisions

1. **chi over stdlib ServeMux**: chi for middleware chaining (CORS, logging, recovery). Go 1.22+ ServeMux has pattern matching but lacks ergonomic middleware composition.
   - *Why*: Middleware is central — CORS for multi-client, logging for debugging, recovery for stability.
   - *Rejected*: stdlib ServeMux — capable but requires manual middleware wrapping.

2. **TanStack Router over React Router**: Type-safe params and search params, built-in loader pattern.
   - *Why*: Prevents runtime errors from parameter mismatches. Clean data fetching story.
   - *Rejected*: React Router v6 — params are untyped strings.

3. **Vite proxy in dev (not CORS)**: Single browser URL, no CORS config needed.
   - *Why*: Simplest dev experience — one origin, WebSocket upgrade works transparently.
   - *Rejected*: Cross-origin access — requires CORS tuning, different behavior than production.

4. **SPA fallback in Go (not Caddy-only)**: Go serves standalone without requiring Caddy.
   - *Why*: Deployment flexibility — works standalone in dev and simple deployments.
   - *Rejected*: Caddy-only `try_files` — makes Go dependent on Caddy for routing.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Go for backend, not Rust or Hono | Confirmed from intake #1 — user evaluated all three | S:95 R:30 A:90 D:95 |
| 2 | Certain | Vite + React SPA for frontend | Confirmed from intake #2 | S:90 R:70 A:90 D:85 |
| 3 | Certain | pnpm workspaces monorepo | Confirmed from intake #3 | S:90 R:75 A:85 D:90 |
| 4 | Certain | Single change (not separate split + rewrite) | Confirmed from intake #4 | S:95 R:50 A:95 D:95 |
| 5 | Certain | Drivers: decoupling, multi-client, iteration speed, stability | Confirmed from intake #5 | S:95 R:80 A:90 D:95 |
| 6 | Certain | gorilla/websocket for WebSocket relay | Confirmed from intake #6 | S:95 R:80 A:80 D:70 |
| 7 | Certain | creack/pty for PTY allocation | Confirmed from intake #7 | S:95 R:75 A:85 D:80 |
| 8 | Certain | Same API contract (endpoint parity) | Confirmed from intake #8 — surface can be sanitized later | S:95 R:85 A:80 D:75 |
| 9 | Certain | Tailwind CSS 4 stays | Confirmed from intake #9 | S:95 R:90 A:85 D:85 |
| 10 | Certain | chi router | Confirmed from intake #10 | S:95 R:85 A:90 D:95 |
| 11 | Certain | TanStack Router | Confirmed from intake #11 | S:95 R:80 A:90 D:95 |
| 12 | Certain | Single port architecture | Confirmed from intake #12 | S:95 R:85 A:95 D:95 |
| 13 | Certain | Vite proxy for dev, Go is canonical API | Confirmed from intake clarification | S:95 R:90 A:90 D:90 |
| 14 | Certain | Go catch-all for SPA fallback | Confirmed from intake clarification | S:95 R:85 A:90 D:95 |
| 15 | Certain | Port test cases idiomatically, don't transliterate | Confirmed from intake clarification | S:95 R:85 A:85 D:90 |
| 16 | Certain | Project config updates in scope | Confirmed from intake clarification | S:95 R:90 A:90 D:95 |
| 17 | Confident | Go module path includes packages/api subdirectory | Standard convention for Go modules nested in a polyglot monorepo | S:70 R:90 A:85 D:75 |
| 18 | Confident | slog for structured logging | Go 1.21+ stdlib; no external dependency. zerolog is alternative but slog avoids deps | S:65 R:90 A:80 D:70 |
| 19 | Confident | Graceful shutdown via SIGINT/SIGTERM signal handling | Standard Go server pattern; matches supervisor's signal trapping behavior | S:75 R:85 A:85 D:85 |

19 assumptions (16 certain, 3 confident, 0 tentative, 0 unresolved).
