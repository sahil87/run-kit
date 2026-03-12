# run-kit Architecture

## System Overview

run-kit is a web-based agent orchestration dashboard. Two independent processes in production, three in development:

1. **Bash supervisor** (`supervisor.sh`) — builds Go binary + frontend, manages the server as a single deployment unit
2. **Go backend** (`app/backend/`, default port 3000) — single binary serving REST API, SSE, WebSocket terminal relay, and SPA static files on one port

In development, `just dev` runs two concurrent processes:
- Go backend (`:3000`) — API, WebSocket relay, SPA static serving
- Vite dev server (`:5173`) — HMR, proxies `/api/*` and `/relay/*` to Go via `vite.config.ts`

Ports and bind host are configurable via CLI args > `run-kit.yaml` > hardcoded defaults. See `app/backend/internal/config/config.go`.

The tmux server is an external dependency — never started or stopped by run-kit.

## Repository Structure

pnpm workspaces monorepo:

```
app/
  backend/            # Go module — backend
    cmd/run-kit/      # Entry point (main.go)
    internal/         # validate, config, tmux, fab, sessions
    api/              # HTTP handlers — one file per resource domain
      router.go       # chi router, CORS/logger/recovery middleware, route registration
      health.go       # GET /api/health
      sessions.go     # GET /api/sessions, POST /api/sessions, POST .../kill
      windows.go      # POST .../windows (create, kill, rename, keys)
      directories.go  # GET /api/directories
      upload.go       # POST /api/sessions/:session/upload
      sse.go          # GET /api/sessions/stream (hub singleton)
      relay.go        # WS /relay/:session/:window
      spa.go          # SPA static serving from app/frontend/dist/
    go.mod, go.sum
  frontend/           # Vite + React SPA — single-view UI
fab/                # Fab-kit project config + changes
docs/               # Memory files
supervisor.sh       # Production process manager
justfile            # Task runner (dev, verify, test commands)
Caddyfile.example   # HTTPS reverse proxy (TLS termination only)
pnpm-workspace.yaml # ["app/frontend"] — Go is independent
```

## Data Model

**No database.** State derived at request time from:
- **tmux server** — `tmux list-sessions`, `tmux list-windows` via `internal/tmux/tmux.go`. Project roots derived from window 0's `pane_current_path`
- **Filesystem** — `.fab-status.yaml` via `internal/fab/fab.go` (reads change name + active stage). Fab-kit projects auto-detected via `os.Stat()` on `fab/project/config.yaml` at the derived project root

## Backend Libraries (Go Modules)

Packages in `app/backend/internal/`:

| Package | Responsibility |
|---------|---------------|
| `internal/tmux` | All tmux operations via `os/exec.CommandContext` with argument slices + `context.WithTimeout` (10s). `ListWindows()` includes `isActiveWindow` flag from `#{window_active}`. `WindowInfo` struct uses `FabChange`/`FabStage` fields (replaced legacy `FabStage`/`FabProgress`) |
| `internal/fab` | Reads `.fab-status.yaml` from project root via `os.ReadFile` + `yaml.Unmarshal`. Returns `*State{Change, Stage}` (active change name + first active stage in canonical order). Returns nil if file missing, dangling symlink, or parse error. No subprocess calls |
| `internal/sessions` | Derives project roots from tmux, auto-detects fab-kit via `os.Stat("fab/project/config.yaml")`, enriches with fab state. Per-session enrichment model: reads `.fab-status.yaml` once from window 0's project root, applies `FabChange`/`FabStage` to all windows in the session. Session enrichment runs in parallel via goroutines with `sync.WaitGroup` and indexed assignment to preserve tmux ordering |
| `internal/validate` | Input validation for names/paths + tilde expansion with `$HOME` security boundary + filename sanitization for uploads |
| `internal/config` | Server config (port, host) — reads CLI args > `run-kit.yaml` > defaults. YAML parsing via `gopkg.in/yaml.v3` |

### External Go Dependencies

| Module | Purpose |
|--------|---------|
| `github.com/go-chi/chi/v5` | HTTP router with middleware chaining (CORS, logging, recovery) |
| `github.com/go-chi/cors` | CORS middleware (permissive by default for multi-client API) |
| `github.com/gorilla/websocket` | WebSocket handling for terminal relay |
| `github.com/creack/pty` | PTY allocation (replaces node-pty, no native module compilation) |
| `gopkg.in/yaml.v3` | YAML config parsing |

