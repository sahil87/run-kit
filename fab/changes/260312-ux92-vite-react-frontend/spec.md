# Spec: Vite/React Frontend

**Change**: 260312-ux92-vite-react-frontend
**Created**: 2026-03-12
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`, `docs/memory/run-kit/architecture.md`

## Non-Goals

- Go backend rewrite (Phase 2) — this change builds the frontend against the target API spec; backend implementation is a separate change
- `app/backend/` scaffold — this change creates only `app/frontend/`
- Deleting `packages/web/` — that's Phase 4 (cleanup)
- New visual design — porting the existing dark theme, monospace aesthetic, color tokens

## API Client: POST-Only Mutations

### Requirement: Typed Fetch Wrappers

The API client at `app/frontend/src/api/client.ts` SHALL export typed async functions for every endpoint in `docs/specs/api.md`. All mutation endpoints MUST use `POST` with intent in the URL path. Read endpoints MUST use `GET`.

Exported functions:

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

Each function SHALL use relative URLs (e.g., `/api/sessions`) for compatibility with both Vite proxy (dev) and same-origin serving (production). Error responses SHALL be thrown as `Error` with the `error` field from the JSON response body.

#### Scenario: Create Session

- **GIVEN** the Go backend is running
- **WHEN** `createSession("my-project", "~/code/my-project")` is called
- **THEN** a `POST /api/sessions` request is sent with `{ "name": "my-project", "cwd": "~/code/my-project" }`
- **AND** on `201` response, the promise resolves with `{ ok: true }`

#### Scenario: Kill Session via Path Intent

- **GIVEN** the Go backend is running
- **WHEN** `killSession("my-project")` is called
- **THEN** a `POST /api/sessions/my-project/kill` request is sent with no body
- **AND** on `200` response, the promise resolves with `{ ok: true }`

#### Scenario: Upload File Scoped to Session

- **GIVEN** the Go backend is running
- **WHEN** `uploadFile("my-project", file, "0")` is called
- **THEN** a `POST /api/sessions/my-project/upload` request is sent as `multipart/form-data` with `file` and `window` fields
- **AND** on `200` response, the promise resolves with `{ ok: true, path: "..." }`

### Requirement: No Multiplexed Action Field

The client SHALL NOT use a discriminated `action` field in request bodies. The old `SessionAction` union type (`{ action: "createSession" | "killSession" | ... }`) SHALL NOT exist. Each mutation is a separate function with its own URL.

#### Scenario: No Action Discrimination

- **GIVEN** the API client module is imported
- **WHEN** searching for `action:` in the module source
- **THEN** no `action` field appears in any request body construction

## Types: API Response Shapes

### Requirement: Session and Window Types

`app/frontend/src/types.ts` SHALL export `ProjectSession` and `WindowInfo` types matching the API response shape from `docs/specs/api.md`.

```typescript
type ProjectSession = {
  name: string;
  windows: WindowInfo[];
};

type WindowInfo = {
  index: number;
  name: string;
  worktreePath: string;
  activity: "active" | "idle";
  isActiveWindow: boolean;
  fabChange?: string;
  fabStage?: string;
};
```

#### Scenario: Fab Enrichment Fields

- **GIVEN** the backend returns a session with fab-enriched windows
- **WHEN** `getSessions()` is called
- **THEN** `fabChange` and `fabStage` are populated on each window object
- **AND** `fabChange` contains the active change folder name
- **AND** `fabStage` contains the current pipeline stage name

## Layout & Routing: Single-View Model

### Requirement: One Route

The application SHALL have a single route: `/:session/:window`. TanStack Router SHALL be used for type-safe routing. When no params are provided (root `/`), the app SHALL redirect to the first session's first window. If no sessions exist, the app SHALL render the sidebar with an empty state and a "Create session" prompt.

#### Scenario: Default Navigation

- **GIVEN** sessions `[{ name: "run-kit", windows: [{ index: 0, name: "main" }] }]` exist
- **WHEN** the user navigates to `/`
- **THEN** the app redirects to `/run-kit/0`

#### Scenario: No Sessions

- **GIVEN** no tmux sessions exist
- **WHEN** the user navigates to `/`
- **THEN** the sidebar shows "No sessions" with a `[+ New Session]` button
- **AND** the terminal area shows a placeholder message

### Requirement: Single-View Layout

The root layout (`app.tsx`) SHALL render a fixed chrome skeleton with four zones:

```
h-screen flex flex-col
  ├── top-chrome:  shrink-0  (2 lines, fixed height)
  ├── main-area:   flex-1 flex flex-row min-h-0
  │     ├── sidebar:   w-[220px] shrink-0 overflow-y-auto (hidden on mobile <768px)
  │     └── terminal:  flex-1 min-w-0
  └── bottom-bar:  shrink-0  (1 line, fixed height)
