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
| `src/lib/tmux.ts` | All tmux operations via `execFile` with argument arrays + timeouts. `listWindows()` includes `isActiveWindow` flag from `#{window_active}` |
| `src/lib/worktree.ts` | Wraps fab-kit `wt-*` scripts (never reimplements) |
| `src/lib/fab.ts` | Reads fab state (progress-line, current change, change list) |
| `src/lib/sessions.ts` | Derives project roots from tmux, auto-detects fab-kit, enriches with fab state. Session enrichment runs in parallel via `Promise.all` with indexed assignment to preserve tmux ordering |
| `src/lib/validate.ts` | Input validation for names/paths + tilde expansion with `$HOME` security boundary + filename sanitization for uploads |
| `src/lib/config.ts` | Server config (port, relayPort, host) — reads CLI args > `run-kit.yaml` > defaults |
| `src/lib/types.ts` | Shared TypeScript types + named constants |

## API Layer

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/health` | GET | Returns `200 { "status": "ok" }` for supervisor health checks |
| `/api/sessions` | GET | Returns `ProjectSession[]` — one per tmux session, with auto-detected fab enrichment |
| `/api/sessions` | POST | Actions: `createSession` (with optional `cwd`), `createWindow`, `killSession`, `killWindow`, `renameWindow`, `sendKeys` |
| `/api/directories` | GET | Server-side directory listing for autocomplete — `?prefix=~/code/wvr` returns matching dirs under `$HOME` |
| `/api/sessions/stream` | GET | SSE — module-level singleton polls tmux every 2.5s, fans out full snapshots to all connected clients on change. Deduplicates polling across browser tabs. 30-minute lifetime cap per connection. |
| `/api/upload` | POST | File upload — accepts `multipart/form-data` with `file` and `session` fields. Resolves project root via `listWindows`, writes to `.uploads/{timestamp}-{name}`, auto-manages `.gitignore`. 50MB limit. |

## Terminal Relay

WebSocket server (default port 3001, configurable via `config.relayPort`). Binds to `config.host` (default `127.0.0.1`). Clients connect via URL path: `ws://{host}:{relayPort}/:session/:window`. The relay port is passed from the server component (`page.tsx` imports `config`) as a prop to `TerminalClient` — never via build-time env vars.

Per connection:
1. Creates independent pane via `tmux split-window` (agent pane 0 untouched)
2. Spawns `tmux attach-session -t <paneId>` via `node-pty` for real terminal I/O
3. Relays I/O between WebSocket and pty
4. On disconnect: kills pty + pane (no orphaned panes)

Client-side WebSocket reconnection: exponential backoff (1s, 2s, 4s, 8s, 16s, max 30s) on unexpected close. Shows `[reconnecting...]` in terminal. Re-sends resize on successful reconnect. Skips reconnect on component unmount.

## Supervisor

~130-line bash script. Reads `run-kit.yaml` at startup via grep-based parsing (no `yq` dependency) for port/host config. Polling loop checks for `.restart-requested` file.

On detection: `pnpm build` → kill both processes → start both with configured ports/host → `GET /api/health` (10s timeout).
On failure: `git revert HEAD` → rebuild → restart prior version.
Signal trapping: SIGINT/SIGTERM → `stop_services` → clean exit.

## Chrome Architecture

The root layout (`src/app/layout.tsx`) owns a flex-col skeleton (height: `var(--app-height, 100vh)`) with three zones:

1. **Top chrome** (`shrink-0`) — `TopBarChrome` component, always-rendered two-line top bar
2. **Content** (`flex-1 overflow-y-auto min-h-0`) — page content, scrollable
3. **Bottom slot** (`shrink-0`) — `BottomSlot` component, renders bottom bar on terminal page via ChromeProvider

All three zones use `max-w-4xl mx-auto w-full px-6` for identical width/padding — pages cannot override this.

**ChromeProvider** (`src/contexts/chrome-context.tsx`) — split into two React contexts: `ChromeStateContext` (read-only state: breadcrumbs, line2Left, line2Right, bottomBar, isConnected, fullbleed) and `ChromeDispatchContext` (stable setter functions). `useChrome()` returns both (backward compat, re-renders on state change). `useChromeDispatch()` returns only setters (stable reference, no re-renders from state changes). Pages that only set chrome slots use `useChromeDispatch()` to avoid cascade re-renders. `Breadcrumb` type includes optional `dropdownItems: BreadcrumbDropdownItem[]` for breadcrumb dropdown menus (project/window switching).

**SessionProvider** (`src/contexts/session-context.tsx`) — layout-level React Context that owns the single `EventSource` connection to `/api/sessions/stream`. Exposes `{ sessions, isConnected }` to all descendant pages via `useSessions()` hook. Forwards `isConnected` to `ChromeProvider` internally, eliminating per-page connection status forwarding. Mounted inside `ChromeProvider` in `src/app/layout.tsx`.

**TopBarChrome** (`src/components/top-bar-chrome.tsx`) — reads from ChromeProvider. Line 1: icon breadcrumbs + connection indicator + ⌘K badge. Line 2: always rendered with `min-h-[36px]`, even when slots are empty (prevents layout shift).