## API Layer

All endpoints served by the single Go binary on one port. POST-only mutations with path-based intent (no multiplexed action field).

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/health` | GET | Returns `200 {"status":"ok"}` for supervisor health checks |
| `/api/sessions` | GET | Returns `ProjectSession[]` — one per tmux session, with auto-detected fab enrichment (`fabChange`/`fabStage` on windows) |
| `/api/sessions` | POST | Create session — JSON body `{"name":"...","cwd":"..."}`. Returns `201 {"ok":true}` |
| `/api/sessions/:session/kill` | POST | Kill session — `:session` validated via `validate.ValidateName()`. Returns `200 {"ok":true}` |
| `/api/sessions/:session/windows` | POST | Create window — JSON body `{"name":"...","cwd":"..."}`. Returns `201 {"ok":true}` |
| `/api/sessions/:session/windows/:index/kill` | POST | Kill window — `:index` must be non-negative integer. Returns `200 {"ok":true}` |
| `/api/sessions/:session/windows/:index/rename` | POST | Rename window — JSON body `{"name":"..."}`. Returns `200 {"ok":true}` |
| `/api/sessions/:session/windows/:index/keys` | POST | Send keys — JSON body `{"keys":"..."}` (non-empty after trim). Returns `200 {"ok":true}` |
| `/api/directories` | GET | Server-side directory listing for autocomplete — `?prefix=~/code/wvr` returns matching dirs under `$HOME` |
| `/api/sessions/:session/upload` | POST | File upload — session from URL path (not form field). Multipart with `file` field, optional `window` field (defaults to `"0"`). Resolves project root via `ListWindows`, writes to `.uploads/{timestamp}-{name}`, auto-manages `.gitignore`. 50MB limit. Returns `200 {"ok":true,"path":"..."}` |
| `/api/sessions/stream` | GET | SSE — hub singleton polls tmux every 2.5s, fans out full snapshots to all connected clients on change. Deduplicates polling across browser tabs. 30-minute lifetime cap per connection |

### Frontend API Client

`app/frontend/src/api/client.ts` — typed fetch wrappers for all endpoints using POST-only mutations with path-based intent. Uses relative URLs — works with both Vite proxy in dev and same-origin in production. Exports individual functions per endpoint:

| Function | Method | Path |
|----------|--------|------|
| `getSessions()` | GET | `/api/sessions` |
| `createSession(name, cwd?)` | POST | `/api/sessions` |
| `killSession(session)` | POST | `/api/sessions/:session/kill` |
| `createWindow(session, name, cwd?)` | POST | `/api/sessions/:session/windows` |
| `killWindow(session, index)` | POST | `/api/sessions/:session/windows/:index/kill` |
| `renameWindow(session, index, name)` | POST | `/api/sessions/:session/windows/:index/rename` |
| `sendKeys(session, index, keys)` | POST | `/api/sessions/:session/windows/:index/keys` |
| `getDirectories(prefix)` | GET | `/api/directories?prefix=...` |
| `uploadFile(session, file, window?)` | POST | `/api/sessions/:session/upload` |

No multiplexed `action` field — each mutation is a separate function with its own URL path.

## Terminal Relay

WebSocket endpoint at `/relay/{session}/{window}` on the same port as the API — no separate relay port. Uses `gorilla/websocket` for WebSocket handling and `creack/pty` for PTY allocation. Implementation in `app/backend/api/relay.go`.

Per connection:
1. Creates independent pane via `tmux split-window` (agent pane 0 untouched)
2. Spawns `tmux attach-session -t <paneId>` via `creack/pty` for real terminal I/O
3. Relays I/O between WebSocket and pty (goroutine for pty→WS, main loop for WS→pty)
4. Handles resize messages (JSON `{"type":"resize","cols":N,"rows":N}`) via `pty.Setsize`
5. On disconnect: kills pty + pane via `sync.Once` cleanup (no orphaned panes)

Client-side WebSocket reconnection: exponential backoff (1s, 2s, 4s, 8s, 16s, max 30s) on unexpected close. Shows `[reconnecting...]` in terminal. Re-sends resize on successful reconnect. Skips reconnect on component unmount. Terminal page connects via `ws://${location.host}/relay/{session}/{window}` — same host, no config needed.

## Supervisor

~140-line bash script. Reads `run-kit.yaml` at startup via grep-based parsing (no `yq` dependency) for port/host config. Polling loop checks for `.restart-requested` file.

