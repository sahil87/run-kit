# run-kit UI Patterns

## URL Structure

| Route | View | Component Pattern |
|-------|------|-------------------|
| `/` | Dashboard | Session card grid in terminal area (`app/frontend/src/components/dashboard.tsx`) |
| `/$session` | Project page | Window card grid in terminal area (`app/frontend/src/components/project-page.tsx`) |
| `/$session/$window` | Terminal | xterm.js + WebSocket relay (unchanged) |

Three-tier URL hierarchy: `/` = global overview, `/$session` = session-scoped, `/$session/$window` = terminal. All three views render in the terminal area slot within the existing app shell (top bar + sidebar + main area). Route detection via `useMatches()` in `app.tsx` — the `view` variable is derived from param presence: both params = `"terminal"`, session only = `"project"`, neither = `"dashboard"`.

TanStack Router has three routes: `indexRoute` (`/`), `sessionRoute` (`/$session`), `sessionWindowRoute` (`/$session/$window`). The router distinguishes them by path segment count.

## Dashboard View (`/`)

`app/frontend/src/components/dashboard.tsx` — renders in the terminal area slot when route matches `/`.

**Empty state**: When no sessions exist, centers "No sessions" text + `[+ Session]` button.

**Normal state**:
- Stats line at top: `{N} sessions, {M} windows` (singular when count is 1, e.g., "1 session, 1 window"). Styled `text-text-secondary text-xs`.
- Session card grid: CSS Grid `grid-template-columns: repeat(auto-fill, minmax(240px, 1fr))` with `gap-3`. Responsive — no breakpoint-specific rules.
- `[+ Session]` button below the grid, opens `CreateSessionDialog`.

**Session cards**: `<button>` elements (semantic HTML for accessibility). Styling: `bg-bg-card border border-border rounded p-4 hover:border-text-secondary text-left transition-colors`. Content:
- Session name (`text-text-primary font-medium text-sm truncate`)
- Window count (e.g., "3 windows")
- Activity summary (e.g., "2 active, 1 idle") — derived from each window's `activity` field

Click navigates to `/$session` (project page).

## Project Page View (`/$session`)

`app/frontend/src/components/project-page.tsx` — renders in the terminal area slot when route matches `/$session`.

**Session not found**: If no session matches the `$session` URL param, shows "Session not found" with an `<a>` link back to `/`.

**Empty session** (0 windows): Centers "No windows" text + `[+ Window]` button.

**Normal state**:
- Window card grid: same CSS Grid pattern as Dashboard (`auto-fill, minmax(240px, 1fr)`, `gap-3`).
- `[+ Window]` button below the grid, calls `createWindow` API.

**Window cards**: `<button>` elements. Same base styling as session cards. Content:
- Window name (`text-text-primary font-medium text-sm truncate`)
- Running process (`paneCommand`) if present
- Activity status: colored dot (green = `bg-accent-green` for active, dim = `bg-text-secondary/40` for idle) + label text
- Duration: idle duration via `getWindowDuration()` from `lib/format.ts`
- Fab info (when `fabStage` present): stage badge (`text-accent text-xs px-1.5 py-0.5 rounded bg-accent/10`) + change ID and slug via `parseFabChange()`

Click navigates to `/$session/$window`.

## Chrome (Top Bar)

The root layout (`app/frontend/src/app.tsx`) renders `TopBarChrome` which derives its content from the current session:window selection via `ChromeProvider` context. No slot injection — the chrome reads the selection and renders directly.

**Line 1** (fixed height, `border-b border-border`): logo toggle + icon breadcrumbs + connection indicator + `⌘K` (desktop) / `⋯` (mobile).

Breadcrumb adapts per view:
- **Dashboard** (`/`): Logo only (no ❯ separators)
- **Project page** (`/$session`): `{logo} ❯ {session}` (session dropdown, no window segment)
- **Terminal** (`/$session/$window`): `{logo} ❯ {session} ❯ {window}` (unchanged, syncs with tmux active window via SSE)

Logo toggles sidebar (desktop) or opens drawer (mobile) — no separate hamburger icon.

- Logo SVG (`logo.svg`) — clickable button that toggles sidebar/drawer (replaces `☰` hamburger)
- ❯ — Unicode heavy right angle (U+276F), unified separator/dropdown trigger icon for both session and window segments (tapping opens respective dropdown)
- Icons are rendered inside `BreadcrumbDropdown` via `icon` prop — no separate passive span, no `›` separator spans
- All segments except the last are clickable links
- No text prefixes like "session:" or "window:"

### Breadcrumb Dropdowns

