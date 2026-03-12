# run-kit UI Patterns

## URL Structure

| Route | View | Component Pattern |
|-------|------|-------------------|
| `/:session/:window` | Single view (sidebar + terminal) | Layout component (SSE via `useSessions()` context) |
| `/` | Redirect | Redirects to first session's first window (`/:session/0`) |

Single-view model: sidebar shows session/window tree, terminal is always the main content area. No page transitions. When no sessions exist, sidebar shows "No sessions" with a `[+ New Session]` button and the terminal area shows a placeholder.

## Chrome (Top Bar)

The root layout (`app/frontend/src/app.tsx`) renders `TopBarChrome` which derives its content from the current session:window selection via `ChromeProvider` context. No slot injection — the chrome reads the selection and renders directly.

**Line 1** (fixed height): `☰` toggle + icon breadcrumbs + connection indicator + `⌘K` (desktop) / `⋯` (mobile).

Breadcrumb: `☰ {logo} › ⬡ {session} › ❯ {window}` (syncs with tmux active window via SSE). `☰` toggles sidebar (desktop) or opens drawer (mobile).

- Logo SVG (`logo.svg`) — always links to `/`
- ⬡ — Unicode hexagon (U+2B21), serves as dropdown trigger for session switching (tapping opens dropdown listing all sessions)
- ❯ — Unicode heavy right angle (U+276F), serves as dropdown trigger for window switching (tapping opens dropdown listing windows in current session)
- Icons are rendered inside `BreadcrumbDropdown` via `icon` prop — no separate passive span
- All segments except the last are clickable links
- No text prefixes like "session:" or "window:"

### Breadcrumb Dropdowns

Breadcrumb segments with a `dropdownItems` array use the icon (⬡ or ❯) as the dropdown trigger. Split click-target pattern: clicking the label navigates (existing behavior), clicking the icon opens the dropdown.

**Session dropdown**: Lists all tmux sessions. Current session highlighted with `text-accent`. Selecting navigates to `/{session}/0`.

**Window dropdown**: Lists all windows in the current session. Current window highlighted. Selecting navigates to `/{session}/{index}`.

**Dropdown component** (`app/frontend/src/components/breadcrumb-dropdown.tsx`): Reusable dropdown accepting `icon` prop (rendered as trigger button content), with outside-click dismiss, Escape dismiss, ArrowUp/ArrowDown keyboard navigation, ARIA `role="menu"`/`role="menuitem"`. Styled with `bg-bg-primary border-border shadow-2xl`, matching bottom-bar Fn key dropdown pattern. Icon button has 24px minimum tap target (44px on touch devices via `coarse:min-h-[44px]`). Long names truncated via `max-w-[240px]`.

Connection indicator: green/gray dot with "live"/"disconnected" label, driven by `isConnected` from ChromeProvider (set by each page from `useSessions`).

**Line 2** (fixed height, ALWAYS rendered with `min-h-[36px]`): Contextual action bar. Chrome derives content from current session:window selection — no slot injection.

| Left content | Right content |
|-------------|---------------|
| `[Rename]` `[Kill]` (kill has red hover) | Activity dot + activity text + fab stage badge |

Line 2 renders even when empty — prevents layout shift.

**Line 2 mobile collapse** (< 640px): Action buttons hidden (`hidden sm:block`). Status text renders left-aligned. A `⋯` button appears at the right edge (`sm:hidden`) and opens the command palette via a `palette:open` CustomEvent on `document`. All actions are registered as palette actions, so nothing is lost on mobile — only the presentation changes.

### Sidebar Kill Controls

- **Session row ✕**: Always-visible ✕ button on session rows with red hover. Click opens confirmation dialog: "Kill session **{name}** and all {N} windows?"

## Sidebar

`app/frontend/src/components/sidebar.tsx` — session/window tree navigation.

**Desktop** (>= 768px): Always visible at `w-[220px]`, collapsible via `☰` in top bar.

**Mobile** (< 768px): Hidden by default. `☰` opens a drawer overlay from the left, dimming the terminal. Selecting a window closes the drawer.

**Session rows**: Session name (left, collapsible via triangle/chevron), ✕ kill button (right, always visible). Click session name to expand/collapse windows.

**Window rows**: Single line with activity dot (green = active, dim = idle) + window name (left), fab stage text in `text-secondary` (right, omitted for non-fab windows). Currently selected window highlighted with `bg-card` + `border-l-2 border-accent`. Click navigates to `/:session/:window`.

**Footer**: `[+ New Session]` button at bottom.

## Bottom Bar (Always Visible)

Single row of `<kbd>` styled buttons, always visible (terminal is always the main content). Layout: `Esc Tab | Ctrl Alt Cmd | ArrowPad | Fn▾ ⌄ | >_`.