Build cycle: `go build -o bin/run-kit ./cmd/run-kit` (Go binary) + `pnpm build` (frontend to `app/frontend/dist/`).
On detection: build all → kill server → start Go server → `GET /api/health` (10s timeout).
On failure: `git revert HEAD` → rebuild → restart prior version.
Signal trapping: SIGINT/SIGTERM → `stop_services` → clean exit.
Auto-restart: detects if server process died and restarts automatically.

## SPA Static Serving

The Go server serves static files from the built SPA directory (`app/frontend/dist/`). Any request not matching `/api/*` or `/relay/*` serves `index.html` for client-side routing (SPA fallback). Requests matching actual static file paths serve the file directly. Path traversal is prevented (resolved path must stay within SPA directory). Implementation in `app/backend/api/spa.go`.

In development, Vite handles SPA fallback natively. In production, Go's catch-all handles it. Caddy is optional — used only for TLS termination, not routing.

## Chrome Architecture

The root layout (`app/frontend/src/app.tsx`) owns a fixed chrome skeleton (height: `var(--app-height, 100vh)`) with four zones:

1. **Top chrome** (`shrink-0`) — `TopBarChrome`, always-rendered two-line top bar
2. **Main area** (`flex-1 flex flex-row min-h-0`) — sidebar + terminal side by side
   - **Sidebar** (`w-[220px] shrink-0 overflow-y-auto`, hidden on mobile < 768px) — session/window tree
   - **Terminal** (`flex-1 min-w-0`) — xterm.js + WebSocket relay
3. **Bottom bar** (`shrink-0`) — always visible (terminal is always the main content)

No `max-w-4xl` constraint — all zones span full width. Terminal fills all available space right of the sidebar.

**ChromeProvider** (`app/frontend/src/contexts/chrome-context.tsx`) — split into two React contexts: `ChromeStateContext` (read-only state: current session:window selection, sidebar open/collapsed, drawer state, isConnected, fullbleed) and `ChromeDispatchContext` (stable setter functions). Chrome derives its content from the current selection — no slot injection. `setLine2Left`, `setLine2Right`, `setBottomBar` removed; top bar and bottom bar read the selection directly. `Breadcrumb` type includes optional `dropdownItems` for session/window switching.

**SessionProvider** (`app/frontend/src/contexts/session-context.tsx`) — layout-level React Context that owns the single `EventSource` connection to `/api/sessions/stream`. Exposes `{ sessions, isConnected }` via `useSessions()` hook. Forwards `isConnected` to `ChromeProvider` internally. Mounted inside `ChromeProvider` in the root layout.

**TopBarChrome** (`app/frontend/src/components/top-bar-chrome.tsx`) — reads from ChromeProvider. Line 1: `☰` toggle + icon breadcrumbs + connection indicator + `⌘K`/`⋯`. Line 2: always rendered with `min-h-[36px]` (prevents layout shift).

**Sidebar** (`app/frontend/src/components/sidebar.tsx`) — session/window tree. Desktop: always visible at `w-[220px]`, collapsible via `☰`. Mobile (< 768px): drawer overlay from the left, triggered by `☰`.

**BottomBar** (`app/frontend/src/components/bottom-bar.tsx`) — always visible. Single row of `<kbd>` buttons: modifier toggles (Ctrl/Alt/Cmd with sticky armed state), arrow keys, Fn dropdown (F1-F12, PgUp/PgDn, Home/End), Esc, Tab, and compose toggle. All buttons 44px min-height for mobile touch targets. Sends ANSI escape sequences through the WebSocket ref. Modifier state managed by `useModifierState` hook.

**ComposeBuffer** (`app/frontend/src/components/compose-buffer.tsx`) — native `<textarea>` overlay triggered by the compose button or file upload. Supports iOS dictation, autocorrect, paste, multiline. Send button (or Cmd/Ctrl+Enter) transmits entire text as a single WebSocket message. Terminal dims (`opacity-50`) while compose is open. Escape dismisses without sending. Accepts optional `initialText` prop for pre-populating with uploaded file paths; appends on subsequent updates while open.

