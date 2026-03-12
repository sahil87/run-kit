# run-kit Architecture

## System Overview

run-kit is a web-based agent orchestration dashboard. Two independent processes in production, three in development:

1. **Bash supervisor** (`supervisor.sh`) — builds Go binary from `app/backend/` + frontend from `app/frontend/`, manages the server as a single deployment unit
2. **Go backend** (default port 3000) — single binary serving REST API, SSE, WebSocket terminal relay, and SPA static files on one port

In development, `just dev` runs two concurrent processes (replaces the removed `dev.sh`):
- Go backend (`:3000`) via `go run ./cmd/run-kit` from `app/backend/` — API, WebSocket relay, SPA static serving
- Vite dev server (`:5173`) via `pnpm dev` from `app/frontend/` — HMR, proxies `/api/*` and `/relay/*` to Go via `vite.config.ts`

Ports and bind host are configurable via CLI args > `run-kit.yaml` > hardcoded defaults. See `packages/api/internal/config/config.go` (old) / `app/backend/internal/config/` (new scaffold).

The tmux server is an external dependency — never started or stopped by run-kit.

## Repository Structure

pnpm workspaces monorepo. Two codebases coexist during the reimplementation: `packages/` (legacy, untouched until Phase 4 cleanup) and `app/` (new scaffold, Phases 1-3).

### New: `app/` (scaffold — Phase 1)

```
app/
  backend/            # Go module — new scaffold
    cmd/run-kit/      # Entry point (main.go — prints "run-kit" and exits)
    api/              # HTTP handler placeholders (router.go, sessions.go, windows.go,
                      #   directories.go, upload.go, sse.go, relay.go, health.go, spa.go)
    internal/         # tmux/, sessions/, fab/, config/, validate/ — each with
                      #   placeholder .go + empty _test.go (no internal/worktree/ — dead code)
    go.mod, go.sum
  frontend/           # Vite + React SPA — new scaffold
    src/
      api/            # Type stubs (client.ts — all functions throw "not implemented")
      main.tsx        # Minimal React entry
      app.tsx         # Single-view layout skeleton (top bar, sidebar, terminal, bottom bar)
      router.tsx      # TanStack Router — one route: /:session/:window
      types.ts        # ProjectSession, WindowInfo types matching API spec
      test-setup.ts   # @testing-library/jest-dom/vitest
    tests/
      msw/            # MSW handler stubs (handlers.ts)
      e2e/            # Playwright smoke test (smoke.spec.ts — test.skip)
    index.html
    vite.config.ts    # React plugin, @/ alias, proxy /api/* and /relay/* to :3000
    vitest.config.ts  # jsdom environment
    tsconfig.json
    playwright.config.ts  # Chromium desktop project, tests/e2e/
    package.json
```

### Legacy: `packages/` (functional code — until Phase 4)

```
packages/
  api/              # Go module — stable backend (fully functional)
    cmd/run-kit/    # Entry point (main.go)
    internal/       # tmux, config, fab, worktree, sessions, validate, relay
    api/            # HTTP handlers (routes.go, sse.go, relay.go, upload.go, spa.go)
    go.mod, go.sum
  web/              # Vite + React SPA — disposable frontend (fully functional)
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
```

### Root files

```
e2e/                # Playwright E2E tests (legacy, for packages/web)
fab/                # Fab-kit project config + changes
docs/               # Memory files
justfile            # Task runner — all recipes target app/ paths (replaced dev.sh)
supervisor.sh       # Production process manager (updated to app/ paths)
Caddyfile.example   # HTTPS reverse proxy (TLS termination only)
pnpm-workspace.yaml # ["app/frontend"] — updated from ["packages/web"]
```

## Data Model

**No database.** State derived at request time from:
- **tmux server** — `tmux list-sessions`, `tmux list-windows` via `internal/tmux/tmux.go`. Project roots derived from window 0's `pane_current_path`
- **Filesystem** — `fab/current`, `.status.yaml` via `internal/fab/fab.go`. Fab-kit projects auto-detected via `os.Stat()` on `fab/project/config.yaml` at the derived project root

## Backend Libraries (Go Modules)

Functional code lives in `packages/api/` until Phase 2+ ports it to `app/backend/`. The `app/backend/internal/` packages are empty placeholders (package declaration + exported placeholder + empty `_test.go`). No `internal/worktree/` in `app/backend/` — removed as dead code not exposed via API.