**Modifier toggles** (Ctrl, Alt, Cmd): Sticky armed state with visual indicator (`accent` bg). Click to arm, auto-clears after next key is sent. Click again while armed to disarm. Multiple modifiers can be armed simultaneously.

**Armed modifier bridging**: When modifiers are armed, a capture-phase `keydown` listener intercepts physical keypresses and translates them to terminal escape sequences (Ctrl+letter → control characters, Alt/Cmd → ESC prefix). Sends via WebSocket, preventing xterm from receiving the unmodified key. Ignores real Cmd/Ctrl/Alt held by the OS.

**ArrowPad** (`arrow-pad.tsx`): Combined directional pad replacing individual arrow buttons. Sends ANSI escape sequences (`[A/B/C/D`). With modifiers, use xterm parameter encoding (`[1;{mod}X`). Modifier parameter: 1 + (alt?2:0) + (ctrl?4:0) + (cmd?8:0).

**Function key dropdown** (F▴): Opens a combined popup above the button. Top section: F1-F12 in a 4-column grid. Divider (`border-t border-border`). Bottom section: PgUp, PgDn, Home, End, Ins, Del in a 3-column grid. Closes after each selection, on outside click, or on Escape.

**Keyboard dismiss** (⌄): Calls `blur()` on the active element to collapse the iOS software keyboard. Positioned after the F▴ dropdown.

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

Four entry points, all on the terminal page:
- **Clipboard paste** (`Cmd+V` / `Ctrl+V`) — document-level paste listener; files in `clipboardData.files` trigger upload, text-only paste passes through to xterm
- **Drag-and-drop** — drop files onto the terminal area; `ring-2 ring-accent` border highlight during drag-over; non-file drag content ignored
- **Compose buffer upload button** (📎) — in compose buffer action row, left of Send button; opens native file picker via hidden `<input type="file">`
- **Command palette** — "Upload file" action opens a separate file picker (hidden input in terminal-client)

After upload: file path auto-inserted into compose buffer (opens compose if closed). Multiple files produce one path per line. Server writes to `.uploads/{YYMMDD-HHmmss}-{sanitized-name}` in the project root. 50MB size limit. `.uploads/` auto-added to `.gitignore` on first use.

### iOS Keyboard Support

`useVisualViewport` hook (`app/frontend/src/hooks/use-visual-viewport.ts`) listens to both `resize` and `scroll` events on `window.visualViewport`, setting `--app-height` CSS custom property from `visualViewport.height`. The `scroll` listener catches iOS Safari viewport panning that doesn't trigger `resize`. In fullbleed mode, `globals.css` applies `position: fixed` to the `.app-shell` container with `inset: 0` and `height: var(--app-height, 100vh)`, pinning it to the viewport regardless of document scroll. When the iOS keyboard appears, the bottom bar stays pinned above it, the terminal shrinks, and xterm refits via the existing `ResizeObserver`. Non-fullbleed pages are unaffected.

### iOS Touch Scroll Prevention

The terminal container div has `touch-none` (CSS `touch-action: none`) to prevent the browser from handling touch gestures on the xterm canvas — xterm.js handles its own scrollback. In the single-view model, fullbleed is always active — `overflow: hidden` and `overscroll-behavior: none` are applied to both `html` and `body` (via `globals.css`), preventing iOS Safari elastic bounce scrolling. The compose buffer and bottom bar are siblings of the terminal container, not children, so their touch behavior is preserved.

## Mobile Responsive

### Breakpoints & Container Width

All zones use `px-3 sm:px-6` — reduced horizontal padding on screens < 640px. No `max-w-4xl` constraint — terminal, top bar, and bottom bar all span full width. Sidebar is `w-[220px]` fixed on desktop; terminal fills remaining space.

### Touch Targets

A custom Tailwind variant `coarse:` is defined in `globals.css` via `@custom-variant coarse (@media (pointer: coarse))`. On touch devices, interactive elements get `coarse:min-h-[44px]` (Apple HIG minimum). This includes:
- Line 2 action buttons (Rename, Kill)
- Sidebar session ✕ kill buttons + window rows
- Breadcrumb dropdown chevrons
- `⋯` command palette trigger
- `☰` hamburger toggle

Bottom bar buttons use `min-h-[44px]` unconditionally (not `coarse:` gated) since the bottom bar is touch-primary.

### Terminal Font Scaling

Terminal font size adapts at initialization: 13px on viewports >= 640px, 11px below. Determined via `window.matchMedia('(min-width: 640px)')` at xterm Terminal construction time. FitAddon recalculates columns automatically.