**iOS Keyboard Support** — `useVisualViewport` hook (`app/frontend/src/hooks/use-visual-viewport.ts`) listens to both `resize` and `scroll` events on `window.visualViewport`, setting `--app-height` CSS custom property from `visualViewport.height`. In the single-view model (fullbleed always on), `globals.css` applies `position: fixed; inset: 0; height: var(--app-height, 100vh)` to the app shell. The bottom bar stays pinned above the keyboard; the terminal shrinks via `flex-1` and xterm refits via `ResizeObserver`.

**iOS Touch Scroll Prevention** — Fullbleed is always active in the single-view model. `globals.css` applies `overflow: hidden` and `overscroll-behavior: none` to both `html` and `body`, preventing iOS Safari elastic bounce scrolling. The terminal container div uses `touch-none` (`touch-action: none`) so the browser yields touch gestures to xterm.js for scrollback handling.

Single-view model: there are no page transitions or per-page chrome injection. The chrome reads the current selection and renders directly.

## Design Decisions

- **Go backend + Vite SPA over Next.js monolith** — decouples frontend and backend for independent iteration. Go backend is a stable, long-lived API that outlives any individual frontend. Multi-client API support (web, mobile, CLI) without split API surface
- **Single port architecture** — Go serves API, WebSocket relay, and SPA static files on one port. The two-port split (Next.js :3000, relay :3001) was a Node.js artifact — separate processes required separate ports. Go serves everything in one binary
- **chi over stdlib ServeMux** — chi for middleware chaining (CORS, logging, recovery). Go 1.22+ ServeMux has pattern matching but lacks ergonomic middleware composition
- **TanStack Router over React Router** — type-safe params and search params, built-in loader pattern. Single route `/:session/:window` in the new frontend
- **Vite proxy in dev (not CORS)** — single browser URL, no CORS config needed. WebSocket upgrade works transparently. Go includes chi CORS middleware for production/non-browser clients
- **SPA fallback in Go (not Caddy-only)** — Go serves standalone without requiring Caddy. Caddy is optional for TLS termination
- **SSE (not WebSocket) for session state** — simpler, server-push only, naturally resilient. Module-level hub deduplicates polling across tabs (one `FetchSessions()` per interval regardless of client count). SSE data includes `isActiveWindow` per window, enabling UI sync when users switch tmux/byobu windows via terminal shortcuts
- **Full snapshots (not diffs)** — small payload (<100 sessions), simple client logic
- **Independent panes per browser client** — no cursor fights, agent pane untouched. The relay pty follows byobu window switches natively (runs `tmux attach-session`)
- **Every tmux session is a project** — no config, no "Other" bucket. Project root derived from window 0's `pane_current_path`
- **Config resolution: CLI > YAML > defaults** — `internal/config/config.go` reads `run-kit.yaml` (optional, gitignored) and CLI args. No relay port — single port serves everything
- **Byobu session-group filtering** — `ListSessions()` filters out derived session-group copies to avoid duplicate projects. See `docs/memory/run-kit/tmux-sessions.md`
- **Derived chrome (not slot injection)** — Single-view model means only one chrome state (terminal-focused). Top bar and bottom bar derive content from the current session:window selection. No `setLine2Left`/`setLine2Right`/`setBottomBar` setters. Split React Context preserved for performance (state vs dispatch).
- **Layout-level SessionProvider (not per-page SSE)** — Single `EventSource` connection at layout level. Eliminates redundant connections and per-page `isConnected` forwarding boilerplate.
- **Single-view layout (sidebar + terminal) replaces three pages** — Dashboard and Project page functionality subsumed by the sidebar. Terminal is always visible. No page transitions.
- **POST-only API client with path-based intent** — Each mutation is a separate function with its own URL (e.g., `killSession(session)` → `POST /api/sessions/:session/kill`). No multiplexed `action` field in request bodies.
- **Sidebar + drawer pattern on mobile** — Desktop sidebar is `w-[220px]`, collapsible. Mobile (< 768px) uses a left-side drawer overlay triggered by `☰`. Preserves session/window tree layout across breakpoints.
- **Active window sync via `history.replaceState` (not `router.replace()`)** — When byobu switches windows, the terminal relay pty already shows the correct content. The UI syncs breadcrumb, URL, and action targets via SSE polling (2.5s). URL updates use `window.history.replaceState()` which is invisible to the router — no re-render, no terminal reinitialization.
- **Sticky modifier state via useRef + forceUpdate** — `useModifierState` uses a ref for the authoritative state and a counter state to trigger re-renders. Ensures `consume()` reads the latest value atomically without stale closure issues.
- **Compose buffer as native textarea (not xterm input)** — xterm renders to `<canvas>`, blocking OS-level input features. The compose buffer provides a real `<textarea>` where dictation, autocorrect, paste, and IME all work. Text sent as a single WebSocket message.
- **Armed modifiers bridge to physical keyboard** — When bottom-bar modifiers (Ctrl/Alt/Cmd) are armed, a capture-phase `keydown` listener intercepts physical keypresses, translates them to terminal escape sequences (Ctrl+letter → control characters, Alt/Cmd → ESC prefix), and sends via WebSocket. Prevents xterm from receiving the unmodified key. Ignores real Cmd/Ctrl/Alt held by the OS.
- **File upload via server filesystem (not terminal binary injection)** — Browser uploads file to `POST /api/sessions/:session/upload`, server writes to `.uploads/` in project root, path auto-inserted into compose buffer. Works because run-kit server and tmux are always co-located; the browser is the remote part. Session identified by URL param (consistent with other session-scoped endpoints, replaces legacy form field approach)
- **Handler files split by resource domain (not monolithic routes.go)** — Each handler file owns one resource: `sessions.go`, `windows.go`, `directories.go`, `upload.go`, `sse.go`, `relay.go`, `spa.go`, `health.go`. `router.go` owns middleware, dependency interfaces, and route registration only. (`260312-r4t9-go-backend-api`)
- **Dependency injection via interfaces for handler testability** — `Server` struct holds `SessionFetcher` and `TmuxOps` interfaces. `NewRouter()` wires production implementations; `NewTestRouter()` accepts mocks. Enables `httptest.NewRecorder` tests without live tmux. (`260312-r4t9-go-backend-api`)
- **Per-session fab enrichment (not per-window)** — `internal/sessions` reads `.fab-status.yaml` once from window 0's project root and applies `FabChange`/`FabStage` to all windows in the session. Eliminates redundant filesystem reads and subprocess calls per window. (`260312-r4t9-go-backend-api`)
- **`internal/fab` reads `.fab-status.yaml` directly (not subprocess)** — Pure `os.ReadFile` + `yaml.Unmarshal`, no calls to `statusman.sh` or `changeman.sh`, no reading `fab/current`. Simpler, faster, no shell dependency. (`260312-r4t9-go-backend-api`)

