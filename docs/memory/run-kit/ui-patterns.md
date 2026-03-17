# run-kit UI Patterns

## URL Structure

| Route | View | Component Pattern |
|-------|------|-------------------|
| `/:session/:window` | Terminal (sidebar + terminal + bottom bar) | Layout component (SSE via `useSessions()` context) |
| `/` | Dashboard | Renders `Dashboard` component in the terminal area. Shows session/window overview with expandable cards. Also the target for relay `4004` (session not found) and all kill redirects |

Two-tier URL model: `/` is the Dashboard (session/window overview), `/:session/:window` is the terminal view. No intermediate `/:session` route. Sidebar shows session/window tree on both views. When no sessions exist, sidebar shows "No sessions" with a `+ New Session` button and the Dashboard shows a "New Session" card.

## Dashboard

`app/frontend/src/components/dashboard.tsx` — renders in the terminal area when no `/:session/:window` params are present (the `{sessionName && windowIndex ? <TerminalClient/> : <Dashboard/>}` branch in `app.tsx`).

**Layout**: Outer wrapper is `flex-1 flex flex-col` containing two sibling regions: (1) pinned stats line (`shrink-0 px-4 sm:px-6 pt-4 sm:pt-6`) and (2) scrollable card area (`flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 pb-4 sm:pb-6`). The stats line stays fixed at the top of the Dashboard area regardless of scroll position; only the card grid scrolls.

**Stats line**: Top of the Dashboard (pinned) — `"{N} sessions, {M} windows"` (`text-sm text-text-secondary`). Counts derived from the existing `sessions` array.