### Command Palette Mobile Trigger

The `CommandPalette` component listens for a `palette:open` CustomEvent on `document` (in addition to `⌘K`). The `⋯` button in Line 2 dispatches this event. This is the mobile equivalent of `⌘K` — physical keyboards aren't available on phones.

## Keyboard Shortcuts

### Global
| Key | Action | Context |
|-----|--------|---------|
| `Cmd+K` | Open command palette | Always |
| `Esc Esc` | Navigate back (close drawer if open, else no-op) | 300ms double-tap window |

### Sidebar
| Key | Action |
|-----|--------|
| `j` / `k` | Navigate windows up/down in sidebar |
| `Enter` | Open focused window in terminal |
| `c` | Open create session dialog |

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

- **All components are client-side** — pure React SPA, no Server Components. Data fetched via typed API client (`app/frontend/src/api/client.ts`) and SSE context
- **No loading spinners** — SSE keeps data fresh, the view renders with whatever data is available
- **Data fetching via context** — `SessionProvider` at layout level owns the `EventSource` connection and provides session data via `useSessions()` hook
- **SSE via `useSessions` hook** — thin wrapper over `SessionProvider` context. Single `EventSource` at layout level. Replaces entire state on each event, auto-reconnects via `EventSource` built-in. Server-side SSE uses a module-level goroutine hub that deduplicates polling across browser tabs
- **ChromeProvider context** (`app/frontend/src/contexts/chrome-context.tsx`) — split into state/dispatch contexts. Manages current session:window selection, sidebar open/collapsed state, drawer state (mobile), `isConnected`, `fullbleed` (always true in single-view). Chrome derives content from the selection — no slot injection (`setLine2Left`, `setLine2Right`, `setBottomBar` removed)
- **SessionProvider context** (`app/frontend/src/contexts/session-context.tsx`) — layout-level provider owning the single `EventSource`. Session data consumed via `useSessions()` hook. Connection status forwarded to ChromeProvider internally.
- **Shared `Dialog` component** (`app/frontend/src/components/dialog.tsx`) — reusable modal with title, backdrop, close-on-click. Used for create, kill, rename dialogs

## Create Session Dialog

The "Create session" dialog (dashboard, `c` shortcut) has three sections:

1. **Quick picks ("Recent:")** — Deduplicated project root paths from existing tmux sessions (window 0's `pane_current_path`). Tappable list items with 44px min height for mobile. Selecting fills path + auto-derives session name.

2. **Path input with autocomplete** — Text input that calls `GET /api/directories?prefix=...` with ~300ms debounce. Results appear as a dropdown below the input. Selecting a result fills the path and triggers a new autocomplete for children. Hidden directories (`.`-prefixed) are excluded from results.

3. **Session name** — Auto-derived from the last segment of the selected path (e.g., `~/code/wvrdz/run-kit` yields `run-kit`). Editable — auto-derivation is a convenience, not a lock.

On submit, the dialog calls `createSession(name, cwd)` which sends `POST /api/sessions` with `{ name, cwd }`. The `cwd` field is omitted when no path is selected, preserving the original name-only behavior. Accessible from sidebar `[+ New Session]` button and `c` keyboard shortcut.

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
| 2026-03-07 | Active window sync — breadcrumb, URL, rename/kill targets follow byobu/tmux window switches via SSE + `history.replaceState` | `260307-f3li-sync-byobu-active-tab` |
| 2026-03-07 | Breadcrumb dropdown menus — chevron triggers for project/window switching, split click-target pattern | `260307-uzsa-navbar-breadcrumb-dropdowns` |
| 2026-03-07 | Mobile responsive polish — Line 2 collapse with ⋯ palette trigger, 44px touch targets via `coarse:` variant, responsive padding (px-3/px-6), terminal font scaling (11px/13px) | `260305-ol5d-mobile-responsive-polish` |
| 2026-03-07 | Mobile cleanup — merged F-key/ext-key popups, moved upload to compose buffer, added keyboard dismiss button, breadcrumb icons as dropdown triggers | `260307-l9jj-mobile-bar-breadcrumb-cleanup` |
| 2026-03-10 | Go backend + Vite SPA split — removed Server Component patterns, all data fetching via API client + SSE context, TanStack Router for client-side routing, terminal WebSocket on same port (no relay port config) | `260310-8xaq-go-backend-vite-spa-split` |
| 2026-03-12 | Single-view UI model — sidebar + terminal replaces three-page navigation, POST-only API client with path-based intent, ChromeProvider derives from selection (no slot injection), fullbleed always on, no max-width constraint, sidebar with session/window tree and mobile drawer | `260312-ux92-vite-react-frontend` |