```

The terminal SHALL always be visible. There SHALL be no page transitions.

#### Scenario: Desktop Layout

- **GIVEN** viewport width >= 768px
- **WHEN** the single-view layout renders
- **THEN** sidebar is visible at `w-[220px]`, terminal fills remaining width
- **AND** top bar and bottom bar span full width

#### Scenario: Mobile Layout

- **GIVEN** viewport width < 768px
- **WHEN** the single-view layout renders
- **THEN** sidebar is hidden (`display: none`)
- **AND** terminal fills full width
- **AND** hamburger icon (`☰`) is visible in the top bar

### Requirement: No Max-Width on Terminal

The terminal area SHALL NOT have `max-w-4xl` constraint. The terminal fills all available space right of the sidebar (or full width on mobile). Top bar and bottom bar SHALL also span full width — the old `max-w-4xl` constraint is removed from all zones.
<!-- clarified: design.md Resolved Decision #6 and Visual Consistency Rules both say "no max-width" and "top bar and bottom bar span full width" — no zone retains max-w-4xl -->

#### Scenario: Wide Viewport

- **GIVEN** viewport width is 1920px
- **WHEN** the layout renders
- **THEN** the terminal area fills `1920 - 220 (sidebar) = 1700px` without any max-width constraint

## Sidebar: Session/Window Tree

### Requirement: Sidebar Component

`app/frontend/src/components/sidebar.tsx` SHALL render a session/window tree as described in `docs/specs/design.md`.

**Session rows**: Session name (left, collapsible via ▼/▶), ✕ kill button (right, always visible). Click session name to expand/collapse.

**Window rows**: Single line, three zones:
- Left: Activity dot (● green = active, dim = idle) + window name
- Right: Fab stage text, `text-secondary`, no prefix. Omitted for non-fab windows
- Currently selected window: `bg-card` highlight + `border-l-2 border-accent`
- Click → switch terminal to that session:window

**Footer**: `[+ New Session]` button at bottom.

#### Scenario: Session Expansion

- **GIVEN** session "run-kit" has 3 windows
- **WHEN** the user clicks ▶ on "run-kit"
- **THEN** the three windows are shown underneath
- **AND** clicking ▼ collapses them

#### Scenario: Window Selection

- **GIVEN** session "run-kit" is expanded, showing windows "main", "fix-bug", "scratch"
- **WHEN** the user clicks "fix-bug"
- **THEN** the URL updates to `/run-kit/1` (where 1 is the window index)
- **AND** the terminal connects to `WS /relay/run-kit/1`
- **AND** "fix-bug" row shows the selected highlight

#### Scenario: Kill Session

- **GIVEN** session "run-kit" is shown in the sidebar
- **WHEN** the user clicks ✕ on the session row
- **THEN** a confirmation dialog appears: "Kill session **run-kit** and all {N} windows?"
- **AND** on confirm, `killSession("run-kit")` is called

#### Scenario: Fab Stage Display

- **GIVEN** a window has `fabStage: "review"`
- **WHEN** the sidebar renders
- **THEN** "review" appears right-aligned on the window row in `text-secondary`

### Requirement: Sidebar Collapsible (Desktop)

The sidebar SHOULD be collapsible via the hamburger icon (`☰`) in the top bar or a keyboard shortcut. When collapsed, only the terminal + chrome remain.

#### Scenario: Toggle Sidebar

- **GIVEN** the sidebar is visible on desktop
- **WHEN** the user clicks `☰`
- **THEN** the sidebar collapses (width → 0) and the terminal expands to fill

### Requirement: Mobile Drawer

On viewports < 768px, the sidebar SHALL render as a drawer overlay triggered by `☰`. The drawer slides in from the left, overlaying the dimmed terminal. Selecting a window closes the drawer and switches the terminal.

#### Scenario: Open Drawer

- **GIVEN** viewport width < 768px
- **WHEN** the user taps `☰`
- **THEN** the sidebar drawer slides in from the left
- **AND** the terminal is dimmed behind it

#### Scenario: Select from Drawer

- **GIVEN** the drawer is open
- **WHEN** the user taps a window
- **THEN** the drawer closes
- **AND** the terminal connects to the selected session:window

## Top Bar: Breadcrumbs & Status

### Requirement: Top Bar Chrome

The top bar SHALL have two lines as in the current implementation.

**Line 1**: `☰ {logo} › ⬡ {session} › ❯ {window}` + connection indicator + `⌘K` (desktop) / `⋯` (mobile).

- `☰` toggles sidebar (desktop) or opens drawer (mobile)
- `⬡ {session}` is a tappable breadcrumb dropdown listing all sessions
- `❯ {window}` is a tappable breadcrumb dropdown listing windows in the current session
- Connection indicator: green/gray dot + "live"/"disconnected"

**Line 2**: Action buttons (left) + status (right). Always rendered with `min-h-[36px]`.

- Left: `[Rename]` `[Kill]` (kill has red hover)
- Right: Activity dot + activity text + fab stage badge
- Mobile: actions hidden, status left-aligned, `⋯` at right edge

#### Scenario: Breadcrumb Session Switch

- **GIVEN** sessions "run-kit" and "ao-server" exist, current is "run-kit"
- **WHEN** the user taps `⬡`
- **THEN** a dropdown shows both sessions with "run-kit" highlighted
- **AND** selecting "ao-server" navigates to `/ao-server/0`

#### Scenario: Breadcrumb Window Switch

- **GIVEN** session "run-kit" has windows "main" (index 0) and "fix" (index 1), current is "main"
- **WHEN** the user taps `❯`
- **THEN** a dropdown shows both windows with "main" highlighted
- **AND** selecting "fix" navigates to `/run-kit/1`

## Terminal: xterm.js + WebSocket

### Requirement: Terminal Client

The terminal component SHALL use xterm.js 5 with FitAddon for auto-sizing. WebSocket connection to `WS /relay/:session/:window` on the same host. Reconnection with exponential backoff (1s → 30s max).

Behavior SHALL be identical to the current `packages/web/src/pages/terminal.tsx` implementation:
- PTY resize messages on window resize
- `ResizeObserver` with `requestAnimationFrame` debounce
- Terminal font: 13px desktop, 11px mobile (via `matchMedia('(min-width: 640px)')`)
- Drag-and-drop file upload with `ring-2 ring-accent` highlight
- Clipboard paste interception for file upload
- Active window sync via SSE (`isActiveWindow` field) + `history.replaceState`

#### Scenario: Terminal Connection

- **GIVEN** the user is viewing `/run-kit/0`
- **WHEN** the terminal component mounts
- **THEN** a WebSocket connects to `ws://{host}/relay/run-kit/0`
- **AND** xterm.js renders terminal output
- **AND** user input is sent through the WebSocket