**BottomBar** (`src/components/bottom-bar.tsx`) — injected by `TerminalClient` via `setBottomBar()`. Single row of `<kbd>` buttons: modifier toggles (Ctrl/Alt/Cmd with sticky armed state), arrow keys, Fn dropdown (F1-F12, PgUp/PgDn, Home/End), Esc, Tab, and compose toggle. All buttons 44px min-height for mobile touch targets. Sends ANSI escape sequences through the WebSocket ref. Modifier state managed by `useModifierState` hook.

**ComposeBuffer** (`src/components/compose-buffer.tsx`) — native `<textarea>` overlay triggered by the compose button or file upload. Supports iOS dictation, autocorrect, paste, multiline. Send button (or Cmd/Ctrl+Enter) transmits entire text as a single WebSocket message. Terminal dims (`opacity-50`) while compose is open. Escape dismisses without sending. Accepts optional `initialText` prop for pre-populating with uploaded file paths; appends on subsequent updates while open.

**iOS Keyboard Support** — `useVisualViewport` hook (`src/hooks/use-visual-viewport.ts`) listens to both `resize` and `scroll` events on `window.visualViewport`, setting `--app-height` CSS custom property from `visualViewport.height`. The `scroll` listener is needed because iOS Safari may fire scroll events (not just resize) when adjusting the viewport for the keyboard. In fullbleed mode (terminal page), `globals.css` applies `position: fixed; inset: 0; height: var(--app-height, 100vh)` to the `.app-shell` container, decoupling it from document scroll — this prevents the keyboard from pushing the app container off-screen. Non-fullbleed pages (dashboard, project) are unaffected. The bottom bar stays pinned above the keyboard; the terminal shrinks via `flex-1` and xterm refits via `ResizeObserver`.

**iOS Touch Scroll Prevention** — `ContentSlot` toggles a `fullbleed` CSS class on `document.documentElement` when the terminal page is active. `globals.css` applies `overflow: hidden` and `overscroll-behavior: none` to `html.fullbleed` and `html.fullbleed body`, preventing iOS Safari elastic bounce scrolling. The terminal container div uses `touch-none` (`touch-action: none`) so the browser yields touch gestures to xterm.js for scrollback handling.

Pages do NOT render their own top bar or outer containers — they set chrome slots and render only their content area.

## Design Decisions

- **SSE (not WebSocket) for session state** — simpler, server-push only, naturally resilient. Module-level singleton deduplicates polling across tabs (one `fetchSessions()` per interval regardless of client count). SSE data includes `isActiveWindow` per window, enabling UI sync when users switch tmux/byobu windows via terminal shortcuts
- **Full snapshots (not diffs)** — small payload (<100 sessions), simple client logic
- **Independent panes per browser client** — no cursor fights, agent pane untouched. The relay pty follows byobu window switches natively (runs `tmux attach-session`)
- **Every tmux session is a project** — no config, no "Other" bucket. Project root derived from window 0's `pane_current_path`
- **Config resolution: CLI > YAML > defaults** — `src/lib/config.ts` reads `run-kit.yaml` (optional, gitignored) and CLI args. Relay port delivered to client via server component prop (runtime, not build-time)
- **Byobu session-group filtering** — `listSessions()` filters out derived session-group copies to avoid duplicate projects. See `docs/memory/run-kit/tmux-sessions.md`
- **Layout-owned chrome (not per-page TopBar)** — Split React Context for slot injection: state context (re-renders readers) and dispatch context (stable setters, no re-renders). Pages inject content via `useChromeDispatch()` setters in `useEffect`; layout renders it in fixed positions. Prevents both layout shift and cascade re-renders.
- **Layout-level SessionProvider (not per-page SSE)** — Single `EventSource` connection at layout level, shared across all pages. Eliminates redundant connections and per-page `isConnected` forwarding boilerplate.
- **Active window sync via `history.replaceState` (not `router.replace()`)** — When byobu switches windows, the terminal relay pty already shows the correct content. The UI syncs breadcrumb, URL, and action targets via SSE polling (2.5s). URL updates use `window.history.replaceState()` which is invisible to Next.js — no server component re-render, no terminal reinitialization. `router.replace()` would change the `[window]` dynamic segment, causing a full remount and xterm flash.
- **Sticky modifier state via useRef + forceUpdate** — `useModifierState` uses a ref for the authoritative state and a counter state to trigger re-renders. Ensures `consume()` reads the latest value atomically without stale closure issues.
- **Compose buffer as native textarea (not xterm input)** — xterm renders to `<canvas>`, blocking OS-level input features. The compose buffer provides a real `<textarea>` where dictation, autocorrect, paste, and IME all work. Text sent as a single WebSocket message.
- **Armed modifiers bridge to physical keyboard** — When bottom-bar modifiers (Ctrl/Alt/Cmd) are armed, a capture-phase `keydown` listener intercepts physical keypresses, translates them to terminal escape sequences (Ctrl+letter → control characters, Alt/Cmd → ESC prefix), and sends via WebSocket. Prevents xterm from receiving the unmodified key. Ignores real Cmd/Ctrl/Alt held by the OS.
- **File upload via server filesystem (not terminal binary injection)** — Browser uploads file to `POST /api/upload`, server writes to `.uploads/` in project root, path auto-inserted into compose buffer. Works because run-kit server and tmux are always co-located; the browser is the remote part. Separate `/api/upload` route (not extending `/api/sessions`) because FormData and JSON body parsing are incompatible.