**Session cards grid**: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3`. Each card is `bg-bg-card border border-border rounded`.

**Session card header**: Button that toggles inline expansion. Shows session name (`text-text-primary font-medium text-sm`), window count, and activity summary (`{N} active, {M} idle`). Chevron indicator (▶ collapsed, ▼ expanded). Multiple sessions may be expanded simultaneously.

**Window cards** (inside expanded session): Each window card is a button (`bg-bg-primary border border-border rounded`) that navigates to `/:session/:window` on click. Shows:
- Window name (primary text) + fab stage badge (`bg-accent/10 text-accent`) when present
- Running process (`paneCommand`), activity dot (green = active, dim = idle) with label + idle duration
- Fab change ID + slug when present

**New Window button**: Inside each expanded session card, dashed border button calling `createWindow` API.

**New Session button**: Always-visible dashed border card in the grid, opens the existing create session dialog.

**Touch targets**: Session card headers and window cards use `coarse:min-h-[44px]`.

## Chrome (Top Bar)

The root layout (`app/frontend/src/app.tsx`) renders `TopBarChrome` which derives its content from the current session:window selection via `ChromeProvider` context. No slot injection — the chrome reads the selection and renders directly.

**Line 1** (fixed height, `border-b border-border`): hamburger toggle + name breadcrumbs + branding + controls. Single-line top bar — no Line 2.

**Dashboard route** (`/`): Hamburger toggle + "Dashboard" text label (`text-text-primary font-medium`). No session or window breadcrumb segments rendered (no session/window is selected). Connection indicator, FixedWidthToggle, and `⌘K`/`⋯` render as normal.

**Terminal route** (`/:session/:window`): `☰ session / window` — hamburger icon (three SVG lines, animates to X via CSS `transition-transform` when sidebar/drawer is open) + session name (dropdown trigger, `max-w-[7ch] truncate`) + `/` plain text separator + window name (dropdown trigger). Syncs with tmux active window via SSE.

- Hamburger icon (`☰`) — replaces logo as sidebar/drawer toggle. Animates to `✕` (X) when `sidebarOpen` (desktop >= 768px) or `drawerOpen` (mobile < 768px) is true
- `/` — plain text separator between session and window names (replaces `❯` U+276F). Not a click target
- Session name and window name text are the dropdown triggers (tappable to open respective dropdowns). Replaces the `❯` icon-based trigger pattern
- Session name capped at ~7 characters with ellipsis overflow (`max-w-[7ch] truncate`)
- No text prefixes like "session:" or "window:"

**Right section (desktop)**: `{logo} Run Kit  ●  ⇔  ⌘K  >_`
- Logo SVG (`logo.svg`) — decorative (`aria-hidden="true"`), not a button
- "Run Kit" text span (`text-xs text-text-secondary`)
- Green/gray connection dot — no text label ("live"/"disconnected" text removed)
- `FixedWidthToggle`
- `⌘K` kbd hint
- Compose button (`>_`) — rightmost item, opens compose buffer. `onOpenCompose` callback passed as prop to `TopBar`

**Right section (mobile < 640px)**: `⋯  >_` — only command palette trigger and compose button visible. Logo, "Run Kit" text, dot, toggle, ⌘K hidden via `hidden sm:flex` / `hidden sm:inline-flex`

### Breadcrumb Dropdowns

Session and window name text are the dropdown triggers. Clicking/tapping the name opens the respective dropdown. No split click-target pattern — the name itself is the trigger.

**Session dropdown**: Lists all tmux sessions. Current session highlighted with `text-accent`. Selecting navigates to `/{session}/0`. First item: `+ New Session` action (opens session creation dialog).

**Window dropdown**: Lists all windows in the current session. Current window highlighted. Selecting navigates to `/{session}/{index}`. First item: `+ New Window` action (creates new window in current session).

**Action items in dropdowns**: `BreadcrumbDropdown` accepts an optional `action` prop of type `{ label: string; onAction: () => void }`. When provided, the action item renders before the selection list, separated by a divider (`border-t border-border`). Action items use `text-text-primary` styling (not `text-accent`), close the dropdown on click, and are excluded from ArrowUp/ArrowDown keyboard navigation among selection items.

**Dropdown component** (`app/frontend/src/components/breadcrumb-dropdown.tsx`): Reusable dropdown with outside-click dismiss, Escape dismiss, ArrowUp/ArrowDown keyboard navigation, ARIA `role="menu"`/`role="menuitem"`. Styled with `bg-bg-primary border-border shadow-2xl`, matching bottom-bar Fn key dropdown pattern. Name text serves as the trigger (44px on touch devices via `coarse:min-h-[44px]`). Long names truncated via `max-w-[240px]`.

Connection indicator: green/gray dot only (no text label), driven by `isConnected` from ChromeProvider (set by each page from `useSessions`).

**FixedWidthToggle** (in Line 1 right section): Renders between the connection dot and `⌘K`. Order: `[●] [⇔] [⌘K]`. Self-contained component using `useChrome()`/`useChromeDispatch()`. Touch target: `coarse:min-h-[36px] coarse:min-w-[28px]`. Hidden on mobile (< 640px).

### Sidebar Kill Controls

- **Session row ✕**: Always-visible ✕ button on session rows with red hover. Click opens confirmation dialog: "Kill session **{name}** and all {N} windows?"

## Sidebar

`app/frontend/src/components/sidebar.tsx` — session/window tree navigation.

**Desktop** (>= 768px): Drag-resizable panel, default 220px width. Width persisted to `localStorage` key `runkit-sidebar-width`. Constraints: min 160px, max 400px. Drag handle (4-6px) on right edge with `col-resize` cursor, supports mouse and touch events. Collapsible via logo button in top bar.

**Mobile** (< 768px): Hidden by default. Logo button opens a drawer overlay from the left, dimming the terminal. Selecting a window closes the drawer. Drag-resize does not apply to mobile drawer.

**Padding**: `px-3 sm:px-6` (matches top bar and bottom bar chrome padding).

**Session rows**: Chevron toggle (left, expands/collapses window list), session name (navigates to first window in session via `onSelectWindow(session, 0)`), + new window button (right), ✕ kill button (right, always visible). Click session name navigates to `/:session/0`; click chevron toggles expand/collapse.

**Window rows**: Single line with activity dot + window name (left), right-side info (fab stage, duration, info button). All rows have `border-l-2` (transparent when not selected to prevent layout shift). Currently selected window highlighted with `bg-accent/10` + `border-accent` + `font-medium` + `rounded-r`. Click navigates to `/:session/:window`.

1. **Activity dot with `isActiveWindow` ring** — green dot = active, dim dot = idle (unchanged). When `isActiveWindow` is true, adds a `ring-1` outline: `ring-accent-green` for active windows, `ring-text-secondary/40` for idle windows. Pure CSS, no animation.

2. **Duration display** (right-aligned, `text-xs text-text-secondary`, after fab stage): For fab windows with `agentState === "idle"`, shows `agentIdleDuration` (e.g., `2m`). For non-fab or unknown-state idle windows, computes elapsed time from `activityTimestamp` on the frontend. Omitted for active windows. Computed via `getWindowDuration()` from `lib/format.ts`.

3. **Info button** (`ⓘ`, `text-[10px]`) — hover-reveal on desktop (`opacity-0 group-hover:opacity-100`), always visible on mobile (`coarse:opacity-100`). Click/tap toggles an info popover. 44px tap target on touch devices (`coarse:min-h-[44px]`). Rendered as a sibling `<button>` positioned absolutely (`absolute right-2 top-1/2 -translate-y-1/2`) to avoid nested interactive elements.

4. **Info popover** — compact key-value card (`bg-bg-primary border border-border shadow-2xl rounded py-1 px-2 text-xs z-50 min-w-[200px]`). Dismiss on outside click, Escape, or re-tap. Contains:
   - **Change**: fab change ID + slug (e.g., `txna · rich-sidebar-window-status`) — shown only for fab windows
   - **Process**: `paneCommand` (e.g., `claude`, `zsh`) — shown when present
   - **Path**: `worktreePath` — always shown
   - **State**: `activity` + agent state + duration (e.g., `idle · idle · 2m`) — always shown

Popover state managed via `popoverKey` state in `Sidebar`, keyed by `session:windowIndex`. Visually distinct from action menus (read-only info card, not clickable items).

**Empty state**: When no sessions exist (`sessions.length === 0`), the sidebar displays "No sessions" text with a centered `+ New Session` button. The button triggers the same session creation flow as the breadcrumb dropdown's `+ New Session` action.

**No footer** — session creation accessible via breadcrumb dropdown `+ New Session` action and sidebar empty state button.

## Bottom Bar (Terminal Pages Only, Inside Terminal Column)

Single row of `<kbd>` styled buttons, rendered only on terminal pages (`/:session/:window`). Hidden on the Dashboard route (`/`) — there is no terminal to send keys to. Rendered inside the terminal column (not root-level), so its width tracks the terminal width, not the full viewport. Styled with `border-t border-border` and `py-1.5` padding. Layout: `Esc Tab | Ctrl Alt | Fn▴ ArrowPad`. Compose button (`>_`) moved to top bar right section.

**Modifier toggles** (Ctrl, Alt): Sticky armed state with visual indicator (`accent` bg). Click to arm, auto-clears after next key is sent. Click again while armed to disarm. Multiple modifiers can be armed simultaneously. Cmd (`⌘`) removed — on desktop users hold the real Cmd key; on mobile Cmd combos aren't used in terminal workflows.

**Armed modifier bridging**: When modifiers are armed, a capture-phase `keydown` listener intercepts physical keypresses and translates them to terminal escape sequences (Ctrl+letter → control characters, Alt → ESC prefix). Sends via WebSocket, preventing xterm from receiving the unmodified key. Ignores real Cmd/Ctrl/Alt held by the OS.

**ArrowPad** (`arrow-pad.tsx`): Combined directional pad replacing individual arrow buttons. Sends ANSI escape sequences (`[A/B/C/D`). With modifiers, use xterm parameter encoding (`[1;{mod}X`). Modifier parameter: 1 + (alt?2:0) + (ctrl?4:0).

**Function key dropdown** (F▴): Opens a combined popup above the button. Top section: F1-F12 in a 4-column grid. Divider (`border-t border-border`). Bottom section: PgUp, PgDn, Home, End, Ins, Del in a 3-column grid. Closes after each selection, on outside click, or on Escape.

**Special keys** (Esc, Tab): Direct send. Ctrl is not consumed for Esc/Tab (Esc IS Ctrl+[, Tab IS Ctrl+I in terminal semantics) — Ctrl stays armed for the next key. Alt prefix with ESC (Meta convention).

**All buttons**: 36px minimum height/width on desktop (`min-h-[36px] min-w-[36px]`), 44px height / 36px width on touch devices (`coarse:min-h-[44px] coarse:min-w-[36px]`). `text-xs`, `<kbd>` element styling.

### Compose Buffer

Native `<textarea>` overlay triggered by the compose button (`>_` in top bar right section). Appears above the bottom bar inside the content area. Terminal dims (`opacity-50`) while compose is open.

- **Open**: Tap compose button (`>_` icon in top bar)
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

`useVisualViewport` hook (`app/frontend/src/hooks/use-visual-viewport.ts`) manages all viewport-related CSS side effects: adds the `fullbleed` class to `<html>` on mount (removed on cleanup), and listens to both `resize` and `scroll` events on `window.visualViewport`, setting `--app-height` CSS custom property from `visualViewport.height`. The `scroll` listener catches iOS Safari viewport panning that doesn't trigger `resize`. In fullbleed mode, `globals.css` applies `position: fixed` to the `.app-shell` container with `inset: 0` and `height: var(--app-height, 100vh)`, pinning it to the viewport regardless of document scroll. When the iOS keyboard appears, the bottom bar stays pinned above it, the terminal shrinks, and xterm refits via the existing `ResizeObserver`. The `fullbleed` class is also present in `index.html` as a static default (FOUC prevention); the hook takes over lifecycle management at runtime.

### iOS Touch Scroll Prevention

The terminal container div has `touch-none` (CSS `touch-action: none`) to prevent the browser from handling touch gestures on the xterm canvas — xterm.js handles its own scrollback. In the single-view model, fullbleed is always active — `overflow: hidden` and `overscroll-behavior: none` are applied to both `html` and `body` (via `globals.css`), preventing iOS Safari elastic bounce scrolling. The compose buffer and bottom bar are siblings of the terminal container, not children, so their touch behavior is preserved.

## Mobile Responsive

### Breakpoints & Container Width

All zones use `px-3 sm:px-6` — reduced horizontal padding on screens < 640px. No `max-w-4xl` constraint — terminal, top bar, and bottom bar all span full width. Sidebar is drag-resizable (default 220px, min 160, max 400) on desktop; terminal fills remaining space. Terminal container has `py-0.5 px-1` padding for breathing room against border lines. Bottom bar uses `py-1.5` vertical padding.

### Touch Targets

A custom Tailwind variant `coarse:` is defined in `globals.css` via `@custom-variant coarse (@media (pointer: coarse))`. On touch devices, interactive elements get `coarse:min-h-[44px]` (Apple HIG minimum). This includes:
- FixedWidthToggle (`coarse:min-h-[36px] coarse:min-w-[28px]`)
- Sidebar session ✕ kill buttons + window rows
- Breadcrumb name dropdown triggers
- `⋯` command palette trigger
- Hamburger icon (sidebar/drawer toggle)

Bottom bar buttons use `coarse:min-h-[44px] coarse:min-w-[36px]` on touch devices, `min-h-[36px] min-w-[36px]` on desktop.

### Terminal Addons

Addons loaded in `init()` via dynamic import, after `terminal.open()`, before `ResizeObserver` setup. Order: FitAddon (existing) → fit() → ClipboardAddon → WebLinksAddon → WebglAddon.

| Addon | Purpose | Notes |
|-------|---------|-------|
| `@xterm/addon-fit` | Auto-resize columns/rows | Existing — loaded first, `fit()` called immediately |
| `@xterm/addon-clipboard` | OSC 52 clipboard sequences | Programs (tmux, vim, SSH) can write to system clipboard |
| `@xterm/addon-web-links` | Clickable URLs in terminal output | |
| `@xterm/addon-webgl` | GPU-accelerated rendering | Wrapped in try/catch — silently falls back to canvas renderer on failure |

### Terminal Font Scaling

Terminal font size adapts at initialization: 13px on viewports >= 640px, 11px below. Determined via `window.matchMedia('(min-width: 640px)')` at xterm Terminal construction time. FitAddon recalculates columns automatically.

### Command Palette Mobile Trigger

The `CommandPalette` component listens for a `palette:open` CustomEvent on `document` (in addition to `⌘K`). The `⋯` button in Line 1 dispatches this event on mobile. This is the mobile equivalent of `⌘K` — physical keyboards aren't available on phones.

## Keyboard Shortcuts

### Global
| Key | Action | Context |
|-----|--------|---------|
| `Cmd+K` | Open command palette | Always |
| `Cmd+C` / `Ctrl+C` | Copy selection to clipboard (with selection) or send SIGINT (without selection) | Terminal focused — via `attachCustomKeyEventHandler`, `keydown` only |

No single-key shortcuts (`j`/`k`/`c`/`r`) or `Esc Esc` — these conflicted with xterm.js terminal input. All actions are accessible via `Cmd+K` command palette or top bar buttons.

## Visual Design

Dark theme only, blue-tinted palette. Linear/Raycast aesthetic.

| Token | Value | Usage |
|-------|-------|-------|
| `--color-bg-primary` | `#0f1117` | Page background (dark navy) |
| `--color-bg-card` | `#171b24` | Card backgrounds (navy-gray) |
| `--color-text-primary` | `#e8eaf0` | Primary text (soft white) |
| `--color-text-secondary` | `#7a8394` | Secondary text, labels (cool gray-blue) |
| `--color-border` | `#2a3040` | Borders, dividers (navy-tinted) |
| `--color-accent` | `#5b8af0` | Active states, focus rings |
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

The "Create session" dialog (breadcrumb `+ New Session` action, sidebar empty state button, or command palette) has three sections:

1. **Quick picks ("Recent:")** — Deduplicated project root paths from existing tmux sessions (window 0's `pane_current_path`). Tappable list items with 44px min height for mobile. Selecting fills path + auto-derives session name.

2. **Path input with autocomplete** — Text input that calls `GET /api/directories?prefix=...` with ~300ms debounce. Results appear as a dropdown below the input. Selecting a result fills the path and triggers a new autocomplete for children. Hidden directories (`.`-prefixed) are excluded from results.

3. **Session name** — Auto-derived from the last segment of the selected path (e.g., `~/code/wvrdz/run-kit` yields `run_kit`). Editable — auto-derivation is a convenience, not a lock. When the name field is left empty at submit time, the name is derived from the path automatically via `deriveNameFromPath()`. The Create button is enabled when either a name or a path is provided.

On submit, the dialog calls `createSession(name, cwd)` which sends `POST /api/sessions` with `{ name, cwd }`. If the name field is empty but a path is set, the name is derived from the path's last segment (sanitized for tmux/byobu: hyphens→underscores, colons/periods replaced with underscores). Collision with existing session names is checked on the derived name and shows an error. The `cwd` field is omitted when no path is selected, preserving the original name-only behavior. Accessible from breadcrumb `+ New Session` dropdown action, sidebar empty state button, and command palette.

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
| 2026-03-12 | UI chrome refinements — simplified breadcrumbs (`☰ {logo} ❯ session ❯ window`, removed `⬡` and `›`), drag-resizable sidebar (default 220px, min 160, max 400, localStorage persist), bottom bar moved inside terminal column (`border-t border-border`, `py-1.5`), top bar `border-b border-border`, `[+ Session]` button in top bar line 2, sidebar footer removed, padding consistency (`px-3 sm:px-6` sidebar, `py-0.5 px-1` terminal container) | `260312-y4ci-ui-chrome-layout-refinements` |
| 2026-03-13 | Rich sidebar window status — activity dot ring for `isActiveWindow`, idle duration display, info popover (change, process, path, state), shared format helpers (`lib/format.ts`). Top bar Line 2 enriched with paneCommand, duration, fab change ID+slug. Backend: `paneCommand` + `activityTimestamp` from tmux, `.fab-runtime.yaml` reading for agent state | `260313-txna-rich-sidebar-window-status` |
| 2026-03-13 | xterm addon activation — ClipboardAddon (OSC 52), WebLinksAddon (clickable URLs), WebglAddon (GPU rendering with silent canvas fallback), Cmd+C selection-aware copy via `attachCustomKeyEventHandler` | `260313-dr60-xterm-clipboard-addons` |
| 2026-03-13 | Removed single-key shortcuts — deleted `useKeyboardNav` (j/k/Enter), `useAppShortcuts` (c/r/Esc Esc), sidebar focus ring (`focusedIndex`). Cmd+K command palette is now the sole keyboard shortcut. Palette actions no longer show shortcut hints for create/rename | `260313-3brm-remove-single-key-shortcuts` |
| 2026-03-13 | Remove top bar Line 2 — deleted action bar (+ Session, Rename, Kill, window status). FixedWidthToggle relocated to Line 1 (between connection indicator and ⌘K). BreadcrumbDropdown gains `action` prop for `+ New Session`/`+ New Window` as first dropdown item with divider. Sidebar empty state shows `+ New Session` button. Top bar is now single-line on all viewports | `260313-zvgc-remove-top-bar-line-2` |
| 2026-03-14 | Top bar & bottom bar refresh — hamburger icon replaces logo as sidebar toggle (animates ☰→✕), `/` separator replaces `❯`, session/window names are dropdown triggers (max 7ch session name). Top bar right: logo (decorative) + "Run Kit" + green dot (no text) + toggle + ⌘K + >_ compose. Mobile right: ⋯ + >_. Bottom bar: removed Cmd modifier and compose button, button sizes increased to 36px desktop / 44px touch | `260314-9raw-top-bar-bottom-bar-refresh` |
| 2026-03-15 | Dashboard view — `/` renders Dashboard component (session cards grid with expandable window cards, stats line, New Session/New Window buttons) instead of redirecting. Top bar shows "Dashboard" text on `/`, no breadcrumbs. Bottom bar hidden on Dashboard. Sidebar session name click navigates to first window (chevron toggles expand/collapse). All kill operations redirect to `/`. Stale URL detection redirects to `/` | `260313-ll1j-dashboard-project-page-views` |
| 2026-03-15 | Per-region scroll behavior — Dashboard split into pinned stats line (`shrink-0`) + scrollable card area (`flex-1 min-h-0 overflow-y-auto`). `useVisualViewport` hook now adds `fullbleed` class to `<html>` on mount (lifecycle management). Fullbleed activates `overflow: hidden` on html/body, preventing browser scrollbar on terminal pages | `260315-lnrb-dashboard-scroll-behavior` |
| 2026-03-17 | Default session name from folder — Create Session dialog derives name from path when name field is empty at submit time. Create button enabled when path is set (even without explicit name). Derived name collision checked with error display | `260317-qiza-default-session-name-from-folder` |