#### Scenario: Reconnection

- **GIVEN** the WebSocket connection drops unexpectedly
- **WHEN** the disconnect event fires
- **THEN** `[reconnecting...]` appears in the terminal
- **AND** reconnection attempts start at 1s intervals, doubling to max 30s

#### Scenario: Active Window Sync

- **GIVEN** the user switches to window "fix" in tmux/byobu
- **WHEN** the next SSE event arrives with `isActiveWindow: true` on "fix"
- **THEN** the breadcrumb updates to show "fix"
- **AND** the URL updates via `history.replaceState` (no re-render)
- **AND** rename/kill targets update to "fix"

## Bottom Bar: Modifier Keys & Compose

### Requirement: Bottom Bar

The bottom bar SHALL be always visible (since the terminal is always the main content area). Layout: `Esc Tab | Ctrl Alt Cmd | ArrowPad | Fn▾ ⌄ | >_`. All buttons 44px min-height.

Behavior SHALL be identical to the current `packages/web/src/components/bottom-bar.tsx`:
- Sticky modifier toggles (Ctrl, Alt, Cmd) with visual armed state
- Armed modifier bridging via capture-phase keydown listener
- Arrow pad sending ANSI escape sequences with modifier parameter encoding
- Fn dropdown (F1-F12 grid + PgUp/PgDn/Home/End/Ins/Del)
- Keyboard dismiss button
- Compose buffer toggle

