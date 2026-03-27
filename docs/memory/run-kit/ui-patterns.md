# run-kit UI Patterns

## URL Structure

| Route | View | Component Pattern |
|-------|------|-------------------|
| `/` | Server list | Standalone page (`ServerListPage`) — lists tmux servers with "+" creation button. No sidebar, no SSE. |
| `/$server` | Session dashboard | `AppShell` layout with `Dashboard` content. SSE connected to the specified server. |
| `/$server/$session/$window` | Terminal | `AppShell` layout with `TerminalClient` + `BottomBar`. SSE connected, WebSocket relay to tmux pane. |

Three-tier URL model with server always in path. URLs are fully shareable — copying a URL and opening it elsewhere on the same host opens the same server, session, and window. TanStack Router uses nested routes: `/$server` is a layout route whose component (`ServerShell`) wraps `SessionProvider` + `AppShell`. Child routes (dashboard index and terminal) are matched by the router but rendered conditionally by `AppShell` based on whether session/window params exist.

Server not found: if the `$server` segment doesn't match any known tmux server, a "Server not found" page renders with a link to `/`. Unmatched URLs (e.g., `/$server/$session` with no window) show a generic not-found page.

Kill/not-found redirects go to `/$server` (server dashboard), not `/` (server list). The user stays in their server context.

## Dashboard

`app/frontend/src/components/dashboard.tsx` — renders in the terminal area when no `/$session/$window` params are present (the `{sessionName && windowIndex ? <TerminalClient/> : <Dashboard/>}` branch in `app.tsx`).

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

**Terminal route** (`/:session/:window`): `☰ session / window` — hamburger icon (three SVG lines, animates to left-pointing chevron `<` via CSS transforms when sidebar/drawer is open) + session name (dropdown trigger, `max-w-[7ch] truncate`) + `/` plain text separator + window name (dropdown trigger). Syncs with tmux active window via SSE.

- Hamburger icon (`☰`) — replaces logo as sidebar/drawer toggle. Animates to back chevron (`<`) when `sidebarOpen` (desktop >= 768px) or `drawerOpen` (mobile < 768px) is true. Top and bottom lines rotate ±40deg and shorten to form chevron arms; middle line fades out. Always uses `text-text-primary` color
- `/` — plain text separator between session and window names (replaces `❯` U+276F). Not a click target
- Session name and window name text are the dropdown triggers (tappable to open respective dropdowns). Replaces the `❯` icon-based trigger pattern
- Session name capped at ~7 characters with ellipsis overflow (`max-w-[7ch] truncate`)
- No text prefixes like "session:" or "window:"

**Right section (desktop)**: `{logo} Run Kit  ●  ⇔  ⫼  ⊟  ✕  ◑  ⌘K  >_`
- Logo SVG (`icon.svg`) — decorative (`aria-hidden="true"`), not a button
- "Run Kit" text span (`text-xs text-text-secondary`)
- Green/gray connection dot — no text label ("live"/"disconnected" text removed)
- Split horizontal button (`SplitButton horizontal`) — splits pane left/right. Only rendered when `currentWindow` exists
- Split vertical button (`SplitButton`) — splits pane top/bottom. Only rendered when `currentWindow` exists
- Close pane button (`ClosePaneButton`) — kills the active pane of the current window. Only rendered when `currentWindow` exists
- `FixedWidthToggle`
- `ThemeToggle`
- `⌘K` kbd hint
- Compose button (`>_`) — rightmost item, opens compose buffer. `onOpenCompose` callback passed as prop to `TopBar`

**Right section (mobile < 640px)**: `⋯  >_` — only command palette trigger and compose button visible. Logo, "Run Kit" text, dot, toggle, split buttons, close pane button, ⌘K hidden via `hidden sm:flex` / `hidden sm:inline-flex`

**Split buttons** (`SplitButton` in `top-bar.tsx`): Two inline components calling `splitWindow(session, windowIndex, horizontal)` from `api/client.ts`. Custom SVG icons (square-split pattern). Best-effort error handling — tmux may reject if pane is too small. `POST /api/sessions/{session}/windows/{index}/split` with `{ "horizontal": bool }`.

**Close pane button** (`ClosePaneButton` in `top-bar.tsx`): Inline component calling `closePane(session, windowIndex)` from `api/client.ts`. X-shaped close icon SVG (`width="14" height="14" viewBox="0 0 24 24"`). Same base styling as `SplitButton` (`min-w-[24px] min-h-[24px] rounded border border-border text-text-secondary hover:border-text-secondary`). Hidden on mobile (`hidden sm:flex`). Only rendered when `currentWindow` exists. Best-effort error handling (`.catch(() => {})`), matching split button pattern. Kills the active pane of the current window — no pane ID tracking needed, targets via `POST /api/sessions/{session}/windows/{index}/close-pane`. Also available as "Pane: Close" in the command palette.

