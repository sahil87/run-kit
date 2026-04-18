# run-kit UI Patterns

## URL Structure

| Route | View | Component Pattern |
|-------|------|-------------------|
| `/` | Server list | Standalone page (`ServerListPage`) — lists tmux servers with "+" creation button. No sidebar, no SSE. |
| `/$server` | Session dashboard | `AppShell` layout with `Dashboard` content. SSE connected to the specified server. |
| `/$server/$session/$window` | Terminal or Iframe | `AppShell` layout. Rendering branch: `rkType === "iframe"` renders `IframeWindow` (URL bar + iframe), otherwise `TerminalClient` + `BottomBar`. SSE connected. |

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

**New Session button**: Always-visible dashed border card in the grid. Triggers instant session creation (calls `onCreateSession` → `executeCreateSessionInstant` in `app.tsx`) — no dialog opened. Session name derived from active window's `worktreePath`; no active window → name is `session`, no `cwd` passed.

**Touch targets**: Session card headers and window cards use `coarse:min-h-[44px]`.

## Iframe Window

`app/frontend/src/components/iframe-window.tsx` — renders in the terminal area when the current window has `rkType === "iframe"` and a non-empty `rkUrl`. The rendering branch in `app.tsx` is: `currentWindow?.rkType === "iframe" && currentWindow?.rkUrl ? <IframeWindow> : <TerminalClient>`. Bottom bar is NOT rendered for iframe windows (no terminal to send keys to).

**Layout**: Outer wrapper `flex flex-col flex-1 min-h-0` with two children: URL bar (`shrink-0`) and iframe (`flex-1`).

**URL Bar**: Thin toolbar above the iframe (`border-b border-border bg-bg-primary`). Three elements:
- **Refresh button** (↻ `&#x21bb;`) — forces iframe reload by clearing `src` to `"about:blank"` then re-setting it via `setTimeout(0)`. Styled: `w-7 h-7 rounded hover:bg-bg-card text-text-secondary`
- **URL input field** — shows current `rkUrl`, editable. On Enter, calls `updateWindowUrl(session, index, url)` via PUT API. On API failure, reverts input to the SSE-confirmed `rkUrl`. Styled: `bg-bg-card text-text-primary text-sm px-2 py-1 rounded border border-border`
- **Submit indicator** (⏎ `&#x23ce;`) — decorative visual affordance (`text-text-secondary text-xs`)

**SSE Sync**: A `useEffect` on `rkUrl` syncs both the URL bar text and iframe `src`. Uses a `currentSrcRef` to avoid re-setting iframe `src` when the URL hasn't actually changed (prevents unnecessary reloads on identical SSE ticks). When `rkUrl` changes externally (Claude or another process runs `tmux set-option`), the URL bar updates and iframe navigates automatically.

**Proxy URL conversion**: `toProxySrc(url)` converts localhost URLs to proxy paths: `http://localhost:8080/docs` -> `/proxy/8080/docs`. Non-localhost URLs pass through unchanged. Pattern: `^https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)(\/.*)?$`.

**Iframe attributes**: `sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"`, `title="Proxied content"`, `border-0`.

**Window creation**: "Window: New Iframe Window" command palette action (id `create-iframe-window`) opens a `Dialog` with two inputs: window name (autofocused, Enter focuses URL input) and URL (Enter creates window). Create button disabled until both fields non-empty. Calls `createWindow(server, session, name, undefined, "iframe", url)` — the extended API client function passes `rkType` and `rkUrl` in the POST body. Backend uses `CreateWindowWithOptions` for atomic `\;`-chained tmux command. Only shown when a session is active.

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

**Split buttons** (`SplitButton` in `top-bar.tsx`): Two inline components calling `splitWindow(server, session, windowIndex, horizontal)` from `api/client.ts`. The active `server` is passed as a prop from `TopBar` (read from `useSessionContext()` at handler scope). Custom SVG icons (square-split pattern). Best-effort error handling — tmux may reject if pane is too small. `POST /api/sessions/{session}/windows/{index}/split` with `{ "horizontal": bool }`.

**Close pane button** (`ClosePaneButton` in `top-bar.tsx`): Inline component calling `closePane(server, session, windowIndex)` from `api/client.ts`. X-shaped close icon SVG (`width="14" height="14" viewBox="0 0 24 24"`). Same base styling as `SplitButton` (`min-w-[24px] min-h-[24px] rounded border border-border text-text-secondary hover:border-text-secondary`). Hidden on mobile (`hidden sm:flex`). Only rendered when `currentWindow` exists. Best-effort error handling (`.catch(() => {})`), matching split button pattern. Kills the active pane of the current window — no pane ID tracking needed, targets via `POST /api/sessions/{session}/windows/{index}/close-pane`. Also available as "Pane: Close" in the command palette.

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

**Session dropdown**: Lists all tmux sessions. Current session highlighted with `text-accent`. Selecting navigates to `/{server}/{session}/0`. First item: `+ New Session` action — triggers instant session creation (no dialog).

**Window dropdown**: Lists all windows in the current session. Current window highlighted. Selecting navigates to `/{server}/{session}/{index}`. First item: `+ New Window` action (creates new window in current session).

**Action items in dropdowns**: `BreadcrumbDropdown` accepts an optional `action` prop of type `{ label: string; onAction: () => void }`. When provided, the action item renders before the selection list, separated by a divider (`border-t border-border`). Action items use `text-text-primary` styling (not `text-accent`), close the dropdown on click, and are excluded from ArrowUp/ArrowDown keyboard navigation among selection items.

**Dropdown component** (`app/frontend/src/components/breadcrumb-dropdown.tsx`): Reusable dropdown with outside-click dismiss, Escape dismiss, ArrowUp/ArrowDown keyboard navigation, ARIA `role="menu"`/`role="menuitem"`. Styled with `bg-bg-primary border-border shadow-2xl`, matching bottom-bar Fn key dropdown pattern. Name text serves as the trigger (44px on touch devices via `coarse:min-h-[44px]`). Long names truncated via `max-w-[240px]`.

Connection indicator: green/gray dot only (no text label), driven by `isConnected` from ChromeProvider (set by each page from `useSessions`).

**FixedWidthToggle** (in Line 1 right section): Renders between the connection dot and `⌘K`. Order: `[●] [⇔] [⌘K]`. Self-contained component using `useChrome()`/`useChromeDispatch()`. Touch target: `coarse:min-h-[36px] coarse:min-w-[28px]`. Hidden on mobile (< 640px).

### Sidebar Kill Controls

- **Session row ✕**: Always-visible ✕ button on session rows with red hover. Normal click opens confirmation dialog: "Kill session **{name}** and all {N} windows?" **Ctrl+Click / Cmd+Click** bypasses the confirmation dialog and kills immediately (best-effort `.catch(() => {})`).
- **Window row ✕**: Hover-reveal ✕ button on window rows (always visible on touch devices via `coarse:opacity-100`). Normal click opens confirmation dialog: "Kill window in **{session}**?" **Ctrl+Click / Cmd+Click** bypasses the confirmation dialog and kills immediately (best-effort `.catch(() => {})`).

The Ctrl+Click force-kill pattern matches the established "modifier = power action" convention: ThemeToggle uses Ctrl+Click to open the theme selector instead of cycling. Modifier detection uses `e.ctrlKey || e.metaKey` (Ctrl on Linux/Windows, Cmd on macOS).

## Sidebar

`app/frontend/src/components/sidebar/` — session/window tree navigation. The sidebar is decomposed into an orchestrator and seven sub-components:

- `index.tsx` — `Sidebar` orchestrator; owns all state (`collapsed`, `killTarget`, `editingWindow`, `editingSession`, `dragSource`, `dropTarget`, `sessionDropTarget`) and all `useOptimisticAction` hooks. Accepts `metrics` and `isConnected` props for HostPanel
- `session-row.tsx` — `SessionRow`; pure presentational; renders the session header row (chevron, name, + button, ✕ button); handles cross-session drag-over styling; all event handlers passed as props
- `window-row.tsx` — `WindowRow`; pure presentational; renders a single window row (activity dot, name, fab stage, duration, kill button); handles drag-and-drop and inline rename display; all event handlers passed as props
- `collapsible-panel.tsx` — `CollapsiblePanel`; reusable collapsible container with header (title + chevron) and localStorage open/closed state persistence via `storageKey` prop. Two modes: (a) legacy `max-height` CSS transition when `resizable` is absent/false (preserves existing Window/Host panel behaviour); (b) resizable mode (opt-in via `resizable` prop) — renders a 6px `ns-resize` drag handle at the bottom, persists user-set height to `localStorage[${storageKey}-height]`, and supports `defaultHeight`/`minHeight`/`maxHeight` props. `maxHeight` accepts a number or a `calc(100vh - Npx)` string form (parsed at drag time using `window.innerHeight`). Mobile breakpoint (`@media (pointer: coarse), (max-width: 639px)`) hides the drag handle and pins the content area to the `mobileHeight` prop (default 56px). All localStorage access wrapped in try/catch. **Header tint**: `tint` prop (`RowTint | null`) paints the header background. By default (legacy mode) the header uses `tint.base` with a `tint.base` ↔ `tint.hover` swap on hover. When `tintOnlyWhenCollapsed` is set, the tint is applied only while the panel is collapsed — and the shade switches to `tint.selected` with the hover swap disabled (stays flat), because in that mode the header is standing in for the selected item inside and a less-saturated hover would read as an inverted effect. `ServerPanel` is the only current consumer of `tintOnlyWhenCollapsed`; the legacy `base`/`hover` behavior is preserved for forward compatibility
- `status-panel.tsx` — `WindowPanel` (exported as both `WindowPanel` and deprecated `StatusPanel`); wraps pane metadata rows (tmx, cwd, git, fab/run, agt) in a `CollapsiblePanel` with copyable row interactions
- `host-panel.tsx` — `HostPanel`; 5-line server metrics display (hostname, CPU sparkline, memory gauge, load averages, disk+uptime) inside a `CollapsiblePanel`
- `server-panel.tsx` — `ServerPanel`; swatch-style grid of server tiles (Mock A) inside a `CollapsiblePanel` with `title="Server"`, `storageKey="runkit-panel-server"`, `defaultOpen={false}`, `resizable={true}`, `defaultHeight={140}`, `minHeight={80}`, `mobileHeight={56}`. The active server name is rendered in the panel's `headerRight` slot with `truncate text-text-primary font-mono` (matching the WindowPanel/HostPanel header-right convention); the `LogoSpinner` follows the name when `refreshing` is true. The panel also passes `tint={activeTint}` + `tintOnlyWhenCollapsed` so the collapsed header background matches the selected server's `rowTints.get(activeColor).selected` shade (same body tint used by the active tile inside the panel) — collapsed and expanded readings agree, and the header hover stays flat at the selected shade. Desktop grid: `repeat(auto-fill, minmax(72px, 1fr))`, 6px gap — tiles expand to fill the sidebar width, multi-row, scrolls internally when overflowing the user-set height. Each tile is a focusable `<button role="option">` with a 4px top color stripe (ANSI tint via `rowTints.get(color).base`, neutral `--color-border` for tiles without an assigned color), 11px truncated name, 10px `{N} sess` meta. Active tile: `aria-current="true"` + inset accent ring + `rowTints.get(color).selected` body tint (accent-subtle fallback for untinted active server). Hover-revealed `.actions` cluster (color-picker `■` + kill `✕`) rendered as a sibling to the tile button (not nested — avoids invalid button-in-button) with `group-hover:flex` on the outer wrapper; kill shown only on the active tile; entire cluster hidden on `pointer: coarse`. Mobile layout (`@media (pointer: coarse), (max-width: 639px)`): single-row grid via `grid-auto-flow: column`, `grid-auto-columns: 88px`, `overflow-x: auto; overflow-y: hidden`, `scroll-snap-type: x mandatory` — swipe horizontally, tap to select. Active tile `scrollIntoView({ block: 'nearest', inline: 'nearest' })` on mount when mobile layout active. `ServerInfo` shape (`{name, sessionCount}`) flows through from `/api/servers`
- `server-selector.tsx` — `ServerSelector` (legacy); owns its own dropdown state (`serverDropdownOpen`, `refreshingServers`, `serverDropdownRef`); pinned-bottom server dropdown with outside-click dismiss. Retained for backwards compat — `ServerPanel` is the primary server-switcher in the current UI
- `kill-dialog.tsx` — `KillDialog`; stateless; renders the kill confirmation dialog for sessions and windows using `<Dialog>`

Consumers import `@/components/sidebar` as before — Vite resolves directory imports to `sidebar/index.tsx` automatically.

**Desktop** (>= 768px): Drag-resizable panel, default 220px width. Width persisted to `localStorage` key `runkit-sidebar-width`. Constraints: min 160px, max 400px. Drag handle (4-6px) on right edge with `col-resize` cursor, supports mouse and touch events. Collapsible via logo button in top bar.

**Mobile** (< 768px): Hidden by default. Logo button opens a drawer overlay from the left, dimming the terminal. Selecting a window closes the drawer. Drag-resize does not apply to mobile drawer.

**Padding**: `px-3 sm:px-6` (matches top bar and bottom bar chrome padding).