## Testing

### Go Unit Tests

Go `testing` package with table-driven tests. Test files co-located with source using `_test.go` suffix. Test scripts: `go test ./...` from `app/backend/`.

Current Go test coverage (`app/backend/`):
- **Internal packages**: `internal/validate` (input validation + tilde expansion + filename sanitization), `internal/config` (CLI arg parsing, port validation, YAML parsing, defaults), `internal/tmux` (listSessions parsing + byobu filtering, listWindows activity computation), `internal/sessions` (fab-kit detection, project root derivation, per-session enrichment), `internal/fab` (`.fab-status.yaml` parsing, missing file, dangling symlink, all-done stages)
- **Handler integration tests**: `api/health_test.go`, `api/sessions_test.go`, `api/windows_test.go`, `api/directories_test.go`, `api/upload_test.go`, `api/sse_test.go`, `api/spa_test.go` — all use `httptest.NewRecorder` with the chi router and mock `SessionFetcher`/`TmuxOps` interfaces for tmux isolation. Cover response shapes, validation errors, URL param parsing, content-type enforcement. `api/relay.go` has no unit test (requires live tmux + PTY)

### Frontend Unit Tests (app/frontend/)

Vitest with jsdom environment. Config at `app/frontend/vitest.config.ts`. MSW mocks all API endpoints and the SSE stream (`app/frontend/tests/msw/handlers.ts`). Test files co-located with source using `.test.{ts,tsx}` suffix.

Test coverage includes: sidebar (expand/collapse, window selection, kill session), breadcrumb dropdowns (open/close, selection), drawer (open via hamburger, close on selection), keyboard shortcuts (j/k navigation, c for create, Cmd+K palette), command palette, modifier state, touch targets (44px on `coarse`), API client (correct URL construction for each endpoint).

### Playwright E2E Tests (app/frontend/tests/e2e/)

Thin suite (3-5 tests) for API round-trip validation. Config at `app/frontend/playwright.config.ts`. Self-managed tmux sessions in `beforeAll`/`afterAll` hooks.

E2E test coverage: create/kill session via UI, SSE stream delivers real data, sidebar navigation.