#### Scenario: Modifier Armed State

- **GIVEN** no modifiers are armed
- **WHEN** the user taps `Ctrl`
- **THEN** the Ctrl button shows armed state (`bg-accent/20 border-accent text-accent`)
- **AND** the next physical keypress is intercepted, translated to Ctrl+key, and sent via WebSocket

### Requirement: Compose Buffer

The compose buffer SHALL be identical to `packages/web/src/components/compose-buffer.tsx`: native `<textarea>` overlay, Send button, Escape dismiss, Cmd/Ctrl+Enter send, file upload button (📎), `initialText` prop for pre-populating from file uploads.

#### Scenario: Compose and Send

- **GIVEN** the compose buffer is open
- **WHEN** the user types "echo hello" and clicks Send
- **THEN** "echo hello" is sent as a single WebSocket message
- **AND** the compose buffer closes

## Contexts: Chrome & Session State

### Requirement: ChromeProvider

`ChromeProvider` SHALL manage:
- Current session + window selection (derived from URL params)
- Sidebar open/collapsed state (boolean)
- Drawer open state (boolean, mobile)
- `isConnected` (boolean, from SSE)
- `fullbleed` (boolean, always true in single-view)

The chrome (top bar, line 2, bottom bar) SHALL derive its content from the current selection rather than slot injection. The `setLine2Left`, `setLine2Right`, `setBottomBar` setters from the current implementation SHALL be removed.
<!-- clarified: design.md Chrome State Management section confirms "No slot injection needed — the chrome reads the current selection and renders directly" — single-view model makes derivation feasible -->

The split context pattern (ChromeStateContext + ChromeDispatchContext) SHALL be preserved for performance.

#### Scenario: Chrome Derives from Selection

- **GIVEN** the current selection is session "run-kit", window "main"
- **WHEN** the top bar renders
- **THEN** breadcrumbs show `{logo} › ⬡ run-kit › ❯ main`
- **AND** line 2 shows `[Rename] [Kill]` (left) and activity status (right)
- **AND** no `useEffect` slot injection is needed

### Requirement: SessionProvider

`SessionProvider` SHALL be identical to the current implementation: layout-level `EventSource` to `/api/sessions/stream`, shared session data via `useSessions()` hook. Connection status forwarded to ChromeProvider internally.

#### Scenario: SSE Session Updates

- **GIVEN** the SessionProvider is mounted
- **WHEN** the SSE stream emits a `sessions` event
- **THEN** `useSessions()` returns the updated session data
- **AND** `isConnected` is true

## Keyboard Shortcuts

### Requirement: Global Shortcuts

| Key | Action | Context |
|-----|--------|---------|
| `Cmd+K` | Open command palette | Always |
| `Esc Esc` | Navigate back (close drawer if open, else no-op) | 300ms double-tap window |

#### Scenario: Command Palette

- **GIVEN** the user is on any view
- **WHEN** `Cmd+K` is pressed
- **THEN** the command palette opens with available actions

### Requirement: Sidebar Shortcuts

| Key | Action |
|-----|--------|
| `j` / `k` | Navigate windows up/down in sidebar |
| `Enter` | Open focused window in terminal |
| `c` | Open create session dialog |

#### Scenario: Keyboard Navigation

- **GIVEN** the sidebar is visible with multiple windows
- **WHEN** the user presses `j` then `Enter`
- **THEN** focus moves down one window and the terminal connects to it

### Requirement: Command Palette Actions

The command palette SHALL include:
- Create session
- Kill current window
- Rename current window
- All windows as navigation targets (`Terminal: {session}/{window}`)
- Upload file (opens file picker)

#### Scenario: Mobile Command Palette

- **GIVEN** viewport < 640px
- **WHEN** the user taps `⋯` in the top bar
- **THEN** the command palette opens (via `palette:open` CustomEvent)

## Mobile: iOS & Touch

### Requirement: Touch Targets

All interactive elements SHALL have `min-h-[44px]` on touch devices via the `coarse:` custom variant. Bottom bar buttons use `min-h-[44px]` unconditionally.