**Toolbar button color convention**: All toolbar buttons (top bar and bottom bar) use `text-text-secondary` as their default foreground color. Active toggle states (Ctrl/Alt modifiers when armed, FixedWidthToggle when active) use `text-accent` with accent background. Hover state uses `hover:border-text-secondary` (border highlight). This convention applies to: compose button, theme toggle, fixed-width toggle, split buttons, close pane button, Esc, Tab, Ctrl, Alt, Fn trigger, arrow pad, and ⌘K.

### Theme System

> Full spec: [`docs/specs/themes.md`](../../specs/themes.md) — architecture, ANSI palette structure, tmux colour mapping, import script usage, persistence model.

Palette-based theme model: each theme defines a `ThemePalette` with 22 canonical terminal colors — `foreground`, `background`, `cursorColor`, `cursorText`, `selectionBackground`, `selectionForeground`, plus 16 ANSI colors (indices 0-15) as a fixed-length readonly tuple. The `Theme` type has shape `{ id, name, category, palette }` — no `colors` or `themeColor` properties (both replaced by derivation from palette).

20 built-in themes (14 dark + 6 light) defined in `app/frontend/src/themes.ts` with canonical ANSI palettes sourced from iTerm2-Color-Schemes / official theme repos. Three consumers derive from the same palette:

1. **Web UI CSS** — `deriveUIColors(palette, category)` produces 8 `UIColors` keys (`bgPrimary`, `bgCard`, `bgInset`, `textPrimary`, `textSecondary`, `border`, `accent`, `accentGreen`). Derivation: `bgPrimary` = background, `bgCard` = lighten/darken background, `bgInset` = darken background, `textPrimary` = foreground, `textSecondary` = ansi[8] (bright black), `border` = blend(fg, bg, 0.25), `accent` = ansi[4] (blue), `accentGreen` = ansi[2] (green). Color utility helpers (`hexToRgb`, `rgbToHex`, `lightenHex`, `darkenHex`, `blendHex`) are module-private. CSS custom properties (`--color-bg-primary`, etc.) applied via inline styles on `document.documentElement.style` overriding `globals.css` fallbacks.
2. **xterm.js canvas** — `deriveXtermTheme(palette)` produces an xterm.js `ITheme` with all 22 colors mapped (background, foreground, cursor, cursorAccent, selectionBackground, selectionForeground, and 16 named ANSI colors black through brightWhite). Terminal content (syntax highlighting, colored prompts, git diff output) matches the selected theme.
3. **tmux chrome** — `configs/tmux/default.conf` uses ANSI `colour{N}` indices (colour0-colour15) instead of hardcoded hex. Because tmux renders its chrome as escape sequences that xterm.js interprets, changing the xterm.js ANSI palette automatically themes tmux status bar, pane borders, and pane-border-format. No runtime `tmux set -g` calls needed — the tmux.conf is static.

`data-theme` attribute set to theme's `category` ("dark" or "light") for CSS branching. Theme preferences persisted to both backend API (`GET/PUT /api/settings/theme` writing `~/.rk/settings.yaml`) and localStorage as synchronous cache. Three settings: `theme` (mode: `"system"` or specific ID), `theme_dark` (preferred dark theme, default `"default-dark"`), `theme_light` (preferred light theme, default `"default-light"`). localStorage keys: `runkit-theme`, `runkit-theme-dark`, `runkit-theme-light`. On init, API is canonical source; localStorage is the fast fallback if API fails. Unrecognized `theme` values fall back to `"system"`, while unrecognized `theme_dark`/`theme_light` values fall back to `"default-dark"`/`"default-light"`. PUT accepts partial updates (load-then-merge).

**ThemeToggle** (top bar): Normal click cycles `system → default-light → default-dark`. **Ctrl+Click / Cmd+Click** dispatches `"theme-selector:open"` CustomEvent to open the theme selector.

**Theme Selector** (`app/frontend/src/components/theme-selector.tsx`): Modal overlay matching CommandPalette structure (fixed z-50, backdrop, max-w-lg at 20vh). Search input filters by name (case-insensitive). Themes grouped under "Dark" / "Light" category headers. Arrow key navigation wraps and skips headers. Mouse hover and arrow navigation trigger live preview via `previewTheme()` — CSS custom properties update in real-time. Enter confirms (persists to API + localStorage), Escape/outside-click reverts to original theme via `cancelPreview()`. Opens via `"theme-selector:open"` custom event (same pattern as `"palette:open"`). Theme rows display multi-color palette swatches showing background plus representative ANSI colors (red, green, yellow, blue, magenta, cyan) instead of a single-color swatch.

**Command palette**: "Theme: Select Theme" action dispatches `"theme-selector:open"`. Individual "Theme: System", "Theme: Light", "Theme: Dark" quick-switch actions retained.