## Security

- All subprocess calls use `os/exec.CommandContext` with argument slices (never `sh -c` or shell strings)
- All `exec.CommandContext` calls include timeout via `context.WithTimeout` (10s tmux, 30s build). Terminal relay attach uses `context.WithCancel` (long-lived, cancelled on disconnect)
- User input validated via `internal/validate` before reaching any subprocess
- Directory listing restricted to `$HOME` via `ExpandTilde()` — rejects `..` traversal, absolute paths outside home, and `~username` syntax. Symlinks under `$HOME` are not resolved (accepted risk for local dev tool)
- File uploads: filename sanitized via `SanitizeFilename()` (strips path separators, null bytes, leading dots, collapses dot sequences); 50MB size limit enforced server-side via `http.MaxBytesReader`; writes via `os.Create` (not subprocess)
- CORS: permissive by default (`*` origin) for multi-client API flexibility. Caddy handles TLS in production

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
| 2026-03-06 | Bottom bar (modifier toggles, arrow keys, Fn dropdown, compose buffer), iOS keyboard support via visualViewport, `i` key compose toggle | `260305-fjh1-bottom-bar-compose-buffer` |
| 2026-03-06 | Performance: parallel session enrichment, SSE pub/sub singleton, split ChromeContext, layout-level SessionProvider, ResizeObserver debounce, useModifierState memoization, WS reconnection | `260306-0ahl-perf-sse-chrome-sessions` |
| 2026-03-07 | iOS touch scroll prevention — fullbleed class toggle on html, touch-none on terminal container | `260307-8n60-fix-ios-terminal-touch-scroll` |
| 2026-03-07 | File upload: `/api/upload` endpoint, clipboard paste/drag-drop/file picker triggers, compose buffer integration, `.uploads/` auto-gitignore | `260307-kqio-image-upload-claude-terminal` |
| 2026-03-07 | iOS keyboard viewport overlap fix — visualViewport scroll listener, fixed positioning in fullbleed mode | `260307-f3o9-ios-keyboard-viewport-overlap` |
| 2026-03-07 | Sync byobu active tab — `isActiveWindow` on `WindowInfo`, breadcrumb/URL/action sync via SSE + `history.replaceState` | `260307-f3li-sync-byobu-active-tab` |
| 2026-03-07 | Breadcrumb type extended with `dropdownItems` for project/window switching dropdowns | `260307-uzsa-navbar-breadcrumb-dropdowns` |
| 2026-03-07 | Playwright E2E tests — chrome stability, breadcrumbs, bottom bar, compose buffer, kill button, mobile viewport | `260305-r7zs-playwright-e2e-design-spec` |
| 2026-03-10 | **Go backend + Vite SPA split** — replaced Next.js monolith with Go backend + Vite React SPA. Single-port architecture (API, SSE, WebSocket relay, SPA static serving on one Go binary). chi router, gorilla/websocket, creack/pty. TanStack Router for client-side routing. Typed API client module. Go table-driven tests ported from Vitest. E2E tests updated for Go + Vite dev servers. | `260310-8xaq-go-backend-vite-spa-split` |
| 2026-03-12 | **Go backend API at `app/backend/`** — handler files split by resource domain (sessions.go, windows.go, etc.). POST-only mutations with path-based intent. `internal/fab` rewritten to read `.fab-status.yaml` directly (no subprocess). Per-session fab enrichment model. `WindowInfo` fields changed: `FabChange`/`FabStage` replace `FabStage`/`FabProgress`. Upload endpoint session from URL path. Handler integration tests via `httptest.NewRecorder` + mock interfaces. SPA serves from `app/frontend/dist/`. | `260312-r4t9-go-backend-api` |
| 2026-03-12 | **Vite/React frontend at `app/frontend/`** — single-view UI (sidebar + terminal, one route `/:session/:window`), POST-only API client with path-based intent, ChromeProvider derives from selection (no slot injection), sidebar with session/window tree + mobile drawer, MSW-backed Vitest, Playwright E2E at `app/frontend/tests/e2e/` | `260312-ux92-vite-react-frontend` |
| 2026-03-12 | **Cleanup old implementation** — removed legacy backend and frontend directories, `e2e/`, root `playwright.config.ts`. Updated `pnpm-workspace.yaml` to `["app/frontend"]`. Removed legacy test sections and stale path references from memory. | `260312-n11e-cleanup-old-implementation` |