**Sessions header**: The Sessions panel in `sidebar/index.tsx` is a plain always-open `<div>` (intentionally not a `CollapsiblePanel` — the session tree is a core always-visible nav surface). Its header row uses `text-text-secondary` as the baseline text color (matching `CollapsiblePanel`'s header baseline), with the "Sessions" label in `font-medium`. When `currentSession` is non-null, its name is rendered to the right of the label in `truncate text-text-primary font-mono` — exactly mirroring the ServerPanel `headerRight` pattern (`server-panel.tsx:81-86`). The `+` new-session button sits to the right of the name (and uses `ml-auto` only when `currentSession` is null, so the right-anchored layout holds in both cases). No background tint is applied — the Sessions panel is always open, so a tint would overlap the colored active `WindowRow` body tint.

**Session rows**: Chevron toggle (left, expands/collapses window list), session name (navigates to first window in session via `onSelectWindow(session, 0)`), + new window button (right), ✕ kill button (right, always visible). Click session name navigates to `/:session/0`; click chevron toggles expand/collapse. No server marker — all sessions belong to the active server. The session-level `+` button triggers instant session creation (calls `onCreateSession` → `executeCreateSessionInstant`), not a dialog. The window-level `+` button triggers instant window creation (existing `executeCreateWindow` behavior, passes `activeWin?.worktreePath` as CWD).

**Window rows**: Single line with activity dot + window name (left), right-side info (fab stage, duration, info button). All rows have `border-l-2` (transparent when not selected to prevent layout shift). Currently selected window highlighted with `bg-accent/10` + `border-accent` + `font-medium` + `rounded-r`. Click navigates to `/:session/:window`.

1. **Activity dot (shape-based)** — filled circle (`currentColor` background) = active, hollow ring (`1.5px solid currentColor` border, transparent background) = idle. Dot color is always `text-text-secondary` — decoupled from row tint color. When `isActiveWindow` is true, adds a `ring-1` outline: `ring-accent-green` for active windows, `ring-text-secondary/40` for idle windows. Pure CSS, no animation.

2. **Duration display** (right-aligned, `text-xs text-text-secondary`, after fab stage): For fab windows with `agentState === "idle"`, shows `agentIdleDuration` (e.g., `2m`). For non-fab or unknown-state idle windows, computes elapsed time from `activityTimestamp` on the frontend. Omitted for active windows. Computed via `getWindowDuration()` from `lib/format.ts`.

3. **Info button** (`ⓘ`, `text-[10px]`) — hover-reveal on desktop (`opacity-0 group-hover:opacity-100`), always visible on mobile (`coarse:opacity-100`). Click/tap toggles an info popover. 44px tap target on touch devices (`coarse:min-h-[44px]`). Rendered as a sibling `<button>` positioned absolutely (`absolute right-2 top-1/2 -translate-y-1/2`) to avoid nested interactive elements.

4. **Info popover** — compact key-value card (`bg-bg-primary border border-border shadow-2xl rounded py-1 px-2 text-xs z-50 min-w-[200px]`). Dismiss on outside click, Escape, or re-tap. Contains:
   - **Change**: fab change ID + slug (e.g., `txna · rich-sidebar-window-status`) — shown only for fab windows
   - **Process**: `paneCommand` (e.g., `claude`, `zsh`) — shown when present
   - **Path**: `worktreePath` — always shown
   - **State**: `activity` + agent state + duration (e.g., `idle · idle · 2m`) — always shown

Popover state managed via `popoverKey` state in `Sidebar`, keyed by `session:windowId`. Visually distinct from action menus (read-only info card, not clickable items).

5. **Pane CWD hover tooltip** — absolutely-positioned `div` inside the `relative group` window row wrapper in `window-row.tsx`. Revealed via `opacity-0 group-hover:opacity-100` (same `group-hover` reveal pattern as the kill button). Positioning: `top-full left-0 mt-0.5 w-full z-30` — appears below the row, full-width, non-clipping. Ghost windows are excluded (no tooltip rendered). Tooltip content (key-value rows):
   - `cwd` — active pane's CWD: `panes?.find(p => p.isActive)?.cwd ?? worktreePath`
   - `win` — window index and window ID (e.g., `3 (@5)`)
   - `panes` — comma-separated list `%id (index)` with `*` marking the active pane (e.g., `%8 (0)*, %9 (1)`); shows `—` when panes absent or empty

**Empty state**: When no sessions exist (`sessions.length === 0`), the sidebar displays "No sessions" text with a centered `+ New Session` button. The button triggers instant session creation (same as the sidebar `+` button and breadcrumb dropdown `+ New Session` action). With no active window, `cwd` is omitted and the name falls back to `session`.

**Inline rename** (double-click — windows and sessions): Both window names and session names in the sidebar support double-click inline rename. The pattern is identical for both:

- Double-clicking a name `<span>` replaces it with a text `<input>` pre-filled with the current name, auto-focused with all text selected.
- Enter or blur commits the rename if the trimmed value is non-empty and differs from the original name. Empty or unchanged input dismisses the editor without an API call.
- Escape cancels editing. A `cancelledRef` / `sessionCancelledRef` prevents blur from committing after an Escape (or cross-cancel).
- Single-click behavior is preserved (navigate to window / navigate to session's first window) — only `onDoubleClick` triggers editing.

**Window rename**: calls `renameWindow(server, session, index, newName)` via `useOptimisticAction` (`server` captured at handler time from `useSessionContext()`). The UI updates immediately via `windowStore.renameWindow(session, windowId, newName)`; on API failure it rolls back via `windowStore.clearRename(session, windowId)` and shows a toast error. SSE still reconciles the canonical updated name once the server event arrives.

**Session rename**: calls `renameSession(server, oldName, newName)` via `useOptimisticAction`. The UI updates immediately via `markRenamed("session", server, oldName, newName)`; on API failure it rolls back via `unmarkRenamed(server, oldName)` (`lastRenameSessionRef` snapshots `{ server, name }` together for cross-server-safe rollback). Toast error on failure. The dialog-based session rename in `app.tsx` remains unchanged — inline editing is an additional path.

**Cross-cancellation**: Only one inline edit (window or session) may be active at a time. Starting any new inline edit cancels the currently active one without committing it. `handleStartEditing` (window edit) sets `sessionCancelledRef.current = true` and clears `editingSession` before activating the window input; `handleStartSessionEditing` sets `cancelledRef.current = true` and clears `editingWindow` before activating the session input. This ensures blur on the cancelled input is a no-op.

**Window drag-and-drop reorder**: Window items in the sidebar are `draggable={true}` (ghost windows excluded). Uses native HTML5 drag-and-drop — no external library (constitution IV). Drag state managed via `dragSource` and `dropTarget` state in `Sidebar`. On `dragStart`, sets `dataTransfer` with JSON `{ session, index, windowId, name }` and `effectAllowed: "move"`. The `windowId` and `name` fields were added for cross-session optimistic operations; within-session drops use only `session` and `index`. Within-session drops: drop indicator is a 2px accent-colored top border (`borderTop: 2px solid var(--color-accent)`) on the hovered window item when source and target differ. On `drop`, uses `useOptimisticAction` to immediately swap window indices in the Zustand store via `swapWindowOrder(session, srcIndex, dstIndex)`, then fires `moveWindow(server, session, srcIndex, dstIndex)` API call in the background (server captured at drop-handler time). `onSelectWindow` is called immediately (not deferred to API success). On API failure, `onAlwaysRollback` reverses the swap via `swapWindowOrder(session, dstIndex, srcIndex)` and shows a toast error. SSE reconciliation naturally clears the optimistic state when `setWindowsForSession` replaces all entries with server-confirmed data. Same-position drops are no-ops (source === target check). All drag visual state (drop indicators) cleared on `dragEnd` and `drop` — handles both successful drops and cancelled drags (Escape, drag outside sidebar).

**Cross-session drag-and-drop**: Dropping a window onto a different session's header moves it to that session. `handleDragOver` accepts drag events on session headers when the dragged window is from a different session. Visual feedback: the session header shows an accent border (`border-accent`) when a valid cross-session drop is hovering. The drag data payload includes `{ session, index, windowId, name }` — `windowId` and `name` were added for optimistic store operations (within-session drop ignores the extra fields). On drop, `handleSessionDrop` calls `executeMoveToSession` (a `useOptimisticAction` instance) with all six arguments `(server, srcSession, srcIndex, windowId, windowName, dstSession)`. The optimistic lifecycle:

- **`onOptimistic`**: calls `killWindow(srcSession, windowId)` to hide the window from the source session, `addGhostWindow(dstSession, windowName)` to show it in the target (using the source window's display name, not a placeholder), and navigates to `/$server` immediately. The `optimisticId` is stored in a ref for rollback.
- **`action`**: calls `moveWindowToSession(server, srcSession, srcIndex, dstSession)` — the API client function with `server` as the first positional argument.
- **`onAlwaysRollback`** (API failure): calls `restoreWindow(srcSession, windowId)` to un-hide in source + `removeGhost(optimisticId)` to remove from target. Toast: "Failed to move window to session".
- **`onAlwaysSettled`** (success): clears the ref. SSE reconciliation handles final state — `setWindowsForSession` removes the entry from the source (not in incoming list), adds it to the target (new incoming entry), and reconciles the ghost (new `windowId` not in ghost's `snapshotWindowIds`).

Same-session header drops are ignored (not a valid cross-session target). Within-session window-to-window drag-and-drop is unchanged. The sidebar handles the move internally — no `onMoveWindowToSession` prop or `handleMoveWindowToSession` callback in `app.tsx` (the sidebar imports `moveWindowToSession` directly from `@/api/client`, matching the pattern of other sidebar API calls).

**Server selector footer** — pinned at the bottom of the sidebar below the scrollable session tree, separated by `border-t border-border`. Displays `Server: {name}` with a dropdown trigger. Clicking opens a dropdown listing all available tmux servers (from `GET /api/servers`); the current server is highlighted with `text-accent`. Selecting a different server calls `setServer(name)`, which updates localStorage (`runkit-server`), reconnects SSE, and navigates to `/`. The session tree area is `flex-1 min-h-0 overflow-y-auto` above the pinned footer.

### Collapsible Panels (Bottom-Aligned)

Two collapsible panels are pinned at the bottom of the sidebar below the scrollable session tree, above the server selector. Layout order top-to-bottom: server selector -> session list (`flex-1 overflow-y-auto`) -> Window panel -> Host panel. Combined height target ~140px when both open.

**CollapsiblePanel** (`app/frontend/src/components/sidebar/collapsible-panel.tsx`) — reusable wrapper used by both Window and Host panels. Props: `title` (string), `storageKey` (string for localStorage persistence), `defaultOpen` (boolean, default `true`), `children` (ReactNode). Header is always visible: title text + chevron (`&#x25B8;` U+25B8) that rotates 90 degrees on toggle via CSS `transform: rotate()` with `transition-transform duration-150`. Content area uses `max-height` transition (`duration-150 ease-in-out`) for smooth expand/collapse. `overflow: hidden` during transition, `visible` when fully expanded (accessibility). Collapse state persisted to `localStorage[storageKey]` on every toggle. Each panel has `border-t border-border`.

**WindowPanel** (`app/frontend/src/components/sidebar/status-panel.tsx`) — collapsible panel with `title="Pane"`, `storageKey="runkit-panel-window"`, `defaultOpen={true}`. Displays per-pane metadata rows: `tmx` (pane index + ID), `cwd` (shortened path), `git` (branch), `fab` (change ID + slug + stage) or `run` (process name), and `agt` (agent state). No window selected -> "No window selected" in secondary text. `StatusPanel` is exported as a deprecated alias for backward compatibility.

**Copyable rows**: The `tmx`, `cwd`, `git`, and `fab` rows are interactive `<button type="button">` elements that copy their underlying value to the clipboard on click or keyboard activation (Enter/Space). Copy values per row:

| Row | Copy value | Source |
|-----|------------|--------|
| `tmx` | Pane ID (e.g., `%5`) | `activePane.paneId` |
| `cwd` | Full unshortened path (e.g., `/home/sahil/code/run-kit`) | `activePane.cwd ?? win.worktreePath` |
| `git` | Branch name | `activePane.gitBranch` |
| `fab` | Change ID (e.g., `lc2q`) | `fabChange.id` (parsed from `win.fabChange`) |

Non-interactive rows: `run` (process-only, when no fab state) and `agt` remain plain text — no hover affordance, no focus ring, no copy behavior. Rows with empty values (`tmx` with empty pane ID, `git` when no branch) are also non-interactive.

**Activity spinners**: Two distinct inline spinner components indicate different activity types on the `run`/`fab` and `agt` rows:

| Component | File | Frames | Interval | Usage | Color |
|-----------|------|--------|----------|-------|-------|
| `BlockPulse` | `block-pulse.tsx` | `░▒▓█▓▒` | 150ms | `run` line (when `activity === "active"`) and `fab` line (when active) | `text-accent-green` (run), `text-accent` (fab) |
| `BrailleSnake` | `braille-snake.tsx` | `⣾⣽⣻⢿⡿⣟⣯⣷` | 80ms | `agt` line (whenever agent state is present) | `text-accent` |

Both components follow the same pattern: `useState(0)` frame counter + `useEffect` with `setInterval` + cleanup on unmount. Rendered as `<span aria-hidden="true">`. BlockPulse conveys "process alive, calm heartbeat"; BrailleSnake conveys "agent actively working, denser activity."

**Inline feedback**: After a successful copy, the row's prefix label swaps to `copied ✓` for 1000ms, then reverts. A single `copiedRow` state variable tracks which row was last copied — only one row shows feedback at a time. Clicking a different row immediately moves the indicator.

**Hover affordance**: Interactive rows render `cursor: pointer` and a subtle background tint (`bg-bg-inset` or equivalent) on hover.

**Keyboard accessibility**: Button elements have visible focus state (outline/ring) and are keyboard-activatable (Enter/Space). Styling is reset to preserve the panel's compact plain-text aesthetic — no default button chrome (padding, border, background removed in rest state).

**Text-selection guard**: The click handler checks `window.getSelection()?.toString()` — if the user has an active text selection (e.g., from drag-selecting text), the copy action is suppressed, preserving native text-selection UX.

**Clipboard utility**: Copy operations use `copyToClipboard()` from `app/frontend/src/lib/clipboard.ts` — see [Clipboard Utility](#clipboard-utility).

**HostPanel** (`app/frontend/src/components/sidebar/host-panel.tsx`) — 5-line server metrics display inside a `CollapsiblePanel` with `title="Host"`, `storageKey="runkit-panel-host"`, `defaultOpen={true}`. Accepts `metrics: MetricsSnapshot | null` and `isConnected: boolean` props. When `metrics` is null, shows "No metrics". Lines:

1. **Hostname + SSE indicator** — hostname on the left (truncated), green dot (`bg-accent-green`) or gray dot (`bg-text-secondary`) on the right indicating SSE connection health
2. **CPU sparkline** — `cpu` label + braille sparkline (`text-accent`) + current percentage (`text-text-primary`). Sparkline rendered by `sparkline()` from `@/lib/sparkline.ts`
3. **Memory gauge** — `mem` label + filled/empty block gauge + `used/totalG` text. Gauge color: green < 70%, yellow 70-90%, red > 90%. Uses `gaugeBar()`, `gaugeColor()`, `formatMemory()` from `@/lib/gauge.ts`
4. **Load averages** — `load` label + three percentages (1/5/15 min) normalized as `(load / cpuCount) * 100`. Any percentage > 90% renders in `text-red-500`
5. **Disk + uptime** — `dsk` label + `used/totalG` + ` · up ` + formatted uptime (`Nd Nh` or `Nh Nm` if < 1 day). All `text-text-secondary`

### Color Tinting

Session and window rows in the sidebar support an optional ANSI-palette color assignment that applies a full-width background tint. Colors come from the active theme's ANSI palette (indices 0-15), so they adapt automatically when the user switches themes.

**Pre-blended row tints**: Colors are pre-blended via `blendHex()` (in `themes.ts`) against the theme background — not rgba opacity. `computeRowTints(palette)` pre-computes a `Map<number, RowTint>` for all 13 picker indices at three blend ratios:

| State | ANSI ratio | Background ratio |
|-------|------------|------------------|
| Base | 12% | 88% |
| Hover | 18% | 82% |
| Selected | 22% | 78% |

Each state gets its own concrete hex value — no stacking of transparent layers. The `RowTint` type (`{ base, hover, selected }`) is exported from `themes.ts`. When a row has a color assigned, the tint backgrounds replace the existing state backgrounds (`bg-accent/10` for selected, `hover:bg-bg-card/50` for hover). The left border on selected colored windows uses the ANSI color at full saturation. Hover state is applied imperatively via `onMouseEnter`/`onMouseLeave` style mutations to avoid CSS specificity issues with dynamic backgrounds.

**ANSI picker indices**: 13 colors offered — `PICKER_ANSI_INDICES = [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14]` (exported from `themes.ts`). Excludes 0 (black), 7 (white), 15 (bright white) to avoid clash with dark/light theme backgrounds. Index 8 (bright black) included as a usable gray.

**SwatchPopover** (`app/frontend/src/components/swatch-popover.tsx`): Shared component used by command palette color actions and hover indicator. Renders 13 color swatches in a compact grid plus a "Clear" action. Props: `selectedColor?: number`, `onSelect(color: number | null)`, `onClose()`. Each swatch displays the ANSI color from `theme.palette.ansi[N]` at full saturation. Currently selected color shown with a checkmark or ring. Swatches re-render live during theme preview. Lazy-loaded in `app.tsx` via `React.lazy()`. Dismisses on selection, Escape, or outside click.

**Hover indicator**: On hover, a small palette icon appears at the row's trailing edge (right side, alongside existing hover-reveal controls). Clicking opens the SwatchPopover inline, anchored to the row. Visible only on hover (desktop) or always visible on touch (`coarse:opacity-100`).

**Command palette actions**: "Session: Set Color" (id `session-set-color`, only when session selected) and "Window: Set Color" (id `window-set-color`, only when window selected) open the SwatchPopover. Selecting a color calls the respective API endpoint; selecting "Clear" sends `null`. Both session and window rows in the sidebar also support direct SwatchPopover via the hover indicator.

**Storage**: Session colors persist in `run-kit.yaml` at the project's git root (survive tmux restarts). Window colors are ephemeral tmux `@color` user options (survive session lifetime, not server restarts). See architecture.md for backend details.

### Braille Sparkline Renderer

`app/frontend/src/lib/sparkline.ts` — converts an array of float values (0-100 range) into a Unicode braille sparkline string. Uses 8 vertical levels from the U+2800-U+28FF braille range filling bottom-to-top: `⣀⣄⣤⣦⣶⣷⣾⣿` (level 0 = `⣀`, level 7 = `⣿`). Values linearly interpolated across 8 levels. Zero-filled buffer renders as repeated `⣀`. Exported as `sparkline(samples: number[]): string`.

### Memory Gauge Renderer

`app/frontend/src/lib/gauge.ts` — utilities for the memory gauge visualization:
- `gaugeBar(ratio: number): string` — builds a filled/empty block string (`█` filled, `░` empty) from a 0-1 ratio. Fixed width of 10 characters
- `gaugeColor(percent: number): string` — returns a Tailwind color class: `text-green-500` (< 70%), `text-yellow-500` (70-90%), `text-red-500` (> 90%)
- `formatBytes(bytes: number): string` — compact human-readable size (`3.1G`, `512M`, `128K`)
- `formatMemory(used: number, total: number): string` — compact `used/total` string (e.g., `3.1G/8G`)

### Clipboard Utility

`app/frontend/src/lib/clipboard.ts` — shared `copyToClipboard(text: string): Promise<void>` function extracted from `terminal-client.tsx`. Primary path uses `navigator.clipboard.writeText()`; fallback uses `document.execCommand('copy')` for non-secure contexts (HTTP). Signature and behavior preserved from the original. All callers (terminal copy, Pane panel row copy) import from this module. Introduced to decouple sidebar copy operations from the terminal-client module.

CWD display (line 1) uses `shortenPath()` to shorten the active pane's `cwd` (falls back to `worktreePath`):
- Home substitution: `/home/<user>/…` → `~/…`, `/Users/<user>/…` → `~/…`, `/root/…` → `~/…` (exact home dir → `~`). Handles Linux and macOS conventions.
- Truncation: if the path (after home substitution) has more than 2 non-empty segments, it is truncated to `…/<second-to-last>/<last>`. Paths with ≤ 2 segments are not truncated.
- Examples: `/home/sahil/code/org/repo/src` → `…/repo/src`; `/home/sahil/code/org` → `~/code/org`; `/var/log/nginx` → `…/log/nginx`.
- The `title` attribute on the CWD element always contains the original unmodified `activePaneCwd` — hover to see the full path.

## Session Creation Pattern

### Instant Creation (Primary)

All primary session creation entry points create a session immediately without a dialog. Implemented by `executeCreateSessionInstant` in `app.tsx`.

**Algorithm**:
1. Derive a name from the active window's `worktreePath` using `deriveNameFromPath(worktreePath)` (exported from `create-session-dialog.tsx`). If the result is empty (CWD is `/`, `~`, or `worktreePath` is undefined), the name is `session`.
2. Deduplicate against `sessions`: if the name is taken, try `{name}-2`, `{name}-3`, … up to `{name}-10`. If all are taken, use `{name}-11` (best-effort).
3. Call `createSession(server, derivedName, worktreePath)`. If no active window exists, call `createSession(server, "session")` (no `cwd` — tmux defaults to server CWD).
4. The session appears in the sidebar via the existing optimistic/ghost mechanism.

**Entry points** (all call `onCreateSession` → `executeCreateSessionInstant`):
- Sidebar `+` button (session level)
- Sidebar empty-state `+ New Session` button
- Dashboard "New Session" dashed-border card
- Top-bar breadcrumb session dropdown `+ New Session` item
- Cmd+K "Session: Create" action

**Name derivation utilities**: `deriveNameFromPath` and `toTmuxSafeName` are exported from `app/frontend/src/components/create-session-dialog.tsx` so `app.tsx` can import them without duplicating logic.

### Folder-Prompted Creation (Secondary, via Cmd+K)

Two secondary entry points open `CreateSessionDialog` for users who want to specify a starting directory:

- **"Session: Create at Folder"** — opens `CreateSessionDialog` (mode `"session"`, default). The dialog's path input is pre-filled with `currentWindow.worktreePath` via the `defaultPath?: string` prop added to `CreateSessionDialogProps`. If no active window, the field starts empty.
- **"Window: Create at Folder"** — opens `CreateSessionDialog` with `mode="window"` and `session={currentSession}`. In window mode: title changes to "Create window at folder", session name input hidden, confirming calls `createWindow(server, session, "zsh", cwd)`.

`CreateSessionDialog` gains three optional backward-compatible props:
- `defaultPath?: string` — pre-fills the path input
- `mode?: "session" | "window"` — controls dialog behavior (default `"session"`)
- `session?: string` — required in window mode to pass to `createWindow`

### Deprecated: Dialog-First Flow

The `showCreateDialog` / `openCreateDialog` / `closeCreateDialog` API in `use-dialog-state.ts` has been removed. `CreateSessionDialog` is no longer opened by the sidebar `+` button or the primary "Session: Create" palette action. Use "Session: Create at Folder" in Cmd+K for folder-prompted session creation.

## Bottom Bar (Terminal Pages Only, Inside Terminal Column)

Single row of `<kbd>` styled buttons, rendered only on terminal pages (`/:session/:window`). Hidden on the Dashboard route (`/`) — there is no terminal to send keys to. Rendered inside the terminal column (not root-level), so its width tracks the terminal width, not the full viewport. Styled with `border-t border-border` and `py-1.5` padding. Layout: `Tab Ctrl Alt Fn▴ ArrowPad | >_ ⌘K ⌨`. Hostname removed from bottom bar — now shown exclusively in the sidebar Host panel. Escape moved to the Function key dropdown's extended-keys section. Compose button (`>_`) conditionally rendered when `onOpenCompose` is provided.

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

**Scroll-lock mode**: Long-press (>= 500ms) on the keyboard toggle button activates scroll-lock — a mode that prevents the soft keyboard from appearing when the terminal area is tapped, allowing uninterrupted reading and scrolling. State is a `scrollLocked` boolean in `BottomBar` (default `false`), exposed to the parent via `onScrollLockChange` callback and passed down to `TerminalClient` as a `scrollLocked` prop. When locked, a capture-phase `focusin` listener on the terminal container immediately blurs any `.xterm` element that gains focus, preventing the keyboard from appearing. Touch scroll gestures (SGR mouse sequences) are unaffected — only focus is prevented. Activating scroll-lock while the keyboard is visible auto-dismisses it (`document.activeElement?.blur()`). Optional haptic feedback via `navigator.vibrate?.(50)` on toggle (graceful no-op if unavailable).

- **Long-press detection**: `touchstart`/`touchend`/`touchmove` handlers with a 500ms timer (`LONG_PRESS_MS` constant). Touch move > 10px (`LONG_PRESS_MOVE_THRESHOLD`) cancels the long-press. On timer expiry, scroll-lock toggles and subsequent `touchend`/`click` are suppressed via a ref flag. Desktop click behavior is unaffected (touch events only).
- **Tap in locked mode**: Tapping the keyboard button (< 500ms) when `scrollLocked` is `true` unlocks AND summons the keyboard in one action — matches user intent without requiring a double-tap.
- **Visual indicator**: When locked, the button shows `bg-accent/20 border-accent text-accent` (same armed-state pattern as Ctrl/Alt modifier toggles) and the icon changes from `⌨` (U+2328) to `🔒` (U+1F512). `aria-label` updates to "Scroll lock on — tap to unlock".
- **State lifecycle**: Session-scoped (component-local React state, not persisted). Resets on navigation (component unmount/remount). Compose buffer is unaffected — it has its own input field outside the terminal container.

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

Addons loaded in `init()` via dynamic import, after `terminal.open()`, before `ResizeObserver` setup. Order: FitAddon (existing) → fit() → ClipboardAddon → WebLinksAddon → UnicodeGraphemesAddon → WebglAddon. The Unicode addon MUST precede WebGL so the renderer measures cell widths against the active Unicode 15 table on first paint.

| Addon | Purpose | Notes |
|-------|---------|-------|
| `@xterm/addon-fit` | Auto-resize columns/rows | Existing — loaded first, `fit()` called immediately |
| `@xterm/addon-clipboard` | OSC 52 clipboard sequences | Custom `ClipboardProvider` accepts both `""` (empty/default, tmux's format) and `"c"` (explicit) selection targets. Rejects `"p"`, `"s"`, `"0"`–`"7"`. Provider exported as `clipboardProvider` for testability |
| `@xterm/addon-web-links` | Clickable URLs in terminal output | |
| `@xterm/addon-unicode-graphemes` | Unicode 15 + grapheme-cluster width tables | Requires `allowProposedApi: true` on the Terminal constructor; `terminal.unicode.activeVersion = "15-graphemes"` set after `loadAddon()`. Must load before the WebGL addon |
| `@xterm/addon-webgl` | GPU-accelerated rendering | Wrapped in try/catch — silently falls back to canvas renderer on failure |

### Terminal Font Scaling

Terminal font size adapts at initialization: 13px on viewports >= 640px, 11px below. Determined via `window.matchMedia('(min-width: 640px)')` at xterm Terminal construction time. FitAddon recalculates columns automatically.

### Terminal Font Bundling

The frontend bundles JetBrainsMono Nerd Font (patched single-file variant) as a webfont so terminal rendering is deterministic across all viewers, independent of which monospace fonts the browser happens to have installed. Without bundling, per-glyph font fallback for Nerd Font private-use-area codepoints produces visible baseline wobble within a single terminal row.

**Asset layout**: Three `.woff2` weights served from `/fonts/` — `JetBrainsMonoNerdFont-Regular.woff2` (400 normal), `-Bold.woff2` (700 normal), `-Italic.woff2` (400 italic). All three `@font-face` rules in `app/frontend/src/globals.css` expose the same `font-family: "JetBrainsMono Nerd Font"` name and MUST declare `font-display: block`. `swap` or `fallback` would let xterm measure cells against system-font metrics that persist as misalignment — xterm measures the character cell grid exactly once at `terminal.open()` and does not re-measure when a deferred font arrives. `index.html` includes a `<link rel="preload" as="font" type="font/woff2" crossorigin href="/fonts/JetBrainsMonoNerdFont-Regular.woff2" />` to overlap the Regular download with JS parsing (only Regular is preloaded — Bold/Italic are a smaller fraction of the initial paint and don't justify the extra critical-path bytes).

**Load convention before `terminal.open()`**: The init routine in `app/frontend/src/components/terminal-client.tsx` awaits a concurrent `Promise.all([document.fonts.load(...), document.fonts.load(...), document.fonts.load(...)])` for all three weights at the exact `fontPx` (`isMobile ? 11 : 13`) the Terminal will use, BEFORE `new Terminal(...)` / `terminal.open()` / `fitAddon.fit()`. Three explicit `document.fonts.load(size, family)` calls (not `document.fonts.ready`) scope the await to exactly the weights xterm will request. A fresh `if (cancelled || !terminalRef.current) return;` guard MUST follow the await, matching the existing pattern after every `await import(...)` in the same effect.

**Primary `fontFamily`**: `'"JetBrainsMono Nerd Font", ui-monospace, monospace'` — bundled webfont first, `ui-monospace` as the system-default monospace, generic `monospace` as final guard against total load failure. The older long tail (`JetBrains Mono`, `Fira Code`, `SF Mono`, `Menlo`, `Monaco`, `Consolas`) is dead code once `font-display: block` plus a successful load makes the webfont always win; do not reintroduce it. Non-terminal monospace surfaces pick up the same font automatically via Tailwind's `--font-mono` custom property (webfont-first). Introduced by change `260417-hyrl-bundle-jetbrains-mono-nerd-font`.

**Test caveat**: jsdom does not implement the FontFaceSet API. `src/test-setup.ts` stubs a minimal `document.fonts.load()` / `document.fonts.ready` surface (same pattern as the existing `ResizeObserver` stub) so unit tests that mount `TerminalClient` do not hang on the await.

### Terminal Unicode Width Handling

xterm.js defaults to Unicode 6 width tables, which classify many modern glyphs (most emojis, several Misc Symbols codepoints) as 1 cell. Modern tmux lays out its buffer using wcwidth with a newer Unicode table (typically 14/15), treating the same glyphs as 2 cells. Without alignment, subsequent characters in a row drift between tmux's intended column and xterm's rendered column, producing visible ghost/overlap artifacts — especially with the WebGL renderer.

**Resolution** (`app/frontend/src/components/terminal-client.tsx`):
1. Construct the Terminal with `allowProposedApi: true` — required to access `terminal.unicode` (a proposed-API surface in xterm v6).
2. After `terminal.open()`, dynamically import `@xterm/addon-unicode-graphemes`, `loadAddon(new UnicodeGraphemesAddon())`, and set `terminal.unicode.activeVersion = "15-graphemes"`.
3. Load order MUST precede the WebGL addon so the renderer initialises against the Unicode 15 table on first measure.

The `addon-unicode-graphemes` package (v6-era) supersedes `addon-unicode11`: it covers Unicode 15 and grapheme clusters (ZWJ sequences, flag emoji, skin-tone modifiers) at the same install cost. The `unicodeVersion` Terminal constructor option is a no-op past `"6"` without the addon — the addon is what registers the newer width table.

Introduced by change `260418-xgl2-xterm-emoji-width`.

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

Command palette actions include: create/rename/kill session, create/rename/kill window, move window left/right, theme switching, "Reload tmux config" (targets the active server via `?server=` param), "Create tmux server" (opens name dialog, creates session "0" in $HOME), "Kill tmux server" (confirmation dialog, kills active server, switches to next available), "Switch tmux server: {name}" (one entry per available server, current marked), "Keyboard Shortcuts" (opens modal showing curated tmux keybindings from `GET /api/keybindings` + hardcoded `Cmd+K`), "Copy: tmux Commands" (opens tmux commands dialog — only visible on terminal route when `currentWindow` is available), and terminal navigation (jump to any session/window).

**Session/window creation actions in the palette**:
| Action ID | Label | Behavior |
|-----------|-------|----------|
| `create-session` | "Session: Create" | Instant creation — no dialog (see Instant Session Creation) |
| `create-session-at-folder` | "Session: Create at Folder" | Opens `CreateSessionDialog` pre-filled with `currentWindow.worktreePath`; empty if no active window |
| `create-window` | "Window: Create" | Instant window creation (existing behavior, unchanged) |
| `create-window-at-folder` | "Window: Create at Folder" | Opens `CreateSessionDialog` in `mode="window"` (dialog title changes, session name input hidden, confirms via `createWindow(server, session, "zsh", cwd)`); only shown when a session is active |
| `create-iframe-window` | "Window: New Iframe Window" | Opens dialog with name + URL inputs; creates iframe window via `createWindow(server, session, name, undefined, "iframe", url)`; only shown when a session is active |

**Window move actions**: "Window: Move Left" (id `move-window-left`) and "Window: Move Right" (id `move-window-right`) in the `windowActions` group. Only shown when `currentWindow` exists. "Move Left" excluded when the current window is at the minimum index in the session; "Move Right" excluded when at the maximum index (boundary exclusion, not disabled state). On select, calls `moveWindow(session, currentIndex, targetIndex)` then navigates to `/$server/$session/$targetIndex` so the user follows their window to its new position after the swap.

**Cross-session move actions**: Dynamically generated "Window: Move to {sessionName}" actions (id `move-window-to-session-{sessionName}`) — one per session other than the current one. Only shown when `currentWindow` exists AND there are at least 2 sessions. On select, calls `moveWindowToSession(currentSession, currentWindow.index, targetSession)` then navigates to `/$server` (server dashboard) because tmux auto-assigns the window index in the destination session and no `/$server/$session` route exists. Flat action list (not a sub-picker) — works well for typical session counts (2-5) and requires zero changes to the command palette component.

### Keyboard Shortcuts Modal

`app/frontend/src/components/keyboard-shortcuts.tsx` — opened via command palette "Keyboard Shortcuts" action. Fetches `GET /api/keybindings?server=...` on-demand each time (no caching). Displays bindings in three groups:

1. **App** — hardcoded `Cmd+K` (command palette)
2. **tmux** — root-table bindings displayed as bare key names (e.g., `F2`, `Shift+F3`)
3. **tmux (prefix)** — prefix-table bindings displayed as `Ctrl+S, <key>` (e.g., `Ctrl+S, \`)

Key name formatting: `S-` → `Shift+`, `C-` → `Ctrl+`. Shows "Loading..." during fetch, "No tmux server running" when response is empty. Uses the shared `Dialog` component.

### Tmux Commands Dialog

`app/frontend/src/components/tmux-commands-dialog.tsx` — opened via command palette "Copy: tmux Commands" action (id `copy-tmux-attach`). Only available on terminal pages when `currentWindow` exists. Opens a `Dialog` with title "tmux commands" showing three copyable tmux command rows:

| Label | Command |
|-------|---------|
| Attach | `tmux [-L {server}] attach-session -t {session}:{window}` |
| New window | `tmux [-L {server}] new-window -t {session}` |
| Detach | `tmux [-L {server}] detach-client -t {session}` |

**Server-aware command generation**: Commands include the `-L {server}` flag only when the server is not `"default"`. When the server is `"default"`, the flag is omitted. This matches the `tmuxExecServer` convention in the backend (see `tmux-sessions.md`).

Each row has a label (`text-text-secondary text-[11px]`), a monospace code block (`bg-bg-inset border border-border rounded px-2 py-1.5 font-mono text-[11px] select-all`), and a copy button. Clicking the copy button writes the command to the clipboard via `navigator.clipboard.writeText` and swaps the copy icon to a checkmark for 1.5 seconds before reverting. Clipboard failure is silently caught.

Dialog state is a `showTmuxCommands` boolean in `app.tsx` (same pattern as `showCreateServerDialog` / `showKillServerConfirm`). Props: `server`, `session`, `window`, `onClose`.

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

3. **Session name** — Auto-derived from the last segment of the selected path (e.g., `~/code/sahil87/run-kit` yields `run_kit`). Editable — auto-derivation is a convenience, not a lock. When the name field is left empty at submit time, the name is derived from the path automatically via `deriveNameFromPath()`. The Create button is enabled when either a name or a path is provided.

On submit, the dialog calls `createSession(server, name, cwd)` which sends `POST /api/sessions?server={server}` with `{ name, cwd }`. If the name field is empty but a path is set, the name is derived from the path's last segment (sanitized for tmux/byobu: hyphens→underscores, colons/periods replaced with underscores). Collision with existing session names is checked on the derived name and shows an error. The `cwd` field is omitted when no path is selected, preserving the original name-only behavior. Accessible from breadcrumb `+ New Session` dropdown action, sidebar empty state button, and command palette.

## Session-to-Project Mapping

Every tmux session is a project — derived from tmux, no config file needed. Project root derived from window 0's `pane_current_path`.

## Activity Status

Windows are `"active"` (last tmux activity within 10 seconds) or `"idle"`. No "exited" state.

## Zustand Window Store

Window optimistic state is managed by a Zustand store at `app/frontend/src/store/window-store.ts`. This is the single source of truth for what windows are visible and what their display names are during the period between a user action and its SSE confirmation.

**Store location**: `app/frontend/src/store/window-store.ts`

**Store shape:**

```ts
// Flat entry type (not WindowInfo & {...} — stores only the fields needed for display)
type WindowEntry = {
  session: string;
  windowId: string;
  index: number;
  name: string;
  pendingName?: string;    // non-undefined = optimistic rename, pending SSE confirmation
  killed: boolean;         // true = optimistically hidden, pending SSE confirmation
};

type GhostWindow = {
  optimisticId: string;    // client-generated unique key for React rendering / rollback
  session: string;
  name: string;
  createdAt: number;
  snapshotWindowIds: Set<string>; // windowIds present in session at creation time
};

type WindowStore = {
  entries: ReadonlyMap<string, WindowEntry>;  // keyed by windowId (@N)
  ghosts: GhostWindow[];
  // actions (the only ways to mutate window state):
  setWindowsForSession(session, incoming): void;
  addGhostWindow(session, name, currentWindowIds?: Iterable<string>): string;  // returns optimisticId
  removeGhost(optimisticId): void;
  killWindow(session, windowId): void;
  restoreWindow(session, windowId): void;
  renameWindow(session, windowId, newName): void;
  clearRename(session, windowId): void;
  clearSession(session): void;
};
```

**Key identifier**: `windowId` is the tmux `@N` value (e.g., `"@3"`). It is globally unique per tmux server, assigned at window creation, and never renumbered. It is used as the store key — not the mutable numeric index.

**`MergedWindow` type**: defined in and exported from `app/frontend/src/store/window-store.ts`. Includes `windowId: string` as a required non-optional field.

**Action surface (minimal by design)**:

| Action | Effect |
|--------|--------|
| `setWindowsForSession(session, incoming)` | SSE reconciliation — merges by `windowId`, preserves `killed`/`pendingName`, removes absent windows, reconciles ghosts |
| `addGhostWindow(session, name, currentWindowIds?)` | Creates a ghost entry; returns `optimisticId` for rollback |
| `removeGhost(optimisticId)` | Removes a ghost by ID (API failure rollback) |
| `killWindow(session, windowId)` | Sets `killed: true` |
| `restoreWindow(session, windowId)` | Sets `killed: false` (API failure rollback or always-settled cleanup) |
| `renameWindow(session, windowId, newName)` | Sets `pendingName` |
| `clearRename(session, windowId)` | Clears `pendingName` (settled or rollback) |
| `swapWindowOrder(session, srcIndex, dstIndex)` | Swaps index values of two entries (optimistic reorder); no-op if either missing |
| `clearSession(session)` | Removes all windows and ghosts for the session |

**SSE sync**: `AppShell` (in `app.tsx`) calls `setWindowsForSession(s.name, s.windows)` for each session in a `useEffect` on `rawSessions`. This keeps the store in sync with the SSE ground truth.

**Ghost reconciliation**: When `setWindowsForSession` is called, it computes `newIds = incomingIds − priorKnownIds`. For each ghost (oldest first) whose `snapshotWindowIds` does not contain any element of `newIds`, the ghost is removed. This set-difference approach is more reliable than count-based reconciliation — it handles concurrent creates/deletes without false positives.

**useMergedSessions**: `useMergedSessions` in `optimistic-context.tsx` derives window data from the Zustand store rather than from raw `session.windows`. For each session: filters `killed: true` entries, applies `pendingName ?? name` for display, sorts by `index`, then appends ghosts.

**Consumers use the store via `useWindowStore()` hook**:
```ts
const { killWindow, restoreWindow, renameWindow, clearRename, swapWindowOrder } = useWindowStore();
```

**Session/server state** (ghost sessions, ghost servers, session kill/rename) remains in `OptimisticContext` — these use name-based keys and are not subject to index-collision bugs.

## Optimistic UI & Mutation Feedback

All mutating API calls use the `useOptimisticAction` hook (`app/frontend/src/hooks/use-optimistic-action.ts`) which provides `{ execute, isPending }`. The hook calls `onOptimistic` synchronously before the async API call, tracks `isPending`, and calls `onRollback`/`onError` on failure and `onSettled` on success. An unmount guard (`mountedRef`) prevents state-after-unmount warnings.

**Callback contract** — four optional result callbacks with distinct mount-safety guarantees:

| Callback | Called on | Mount guard | Use for |
|----------|-----------|-------------|---------|
| `onAlwaysSettled` | success | none — always fires | Root-level context cleanup (e.g., `unmarkKilled`) |
| `onAlwaysRollback` | failure | none — always fires | Root-level context cleanup (e.g., `unmarkKilled`) |
| `onSettled` | success | behind `mountedRef` | Local component state updates |
| `onRollback` | failure | behind `mountedRef` | Local component state updates |

`onAlwaysSettled`/`onAlwaysRollback` MUST be safe to call after the initiating component unmounts — i.e., they may only interact with root-level stores/contexts like `OptimisticContext` or the Zustand window store (both always available for the lifetime of the app). Using local component state or `setState` in these callbacks will cause state-after-unmount warnings. Use `onSettled`/`onRollback` for anything that touches local component state.

`onError` is also behind the `mountedRef` guard (safe to call `addToast` — `ToastProvider` is root-level, but error display is only meaningful when the user can see it).

**Three feedback patterns:**

1. **Ghost entries** (CRUD operations): Creating a session/window/server immediately inserts a ghost entry with `opacity-50 animate-pulse` styling. SSE reconciliation auto-clears ghosts when real data arrives. Failure removes the ghost and shows an error toast. Kill operations immediately hide the entry; failure restores it. Rename operations immediately update the displayed name; failure reverts. **Window** ghost/kill/rename state is managed by the Zustand window store (`app/frontend/src/store/window-store.ts`); **session and server** ghost/kill/rename state remains in `OptimisticProvider` context (`app/frontend/src/contexts/optimistic-context.tsx`). Both feed into `useMergedSessions(realSessions, currentServer)` which filters session-level overlays by `currentServer` (so cross-server ghosts/kills/renames don't leak — see "Server Capture Convention" below) and merges with SSE data.

2. **Button loading states** (fire-and-forget): Split pane and close pane top-bar buttons show a spinner SVG (`animate-spin`) and `disabled` attribute during `isPending`. Command palette equivalents use the same hook for error toast feedback (palette closes, so spinner not visible).

3. **Inline progress** (async data): File upload shows an "Uploading..." badge in the terminal area. Directory autocomplete shows a spinner in the path input trailing slot. Server list refresh shows a spinner on the dropdown trigger.

**Error toast system**: `ToastProvider` + `Toast` component (`app/frontend/src/components/toast.tsx`). Fixed bottom-right, auto-dismiss after 4 seconds, stacked vertically. Error variant has `var(--color-ansi-1)` (red) left accent border; info variant uses `var(--color-ansi-4)` (blue). Theme-aware via CSS custom properties.

**Type guard**: `isGhostWindow(win)` exported from `optimistic-context.tsx` — narrows `WindowInfo | MergedWindow` to `MergedWindow & { optimistic: true }`. Used in sidebar and dashboard instead of `as` casts. `MergedWindow` type is defined in and exported from `app/frontend/src/store/window-store.ts`; it includes `windowId: string` as a required non-optional field.

### Window Kill: Zustand Store Handles Kill Cleanup

Window kill state is tracked in the Zustand window store by `windowId` (the immutable tmux `@N` identifier), not by mutable index. This eliminates the index-collision bug where killing window N would cause tmux's renumbering to suppress the next window at that index.

**Kill flow** (`useOptimisticAction` pattern):
- `onOptimistic`: calls `windowStore.killWindow(session, windowId)` — sets `killed: true` in the store
- `onAlwaysRollback` (API failure): calls `windowStore.restoreWindow(session, windowId)` — clears `killed`
- `onAlwaysSettled` (API success): calls `windowStore.restoreWindow(session, windowId)` — clears `killed` (SSE absence will remove the entry once tmux confirms)

When the next SSE update arrives without the `windowId`, `setWindowsForSession` removes the entry from the store entirely — regardless of whether `killed` is set. No explicit `confirmKill` action is needed.

**Three `useOptimisticAction` instances** use this pattern:

| Instance | File | Kill path |
|----------|------|-----------|
| `executeKillWindow` | `app/frontend/src/components/sidebar.tsx` | Ctrl+Click direct kill |
| `executeKillFromDialog` | `app/frontend/src/components/sidebar.tsx` | Confirmation dialog kill |
| `executeKillWindow` | `app/frontend/src/hooks/use-dialog-state.ts` | Command palette kill |

**Session kills are unaffected**: Session names are stable across kills (tmux never renumbers sessions). Session kill/restore remain in `OptimisticContext`.

### Cross-Session Move: Compound Optimistic Update

The `executeMoveToSession` hook in `sidebar/index.tsx` combines two store actions (`killWindow` + `addGhostWindow`) for a single optimistic update. This is the only `useOptimisticAction` instance that performs a compound optimistic mutation (hiding in one session while inserting a ghost in another). The ref-based `lastMoveToSessionRef` stores `{ srcSession, windowId, optimisticId }` so `onAlwaysRollback` can reverse both operations even after the component navigates away.

### Server Capture Convention (Optimistic Actions)

The `server` argument that scopes a mutation to a tmux server is **always captured at user-event time**, never read from an ambient module-level global, never frozen at component mount. This is enforced both by the API client signature (every server-scoped function takes `server: string` as its first arg — see `tmux-sessions.md` → "Frontend Server Routing Contract") and by the React handler shape on every call site.

#### The two compliant capture shapes

**Shape A — explicit capture inside `useCallback`**: read `server` from `useSessionContext()` at component scope, list it in the callback's deps array, and pass it as the first argument to the action when the user-event handler fires:

```tsx
const { server } = useSessionContext();
const handleRenameSession = useCallback(() => {
  if (!renameSessionName.trim() || !sessionName) return;
  executeRenameSession(server, sessionName, renameSessionName.trim());
  setShowRenameSessionDialog(false);
}, [renameSessionName, sessionName, server, executeRenameSession]);
```

**Shape B — `server` threaded through the `useOptimisticAction` argument tuple**: extend the tuple's first slot to `string` and forward it inside `action`. This is the standard shape for hooks like `executeRenameSession`, `executeKillFromDialog`, `executeMoveToSession`, etc.:

```tsx
const { execute: executeRenameSession } = useOptimisticAction<[string, string, string]>({
  action: (srv, oldName, newName) => renameSession(srv, oldName, newName),
  onOptimistic: (srv, oldName, newName) => {
    lastRenameSessionRef.current = { server: srv, name: oldName };
    markRenamed("session", srv, oldName, newName);
  },
  onRollback: () => {
    const last = lastRenameSessionRef.current;
    if (last) unmarkRenamed(last.server, last.name);
  },
  ...
});
```

**Refs that bridge async callbacks** (e.g., `lastKillSessionRef`, `lastRenameSessionRef`, `killDialogServerRef`) snapshot `{ server, name }` together inside `onOptimistic`, so `onAlwaysRollback`/`onAlwaysSettled` can target the originating server even if the user has switched servers by the time the API resolves. Snapshotting the name without the server is a bug — rollback would invalidate the wrong server's overlay.

#### Optimistic overlays carry `server` (session-level)

`OptimisticContext` (`app/frontend/src/contexts/optimistic-context.tsx`) stores session-level entries with their originating `server` and filters by `(server, name)` at render time. The discriminated-union types reflect this:

```ts
type GhostEntry =
  | { optimisticId: string; type: "session"; name: string; server: string }
  | { optimisticId: string; type: "server"; name: string };

type KilledEntry =
  | { type: "session"; identifier: string; server: string }
  | { type: "server"; identifier: string };

type RenamedEntry = { type: "session"; identifier: string; newName: string; server: string };
```

API surface (session-level entries take `server` first; server-level entries are global):

| Method | Signature | Notes |
|--------|-----------|-------|
| `addGhostSession` | `(server, name) => optimisticId` | Session ghost |
| `addGhostServer` | `(name) => optimisticId` | Server ghost — global, no `server` arg |
| `markKilled("session", server, name)` | overload | Session kill |
| `markKilled("server", name)` | overload | Server kill — global |
| `unmarkKilled("session", server, name)` | overload | Mirror of `markKilled` |
| `unmarkKilled("server", name)` | overload | Mirror of `markKilled` |
| `markRenamed("session", server, name, newName)` | required `server` | |
| `unmarkRenamed(server, name)` | required `server` | |
| `useMergedSessions(real, currentServer)` | filter | Drops session-level overlays whose `server !== currentServer` |

`useMergedSessions` filters ghosts/kills/renames by `currentServer` before applying them. SSE reconciliation only inspects ghosts whose `server === currentServer` so the other server's pending state is left intact when the user switches servers and back.

**Window-store entries are NOT keyed by server** — windows cannot migrate across tmux servers (`MoveWindowToSession` operates within a single server, and there is no cross-server move API). The `windowId` (tmux `@N`) is unique per server, and `setWindowsForSession` is only ever called with data for the active server. Adding `server` to the window-store key would be defensive bookkeeping with no failure mode to defend against.

#### Why this convention exists

The pre-fix client kept `server` in a module-level closure (`_getServer`) wired to `serverRef.current`. The closure dereferenced live state at fetch time, so any switch between user intent and fetch dispatch silently retargeted the request — most commonly via Cmd+K's near-instant server switcher between opening a rename dialog and pressing Enter. The optimistic overlay made the bug invisible until SSE reconciled (~2–5 s later), which manifested as random renames/kills landing on the wrong server with a flicker on rollback.

#### General rule: don't introduce ambient state for request parameters

Any value that scopes an HTTP request to a particular backend resource (server, project, account, tenant) MUST be passed as an explicit argument to the API call, captured at user-event time. Module-level mutable getters, refs read at fetch time, or context reads inside the action callback (rather than the handler) all create the same closure-race shape that this change retired. If a value travels with a mutation, it travels in the call signature — period.

The regression test in `app/frontend/src/hooks/use-dialog-state.test.tsx` flips `SessionProvider`'s `server` prop between `openRenameSessionDialog("foo")` and `handleRenameSession()` and asserts the API call uses the post-flip server (`server-B`), proving the capture point is the handler invocation, not the dialog open.

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
| 2026-03-27 | Mobile keyboard scroll-lock — long-press on keyboard toggle (>= 500ms) activates scroll-lock mode preventing soft keyboard from appearing on terminal tap. Focus prevention via capture-phase `focusin` listener. Tap-in-locked-mode unlocks + summons keyboard in one action. Visual indicator uses modifier armed-state pattern (`bg-accent/20 border-accent text-accent`, lock icon). Session-scoped state, optional haptic feedback | `260327-4azv-mobile-keyboard-scroll-lock` |
| 2026-03-28 | Tmux commands dialog — replaced direct clipboard copy with a dialog showing three tmux commands (attach, new-window, detach) with per-row copy buttons and checkmark feedback. Server-aware command generation includes `-L {server}` flag for named servers, omits it for `"default"` | `260328-6xey-tmux-commands-dialog` |
| 2026-04-03 | New pane inherits active pane CWD — `handleCreateWindow` passes `currentWindow?.worktreePath` to `createWindow()` so new windows start in the active pane's current directory (live via tmux `#{pane_current_path}`) instead of defaulting to `windows[0].WorktreePath`. No backend/API changes needed — `cwd` param already supported end-to-end. All three entry points (sidebar "+", top bar, Cmd+K) covered by single handler | `260403-xnq5-new-pane-inherit-cwd` |
| 2026-04-03 | Optimistic UI feedback — `useOptimisticAction` hook replacing all `.catch(() => {})` mutation patterns, `OptimisticProvider` context for ghost entries (create) and optimistic removal (kill) with SSE reconciliation, `ToastProvider` + `Toast` for error/info notifications (auto-dismiss 4s), button loading states (split/close pane spinners), inline progress (upload badge, directory autocomplete spinner, server refresh spinner), `isGhostWindow` type guard | `260403-32la-optimistic-ui-feedback` |
| 2026-04-04 | Window move & reorder — CmdK "Window: Move Left/Right" actions (boundary-excluded, navigate after swap), sidebar drag-and-drop window reordering via native HTML5 DnD (same-session only, accent drop indicator, no external library) | `260404-29qz-window-move-reorder` |
| 2026-04-04 | Cross-session window move — CmdK "Window: Move to {name}" actions (one per other session, flat list), cross-session drag-and-drop to session headers (accent border feedback), `moveWindowToSession` API client function, post-move navigation to `/$server` (server dashboard) | `260404-dq70-move-window-between-sessions` |
| 2026-04-04 | Fix sidebar kill hides extra window — `onSettled` callbacks added to all three `useOptimisticAction` kill instances (`executeKillWindow` in sidebar, `executeKillFromDialog` in sidebar, `executeKillWindow` in use-dialog-state) to call `unmarkKilled` after success, preventing tmux index-renumbering from causing index collision on next SSE update | `260404-dsq9-sidebar-kill-hides-extra-window` |
| 2026-04-05 | Fix left panel window sync — introduced `onAlwaysSettled`/`onAlwaysRollback` callbacks to `useOptimisticAction` that fire regardless of mount state (for root-level context cleanup like `unmarkKilled`), while `onSettled`/`onRollback` remain behind `mountedRef` guard (safe for local component state). Kill handlers in `sidebar.tsx` and `use-dialog-state.ts` migrated to `onAlways*`. E2E test `sidebar-window-sync.spec.ts` rewritten to be self-contained per test with unique window names and Scenario 3 using `page.route()` to intercept the kill API and exercise the unmount-before-response path. | `260405-2a2k-left-panel-window-sync` |
| 2026-04-05 | Session inline rename — double-click session name in sidebar to edit inline (mirrors window rename pattern). Enter/blur commits (non-empty, changed only), Escape cancels. Optimistic update via `markRenamed("session", ...)` with toast on error. Cross-cancel: starting a session edit cancels any active window edit and vice versa — only one inline edit active at a time. Dialog-based session rename in `app.tsx` unchanged | `260405-3mt2-session-inline-rename` |
| 2026-04-05 | Sidebar window state Zustand — window optimistic state migrated from index-based `OptimisticContext` to a Zustand store (`app/frontend/src/store/window-store.ts`) keyed by immutable `windowId` (`@N`). Eliminates index-collision bugs from tmux window renumbering. `WindowInfo` gains `windowId: string`. Backend adds `#{window_id}` to tmux format string. `OptimisticContext` slimmed to session/server scope only. `MergedWindow` moved to `window-store.ts`. `sidebar.tsx`, `app.tsx`, `use-dialog-state.ts` updated to use Zustand store actions. Ghost reconciliation uses snapshot `windowId` set-difference instead of count-based heuristics. | `260405-x3yt-sidebar-window-state-zustand` |
| 2026-04-06 | Shorten CWD in StatusPanel — `shortenPath()` in `status-panel.tsx` rewritten to substitute Linux `/home/<user>/` and macOS `/Users/<user>/` (and `/root`) with `~`, then truncate paths with >2 segments to `…/<last-two-segments>`. `title` attribute retains full unmodified path for hover tooltip. Unit tests updated/added in `status-panel.test.tsx`. | `260406-65f1-shorten-cwd-status-panel` |
| 2026-04-11 | Optimistic sidebar window reorder — drag-drop window reorder in sidebar now uses `useOptimisticAction` with `swapWindowOrder` store action to swap window index values immediately on drop. API call fires in background; rollback reverses the swap on failure. Eliminates ~2.5s SSE poll wait. `swapWindowOrder(session, srcIndex, dstIndex)` added to Zustand window store. Unit tests for store swap + rollback, sidebar tests for optimistic drop + API failure rollback. | `260411-sl01-optimistic-sidebar-window-reorder` |
| 2026-04-11 | Optimistic cross-session drag — `executeMoveToSession` `useOptimisticAction` instance in sidebar wires compound optimistic update: `killWindow` (hide in source) + `addGhostWindow` (show in target with source window's display name) + immediate navigation to `/$server`. Rollback: `restoreWindow` + `removeGhost`. Removed `onMoveWindowToSession` prop from `SidebarProps` — sidebar imports `moveWindowToSession` API directly. Drag data payload extended with `windowId` and `name`. Unit tests for optimistic lifecycle and rollback. | `260411-sl02-cross-session-drag-optimistic-update` |
| 2026-04-11 | Sidebar collapsible panels — `CollapsiblePanel` reusable component (header + chevron + `max-height` transition + localStorage persistence). `StatusPanel` refactored into `WindowPanel` wrapping content in CollapsiblePanel (`storageKey="runkit-panel-window"`). New `HostPanel` (5 lines: hostname+SSE dot, CPU braille sparkline, memory gauge bar, load percentages, disk+uptime) wrapping in CollapsiblePanel (`storageKey="runkit-panel-host"`). Both panels bottom-aligned in sidebar. Hostname removed from bottom bar. New `lib/sparkline.ts` (8-level braille mapping U+2800-U+28FF) and `lib/gauge.ts` (block gauge with green/yellow/red thresholds, byte formatting). `SessionProvider` extended with `metrics: MetricsSnapshot | null` from SSE `event: metrics`. | `260411-z63r-sidebar-host-window-panels` |
| 2026-04-12 | Pane panel copy interactions — `tmx`, `cwd`, `git`, `fab` rows in WindowPanel (`status-panel.tsx`) rendered as `<button>` elements with click-to-copy (pane ID, full path, branch, change ID). Inline "copied ✓" label feedback (1000ms, single `copiedRow` state). Hover affordance (`cursor: pointer` + `bg-bg-inset` tint). Keyboard accessible (Enter/Space). Text-selection guard (`window.getSelection()`). `copyToClipboard` extracted from `terminal-client.tsx` to `lib/clipboard.ts` shared utility module | `260412-lc2q-pane-panel-copy-cwd-branch` |
| 2026-04-16 | Session and window color tinting — ANSI-palette color assignment for sidebar rows with pre-blended `blendHex()` background tints at 12%/18%/22%. `SwatchPopover` component (13 ANSI swatches + Clear). Command palette "Session/Window: Set Color" actions. Hover indicator on sidebar rows. Activity dot changed from green/gray color-based to filled circle/hollow ring shape-based (always `text-text-secondary`). `RowTint` type and `computeRowTints()` in `themes.ts`. `PICKER_ANSI_INDICES` constant | `260416-jn4h-session-window-color-tinting` |
| 2026-04-16 | Iframe proxy windows — `IframeWindow` component (`iframe-window.tsx`) renders URL bar chrome + iframe for windows with `rkType === "iframe"`. Rendering branch in `app.tsx`: `currentWindow?.rkType === "iframe" && currentWindow?.rkUrl` renders `IframeWindow`, otherwise `TerminalClient`. URL bar: refresh button (↻), editable URL input (Enter submits via `updateWindowUrl` PUT API), submit indicator (⏎). SSE-driven URL sync via `useEffect` on `rkUrl` with `currentSrcRef` guard (no reload on identical data). `toProxySrc()` converts localhost URLs to `/proxy/{port}/...` paths. New "Window: New Iframe Window" command palette action (id `create-iframe-window`) opens dialog with name + URL inputs. Bottom bar hidden for iframe windows. | `260416-6b0h-iframe-proxy-windows` |
| 2026-04-18 | Server panel tile grid + resizable CollapsiblePanel — `ServerPanel` rewritten from vertical list to swatch-style tile grid (`repeat(auto-fill, minmax(72px, 1fr))` desktop, single-row horizontal scroll with `scroll-snap-type` on `pointer: coarse` / `<640px`). Tiles: 4px ANSI-tinted top stripe + 11px truncated name + 10px "N sess" meta. Active tile: `aria-current` + inset accent ring + `rowTints.get(color).selected` body tint. Hover-revealed color-picker and kill buttons rendered as siblings to the tile `<button>` (avoids nested-button HTML) with `group-hover:flex`; hidden on coarse pointer. Scrolls internally when tile grid overflows the user-set height. `CollapsiblePanel` gained opt-in `resizable`, `defaultHeight`, `minHeight`, `maxHeight`, `mobileHeight` props: 6px `ns-resize` drag handle persisted to `localStorage[${storageKey}-height]`, height clamping, `calc(100vh - Npx)` maxHeight parsing, mobile drag-handle hide. Window/Host panels unchanged (opt-in preserves legacy behaviour). `/api/servers` now returns `{name, sessionCount}[]` per architecture.md. | `260417-jpkl-server-panel-tile-grid` |
| 2026-04-18 | Right-align server name in ServerPanel header — `ServerPanel` title changed from dynamic `Tmux · {server}` to static `"Server"` (matches WindowPanel/HostPanel convention). Active server name moved into `headerRight` slot with `truncate text-text-primary font-mono` classes (mirrors `host-panel.tsx`); `LogoSpinner` follows the name when `refreshing`. Left-side chevron and title are now visually fixed across server switches — only the right-slot text updates. Playwright spec `server-panel-grid.spec.ts` and its companion `.spec.md` updated to match the new `name: /^Server/` accessible name and `Resize Server panel` separator label. No new patterns introduced — aligns with existing sidebar panel header convention. | `260418-2cjc-right-align-server-name` |
| 2026-04-18 | xterm Unicode 15 grapheme widths — added `@xterm/addon-unicode-graphemes` to the Terminal init chain (loads after WebLinks, before WebGL), set `allowProposedApi: true` on the Terminal constructor, and assigned `terminal.unicode.activeVersion = "15-graphemes"` after `loadAddon()`. Aligns xterm's cell-width measurements with tmux's wcwidth-based layout so emojis and other wide graphemes (ZWJ sequences, flag/skin-tone modifiers) render without ghost/overlap artifacts. The `unicodeVersion` constructor option remains a no-op past `"6"` without the addon. | `260418-xgl2-xterm-emoji-width` |
| 2026-04-18 | Server-capture-at-trigger convention for optimistic actions — every `useOptimisticAction` instance for a server-scoped mutation now threads `server: string` as the first slot of its argument tuple (Shape B), with `server` read from `useSessionContext()` and listed in the calling handler's `useCallback` deps (Shape A). Async-bridge refs (`lastKillSessionRef`, `lastRenameSessionRef`, `killDialogServerRef`) snapshot `{ server, name }` together so rollback/settle target the originating server. `OptimisticContext` switched session-level `GhostEntry`/`KilledEntry`/`RenamedEntry` to discriminated unions carrying `server`; `markKilled`/`unmarkKilled` overloaded by `type` ("session" requires `server`, "server" is global); `useMergedSessions(real, currentServer)` now filters session-level overlays so cross-server overlays don't leak. Window-store keying unchanged — windows don't migrate across servers. Establishes the rule: ambient module-level state for request parameters is prohibited; request-scoping values travel in the call signature, captured at user-event time. Regression test in `use-dialog-state.test.tsx` flips `SessionProvider.server` between dialog open and submit. | `260418-yadg-fix-mutation-server-race` |
