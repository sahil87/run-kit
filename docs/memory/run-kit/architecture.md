# run-kit Architecture

## System Overview

run-kit is a web-based agent orchestration dashboard. Two independent processes in production, three in development:

1. **Bash supervisor** (`supervisor.sh`) — builds Go binary + frontend, manages the server as a single deployment unit
2. **Go backend** (`app/backend/`, default port 3000) — single binary serving REST API, SSE, WebSocket terminal relay, and SPA static files on one port

> **Legacy note**: `packages/api/` contains the prior implementation, pending removal in Phase 4. The canonical backend is now `app/backend/`.

In development, `dev.sh` runs two concurrent processes:
- Go backend (`:3000`) — API, WebSocket relay, SPA static serving
- Vite dev server (`:5173`) — HMR, proxies `/api/*` and `/relay/*` to Go via `vite.config.ts`

Ports and bind host are configurable via CLI args > `run-kit.yaml` > hardcoded defaults. See `app/backend/internal/config/config.go`.

The tmux server is an external dependency — never started or stopped by run-kit.

## Repository Structure

pnpm workspaces monorepo:

```
app/
  backend/            # Go module — canonical backend (Phase 2+)
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
  frontend/           # (Phase 3 — planned) Vite + React SPA
packages/
  api/                # Legacy Go backend — pending removal in Phase 4
  web/                # Vite + React SPA — disposable frontend
    src/
      api/          # Typed fetch wrappers (client.ts)
      components/   # React components
      contexts/     # ChromeProvider, SessionProvider
      hooks/        # useSessions, useKeyboardNav, useVisualViewport, etc.
      pages/        # dashboard.tsx, project.tsx, terminal.tsx
      router.tsx    # TanStack Router (type-safe routes)
      types.ts      # Shared TypeScript types
    vite.config.ts
    vitest.config.ts
e2e/                # Playwright E2E tests
fab/                # Fab-kit project config + changes
docs/               # Memory files
supervisor.sh       # Production process manager
dev.sh              # Development launcher (Go + Vite concurrent)
Caddyfile.example   # HTTPS reverse proxy (TLS termination only)
pnpm-workspace.yaml # ["packages/web"] — Go is independent
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

> `internal/worktree` was present in `packages/api/` but is not ported to `app/backend/` (dead code, not API-exposed).

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

`packages/web/src/api/client.ts` — typed fetch wrappers for all endpoints. Uses relative URLs (e.g., `/api/sessions`) — works with both Vite proxy in dev and same-origin in production. Exports `getSessions()`, `postSessionAction()`, `getDirectories()`, `uploadFile()` with TypeScript types.

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

The root layout (`packages/web/src/router.tsx` `RootLayout`) owns a flex-col skeleton (height: `var(--app-height, 100vh)`) with three zones:

1. **Top chrome** (`shrink-0`) — `TopBarChrome` component, always-rendered two-line top bar
2. **Content** (`flex-1 overflow-y-auto min-h-0`) — page content, scrollable
3. **Bottom slot** (`shrink-0`) — `BottomSlot` component, renders bottom bar on terminal page via ChromeProvider

All three zones use `max-w-4xl mx-auto w-full px-3 sm:px-6` for identical width/padding — pages cannot override this.

**ChromeProvider** (`packages/web/src/contexts/chrome-context.tsx`) — split into two React contexts: `ChromeStateContext` (read-only state: breadcrumbs, line2Left, line2Right, bottomBar, isConnected, fullbleed) and `ChromeDispatchContext` (stable setter functions). `useChrome()` returns both (backward compat, re-renders on state change). `useChromeDispatch()` returns only setters (stable reference, no re-renders from state changes). Pages that only set chrome slots use `useChromeDispatch()` to avoid cascade re-renders. `Breadcrumb` type includes optional `dropdownItems: BreadcrumbDropdownItem[]` for breadcrumb dropdown menus (project/window switching).

**SessionProvider** (`packages/web/src/contexts/session-context.tsx`) — layout-level React Context that owns the single `EventSource` connection to `/api/sessions/stream`. Exposes `{ sessions, isConnected }` to all descendant pages via `useSessions()` hook. Forwards `isConnected` to `ChromeProvider` internally, eliminating per-page connection status forwarding. Mounted inside `ChromeProvider` in `RootLayout`.

**TopBarChrome** (`packages/web/src/components/top-bar-chrome.tsx`) — reads from ChromeProvider. Line 1: icon breadcrumbs + connection indicator + Cmd+K badge. Line 2: always rendered with `min-h-[36px]`, even when slots are empty (prevents layout shift).

**BottomBar** (`packages/web/src/components/bottom-bar.tsx`) — injected by `TerminalClient` via `setBottomBar()`. Single row of `<kbd>` buttons: modifier toggles (Ctrl/Alt/Cmd with sticky armed state), arrow keys, Fn dropdown (F1-F12, PgUp/PgDn, Home/End), Esc, Tab, and compose toggle. All buttons 44px min-height for mobile touch targets. Sends ANSI escape sequences through the WebSocket ref. Modifier state managed by `useModifierState` hook.

**ComposeBuffer** (`packages/web/src/components/compose-buffer.tsx`) — native `<textarea>` overlay triggered by the compose button or file upload. Supports iOS dictation, autocorrect, paste, multiline. Send button (or Cmd/Ctrl+Enter) transmits entire text as a single WebSocket message. Terminal dims (`opacity-50`) while compose is open. Escape dismisses without sending. Accepts optional `initialText` prop for pre-populating with uploaded file paths; appends on subsequent updates while open.

**iOS Keyboard Support** — `useVisualViewport` hook (`packages/web/src/hooks/use-visual-viewport.ts`) listens to both `resize` and `scroll` events on `window.visualViewport`, setting `--app-height` CSS custom property from `visualViewport.height`. The `scroll` listener is needed because iOS Safari may fire scroll events (not just resize) when adjusting the viewport for the keyboard. In fullbleed mode (terminal page), `globals.css` applies `position: fixed; inset: 0; height: var(--app-height, 100vh)` to the `.app-shell` container, decoupling it from document scroll — this prevents the keyboard from pushing the app container off-screen. Non-fullbleed pages (dashboard, project) are unaffected. The bottom bar stays pinned above the keyboard; the terminal shrinks via `flex-1` and xterm refits via `ResizeObserver`.

**iOS Touch Scroll Prevention** — `ContentSlot` toggles a `fullbleed` CSS class on `document.documentElement` when the terminal page is active. `globals.css` applies `overflow: hidden` and `overscroll-behavior: none` to `html.fullbleed` and `html.fullbleed body`, preventing iOS Safari elastic bounce scrolling. The terminal container div uses `touch-none` (`touch-action: none`) so the browser yields touch gestures to xterm.js for scrollback handling.

Pages do NOT render their own top bar or outer containers — they set chrome slots and render only their content area.

## Design Decisions

- **Go backend + Vite SPA over Next.js monolith** — decouples frontend and backend for independent iteration. Go backend is a stable, long-lived API that outlives any individual frontend. Multi-client API support (web, mobile, CLI) without split API surface
- **Single port architecture** — Go serves API, WebSocket relay, and SPA static files on one port. The two-port split (Next.js :3000, relay :3001) was a Node.js artifact — separate processes required separate ports. Go serves everything in one binary
- **chi over stdlib ServeMux** — chi for middleware chaining (CORS, logging, recovery). Go 1.22+ ServeMux has pattern matching but lacks ergonomic middleware composition
- **TanStack Router over React Router** — type-safe params and search params, built-in loader pattern. Prevents runtime errors from parameter mismatches
- **Vite proxy in dev (not CORS)** — single browser URL, no CORS config needed. WebSocket upgrade works transparently. Go includes chi CORS middleware for production/non-browser clients
- **SPA fallback in Go (not Caddy-only)** — Go serves standalone without requiring Caddy. Caddy is optional for TLS termination
- **SSE (not WebSocket) for session state** — simpler, server-push only, naturally resilient. Module-level hub deduplicates polling across tabs (one `FetchSessions()` per interval regardless of client count). SSE data includes `isActiveWindow` per window, enabling UI sync when users switch tmux/byobu windows via terminal shortcuts
- **Full snapshots (not diffs)** — small payload (<100 sessions), simple client logic
- **Independent panes per browser client** — no cursor fights, agent pane untouched. The relay pty follows byobu window switches natively (runs `tmux attach-session`)
- **Every tmux session is a project** — no config, no "Other" bucket. Project root derived from window 0's `pane_current_path`
- **Config resolution: CLI > YAML > defaults** — `internal/config/config.go` reads `run-kit.yaml` (optional, gitignored) and CLI args. No relay port — single port serves everything
- **Byobu session-group filtering** — `ListSessions()` filters out derived session-group copies to avoid duplicate projects. See `docs/memory/run-kit/tmux-sessions.md`
- **Layout-owned chrome (not per-page TopBar)** — Split React Context for slot injection: state context (re-renders readers) and dispatch context (stable setters, no re-renders). Pages inject content via `useChromeDispatch()` setters in `useEffect`; layout renders it in fixed positions. Prevents both layout shift and cascade re-renders.
- **Layout-level SessionProvider (not per-page SSE)** — Single `EventSource` connection at layout level, shared across all pages. Eliminates redundant connections and per-page `isConnected` forwarding boilerplate.
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

### Frontend Unit Tests

Vitest with jsdom environment. Config at `packages/web/vitest.config.ts`. Setup file at `packages/web/src/test-setup.ts` imports `@testing-library/jest-dom/vitest` for extended DOM matchers.

Test scripts: `pnpm test` (single run, in `packages/web/`), `pnpm test:watch` (watch mode).

Test files co-located with source using `.test.{ts,tsx}` suffix (test-alongside strategy per `code-quality.md`). Path alias `@/` resolves to `src/` in both app and test contexts.

Current frontend test coverage: `command-palette.tsx` (keyboard interaction, filtering, open/close), `use-keyboard-nav.ts` (j/k/Enter navigation, input skip, clamping, custom shortcuts).

### Playwright E2E Tests

Playwright for browser-level integration tests. Config at `playwright.config.ts` (repo root). E2E tests live in `e2e/` (separate from unit tests). Two projects: `desktop` (Chromium) and `mobile` (WebKit, iPhone 14 viewport). `mobile.spec.ts` runs only on the mobile project; all other specs run only on desktop.

Test scripts: `pnpm test:e2e` (headless), `pnpm test:e2e:ui` (interactive UI mode). Web server auto-starts via `bash dev.sh` (Go + Vite) if not already running (`reuseExistingServer: true`).

Tests self-manage tmux sessions via `POST /api/sessions` in `beforeAll`/`afterAll` hooks. Shared helpers in `e2e/helpers.ts`.

E2E test suites:
- `chrome-stability.spec.ts` — top bar bounding box invariance across page navigation, Line 2 min-height, max-width 896px
- `breadcrumbs.spec.ts` — page-specific breadcrumb segments, link verification, no text prefixes
- `bottom-bar.spec.ts` — terminal-only visibility, modifier armed state (`aria-pressed`), Fn dropdown lifecycle, special keys
- `compose-buffer.spec.ts` — open/close flow, terminal dimming, Send button, multiline input
- `kill-button.spec.ts` — always-visible kill buttons, confirmation dialog flow
- `mobile.spec.ts` — mobile bottom bar rendering, tap target minimum height (30px), Cmd+K badge visibility

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
| 2026-03-10 | **Go backend + Vite SPA split** — replaced Next.js monolith with Go backend (`packages/api/`) + Vite React SPA (`packages/web/`). Single-port architecture (API, SSE, WebSocket relay, SPA static serving on one Go binary). chi router, gorilla/websocket, creack/pty. TanStack Router for client-side routing. Typed API client module. Go table-driven tests ported from Vitest. E2E tests updated for Go + Vite dev servers. | `260310-8xaq-go-backend-vite-spa-split` |
| 2026-03-12 | **Go backend API at `app/backend/`** — new canonical backend alongside legacy `packages/api/`. Handler files split by resource domain (sessions.go, windows.go, etc.). POST-only mutations with path-based intent. `internal/fab` rewritten to read `.fab-status.yaml` directly (no subprocess). Per-session fab enrichment model. `WindowInfo` fields changed: `FabChange`/`FabStage` replace `FabStage`/`FabProgress`. Upload endpoint session from URL path. Handler integration tests via `httptest.NewRecorder` + mock interfaces. SPA serves from `app/frontend/dist/`. | `260312-r4t9-go-backend-api` |