### Requirement: iOS Keyboard Support

`useVisualViewport` hook SHALL listen to `resize` and `scroll` events on `window.visualViewport`, setting `--app-height` from `visualViewport.height`. In the single-view layout, `position: fixed; inset: 0; height: var(--app-height, 100vh)` SHALL be applied to the app shell.

### Requirement: iOS Touch Scroll Prevention

The terminal container SHALL have `touch-action: none`. When the app renders (always in single-view), `overflow: hidden` and `overscroll-behavior: none` SHALL be applied to prevent iOS bounce scrolling.
<!-- clarified: fullbleed is always on in single-view — design.md CSS skeleton shows terminal always present in flex-col layout, no conditional fullbleed needed -->

### Requirement: Terminal Font Scaling

Terminal font size: 13px on viewports >= 640px, 11px below. Determined at xterm construction via `matchMedia`.

## Testing: MSW Unit Tests

### Requirement: MSW Test Infrastructure

Vitest with jsdom environment. MSW SHALL mock all API endpoints and the SSE stream. Test files co-located with source as `.test.{ts,tsx}`. Setup file imports `@testing-library/jest-dom/vitest`.

#### Scenario: Sidebar Navigation Test

- **GIVEN** MSW returns two sessions with windows
- **WHEN** the sidebar component renders
- **THEN** both sessions appear with their windows
- **AND** clicking a window updates the selection

#### Scenario: Breadcrumb Dropdown Test

- **GIVEN** MSW returns sessions
- **WHEN** the breadcrumb dropdown trigger is clicked
- **THEN** the dropdown shows all sessions
- **AND** the current session is highlighted

#### Scenario: Keyboard Shortcut Test

- **GIVEN** the single-view layout renders with MSW data
- **WHEN** `j` then `Enter` is pressed
- **THEN** the terminal selection changes

### Requirement: Test Coverage Targets

Tests SHALL cover:
- Sidebar: expand/collapse sessions, window selection, kill session flow
- Breadcrumb dropdowns: open/close, selection
- Drawer: open via hamburger, close on selection
- Keyboard shortcuts: j/k navigation, c for create, Cmd+K palette
- Command palette: open, filter, select
- Modifier state: arm, consume, visual state
- Touch targets: 44px minimum heights on `coarse` media
- API client: correct URL construction for each endpoint

## Testing: Playwright E2E

### Requirement: E2E Test Suite

Playwright E2E tests SHALL live at `app/frontend/tests/e2e/`. Thin suite (3-5 tests) for API round-trip validation. Self-managed tmux sessions in `beforeAll`/`afterAll`.

#### Scenario: Create and Kill Session

- **GIVEN** a self-managed tmux session exists
- **WHEN** the user creates a session via the UI dialog
- **THEN** the session appears in the sidebar via SSE
- **AND** killing the session removes it

#### Scenario: SSE Delivers Data

- **GIVEN** the app loads
- **WHEN** the SSE connection is established
- **THEN** session data populates the sidebar
- **AND** connection status shows "live"

## Project Scaffold

### Requirement: Frontend Package at `app/frontend/`

The frontend SHALL be scaffolded at `app/frontend/` with:
- `package.json` — dependencies matching current `packages/web/` (React 19, TanStack Router, xterm.js 5, Tailwind 4, MSW)
- `vite.config.ts` — React plugin, `@/` alias, proxy for `/api` and `/relay` to `:3000`
- `vitest.config.ts` — jsdom environment, setup file, test pattern
- `tsconfig.json` — strict TypeScript
- `src/` — application source
- `tests/msw/handlers.ts` — MSW handlers
- `tests/e2e/` — Playwright E2E tests
- `playwright.config.ts` — Playwright config

#### Scenario: Build Succeeds

- **GIVEN** `pnpm install` has been run
- **WHEN** `pnpm build` is run in `app/frontend/`
- **THEN** the build succeeds with no TypeScript errors
- **AND** output goes to `app/frontend/dist/`

## Create Session Dialog

### Requirement: Dialog with Folder Picker

The create session dialog SHALL be identical to the current implementation: quick picks from existing session paths, path input with debounced autocomplete via `getDirectories()`, auto-derived session name from path. Accessible from sidebar `[+ New Session]` button and `c` keyboard shortcut.