| Package | Responsibility |
|---------|---------------|
| `internal/tmux` | All tmux operations via `os/exec.CommandContext` with argument slices + `context.WithTimeout` (10s). `ListWindows()` includes `isActiveWindow` flag from `#{window_active}` |
| `internal/worktree` | Wraps fab-kit `wt-*` scripts (never reimplements) — `packages/api/` only, not in `app/backend/` |
| `internal/fab` | Reads fab state (progress-line, current change, change list) |
| `internal/sessions` | Derives project roots from tmux, auto-detects fab-kit, enriches with fab state. Session enrichment runs in parallel via goroutines with `sync.WaitGroup` and indexed assignment to preserve tmux ordering |
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

All endpoints served by the single Go binary on one port.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/health` | GET | Returns `200 { "status": "ok" }` for supervisor health checks |
| `/api/sessions` | GET | Returns `ProjectSession[]` — one per tmux session, with auto-detected fab enrichment |
| `/api/sessions` | POST | Actions: `createSession` (with optional `cwd`), `createWindow`, `killSession`, `killWindow`, `renameWindow`, `sendKeys` |
| `/api/directories` | GET | Server-side directory listing for autocomplete — `?prefix=~/code/wvr` returns matching dirs under `$HOME` |
| `/api/sessions/stream` | GET | SSE — module-level goroutine polls tmux every 2.5s, fans out full snapshots to all connected clients on change. Deduplicates polling across browser tabs. 30-minute lifetime cap per connection. |
| `/api/upload` | POST | File upload — accepts `multipart/form-data` with `file` and `session` fields. Resolves project root via `ListWindows`, writes to `.uploads/{timestamp}-{name}`, auto-manages `.gitignore`. 50MB limit. |

### Frontend API Client

`packages/web/src/api/client.ts` — typed fetch wrappers for all endpoints (functional, legacy). Uses relative URLs (e.g., `/api/sessions`) — works with both Vite proxy in dev and same-origin in production. Exports `getSessions()`, `postSessionAction()`, `getDirectories()`, `uploadFile()` with TypeScript types.

`app/frontend/src/api/client.ts` — type stubs matching the new POST-only API spec. All functions throw "not implemented". Uses individual POST routes (e.g., `/api/sessions/:session/kill`) rather than the legacy multiplexed POST. Will be implemented in Phase 3.

## Terminal Relay

WebSocket endpoint at `/relay/{session}/{window}` on the same port as the API — no separate relay port. Uses `gorilla/websocket` for WebSocket handling and `creack/pty` for PTY allocation. Implementation in `packages/api/api/relay.go`.

Per connection:
1. Creates independent pane via `tmux split-window` (agent pane 0 untouched)
2. Spawns `tmux attach-session -t <paneId>` via `creack/pty` for real terminal I/O
3. Relays I/O between WebSocket and pty (goroutine for pty→WS, main loop for WS→pty)
4. Handles resize messages (JSON `{"type":"resize","cols":N,"rows":N}`) via `pty.Setsize`
5. On disconnect: kills pty + pane via `sync.Once` cleanup (no orphaned panes)

Client-side WebSocket reconnection: exponential backoff (1s, 2s, 4s, 8s, 16s, max 30s) on unexpected close. Shows `[reconnecting...]` in terminal. Re-sends resize on successful reconnect. Skips reconnect on component unmount. Terminal page connects via `ws://${location.host}/relay/{session}/{window}` — same host, no config needed.

## Supervisor

~140-line bash script. Reads `run-kit.yaml` at startup via grep-based parsing (no `yq` dependency) for port/host config. Polling loop checks for `.restart-requested` file.

Build cycle: `cd app/backend && go build -o ../../bin/run-kit ./cmd/run-kit` (Go binary) + `cd app/frontend && pnpm build` (frontend to `app/frontend/dist/`).
On detection: build all → kill server → start Go server → `GET /api/health` (10s timeout).
On failure: `git revert HEAD` → rebuild → restart prior version.
Signal trapping: SIGINT/SIGTERM → `stop_services` → clean exit.
Auto-restart: detects if server process died and restarts automatically.

## SPA Static Serving

The Go server serves static files from the built SPA directory (`app/frontend/dist/`, previously `packages/web/dist/`). Any request not matching `/api/*` or `/relay/*` serves `index.html` for client-side routing (SPA fallback). Requests matching actual static file paths serve the file directly. Implementation in `packages/api/api/spa.go` (legacy) / `app/backend/api/spa.go` (scaffold placeholder).

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
- **File upload via server filesystem (not terminal binary injection)** — Browser uploads file to `POST /api/upload`, server writes to `.uploads/` in project root, path auto-inserted into compose buffer. Works because run-kit server and tmux are always co-located; the browser is the remote part. Separate `/api/upload` route (not extending `/api/sessions`) because FormData and JSON body parsing are incompatible.

## Testing

### Task Runner

The `justfile` is the single task runner for all test/build/dev commands (replaces `dev.sh` which was removed):