Breadcrumb segments with a `dropdownItems` array use the ❯ icon as the dropdown trigger. Split click-target pattern: clicking the label navigates (existing behavior), clicking the icon opens the dropdown.

**Session dropdown**: Lists all tmux sessions. Current session highlighted with `text-accent`. Selecting navigates to `/{session}/0`.

**Window dropdown**: Lists all windows in the current session. Current window highlighted. Selecting navigates to `/{session}/{index}`.

**Dropdown component** (`app/frontend/src/components/breadcrumb-dropdown.tsx`): Reusable dropdown accepting `icon` prop (rendered as trigger button content), with outside-click dismiss, Escape dismiss, ArrowUp/ArrowDown keyboard navigation, ARIA `role="menu"`/`role="menuitem"`. Styled with `bg-bg-primary border-border shadow-2xl`, matching bottom-bar Fn key dropdown pattern. Icon button has 24px minimum tap target (44px on touch devices via `coarse:min-h-[44px]`). Long names truncated via `max-w-[240px]`.

Connection indicator: green/gray dot with "live"/"disconnected" label, driven by `isConnected` from ChromeProvider (set by each page from `useSessions`).

**Line 2** (fixed height, ALWAYS rendered with `min-h-[36px]`): Contextual action bar. Chrome derives content from `view` prop — adapts left actions and right status per route.

| View | Left content | Right content |
|------|-------------|---------------|
| Dashboard (`/`) | `[+ Session]` | (empty) |
| Project page (`/$session`) | `[+ Session]` `[+ Window]` | (empty) |
| Terminal (`/$session/$window`) | `[+ Session]` `[Rename]` `[Kill]` (kill has red hover) | `{dot} {activity} · {paneCommand} · {duration} │ {fabStage badge} · {fabChange id} · {fabChange slug} [fixedWidthToggle]` |

Right content layout for the selected window: activity dot + activity text, then `paneCommand` if present, then idle duration (via `getWindowDuration()`), then a `│` (U+2502 box drawing vertical) separator + fab stage badge + fab change (4-char ID `·` slug via `parseFabChange()`) if fab info is present. Items within a group separated by `·` (U+00B7 middle dot). All items `text-xs text-text-secondary`. Fab stage uses `text-accent px-1.5 py-0.5 rounded bg-accent/10` badge styling. Shared helpers imported from `lib/format.ts`.

`[+ Session]` is always visible (not gated on `currentWindow`) since creating a session is a global action. `[Rename]` and `[Kill]` are contextual to the current window.

Line 2 renders even when empty — prevents layout shift.

**Line 2 mobile collapse** (< 640px): Action buttons hidden (`hidden sm:block`). Status text renders left-aligned. A `⋯` button appears at the right edge (`sm:hidden`) and opens the command palette via a `palette:open` CustomEvent on `document`. All actions are registered as palette actions, so nothing is lost on mobile — only the presentation changes.

### Sidebar Kill Controls

- **Session row ✕**: Always-visible ✕ button on session rows with red hover. Click opens confirmation dialog: "Kill session **{name}** and all {N} windows?"

## Sidebar

`app/frontend/src/components/sidebar.tsx` — session/window tree navigation.

**Desktop** (>= 768px): Drag-resizable panel, default 220px width. Width persisted to `localStorage` key `runkit-sidebar-width`. Constraints: min 160px, max 400px. Drag handle (4-6px) on right edge with `col-resize` cursor, supports mouse and touch events. Collapsible via logo button in top bar.

**Mobile** (< 768px): Hidden by default. Logo button opens a drawer overlay from the left, dimming the terminal. Selecting a window closes the drawer. Drag-resize does not apply to mobile drawer.

**Padding**: `px-3 sm:px-6` (matches top bar and bottom bar chrome padding).

**Session rows**: Split interaction targets — session name and chevron are separate buttons. Chevron (▶/▼) toggles expand/collapse of the window list. Session name click navigates to `/$session` (project page) via `onSelectSession` prop. When viewing a Project page (`/$session`), the session name is highlighted (`text-text-primary font-medium`). ✕ kill button (right, always visible) opens confirmation dialog; on kill success, `onKillSession` callback navigates to `/`.

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

**No footer** — `[+ Session]` action moved to top bar line 2.

## Bottom Bar (Terminal View Only, Inside Terminal Column)

Single row of `<kbd>` styled buttons, rendered only when the Terminal view is active (`/$session/$window`). Hidden (not rendered) on Dashboard and Project page — no terminal WebSocket exists on those views. Rendered inside the terminal column (not root-level), so its width tracks the terminal width, not the full viewport. Styled with `border-t border-border` and `py-1.5` padding. Layout: `Esc Tab | Ctrl Alt Cmd | Fn▴ ArrowPad | >_`.