#### Scenario: Quick Pick Selection

- **GIVEN** existing sessions have paths `~/code/run-kit` and `~/code/ao-server`
- **WHEN** the create dialog opens
- **THEN** "Recent:" section shows both paths
- **AND** clicking `~/code/run-kit` fills path and derives name "run-kit"

## Deprecated Requirements

### Three-Page Routing Model

**Reason**: Replaced by single-view model (sidebar + terminal). Dashboard and Project pages are subsumed by the sidebar.
**Migration**: All navigation functionality is in the sidebar. The `/`, `/p/:project`, `/p/:project/:window` routes are replaced by `/:session/:window`.

### Multiplexed POST API Client

**Reason**: Replaced by POST-only mutations with path-based intent per `docs/specs/api.md`.
**Migration**: Each `SessionAction` variant becomes a separate function with its own URL.

### ChromeProvider Slot Injection

**Reason**: Single-view model can derive chrome content from the current session:window selection.
**Migration**: `setLine2Left`, `setLine2Right`, `setBottomBar` removed. Chrome components read selection directly.

## Design Decisions

1. **Single-view layout replaces three pages**: The sidebar subsumes Dashboard and Project page functionality. This matches `docs/specs/design.md` and eliminates page transitions.
   - *Why*: Terminal is always the primary content; navigating away from it is unnecessary overhead
   - *Rejected*: Keeping three pages with a persistent sidebar — adds routing complexity without benefit

2. **Derived chrome over slot injection**: Top bar and bottom bar derive their content from the current session:window selection instead of each page injecting via `useEffect`
   - *Why*: Only one view exists, so there's only one possible chrome state (terminal-focused)
   - *Rejected*: Keeping slot injection — unnecessary indirection when there's only one consumer

3. **Sidebar width 220px fixed**: Desktop sidebar uses `w-[220px]` per design spec
   - *Why*: Session/window names are short, 220px fits most names while preserving terminal width
   - *Rejected*: Resizable sidebar — over-engineering for the use case

4. **Drawer on mobile (not bottom sheet)**: Mobile navigation uses a left-side drawer overlay
   - *Why*: Matches design spec, preserves session/window tree layout across breakpoints
   - *Rejected*: Bottom sheet — different mental model, harder to fit full tree

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | POST-only API client with path-based intent | Confirmed from intake #1 — matches api.md | S:95 R:80 A:95 D:95 |
| 2 | Certain | Single-view model (sidebar + terminal, one route) | Confirmed from intake #2 — per design.md | S:95 R:80 A:95 D:95 |
| 3 | Certain | Drawer pattern on mobile | Confirmed from intake #3 — hamburger trigger | S:95 R:80 A:90 D:95 |
| 4 | Certain | E2E tests at `app/frontend/tests/e2e/` | Confirmed from intake #4 | S:95 R:85 A:90 D:95 |
| 5 | Certain | TanStack Router — one route `/:session/:window` | Confirmed from intake #5 | S:90 R:85 A:90 D:95 |
| 6 | Certain | MSW-backed Vitest for UI tests, thin E2E for round-trips | Confirmed from intake #6 | S:90 R:80 A:90 D:90 |
| 7 | Confident | Same frontend dependencies (React 19, Tailwind 4, xterm.js 5, MSW) | Confirmed from intake #7 — no changes needed | S:80 R:80 A:85 D:85 |
| 8 | Confident | Self-managed tmux sessions in E2E test hooks | Confirmed from intake #8 — proven pattern | S:80 R:80 A:85 D:85 |
| 9 | Certain | Remove ChromeProvider slot injection, derive from selection | Clarified — design.md Chrome State Management confirms "No slot injection needed" | S:95 R:70 A:80 D:80 |
| 10 | Certain | Fullbleed always on in single-view | Clarified — single-view CSS skeleton always has terminal present, no conditional fullbleed | S:95 R:85 A:80 D:85 |
| 11 | Certain | No max-width on any zone (terminal, top bar, bottom bar all span full width) | Clarified — design.md Resolved Decision #6 and Visual Consistency Rules say no max-width on any zone | S:95 R:85 A:75 D:75 |

11 assumptions (9 certain, 2 confident, 0 tentative, 0 unresolved).