| Recipe | Command |
|--------|---------|
| `just dev` | Go backend (`app/backend/`) + Vite dev server (`app/frontend/`) concurrently |
| `just build` | `go build` from `app/backend/` + `pnpm build` from `app/frontend/` |
| `just test` | `test-backend` + `test-frontend` + `test-e2e` |
| `just test-backend` | `go test ./...` from `app/backend/` |
| `just test-frontend` | `pnpm test` from `app/frontend/` (Vitest) |
| `just test-e2e` | `pnpm exec playwright test` from `app/frontend/` |
| `just check` | `pnpm exec tsc --noEmit` from `app/frontend/` |
| `just verify` | `check` + `test` + `build` |
| `just up` | `./supervisor.sh` |
| `just bg` / `just logs` / `just down` | Supervisor in detached tmux session |
| `just https` / `just trust` | Caddy HTTPS proxy |

### Go Unit Tests

Go `testing` package with table-driven tests. Test files co-located with source using `_test.go` suffix. Test scripts: `just test-backend` (runs `go test ./...` from `app/backend/`).

Legacy tests in `packages/api/` remain functional. New `app/backend/internal/` packages have empty `_test.go` files (package declaration only, zero tests).

Current Go test coverage (legacy `packages/api/`): `internal/validate` (input validation + tilde expansion + filename sanitization), `internal/config` (CLI arg parsing, port validation, YAML parsing, defaults), `internal/tmux` (listSessions parsing + byobu filtering, listWindows activity computation), `internal/sessions` (fab-kit detection, project root derivation, session enrichment).

### Frontend Unit Tests

Vitest with jsdom environment. New scaffold config at `app/frontend/vitest.config.ts`. Setup file at `app/frontend/src/test-setup.ts` imports `@testing-library/jest-dom/vitest`. Legacy config remains at `packages/web/vitest.config.ts`.

Test scripts: `just test-frontend` (runs `pnpm test` from `app/frontend/`).

Test files co-located with source using `.test.{ts,tsx}` suffix (test-alongside strategy per `code-quality.md`). Path alias `@/` resolves to `src/` in both app and test contexts.

Current frontend test coverage (legacy `packages/web/`): `command-palette.tsx` (keyboard interaction, filtering, open/close), `use-keyboard-nav.ts` (j/k/Enter navigation, input skip, clamping, custom shortcuts).

### Playwright E2E Tests

Two Playwright setups coexist:

**Legacy** (`e2e/` at repo root): Config at `playwright.config.ts` (repo root). Two projects: `desktop` (Chromium) and `mobile` (WebKit, iPhone 14 viewport). `mobile.spec.ts` runs only on the mobile project; all other specs run only on desktop.

Test scripts (legacy): `pnpm test:e2e` (headless), `pnpm test:e2e:ui` (interactive UI mode). Web server auto-starts via `just dev` if not already running (`reuseExistingServer: true`).

Tests self-manage tmux sessions via `POST /api/sessions` in `beforeAll`/`afterAll` hooks. Shared helpers in `e2e/helpers.ts`.

E2E test suites (legacy):
- `chrome-stability.spec.ts` — top bar bounding box invariance across page navigation, Line 2 min-height, max-width 896px
- `breadcrumbs.spec.ts` — page-specific breadcrumb segments, link verification, no text prefixes
- `bottom-bar.spec.ts` — terminal-only visibility, modifier armed state (`aria-pressed`), Fn dropdown lifecycle, special keys
- `compose-buffer.spec.ts` — open/close flow, terminal dimming, Send button, multiline input
- `kill-button.spec.ts` — always-visible kill buttons, confirmation dialog flow
- `mobile.spec.ts` — mobile bottom bar rendering, tap target minimum height (30px), Cmd+K badge visibility

**New scaffold** (`app/frontend/tests/e2e/`): Config at `app/frontend/playwright.config.ts`. One project: `desktop` (Chromium). One placeholder test (`smoke.spec.ts` — `test.skip`). Run via `just test-e2e`.

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
| 2026-03-12 | **Scaffold `app/` folder structure** (Phase 1 of reimplementation) — created `app/backend/` Go module (placeholder packages, no `internal/worktree/`) and `app/frontend/` Vite project (type stubs, MSW handlers, Playwright config). Replaced `justfile` recipes to target `app/` paths. Updated `supervisor.sh` build paths to `app/backend/` and `app/frontend/`. Updated `pnpm-workspace.yaml` from `["packages/web"]` to `["app/frontend"]`. Removed `dev.sh` (replaced by `just dev`). Legacy `packages/` untouched until Phase 4. | `260312-jz77-scaffold-app-structure` |
