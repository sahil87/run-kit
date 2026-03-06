# run-kit UI Patterns

## URL Structure

| Route | Page | Component Pattern |
|-------|------|-------------------|
| `/` | Dashboard | Server Component → Client Component (SSE) |
| `/p/:project` | Project view | Server Component → Client Component (SSE) |
| `/p/:project/:window?name=` | Terminal view | Server Component → Client Component (xterm.js + WebSocket + SSE) |

The terminal page accepts an optional `name` query parameter for the window name (used in breadcrumb). Falls back to the numeric window index if not provided. Navigation from dashboard/project cards always includes the `name` param.

## Chrome (Top Bar)

The root layout renders `TopBarChrome` (`src/components/top-bar-chrome.tsx`) which reads slot content from `ChromeProvider` context. Pages inject their content via `useChrome()` setters — they do NOT render their own top bar.

**Line 1** (fixed height): Icon breadcrumbs + connection indicator + ⌘K hint badge.

| Page | Breadcrumb |
|------|-----------|
| Dashboard | `{logo}` (SVG logo only) |
| Project | `{logo} › ⬡ {name}` |
| Terminal | `{logo} › ⬡ {name} › ❯ {window}` |

- Logo SVG (`logo.svg`) — always links to `/`
- ⬡ — Unicode hexagon (U+2B21), `text-text-secondary`, precedes project name
- ❯ — Unicode heavy right angle (U+276F), `text-text-secondary`, precedes window name
- All segments except the last are clickable links
- No text prefixes like "project:" or "window:"

Connection indicator: green/gray dot with "live"/"disconnected" label, driven by `isConnected` from ChromeProvider (set by each page from `useSessions`).

**Line 2** (fixed height, ALWAYS rendered with `min-h-[36px]`): Contextual action bar. Slots set via `setLine2Left` / `setLine2Right` from ChromeProvider.

| Page | Left content | Right content |
|------|-------------|---------------|
| Dashboard | "+ New Session" button (via chrome slot) | `{N} sessions, {M} windows` |
| Project | "+ New Window" button, "Send Message" button (disabled when no windows), "Rename" button (disabled when no windows) | `{N} windows` |
| Terminal | "Rename" button, "Kill" button (red hover) | Activity dot + fab stage badge |

Line 2 renders even when empty — prevents layout shift during navigation and before `useEffect` fires.

### Inline Kill Controls

- **Window card ✕**: Every `SessionCard` has an always-visible ✕ button (no hover-reveal — accessible on touch devices). Click opens confirmation dialog. Click uses `stopPropagation` to prevent card navigation.
- **Session group ✕** (dashboard only): Always-visible button on session group headers with red hover. Click opens confirmation dialog: "Kill session **{name}** and all {N} windows?"

## Bottom Bar (Terminal Page Only)

Single row of `<kbd>` styled buttons, injected by `TerminalClient` via `setBottomBar()` from ChromeProvider. Layout: `Ctrl Alt Cmd | ArrowPad | F▴ Esc Tab 📎 >_`.

**Modifier toggles** (Ctrl, Alt, Cmd): Sticky armed state with visual indicator (`accent` bg). Click to arm, auto-clears after next key is sent. Click again while armed to disarm. Multiple modifiers can be armed simultaneously.

**Armed modifier bridging**: When modifiers are armed, a capture-phase `keydown` listener intercepts physical keypresses and translates them to terminal escape sequences (Ctrl+letter → control characters, Alt/Cmd → ESC prefix). Sends via WebSocket, preventing xterm from receiving the unmodified key. Ignores real Cmd/Ctrl/Alt held by the OS.

**ArrowPad** (`arrow-pad.tsx`): Combined directional pad replacing individual arrow buttons. Sends ANSI escape sequences (`[A/B/C/D`). With modifiers, use xterm parameter encoding (`[1;{mod}X`). Modifier parameter: 1 + (alt?2:0) + (ctrl?4:0) + (cmd?8:0).

**Function key dropdown** (F▴): Opens a grid dropdown above the button. Contains F1-F12, PgUp, PgDn, Home, End. Closes after each selection, on outside click, or on Escape.