**Modifier toggles** (Ctrl, Alt, Cmd): Sticky armed state with visual indicator (`accent` bg). Click to arm, auto-clears after next key is sent. Click again while armed to disarm. Multiple modifiers can be armed simultaneously.

**Armed modifier bridging**: When modifiers are armed, a capture-phase `keydown` listener intercepts physical keypresses and translates them to terminal escape sequences (Ctrl+letter → control characters, Alt/Cmd → ESC prefix). Sends via WebSocket, preventing xterm from receiving the unmodified key. Ignores real Cmd/Ctrl/Alt held by the OS.

**ArrowPad** (`arrow-pad.tsx`): Combined directional pad replacing individual arrow buttons. Sends ANSI escape sequences (`[A/B/C/D`). With modifiers, use xterm parameter encoding (`[1;{mod}X`). Modifier parameter: 1 + (alt?2:0) + (ctrl?4:0) + (cmd?8:0).

**Function key dropdown** (F▴): Opens a combined popup above the button. Top section: F1-F12 in a 4-column grid. Divider (`border-t border-border`). Bottom section: PgUp, PgDn, Home, End, Ins, Del in a 3-column grid. Closes after each selection, on outside click, or on Escape.

**Special keys** (Esc, Tab): Direct send. Ctrl is not consumed for Esc/Tab (Esc IS Ctrl+[, Tab IS Ctrl+I in terminal semantics) — Ctrl stays armed for the next key. Alt/Cmd prefix with ESC (Meta convention).

**All buttons**: 32px minimum height on desktop, 44px on touch devices (`coarse:min-h-[44px]`). `text-xs`, `<kbd>` element styling.

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

All zones use `px-3 sm:px-6` — reduced horizontal padding on screens < 640px. No `max-w-4xl` constraint — terminal, top bar, and bottom bar all span full width. Sidebar is drag-resizable (default 220px, min 160, max 400) on desktop; terminal fills remaining space. Terminal container has `py-0.5 px-1` padding for breathing room against border lines. Bottom bar uses `py-1.5` vertical padding.

### Touch Targets

A custom Tailwind variant `coarse:` is defined in `globals.css` via `@custom-variant coarse (@media (pointer: coarse))`. On touch devices, interactive elements get `coarse:min-h-[44px]` (Apple HIG minimum). This includes:
- Line 2 action buttons (Rename, Kill)
- Sidebar session ✕ kill buttons + window rows
- Breadcrumb dropdown chevrons
- `⋯` command palette trigger
- Logo button (sidebar/drawer toggle)

Bottom bar buttons use `min-h-[44px]` unconditionally (not `coarse:` gated) since the bottom bar is touch-primary.

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

The `CommandPalette` component listens for a `palette:open` CustomEvent on `document` (in addition to `⌘K`). The `⋯` button in Line 2 dispatches this event. This is the mobile equivalent of `⌘K` — physical keyboards aren't available on phones.

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

The "Create session" dialog (top bar `[+ Session]` button or command palette) has three sections:

1. **Quick picks ("Recent:")** — Deduplicated project root paths from existing tmux sessions (window 0's `pane_current_path`). Tappable list items with 44px min height for mobile. Selecting fills path + auto-derives session name.

2. **Path input with autocomplete** — Text input that calls `GET /api/directories?prefix=...` with ~300ms debounce. Results appear as a dropdown below the input. Selecting a result fills the path and triggers a new autocomplete for children. Hidden directories (`.`-prefixed) are excluded from results.

3. **Session name** — Auto-derived from the last segment of the selected path (e.g., `~/code/wvrdz/run-kit` yields `run-kit`). Editable — auto-derivation is a convenience, not a lock.

On submit, the dialog calls `createSession(name, cwd)` which sends `POST /api/sessions` with `{ name, cwd }`. The `cwd` field is omitted when no path is selected, preserving the original name-only behavior. Accessible from top bar `[+ Session]` button and command palette.

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
| 2026-03-14 | Dashboard & Project page views — three-tier URL hierarchy (`/` = Dashboard, `/$session` = Project page, `/$session/$window` = Terminal). Session/window card grids in terminal area. View-dependent chrome (breadcrumbs, Line 2 actions, bottom bar visibility). Sidebar session name navigates to project page (chevron toggles expand/collapse). Kill redirects (window kill → `/$session`, session kill → `/`). Removed auto-redirect on root | `260313-ll1j-dashboard-project-page-views` |