## Testing

Vitest with jsdom environment. Config at `vitest.config.ts` (repo root). Setup file at `src/test-setup.ts` imports `@testing-library/jest-dom/vitest` for extended DOM matchers.

Test scripts: `pnpm test` (single run), `pnpm test:watch` (watch mode).

Test files co-located with source using `.test.{ts,tsx}` suffix (test-alongside strategy per `code-quality.md`). Path alias `@/` resolves to `src/` in both app and test contexts.

Current unit test coverage: `validate.ts` (input validation + tilde expansion), `config.ts` (CLI arg parsing, port validation, defaults), `command-palette.tsx` (keyboard interaction, filtering, open/close), `tmux.ts` (listSessions parsing + byobu filtering, listWindows activity computation), `use-keyboard-nav.ts` (j/k/Enter navigation, input skip, clamping, custom shortcuts), `api/sessions/route.ts` POST handler (5-action dispatch, validation, error propagation).

### Playwright E2E Tests

Playwright for browser-level integration tests. Config at `playwright.config.ts` (repo root). E2E tests live in `e2e/` (separate from unit tests in `__tests__/`). Two projects: `desktop` (Chromium) and `mobile` (WebKit, iPhone 14 viewport). `mobile.spec.ts` runs only on the mobile project; all other specs run only on desktop.

Test scripts: `pnpm test:e2e` (headless), `pnpm test:e2e:ui` (interactive UI mode). Web server auto-starts via `pnpm dev` if not already running (`reuseExistingServer: true`).

Tests self-manage tmux sessions via `POST /api/sessions` in `beforeAll`/`afterAll` hooks. Shared helpers in `e2e/helpers.ts`.

E2E test suites:
- `chrome-stability.spec.ts` — top bar bounding box invariance across page navigation, Line 2 min-height, max-width 896px
- `breadcrumbs.spec.ts` — page-specific breadcrumb segments, link verification, no text prefixes
- `bottom-bar.spec.ts` — terminal-only visibility, modifier armed state (`aria-pressed`), Fn dropdown lifecycle, special keys
- `compose-buffer.spec.ts` — open/close flow, terminal dimming, Send button, multiline input
- `kill-button.spec.ts` — always-visible kill buttons, confirmation dialog flow
- `mobile.spec.ts` — mobile bottom bar rendering, tap target minimum height (30px), ⌘K badge visibility

## Security

- All subprocess calls use `execFile` with argument arrays (never `exec` or shell strings)
- All `execFile` calls include timeout (10s tmux, 30s build)
- User input validated via `lib/validate.ts` before reaching any subprocess
- Directory listing restricted to `$HOME` via `expandTilde()` — rejects `..` traversal, absolute paths outside home, and `~username` syntax. Symlinks under `$HOME` are not resolved (accepted risk for local dev tool)
- File uploads: filename sanitized via `sanitizeFilename()` (strips path separators, null bytes, leading dots, collapses dot sequences); 50MB size limit enforced server-side; writes via `fs.writeFile` (not subprocess)

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
| 2026-03-06 | Bottom bar (modifier toggles, arrow keys, Fn dropdown, Esc/Tab, compose buffer), iOS keyboard support via visualViewport, `i` key compose toggle | `260305-fjh1-bottom-bar-compose-buffer` |
| 2026-03-06 | Performance: parallel session enrichment, SSE pub/sub singleton, split ChromeContext, layout-level SessionProvider, ResizeObserver debounce, useModifierState memoization, WS reconnection | `260306-0ahl-perf-sse-chrome-sessions` |
| 2026-03-07 | iOS touch scroll prevention — fullbleed class toggle on html, touch-none on terminal container | `260307-8n60-fix-ios-terminal-touch-scroll` |
| 2026-03-07 | File upload: `/api/upload` endpoint, clipboard paste/drag-drop/file picker triggers, compose buffer integration, `.uploads/` auto-gitignore | `260307-kqio-image-upload-claude-terminal` |
| 2026-03-07 | iOS keyboard viewport overlap fix — visualViewport scroll listener, fixed positioning in fullbleed mode | `260307-f3o9-ios-keyboard-viewport-overlap` |
| 2026-03-07 | Sync byobu active tab — `isActiveWindow` on `WindowInfo`, breadcrumb/URL/action sync via SSE + `history.replaceState` | `260307-f3li-sync-byobu-active-tab` |
| 2026-03-07 | Breadcrumb type extended with `dropdownItems` for project/window switching dropdowns | `260307-uzsa-navbar-breadcrumb-dropdowns` |
| 2026-03-07 | Playwright E2E tests — chrome stability, breadcrumbs, bottom bar, compose buffer, kill button, mobile viewport | `260305-r7zs-playwright-e2e-design-spec` |