**ThemeProvider** (`app/frontend/src/contexts/theme-context.tsx`): `useTheme()` returns `{ preference, resolved, theme, themeDark, themeLight }`. `useThemeActions()` returns `{ setTheme, previewTheme, cancelPreview }`. Preview applies colors to DOM without persistence. Cancel reverts to the last persisted theme. Uses stable `actionsRef` pattern for callback identity. On init: calls `getThemePreference()` from API (returns `{ theme, themeDark, themeLight }`), falls back to localStorage / defaults if API fails. Per-mode theme resolution: in `"system"` mode, resolves to the user's preferred dark or light theme based on OS `prefers-color-scheme`, falling back to `DEFAULT_DARK_THEME` / `DEFAULT_LIGHT_THEME` if the stored ID is invalid. `setTheme` with a specific theme ID saves it to the matching per-mode slot (by `category`), keeps preference as `"system"` (preserving OS auto-toggle), and persists all three values to API and localStorage. `setTheme("system")` resets to system mode without changing per-mode prefs. Backend is canonical source of truth; localStorage is the fast fallback.

### Breadcrumb Dropdowns

Session and window name text are the dropdown triggers. Clicking/tapping the name opens the respective dropdown. No split click-target pattern — the name itself is the trigger.

**Session dropdown**: Lists all tmux sessions. Current session highlighted with `text-accent`. Selecting navigates to `/{server}/{session}/0`. First item: `+ New Session` action (opens session creation dialog).

**Window dropdown**: Lists all windows in the current session. Current window highlighted. Selecting navigates to `/{server}/{session}/{index}`. First item: `+ New Window` action (creates new window in current session).

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

**Session rows**: Chevron toggle (left, expands/collapses window list), session name (navigates to first window in session via `onSelectWindow(session, 0)`), + new window button (right), ✕ kill button (right, always visible). Click session name navigates to `/:session/0`; click chevron toggles expand/collapse. No server marker — all sessions belong to the active server.

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

**Inline window rename** (double-click): Double-clicking a window name `<span>` replaces it with a text `<input>` pre-filled with the current name, auto-focused with all text selected. Enter or blur commits the rename via `renameWindow(session, index, newName)` from `api/client.ts` — SSE pushes the updated name automatically, no optimistic UI. Escape cancels editing and reverts to the original name. Empty or whitespace-only input cancels (same as Escape). If the name is unchanged, no API call is made. Single-click behavior (navigate to window) is preserved — only `onDoubleClick` triggers editing. Editing state is local to the `Sidebar` component: `editingWindow: { session: string; index: number } | null` and `editingName: string`. Only one window may be in editing mode at a time. A `cancelledRef` prevents blur from committing after an Escape cancel. The existing command palette "Rename current window" dialog remains unchanged — inline editing is an additional path.

**Server selector footer** — pinned at the bottom of the sidebar below the scrollable session tree, separated by `border-t border-border`. Displays `Server: {name}` with a dropdown trigger. Clicking opens a dropdown listing all available tmux servers (from `GET /api/servers`); the current server is highlighted with `text-accent`. Selecting a different server calls `setServer(name)`, which updates localStorage (`runkit-server`), reconnects SSE, and navigates to `/`. The session tree area is `flex-1 min-h-0 overflow-y-auto` above the pinned footer.

## Bottom Bar (Terminal Pages Only, Inside Terminal Column)

Single row of `<kbd>` styled buttons, rendered only on terminal pages (`/:session/:window`). Hidden on the Dashboard route (`/`) — there is no terminal to send keys to. Rendered inside the terminal column (not root-level), so its width tracks the terminal width, not the full viewport. Styled with `border-t border-border` and `py-1.5` padding. Layout: `Tab Ctrl Alt Fn▴ ArrowPad | >_ ⌘K [hostname] ⌨`. Escape moved to the Function key dropdown's extended-keys section. Compose button (`>_`) conditionally rendered when `onOpenCompose` is provided.

**Modifier toggles** (Ctrl, Alt): Sticky armed state with visual indicator (`accent` bg). Click to arm, auto-clears after next key is sent. Click again while armed to disarm. Multiple modifiers can be armed simultaneously. Cmd (`⌘`) removed — on desktop users hold the real Cmd key; on mobile Cmd combos aren't used in terminal workflows.

**Armed modifier bridging**: When modifiers are armed, a capture-phase `keydown` listener intercepts physical keypresses and translates them to terminal escape sequences (Ctrl+letter → control characters, Alt → ESC prefix). Sends via WebSocket, preventing xterm from receiving the unmodified key. Ignores real Cmd/Ctrl/Alt held by the OS.

**ArrowPad** (`arrow-pad.tsx`): Combined directional pad replacing individual arrow buttons. Sends ANSI escape sequences (`[A/B/C/D`). With modifiers, use xterm parameter encoding (`[1;{mod}X`). Modifier parameter: 1 + (alt?2:0) + (ctrl?4:0).