**Special keys** (Esc, Tab): Direct send. Ctrl is not consumed for Esc/Tab (Esc IS Ctrl+[, Tab IS Ctrl+I in terminal semantics) — Ctrl stays armed for the next key. Alt/Cmd prefix with ESC (Meta convention).

**All buttons**: 44px minimum height (Apple HIG touch target). `<kbd>` element styling consistent with the existing `Cmd+K` badge.

### Compose Buffer

Native `<textarea>` overlay triggered by the compose button. Appears above the bottom bar inside the content area. Terminal dims (`opacity-50`) while compose is open.

- **Open**: Tap compose button (`>_` icon)
- **Send**: Click Send button or press Cmd/Ctrl+Enter — entire text transmitted as one WebSocket message
- **Dismiss**: Press Escape — closes without sending, text discarded
- **Why**: xterm is a `<canvas>`, not a native text input. iOS dictation, autocorrect, paste, IME all require a real DOM element. Also useful on desktop for pasting large text blocks over a laggy WebSocket.
- **initialText prop**: Optional string that pre-populates the textarea. Used by file upload to insert paths. On subsequent prop changes while mounted, appends to existing textarea content with newline separator.

### File Upload

Three entry points, all on the terminal page:
- **Clipboard paste** (`Cmd+V` / `Ctrl+V`) — document-level paste listener; files in `clipboardData.files` trigger upload, text-only paste passes through to xterm
- **Drag-and-drop** — drop files onto the terminal area; `ring-2 ring-accent` border highlight during drag-over; non-file drag content ignored
- **File picker button** (📎) — in bottom bar between extended keys and compose toggle; opens native file picker via hidden `<input type="file">`
- **Command palette** — "Upload file" action opens the file picker

After upload: file path auto-inserted into compose buffer (opens compose if closed). Multiple files produce one path per line. Server writes to `.uploads/{YYMMDD-HHmmss}-{sanitized-name}` in the project root. 50MB size limit. `.uploads/` auto-added to `.gitignore` on first use.

### iOS Keyboard Support

`useVisualViewport` hook listens to both `resize` and `scroll` events on `window.visualViewport`, setting `--app-height` CSS custom property from `visualViewport.height`. The `scroll` listener catches iOS Safari viewport panning that doesn't trigger `resize`. In fullbleed mode, `globals.css` applies `position: fixed` to the `.app-shell` container with `inset: 0` and `height: var(--app-height, 100vh)`, pinning it to the viewport regardless of document scroll. When the iOS keyboard appears, the bottom bar stays pinned above it, the terminal shrinks, and xterm refits via the existing `ResizeObserver`. Non-fullbleed pages are unaffected.

### iOS Touch Scroll Prevention

The terminal container div has `touch-none` (CSS `touch-action: none`) to prevent the browser from handling touch gestures on the xterm canvas — xterm.js handles its own scrollback. When fullbleed is active, `ContentSlot` toggles a `fullbleed` class on `<html>`, which applies `overflow: hidden` and `overscroll-behavior: none` to both `html` and `body` (via `globals.css`), preventing iOS Safari elastic bounce scrolling. The class is removed on cleanup when navigating away. Non-terminal pages (dashboard, project) are unaffected — they don't set fullbleed. The compose buffer and bottom bar are siblings of the terminal container, not children, so their touch behavior is preserved.

## Keyboard Shortcuts

### Global
| Key | Action | Context |
|-----|--------|---------|
| `Cmd+K` | Open command palette | All pages |
| `j` / `k` | Navigate cards down/up | Dashboard, Project view |
| `Enter` | Drill into focused item | Dashboard, Project view |
| `Esc Esc` | Navigate back | Terminal view (300ms window) |


### Dashboard
| Key | Action |
|-----|--------|
| `c` | Create new tmux session |
| `/` | Focus search input |

### Project View
| Key | Action |
|-----|--------|
| `n` | Create new window |
| `x` | Kill focused window (confirmation) |
| `s` | Send message to focused window's agent |
| `r` | Rename focused window |

### Terminal View
| Key | Action |
|-----|--------|
| `r` | Rename window |

All keyboard shortcuts are registered in the command palette.

## Visual Design

Dark theme only. Linear/Raycast aesthetic.

| Token | Value | Usage |
|-------|-------|-------|
| `--color-bg-primary` | `#111111` | Page background |
| `--color-bg-card` | `#1a1a1a` | Card backgrounds |
| `--color-text-primary` | `#ffffff` | Primary text |
| `--color-text-secondary` | `#888888` | Secondary text, labels |
| `--color-border` | `#333333` | Borders, dividers |
| `--color-accent` | `#3b82f6` | Active states, focus rings |
| `--color-accent-green` | `#22c55e` | Activity indicators |
| `--font-mono` | JetBrains Mono, etc. | Everywhere |

## Component Conventions

- **Server Components by default** — Client Components only for keyboard handlers, xterm.js, SSE consumers
- **No loading spinners** — SSE keeps data fresh, pages render with whatever data is available
- **No `useEffect` for data fetching** — Server Components fetch initial data, passed to Client Components
- **SSE via `useSessions` hook** — thin wrapper over `SessionProvider` context. Single `EventSource` at layout level, shared across all pages. Replaces entire state on each event, auto-reconnects via `EventSource` built-in. Server-side SSE uses a module-level singleton that deduplicates polling across browser tabs
- **ChromeProvider context** (`src/contexts/chrome-context.tsx`) — split into state/dispatch contexts. `useChrome()` for components reading state (TopBarChrome, BottomSlot, ContentSlot). `useChromeDispatch()` for setter-only consumers (page components) — stable reference, no re-renders from state changes. Pages set slots via `useEffect` with cleanup on unmount.
- **SessionProvider context** (`src/contexts/session-context.tsx`) — layout-level provider owning the single `EventSource`. All pages consume session data via `useSessions()` hook. Connection status forwarded to ChromeProvider internally.
- **Shared `Dialog` component** (`src/components/dialog.tsx`) — reusable modal with title, backdrop, close-on-click. Used for create, kill, send dialogs across all pages

## Create Session Dialog

The "Create session" dialog (dashboard, `c` shortcut) has three sections:

1. **Quick picks ("Recent:")** — Deduplicated project root paths from existing tmux sessions (window 0's `pane_current_path`). Tappable list items with 44px min height for mobile. Selecting fills path + auto-derives session name.

2. **Path input with autocomplete** — Text input that calls `GET /api/directories?prefix=...` with ~300ms debounce. Results appear as a dropdown below the input. Selecting a result fills the path and triggers a new autocomplete for children. Hidden directories (`.`-prefixed) are excluded from results.

3. **Session name** — Auto-derived from the last segment of the selected path (e.g., `~/code/wvrdz/run-kit` yields `run-kit`). Editable — auto-derivation is a convenience, not a lock.

On submit, the dialog sends `{ action: "createSession", name, cwd }` to `POST /api/sessions`. The `cwd` field is omitted when no path is selected, preserving the original name-only behavior.

## Session-to-Project Mapping

Every tmux session is a project — derived from tmux, no config file needed. Project root derived from window 0's `pane_current_path`.

## Activity Status

Windows are `"active"` (last tmux activity within 10 seconds) or `"idle"`. No "exited" state.

## Changelog

| Date | Change | Reference |
|------|--------|-----------|
| 2026-03-02 | Initial UI patterns — three pages, keyboard-first, dark theme | `260302-fl88-web-agent-dashboard` |
| 2026-03-03 | Unified top bar — shared breadcrumb + action bar, inline kill controls, command palette on terminal, always-visible search | `260303-vag8-unified-top-bar` |
| 2026-03-05 | Create Session dialog with folder picker — quick picks, server-side autocomplete, name auto-derivation | `260305-zkem-session-folder-picker` |
| 2026-03-06 | Chrome architecture — layout-owned skeleton, ChromeProvider context, TopBarChrome, icon breadcrumbs, always-visible kill buttons | `260305-emla-fixed-chrome-architecture` |
| 2026-03-06 | Bottom bar with modifier toggles, arrow keys, Fn dropdown, compose buffer, iOS keyboard support | `260305-fjh1-bottom-bar-compose-buffer` |
| 2026-03-06 | Performance: split ChromeContext (state/dispatch), layout-level SessionProvider, inline dashboard search, memoized shortcuts | `260306-0ahl-perf-sse-chrome-sessions` |
| 2026-03-07 | Rename window action (both pages), kill button label shortened to "Kill" | `260307-r3yv-action-buttons-rename-kill` |
| 2026-03-07 | iOS touch scroll fix — `touch-none` on terminal container, fullbleed class toggle for body overflow/overscroll prevention | `260307-8n60-fix-ios-terminal-touch-scroll` |
| 2026-03-07 | File upload: clipboard paste, drag-and-drop, file picker button, compose buffer path insertion, command palette action | `260307-kqio-image-upload-claude-terminal` |
| 2026-03-07 | iOS keyboard viewport overlap fix — scroll+resize listeners on visualViewport, fixed positioning for app-shell in fullbleed | `260307-f3o9-ios-keyboard-viewport-overlap` |