**Function key dropdown** (F▴): Opens a combined popup above the button. Top section: F1-F12 in a 4-column grid. Divider (`border-t border-border`). Bottom section: Esc, PgUp, PgDn, Home, End, Ins, Del in a 3-column grid (3x3, 7 items). Escape uses `sendSpecial` (preserves Ctrl re-arm semantics); other extended keys use `sendWithMods`. Closes after each selection, on outside click, or on Escape.

**Special keys** (Tab in bottom bar, Esc in Fn menu): Direct send via `sendSpecial`. Ctrl is not consumed for Esc/Tab (Esc IS Ctrl+[, Tab IS Ctrl+I in terminal semantics) — Ctrl stays armed for the next key. Alt prefix with ESC (Meta convention).

**All buttons**: 36px minimum height/width on desktop (`min-h-[36px] min-w-[36px]`), 44px height / 36px width on touch devices (`coarse:min-h-[44px] coarse:min-w-[36px]`). `text-xs`, `<kbd>` element styling.

**Focus preservation**: All bottom bar buttons that send terminal input or toggle modifier state have `onMouseDown={(e) => e.preventDefault()}` via a shared `preventFocusSteal` handler. This prevents the browser from shifting focus away from xterm.js's hidden textarea when buttons are tapped, keeping the on-screen keyboard visible on iOS/touch devices. The CmdK button is excluded (it intentionally opens a dialog that takes focus). The ArrowPad handles focus preservation independently via its own `onMouseDown` handler.

### Compose Buffer

Modal dialog (`fixed inset-0 z-40`) triggered by the compose button (`>_` in top bar right section). Follows the same structural pattern as `dialog.tsx`: separate backdrop layer (`fixed inset-0 bg-black/50`, `aria-hidden`), `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, focus trap (Tab/Shift+Tab cycling), two-layer click-outside close (outer `onClick={onClose}`, inner `stopPropagation`). Terminal dims (`opacity-50`) while compose is open.

- **Title**: "Text Input" (`<h2>` with `aria-labelledby` ID)
- **Open**: Tap compose button (`>_` icon in top bar)
- **Send**: Click Send button or press Cmd/Ctrl+Enter — entire text transmitted as one WebSocket message
- **Dismiss**: Press Escape — closes without sending, text discarded
- **Why**: xterm is a `<canvas>`, not a native text input. iOS dictation, autocorrect, paste, IME all require a real DOM element. Also useful on desktop for pasting large text blocks over a laggy WebSocket.
- **initialText prop**: Optional string that pre-populates the textarea via imperative ref (no `defaultValue`). On subsequent prop changes while mounted, appends only new text.
- **Image preview**: When files are uploaded, a horizontal thumbnail strip renders above the textarea (~60px height). Image files (`image/*`) show `<img>` thumbnails via `URL.createObjectURL()` blob URLs. Non-image files show filename text. Each item has a dismiss (×) button (visible on hover) that removes the file from preview and its path from the textarea. Clicking an image thumbnail toggles a larger constrained preview within the dialog. All blob URLs are revoked via `URL.revokeObjectURL()` when the dialog closes (unmount cleanup).
- **Upload flow**: `useFileUpload` hook returns `{ path: string; file: File }[]` tuples. `terminal-client.tsx` stores both paths and `File` objects in state, passing `uploadedFiles` and `onRemoveFile` props to the compose buffer.

### File Upload

Four entry points, all on the terminal page:
- **Clipboard paste** (`Cmd+V` / `Ctrl+V`) — document-level paste listener; files in `clipboardData.files` trigger upload, text-only paste passes through to xterm
- **Drag-and-drop** — drop files onto the terminal area; `ring-2 ring-accent` border highlight during drag-over; non-file drag content ignored
- **Compose buffer upload button** (📎) — in compose buffer action row, left of Send button; opens native file picker via hidden `<input type="file">`
- **Command palette** — "Upload file" action opens a separate file picker (hidden input in terminal-client)

After upload: file path auto-inserted into compose buffer (opens compose if closed). Multiple files produce one path per line. Server writes to `.uploads/{YYMMDD-HHmmss}-{sanitized-name}` in the project root. 50MB size limit. `.uploads/` auto-added to `.gitignore` on first use.

### iOS Keyboard Support

`useVisualViewport` hook (`app/frontend/src/hooks/use-visual-viewport.ts`) manages all viewport-related CSS side effects: adds the `fullbleed` class to `<html>` on mount (removed on cleanup), and listens to both `resize` and `scroll` events on `window.visualViewport`, setting `--app-height` CSS custom property from `visualViewport.height`. The `scroll` listener catches iOS Safari viewport panning that doesn't trigger `resize`. In fullbleed mode, `globals.css` applies `position: fixed` to the `.app-shell` container with `inset: 0` and `height: var(--app-height, 100vh)`, pinning it to the viewport regardless of document scroll. When the iOS keyboard appears, the bottom bar stays pinned above it, the terminal shrinks, and xterm refits via the existing `ResizeObserver`. The `fullbleed` class is also present in `index.html` as a static default (FOUC prevention); the hook takes over lifecycle management at runtime.

**Keyboard toggle** (`⌨` U+2328): Right-aligned button in the bottom bar, visible only on touch devices (`hidden coarse:inline-flex`). Bidirectional toggle: when terminal is focused (detected via `document.activeElement.closest(".xterm")`), tapping blurs to dismiss the keyboard; when not focused, tapping calls `onFocusTerminal` callback which chains through `app.tsx` → `TerminalClient.focusRef` → `xtermRef.current.focus()` to summon the keyboard. Dynamic `aria-label`: "Hide keyboard" / "Show keyboard". Uses `preventFocusSteal` to avoid stealing focus on the dismiss path.

### Terminal Touch Scroll

The terminal container div has `touch-pan-y` (CSS `touch-action: pan-y`) — allows vertical swipe gestures for scrollback access on mobile/touch devices while blocking horizontal panning (prevents page-level overflow from tmux's ~80 column minimum). The xterm.js `.xterm-viewport` has `overflow-y: scroll` and `overscroll-behavior: none` (in `globals.css`), so the browser delegates vertical touch scroll to xterm natively without page bounce. In the single-view model, fullbleed is always active — `overflow: hidden` and `overscroll-behavior: none` are applied to both `html` and `body` (via `globals.css`), preventing iOS Safari elastic bounce scrolling. The compose buffer and bottom bar are siblings of the terminal container, not children, so their touch behavior is preserved.

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

### Viewport Zoom Prevention

The viewport meta tag in `app/frontend/index.html` includes `maximum-scale=1.0` and `user-scalable=no` to prevent iOS Safari from auto-zooming when text inputs (command palette, compose buffer, text input dialog) receive focus. Without these directives, iOS zooms in on inputs with `font-size < 16px`, displacing the entire interface. Pinch-to-zoom is also disabled — acceptable tradeoff for a keyboard-first tool dashboard where zoom doesn't improve terminal readability. The existing `interactive-widget=resizes-content` directive is preserved (controls keyboard layout resizing, unrelated to zoom).

### Terminal Addons

Addons loaded in `init()` via dynamic import, after `terminal.open()`, before `ResizeObserver` setup. Order: FitAddon (existing) → fit() → ClipboardAddon → WebLinksAddon → WebglAddon.

| Addon | Purpose | Notes |
|-------|---------|-------|
| `@xterm/addon-fit` | Auto-resize columns/rows | Existing — loaded first, `fit()` called immediately |
| `@xterm/addon-clipboard` | OSC 52 clipboard sequences | Custom `ClipboardProvider` accepts both `""` (empty/default, tmux's format) and `"c"` (explicit) selection targets. Rejects `"p"`, `"s"`, `"0"`–`"7"`. Provider exported as `clipboardProvider` for testability |
| `@xterm/addon-web-links` | Clickable URLs in terminal output | |
| `@xterm/addon-webgl` | GPU-accelerated rendering | Wrapped in try/catch — silently falls back to canvas renderer on failure |

### Terminal Font Scaling

Terminal font size adapts at initialization: 13px on viewports >= 640px, 11px below. Determined via `window.matchMedia('(min-width: 640px)')` at xterm Terminal construction time. FitAddon recalculates columns automatically.

### Command Palette Mobile Trigger

The `CommandPalette` component listens for a `palette:open` CustomEvent on `document` (in addition to `⌘K`). The `⋯` button in Line 1 dispatches this event on mobile. This is the mobile equivalent of `⌘K` — physical keyboards aren't available on phones.

### Keyboard-Navigable List Scroll Pattern

Both `CommandPalette` and `ThemeSelector` use the same scroll-into-view pattern for arrow key navigation: a `listRef` on the listbox container plus a `useEffect` on `[selectedIndex, open]` that queries `[aria-selected="true"]` and calls `scrollIntoView({ block: "nearest" })`. This ensures the selected item stays visible when navigating past the `max-h-64` scroll boundary. New keyboard-navigable list components SHOULD follow this pattern.

## Keyboard Shortcuts

### Global
| Key | Action | Context |
|-----|--------|---------|
| `Cmd+K` | Open command palette | Always |
| `Cmd+C` / `Ctrl+C` | Copy selection to clipboard (with selection) or send SIGINT (without selection) | Terminal focused — via `attachCustomKeyEventHandler`, `keydown` only. Uses `navigator.clipboard.writeText()` with `document.execCommand('copy')` fallback for non-secure contexts (HTTP). Selection cleared after copy via `.finally()` |

No single-key shortcuts (`j`/`k`/`c`/`r`) or `Esc Esc` — these conflicted with xterm.js terminal input. All actions are accessible via `Cmd+K` command palette or top bar buttons.

Command palette actions include: create/rename/kill session, create/rename/kill window, theme switching, "Reload tmux config" (targets the active server via `?server=` param), "Create tmux server" (opens name dialog, creates session "0" in $HOME), "Kill tmux server" (confirmation dialog, kills active server, switches to next available), "Switch tmux server: {name}" (one entry per available server, current marked), "Keyboard Shortcuts" (opens modal showing curated tmux keybindings from `GET /api/keybindings` + hardcoded `Cmd+K`), "Copy: tmux Attach Command" (copies `tmux attach-session -t {session}:{window}` to clipboard — only visible on terminal route when `currentWindow` is available), and terminal navigation (jump to any session/window).

### Keyboard Shortcuts Modal

`app/frontend/src/components/keyboard-shortcuts.tsx` — opened via command palette "Keyboard Shortcuts" action. Fetches `GET /api/keybindings?server=...` on-demand each time (no caching). Displays bindings in three groups:

1. **App** — hardcoded `Cmd+K` (command palette)
2. **tmux** — root-table bindings displayed as bare key names (e.g., `F2`, `Shift+F3`)
3. **tmux (prefix)** — prefix-table bindings displayed as `Ctrl+B, <key>` (e.g., `Ctrl+B, |`)

Key name formatting: `S-` → `Shift+`, `C-` → `Ctrl+`. Shows "Loading..." during fetch, "No tmux server running" when response is empty. Uses the shared `Dialog` component.

## Visual Design

Three theme modes: **system** (follows OS), **light**, **dark**. Default: system. Linear/Raycast aesthetic.

Theme is applied via `data-theme` attribute on `<html>` (`"dark"` or `"light"`). CSS custom properties in `globals.css` switch values per `html[data-theme="dark"]` and `html[data-theme="light"]` selectors. The `@theme` block registers token names for Tailwind CSS 4 with dark palette as initial values.

### Color Tokens

| Token | Dark | Light | Usage |
|-------|------|-------|-------|
| `--color-bg-primary` | `#0f1117` | `#f8f9fb` | Page background |
| `--color-bg-card` | `#171b24` | `#ffffff` | Card backgrounds |
| `--color-bg-inset` | `#0a0c12` | `#e8eaef` | Fixed-width outer background |
| `--color-text-primary` | `#e8eaf0` | `#1a1d24` | Primary text |
| `--color-text-secondary` | `#7a8394` | `#6b7280` | Secondary text, labels |
| `--color-border` | `#454d66` | `#d1d5db` | Borders, dividers |
| `--color-accent` | `#5b8af0` | `#4a7ae8` | Active states, focus rings |
| `--color-accent-green` | `#22c55e` | `#16a34a` | Activity indicators |
| `--font-mono` | JetBrains Mono, etc. | (same) | Everywhere |

### Theme Switching

Preference persisted to backend API (`PUT /api/settings/theme` → `~/.rk/settings.yaml`) with localStorage key `runkit-theme` as synchronous cache (values: any theme ID or `"system"`). On init, ThemeProvider calls `getThemePreference()` from API; falls back to localStorage / `"system"` if API fails. `setTheme` writes localStorage immediately and calls `setThemePreference(id)` fire-and-forget. Three switching surfaces: (1) command palette (`Cmd+K` → "Theme: System/Light/Dark", current indicated with "(current)" suffix), (2) top-bar ThemeToggle button (desktop only, hidden on mobile via `hidden sm:flex`, cycles system → default-light → default-dark), and (3) Theme Selector modal (Ctrl+Click / Cmd+Click on ThemeToggle, or command palette "Theme: Select Theme").

### No-Flicker Initialization

A blocking inline `<script>` in `index.html` `<head>` reads `localStorage("runkit-theme")`, resolves system preference via `matchMedia`, and sets `data-theme` on `<html>` before first paint. Static fallback: `data-theme="dark"` on the `<html>` tag.

### PWA Meta Tags & Theme Color

`app/frontend/index.html` includes PWA-related tags in `<head>`:
- `<meta name="theme-color" content="#0f1117" />` — initial value matching dark theme background
- `<meta name="apple-mobile-web-app-capable" content="yes" />` — enables standalone mode on iOS
- `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />` — content renders behind the status bar
- `<link rel="apple-touch-icon" href="/generated-icons/icon-192.png" />` — homescreen icon for iOS

The `<link rel="manifest">` tag is injected automatically by `vite-plugin-pwa` during build.

**Theme-color synchronization**: The `theme-color` meta tag value is kept in sync with the active theme via two mechanisms:
1. **Initial load** — the blocking inline script in `index.html` sets the `theme-color` meta tag alongside `data-theme` before first paint
2. **Runtime switch** — `applyThemeToDOM` in `ThemeProvider` sets `theme-color` to `theme.palette.background` when the user changes theme

Theme color is per-theme (derived from `palette.background`), not a fixed dark/light pair.

**Icon set**: Canonical mark at `app/frontend/public/icon.svg` (hexagonal cube, transparent). Generated variants in `app/frontend/public/generated-icons/`:
- `favicon.svg` — copy of `icon.svg` (transparent, used as browser favicon)
- `icon-192.png` — 192x192, solid `#0f1117` background, ~20% padding (homescreen icon)
- `icon-512.png` — 512x512, solid `#0f1117` background, ~20% padding (splash screen)
- `icon-512-maskable.png` — 512x512, solid `#0f1117` background, ~40% padding (maskable, safe zone for adaptive icon shapes)

Generated by `scripts/generate-icons.sh` (Node + sharp). Run via `just icons`.

**Standalone display mode**: When installed via "Add to Home Screen" (Android or iOS), the app runs without browser chrome (no address bar, no toolbar). The `display: "standalone"` manifest property and `apple-mobile-web-app-capable` meta tag enable this on their respective platforms.

### ThemeProvider Context

`app/frontend/src/contexts/theme-context.tsx` — split context (ThemeStateContext + ThemeActionsContext) following ChromeContext pattern. Provides `useTheme()` (preference + resolved + theme object) and `useThemeActions()` (setTheme, previewTheme, cancelPreview). Listens to `matchMedia("(prefers-color-scheme: dark)")` change events when preference is "system" for real-time OS theme tracking. On init: calls `getThemePreference()` from API, falls back to localStorage / `"system"` if API fails. `setTheme` writes localStorage immediately and calls `setThemePreference(id)` fire-and-forget. `applyThemeToDOM` computes CSS values via `deriveUIColors(theme.palette, theme.category)` and sets `theme-color` meta tag to `theme.palette.background`.

Provider order: `ThemeProvider > ChromeProvider > SessionProvider > AppShell`.

### xterm Terminal Theme

`terminal-client.tsx` uses `useTheme()` to get the active `Theme` object. Initial theme set at Terminal construction via `deriveXtermTheme(activeTheme.palette)` — all 22 colors (background, foreground, cursor, cursorAccent, selectionBackground, selectionForeground, and 16 named ANSI colors). Live updates via `xtermRef.current.options.theme = deriveXtermTheme(theme.palette)` in a `useEffect` — no terminal recreation needed. The `XTERM_THEMES` constant has been removed.

### Terminal Write Batching

WebSocket `onmessage` handler accumulates incoming data in buffers (string concatenation for text, `Uint8Array[]` for binary) and flushes once per `requestAnimationFrame` instead of calling `terminal.write()` per message. This coalesces multiple rapid messages into a single xterm.js render pass, smoothing output under high throughput (builds, log tailing). Buffered data is flushed on WebSocket close (guarded with try/catch for disposed terminal). `cancelAnimationFrame()` called on effect cleanup.

## Component Conventions

- **All components are client-side** — pure React SPA, no Server Components. Data fetched via typed API client (`app/frontend/src/api/client.ts`) and SSE context
- **No loading spinners** — SSE keeps data fresh, the view renders with whatever data is available
- **Data fetching via context** — `SessionProvider` at layout level owns the `EventSource` connection and provides session data via `useSessions()` hook
- **SSE via `useSessions` hook** — thin wrapper over `SessionProvider` context. Single `EventSource` at layout level. SSE handler diffs incoming `e.data` JSON string against a `useRef<string>` before parsing — if identical, skips `setSessions()` entirely (eliminates ~90% of redundant re-renders). When data has changed, `setSessions()` is wrapped in `startTransition()` to keep user input responsive. Auto-reconnects via `EventSource` built-in. Server-side SSE uses a module-level goroutine hub that deduplicates polling across browser tabs
- **ChromeProvider context** (`app/frontend/src/contexts/chrome-context.tsx`) — split into state/dispatch contexts. Three hooks: `useChromeState()` (state only), `useChromeDispatch()` (dispatch only), `useChrome()` (convenience alias for both). Components that only read state (e.g., `AppShell`, `FixedWidthToggle`) use `useChromeState()` to avoid subscribing to dispatch identity changes. Manages current session:window selection, sidebar open/collapsed state, drawer state (mobile), `isConnected`, `fixedWidth`. Chrome derives content from the selection — no slot injection
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
| 2026-03-17 | Fix xterm clipboard copy — `copyToClipboard` helper with `navigator.clipboard.writeText()` primary + `document.execCommand('copy')` fallback for non-secure HTTP contexts. Selection cleared via `.finally()`. Exported for testability | `260317-rpqx-xterm-copy-clipboard` |
| 2026-03-18 | Light theme support — three-mode theme system (system/light/dark), `data-theme` attribute on `<html>`, CSS custom properties per theme, blocking init script for no-flicker, ThemeProvider context (split pattern), xterm live theme update, command palette theme switcher, `--color-bg-inset` token replaces hardcoded fixed-width bg | `260318-eseg-add-light-theme-support` |
| 2026-03-18 | Inline tab rename — double-click window name in sidebar to edit inline (Enter/blur commits, Escape cancels, empty input cancels). Local state in Sidebar, no new dependencies. Existing command palette rename unchanged | `260318-dcl9-inline-tab-rename-double-click` |
| 2026-03-18 | Sidebar external session marker — `ProjectSession` type gains `server` field (`"runkit"` or `"default"`). Session rows show `↗` marker for default-server sessions (`text-[10px] text-text-secondary/50`, `aria-label="external session"`). Runkit-server sessions have no marker. | `260318-0gjh-dedicated-tmux-server` |
| 2026-03-20 | Multi-server terminal support — `TerminalClient` accepts `server` prop, WebSocket URL includes `?server=` param. "Reload tmux config" command palette action targets current session's server. `selectWindow` API call passes server for correct routing. | `260318-0gjh-dedicated-tmux-server` |
| 2026-03-20 | PWA meta tags and theme-color sync — `theme-color`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `apple-touch-icon` in `index.html`. Theme-color updated by blocking script (initial) and `applyTheme()` (runtime). Dark `#0f1117`, light `#f8f9fb`. Icon set in `public/icons/`. Standalone display mode. | `260320-j9a2-pwa-compliance` |
| 2026-03-20 | Single-active-server model — Sidebar server selector at bottom (`Server: <dropdown>`, pinned below scrollable session tree). Command palette: "Create tmux server" (name dialog), "Kill tmux server" (confirmation), "Switch tmux server: {name}" per server. Removed `↗` external session marker and `ProjectSession.server` field. `SessionProvider` manages `server`/`setServer`/`servers`/`refreshServers` state. Active server persisted in localStorage `runkit-server` (default: `runkit`). All API calls append `?server=` via `setServerGetter()` mechanism. SSE reconnects on server switch. Navigate to `/` on switch. | `260320-1335-tmux-server-switcher` |
| 2026-03-20 | UI polish + keyboard shortcuts — Breadcrumb left-aligned (removed `justify-center`). Sidebar server dropdown gains `+ tmux server` action. Hostname in bottom bar (hidden on mobile). Sidebar footer and bottom bar aligned at `h-[48px]`. Server label → "tmux server:". Consistent dropdown density (`text-sm py-2`). New "Keyboard Shortcuts" command palette action opens modal fetching `GET /api/keybindings` — shows curated tmux bindings grouped by table (root vs prefix), plus hardcoded `Cmd+K`. | `260320-9ldy-ui-polish-tmux-config-embed` |
| 2026-03-21 | Fix OSC 52 clipboard — custom `ClipboardProvider` for `ClipboardAddon` that accepts empty selection parameter (`""`) in addition to `"c"`. Fixes tmux copy-mode yank not reaching browser clipboard (tmux sends `]52;;base64`, addon default provider only accepted `]52;c;base64`). Provider exported as `clipboardProvider` for testability | `260321-zbdq-fix-osc52-clipboard-provider` |
| 2026-03-23 | ANSI palette theme rework — ThemePalette type (22 colors), deriveUIColors/deriveXtermTheme derivation layer, full xterm.js palette integration, tmux.conf ANSI colour indices (auto-theming via xterm.js), backend settings persistence (`~/.rk/settings.yaml`, `GET/PUT /api/settings/theme`), API + localStorage dual persistence in ThemeProvider, multi-color palette swatches in theme selector | `260323-7wys-ansi-palette-theme-rework` |
| 2026-03-25 | Per-mode theme preferences — `theme_dark`/`theme_light` settings stored alongside `theme` in `~/.rk/settings.yaml` and localStorage. System mode resolves to user's preferred dark/light theme instead of hard-coded defaults. Theme selection saves to matching per-mode slot (by category) and stays in system mode. API extended: GET returns all three fields, PUT accepts partial updates. | `260325-vxj6-per-mode-theme-preferences` |
| 2026-03-27 | Frontend rendering perf — SSE string diff + `startTransition` in SessionProvider (skips ~90% redundant re-renders), `useChromeState()` hook export (state-only consumers avoid merged object allocation), palette actions split into 7 independently memoized groups (session/window/view/theme/config/server/terminal), xterm.js write batching via `requestAnimationFrame` (coalesces WebSocket messages per frame) | `260327-cnav-perf-frontend-rendering` |
