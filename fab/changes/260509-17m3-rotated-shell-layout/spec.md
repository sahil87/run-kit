# Spec: Rotated Shell Layout

**Change**: 260509-17m3-rotated-shell-layout
**Created**: 2026-05-09
**Affected memory**: `docs/memory/run-kit/architecture.md`, `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- Backend (Go) changes — frontend layout refactor only; tmux/SSE/WebSocket layers untouched.
- New routes — adds zero `TanStack Router` routes.
- New runtime dependencies — uses CSS Grid and built-in React Context only.
- Reordering sidebar contents on mobile — same Boards → Servers → Sessions order applies; only the open/dismiss model changes (overlay vs structural).
- Animating individual sidebar contents — the only animated property is the grid column width on collapse (~150ms).
- Reworking the BottomBar's input semantics — sticky modifier toggles, ANSI escape construction, scroll-lock long-press, and Compose are unchanged. Only the input *target* moves to context.
- Pinning, board switching, session reorder, kill flows — preserved verbatim from the dc0t baseline.

## Shell Topology

### Requirement: Shell wrapper component

A new component `<Shell>` SHALL exist at `app/frontend/src/components/shell/shell.tsx` and SHALL be imported by both `AppShell` (`app/frontend/src/app.tsx`) and `BoardPage` (`app/frontend/src/components/board/board-page.tsx`). The wrapper SHALL render a single root element styled as a CSS Grid with named areas `sidebar`, `topbar`, `content`, `bottombar`.

#### Scenario: Grid template areas (desktop)
- **GIVEN** the viewport width is `>= 640px`
- **WHEN** `<Shell>` mounts
- **THEN** the root element's computed `grid-template-areas` SHALL equal:
  ```
  "sidebar topbar"
  "sidebar content"
  "sidebar bottombar"
  ```
- **AND** `grid-template-rows` SHALL equal `auto 1fr auto`
- **AND** `grid-template-columns` SHALL be `${sidebarWidth}px 1fr` when `sidebarOpen` is `true`, else `0 1fr`

#### Scenario: Grid template areas (mobile)
- **GIVEN** the viewport width is `< 640px`
- **WHEN** `<Shell>` mounts
- **THEN** the root element SHALL use a single-column grid with `grid-template-areas`:
  ```
  "topbar"
  "content"
  "bottombar"
  ```
- **AND** the sidebar SHALL render outside the grid as a fixed-position overlay (see § Mobile Overlay Sidebar)

#### Scenario: Children placed by named area
- **GIVEN** `<Shell>` is rendering
- **WHEN** a consumer wraps `<Sidebar>`, `<TopBar>`, content, and `<BottomBar>` in elements with `style={{ gridArea: "sidebar" | "topbar" | "content" | "bottombar" }}`
- **THEN** each child SHALL render in the corresponding cell without manual width/height management

#### Scenario: Full-viewport height
- **GIVEN** `<Shell>` is rendered
- **WHEN** the iOS visual viewport reports a value via `useVisualViewport`
- **THEN** the shell root SHALL have inline `height: var(--app-height, 100vh)`
- **AND** `useVisualViewport` SHALL be invoked once per shell mount (preserving today's iOS keyboard handling)

### Requirement: AppShell adopts Shell

`AppShell` SHALL render its current children (Sidebar, TopBar, Terminal/Iframe/Dashboard branch, BottomBar, mobile drawer overlay) inside `<Shell>`, replacing the current `flex flex-col` + nested `flex flex-row` topology.

#### Scenario: AppShell renders inside Shell
- **GIVEN** the route `/$server/$session/$window`
- **WHEN** `AppShell` mounts
- **THEN** the `app-shell` root SHALL be the `<Shell>` grid wrapper
- **AND** `<Sidebar>`, `<TopBar>`, the rendering branch (`TerminalClient` | `IframeWindow` | `Dashboard`), and `<BottomBar>` SHALL each occupy their respective grid areas
- **AND** the iframe-banner row above `TerminalClient` (when `currentWindow.rkUrl` exists) SHALL remain inside the `content` area

#### Scenario: Dashboard branch (no terminal)
- **GIVEN** the route `/$server` (no session/window params)
- **WHEN** `AppShell` mounts
- **THEN** `<Dashboard>` SHALL occupy the `content` grid area
- **AND** the `bottombar` grid area SHALL render `<BottomBar>` (focus context is `null`; BottomBar input handlers no-op naturally)

### Requirement: BoardPage adopts Shell

`BoardPage` SHALL replace its bespoke `h-screen w-screen flex` root with `<Shell>` and SHALL render its children via grid-area wrappers.

#### Scenario: BoardPage layout
- **GIVEN** the route `/board/$name`
- **WHEN** `BoardPage` mounts
- **THEN** `<Sidebar currentServer={null} ...>` SHALL occupy the `sidebar` grid area
- **AND** the existing board mini-topbar (board breadcrumb + dropdown, plus new pane/server count + cycle hint per § TopBar Board Mode) SHALL occupy the `topbar` grid area
- **AND** the existing `DesktopRow` / `MobileCarousel` body SHALL occupy the `content` grid area
- **AND** `<BottomBar>` SHALL occupy the `bottombar` grid area (new — board route had no BottomBar pre-change)

#### Scenario: Board horizontal scroll viewport flush with sidebar
- **GIVEN** `BoardPage` is rendering with `>= 1` pinned pane on desktop
- **WHEN** the user reads the layout
- **THEN** the board's horizontal-scroll viewport (`DesktopRow`'s `overflow-x-auto` container) SHALL begin at the `content` grid area's left edge — i.e. flush with `sidebar.right` (or page.left when `sidebarOpen` is `false`)
- **AND** there SHALL be no left gutter dedicated to board-level chrome

## Sidebar Collapse and Hamburger

### Requirement: Sidebar collapses to width zero

When `sidebarOpen` is `false`, the `sidebar` grid column SHALL be `0` and the sidebar contents SHALL be hidden from the layout. There SHALL be no 48px collapsed rail.

#### Scenario: Collapse hides sidebar entirely
- **GIVEN** the user is on `/$server/$session/$window` with `sidebarOpen === true` and `sidebarWidth === 220`
- **WHEN** the user clicks the hamburger
- **THEN** `sidebarOpen` SHALL become `false`
- **AND** `grid-template-columns` SHALL transition to `0 1fr`
- **AND** the `topbar`, `content`, and `bottombar` cells SHALL extend their left edge to page.left
- **AND** no sidebar rail SHALL be visible

#### Scenario: Re-open restores prior width
- **GIVEN** `sidebarOpen === false`
- **WHEN** the user clicks the hamburger
- **THEN** `sidebarOpen` SHALL become `true`
- **AND** `grid-template-columns` SHALL transition to `${sidebarWidth}px 1fr`, where `sidebarWidth` is the persisted value from `localStorage["runkit-sidebar-width"]` (or the default 220)

#### Scenario: Collapse animation
- **GIVEN** the user toggles `sidebarOpen`
- **WHEN** the toggle dispatches
- **THEN** `grid-template-columns` SHALL transition with `transition: grid-template-columns 150ms ease-out`
- **AND** the transition SHALL be applied via inline style or a stable CSS class on the `<Shell>` root

#### Scenario: Drag handle hidden when collapsed
- **GIVEN** `sidebarOpen === false`
- **WHEN** the user inspects the seam between page.left and the topbar/content/bottombar cells
- **THEN** no drag-resize handle SHALL be present
- **AND** the only re-open affordance SHALL be the hamburger icon at TopBar.left

### Requirement: Hamburger lives at TopBar.left in both states

The hamburger icon (`☰` / animated `<` chevron) SHALL render inside `<TopBar>` at its left edge in both `sidebarOpen === true` and `sidebarOpen === false` states. The icon SHALL NOT move between components on toggle.

#### Scenario: Sidebar open — hamburger at sidebar/topbar seam
- **GIVEN** `sidebarOpen === true`
- **WHEN** the layout renders
- **THEN** the hamburger SHALL render at the left edge of the `topbar` grid cell
- **AND** the visual position of the hamburger SHALL coincide with the `sidebar.right` / `topbar.left` seam

#### Scenario: Sidebar closed — hamburger at page.left
- **GIVEN** `sidebarOpen === false`
- **WHEN** the layout renders
- **THEN** the hamburger SHALL render at the left edge of the `topbar` grid cell, which now extends to page.left
- **AND** clicking the hamburger SHALL toggle `sidebarOpen` back to `true`

### Requirement: Sidebar state lifted to ChromeContext

`sidebarOpen` and `sidebarWidth` SHALL be sourced from `ChromeContext` rather than per-route local state, so AppShell and BoardPage produce the same Shell topology from a single state surface. The keyboard chord `Cmd+\` (macOS) / `Ctrl+\` (Linux/Windows) SHALL toggle `sidebarOpen`, available on every route that renders `<Shell>`.

#### Scenario: ChromeContext exposes sidebar state
- **GIVEN** `ChromeProvider` is mounted
- **WHEN** a consumer reads `useChromeState()`
- **THEN** the returned object SHALL include `sidebarOpen: boolean` and `sidebarWidth: number`
- **AND** `useChromeDispatch()` SHALL expose `setSidebarOpen(open: boolean)` and `setSidebarWidth(width: number)`

#### Scenario: sidebarOpen persistence
- **GIVEN** the user toggles `sidebarOpen`
- **WHEN** `setSidebarOpen` runs
- **THEN** the new value SHALL be written to `localStorage["runkit-sidebar-open"]` (existing key, already used by `chrome-context.tsx`)

#### Scenario: sidebarWidth persistence
- **GIVEN** the user drag-resizes the sidebar
- **WHEN** the drag ends
- **THEN** the final width SHALL be persisted to `localStorage["runkit-sidebar-width"]` (existing key, currently owned by `app.tsx`)
- **AND** the persisted width SHALL be read on next mount via `ChromeProvider`'s initializer

#### Scenario: Keyboard toggle
- **GIVEN** any `<Shell>`-bearing route is mounted, no input/textarea has focus
- **WHEN** the user presses `Cmd+\` (or `Ctrl+\` on non-macOS)
- **THEN** `setSidebarOpen(!sidebarOpen)` SHALL fire
- **AND** the keybinding SHALL be visible in the existing `KeyboardShortcuts` modal (Constitution V — Keyboard-First)

## Sidebar Section Order

### Requirement: Boards above Servers, Sessions below

The sidebar SHALL render its top-level sections in the order **Boards → Servers → Sessions**, top to bottom. The bottom-pinned `WindowPanel` and `HostPanel` SHALL remain at the bottom.

#### Scenario: Section order on AppShell route
- **GIVEN** the route `/$server/$session/$window`
- **WHEN** `<Sidebar>` mounts
- **THEN** the visible vertical order SHALL be: `BoardsSection`, `ServerPanel`, Sessions header + per-server `ServerGroup`s, `WindowPanel`, `HostPanel`
- **AND** the previous order (`ServerPanel` first, `BoardsSection` second) SHALL no longer apply

#### Scenario: Section order on Board route
- **GIVEN** the route `/board/$name`
- **WHEN** `<Sidebar currentServer={null}>` mounts
- **THEN** the visible vertical order SHALL be the same: `BoardsSection`, `ServerPanel`, Sessions header + per-server groups, `WindowPanel`, `HostPanel`

### Requirement: BoardsSection always visible with empty hint

`BoardsSection` SHALL always render at the top of the sidebar, regardless of whether boards exist. When `boards.length === 0`, the section header SHALL render with a one-line empty-state hint inside its body. The previous "hide entirely when zero boards" rule (4vuv §5) SHALL be replaced by always-visible behavior.

#### Scenario: Zero boards — hint mode
- **GIVEN** `useBoards()` returns `boards.length === 0`
- **WHEN** `<BoardsSection>` renders
- **THEN** the section header `Boards` SHALL be visible at the top of the sidebar
- **AND** the body SHALL contain a single line `Pin a window to start a board` (verbatim 4vuv copy) styled `text-xs text-text-secondary`
- **AND** the section SHALL NOT be hidden, regardless of route (server route, board route, or any other)

#### Scenario: First board appears
- **GIVEN** `BoardsSection` is rendering in hint mode
- **WHEN** the user pins a window and `useBoards()` returns `boards.length === 1`
- **THEN** the hint SHALL be replaced by a single board row in place
- **AND** no other section's vertical position SHALL shift (no layout jump)

#### Scenario: Last board removed
- **GIVEN** one board exists with one pinned window
- **WHEN** the user unpins the last window and `useBoards()` returns `boards.length === 0`
- **THEN** `BoardsSection` SHALL revert to hint mode
- **AND** ServerPanel and Sessions SHALL NOT shift position

## BottomBar Relocation and Focused-Terminal Context

### Requirement: New FocusedTerminalContext

A new context `FocusedTerminalContext` SHALL exist at `app/frontend/src/contexts/focused-terminal-context.tsx` exposing the currently-focused terminal's WebSocket ref plus identifiers.

#### Scenario: Context shape
- **GIVEN** `FocusedTerminalProvider` is mounted
- **WHEN** a consumer reads `useFocusedTerminal()`
- **THEN** the returned value SHALL match shape:
  ```ts
  type FocusedTerminal = {
    wsRef: React.RefObject<WebSocket | null>;
    server: string;
    session: string;
    windowIndex: string;
  } | null;
  type FocusedTerminalContextValue = {
    focused: FocusedTerminal;
    setFocused: (t: FocusedTerminal) => void;
  };
  ```
- **AND** `FocusedTerminalProvider` SHALL be mounted in `RootWrapper` above `<Outlet />`, alongside `SessionProvider` (so both AppShell and BoardPage share one instance)

#### Scenario: Default state
- **GIVEN** no terminal is mounted (e.g., the user is on `/$server` Dashboard route)
- **WHEN** `useFocusedTerminal()` is read
- **THEN** `focused` SHALL be `null`

### Requirement: TerminalClient registers as focused

`TerminalClient` SHALL call `setFocused({ wsRef, server, session, windowIndex })` on mount and `setFocused(null)` on unmount.

#### Scenario: Single-terminal route mount
- **GIVEN** the user navigates to `/$server/$session/$window` with a terminal-typed window
- **WHEN** `TerminalClient` mounts
- **THEN** `setFocused` SHALL be called with the wsRef and identifiers passed to the component
- **AND** subsequent mount of any `BottomBar` instance SHALL read this focused terminal

#### Scenario: Single-terminal route unmount
- **GIVEN** `TerminalClient` is mounted
- **WHEN** the user navigates away (route change, or `currentWindow.rkType === "iframe"` flip)
- **THEN** `TerminalClient`'s cleanup SHALL call `setFocused(null)`
- **AND** any newly-mounted `TerminalClient` (from the next route) SHALL overwrite via its own mount-time `setFocused`

### Requirement: BoardPane registers as focused on focus events

`BoardPane` SHALL call `setFocused({ wsRef, server, session, windowIndex })` whenever the pane gains focus (click, cycle-to via `Cmd+]`/`Cmd+[`, or initial pane on mount). It SHALL NOT call `setFocused(null)` on focus loss — the next pane to gain focus overwrites.

#### Scenario: Initial focused pane on board mount
- **GIVEN** the user navigates to `/board/$name` with `entries.length >= 1`
- **WHEN** the board mounts and the existing `useEffect` sets `focusedIndex = 0`
- **THEN** the leftmost pane (`entries[0]`) SHALL call `setFocused` with its identifiers
- **AND** any mounted `BottomBar` SHALL show that pane's wsRef as its target

#### Scenario: Cycle pane focus
- **GIVEN** `entries.length >= 2` and `focusedIndex === 0`
- **WHEN** the user presses `Cmd+]`
- **THEN** `focusedIndex` SHALL become `1`
- **AND** `entries[1]`'s `BoardPane` SHALL call `setFocused` with its identifiers
- **AND** `BottomBar` input SHALL route to `entries[1]`'s WebSocket

#### Scenario: Click-to-focus
- **GIVEN** `focusedIndex === 0` and the user clicks pane index `2`
- **WHEN** `BoardPage`'s existing `onPaneClick(2)` fires
- **THEN** `focusedIndex` SHALL become `2`
- **AND** `entries[2]`'s `BoardPane` SHALL call `setFocused`

### Requirement: BottomBar reads focused terminal from context

`BottomBar`'s `wsRef` prop SHALL be removed. The component SHALL consume `useFocusedTerminal()` and use `focused?.wsRef` where today it uses the `wsRef` prop. When `focused` is `null`, the existing `wsRef.current?.readyState !== OPEN` guard SHALL no-op input handlers naturally.

#### Scenario: API change
- **GIVEN** the post-change `BottomBar` source
- **WHEN** the type signature `BottomBarProps` is inspected
- **THEN** the type SHALL NOT include a `wsRef` field
- **AND** `onOpenCompose`, `onFocusTerminal`, `onScrollLockChange` SHALL remain unchanged

#### Scenario: BottomBar present on board route
- **GIVEN** `/board/$name` is rendered
- **WHEN** the `bottombar` grid area is inspected
- **THEN** a `<BottomBar>` instance SHALL be present (new — board route had none pre-change)
- **AND** input typed via the BottomBar SHALL reach the focused pane's WebSocket

#### Scenario: BottomBar present on Dashboard route
- **GIVEN** `/$server` is rendered (Dashboard, no terminal)
- **WHEN** the `bottombar` grid area is inspected
- **THEN** a `<BottomBar>` instance MAY render with `focused === null`
- **AND** input handlers SHALL no-op (no WebSocket open) — no error, no toast

### Requirement: Compose buffer target is frozen at open time

The Compose buffer (opened via `>_` in the TopBar) SHALL snapshot `focused?.wsRef` at the moment it mounts and SHALL use that snapshot for its lifetime, ignoring focus changes that occur while it is open.

#### Scenario: Compose target frozen
- **GIVEN** `focused` references pane A's wsRef and the Compose buffer is closed
- **WHEN** the user opens Compose
- **THEN** Compose SHALL snapshot pane A's wsRef into a local ref/state
- **AND** if the user cycles focus to pane B while Compose is open, Compose's send action SHALL still write to pane A's WebSocket

#### Scenario: Reopen captures fresh target
- **GIVEN** the Compose buffer was closed while pane A was focused, and the user has since cycled focus to pane B
- **WHEN** the user reopens Compose
- **THEN** the new Compose mount SHALL snapshot pane B's wsRef

## TopBar Mode-Aware Content

### Requirement: TopBar accepts a mode prop

`TopBar` SHALL accept a `mode: "terminal" | "board" | "root"` prop (default `"terminal"`) that controls the breadcrumb / informational content rendered in the left/center region. Right-section chrome (theme toggle, `FixedWidthToggle`, `⌘K`, compose `>_`) SHALL be unchanged.

#### Scenario: Terminal mode (single-terminal route)
- **GIVEN** `mode="terminal"` is passed by `AppShell`
- **WHEN** `TopBar` renders
- **THEN** the breadcrumbs SHALL be `☰ session / window` (today's behavior — unchanged)
- **AND** dropdown triggers, connection dot, theme toggle, `FixedWidthToggle`, `⌘K`, compose `>_` SHALL render exactly as today

#### Scenario: Root mode (server dashboard)
- **GIVEN** `mode="root"` is passed by `AppShell` when no session/window params exist
- **WHEN** `TopBar` renders
- **THEN** the breadcrumb area SHALL show `☰ Dashboard` (today's behavior — unchanged)

#### Scenario: Board mode
- **GIVEN** `mode="board"` is passed by `BoardPage` with `boardName="main"`, `paneCount=4`, `serverCount=3`
- **WHEN** `TopBar` renders
- **THEN** the left section SHALL render `☰ Board ▸ main ▾` (the existing breadcrumb dropdown from 4vuv)
- **AND** an inline-info span SHALL render after the breadcrumb: `4 panes · 3 servers · ⌘[⌘] cycle` styled `text-xs text-text-secondary`
- **AND** the right section SHALL render the same chrome as terminal mode (theme toggle, `FixedWidthToggle`, `⌘K`, compose)
- **AND** the BoardPage's pre-existing inline `<header>` element with `Board ▸ {name} ▾` SHALL be replaced by this `<TopBar mode="board">` invocation

#### Scenario: Board mode with one pane
- **GIVEN** `paneCount=1, serverCount=1`
- **WHEN** `TopBar` renders in board mode
- **THEN** the inline info SHALL render `1 pane · 1 server · ⌘[⌘] cycle` (singular nouns)

#### Scenario: Board mode hides inline info on mobile
- **GIVEN** the viewport width is `< 640px` and `mode="board"`
- **WHEN** `TopBar` renders
- **THEN** the inline-info span (`4 panes · 3 servers · ⌘[⌘] cycle`) SHALL be hidden via `hidden sm:inline`
- **AND** the breadcrumb `Board ▸ {name} ▾` SHALL remain visible

## Mobile Overlay Sidebar

### Requirement: Mobile sidebar overlays content

On viewports `< 640px`, the sidebar SHALL render as a `position: fixed` overlay rather than as a grid column. Toggling `sidebarOpen` SHALL show/hide the overlay; the page content SHALL NOT shift horizontally.

#### Scenario: Mobile overlay open
- **GIVEN** the viewport width is `< 640px` and `sidebarOpen === true`
- **WHEN** the layout renders
- **THEN** the sidebar SHALL render as a fixed-position element with classes including `fixed inset-y-0 left-0 z-50 w-[88%] max-w-[320px] bg-bg-primary shadow-2xl`
- **AND** a backdrop `<div>` SHALL render behind it (`fixed inset-0 z-40 bg-black/50`)
- **AND** the topbar/content/bottombar grid SHALL remain a single column (`grid-template-columns: 1fr`)

#### Scenario: Mobile overlay close — backdrop
- **GIVEN** the mobile overlay is open
- **WHEN** the user taps the backdrop
- **THEN** `setSidebarOpen(false)` SHALL fire
- **AND** the overlay SHALL unmount

#### Scenario: Mobile overlay close — destination tap
- **GIVEN** the mobile overlay is open
- **WHEN** the user taps a session row, window row, or board row
- **THEN** the navigation SHALL fire as today
- **AND** `setSidebarOpen(false)` SHALL fire automatically after navigation

#### Scenario: Mobile overlay close — explicit close button
- **GIVEN** the mobile overlay is open
- **WHEN** the user taps the close affordance at the overlay's top-right (existing close button or hamburger toggle)
- **THEN** `setSidebarOpen(false)` SHALL fire

#### Scenario: ARIA semantics
- **GIVEN** the mobile overlay is open
- **WHEN** an assistive-tech tree is queried
- **THEN** the overlay's `<aside>` SHALL have `role="dialog"` and `aria-modal="true"`

### Requirement: Drawer-state migration

The existing `drawerOpen` state in `ChromeContext` SHALL be removed. Mobile overlay open/close SHALL be driven solely by `sidebarOpen`. Any downstream caller currently reading `drawerOpen` (e.g., `TopBar` hamburger animation) SHALL be migrated to read `sidebarOpen`.

#### Scenario: drawerOpen removed
- **GIVEN** the post-change `chrome-context.tsx`
- **WHEN** the type `ChromeState` is inspected
- **THEN** it SHALL NOT contain a `drawerOpen` field
- **AND** `ChromeDispatch` SHALL NOT contain `setDrawerOpen`

#### Scenario: TopBar hamburger animation reads sidebarOpen
- **GIVEN** the post-change `TopBar` source
- **WHEN** the hamburger CSS `<` chevron rotation is inspected
- **THEN** the animation SHALL be driven by `sidebarOpen` alone (regardless of viewport width)

## Code Quality and Constitutional Alignment

### Requirement: No new dependencies

The change SHALL NOT add any new entries to `app/frontend/package.json` `dependencies` or `devDependencies`.

#### Scenario: package.json unchanged
- **GIVEN** the post-change `app/frontend/package.json`
- **WHEN** diffed against the pre-change file
- **THEN** the `dependencies` and `devDependencies` keys SHALL be identical

### Requirement: No backend changes

This change SHALL NOT modify any file under `app/backend/` and SHALL NOT modify any file under `configs/tmux/`.

#### Scenario: Backend untouched
- **GIVEN** the post-change diff
- **WHEN** `git diff --name-only main...HEAD -- app/backend/ configs/tmux/` is run
- **THEN** the output SHALL be empty

### Requirement: Tests cover new behavior

New unit tests SHALL cover (a) `<Shell>` grid topology, including sidebar collapse and mobile overlay; (b) `FocusedTerminalContext` register/clear behavior; (c) `BottomBar` consumption of focused-terminal context; (d) updated sidebar section order. New e2e tests SHALL cover board-route BottomBar focus tracking across panes. Existing tests SHALL pass without flakiness.

#### Scenario: Shell unit tests
- **GIVEN** `src/components/shell/shell.test.tsx`
- **WHEN** `just test-frontend` runs
- **THEN** there SHALL be tests asserting:
  - Grid template areas in desktop mode (sidebar open and collapsed)
  - Mobile breakpoint switches to single-column grid + overlay rendering
  - `grid-template-columns: 0 1fr` when `sidebarOpen === false`

#### Scenario: FocusedTerminalContext tests
- **GIVEN** `src/contexts/focused-terminal-context.test.tsx`
- **WHEN** `just test-frontend` runs
- **THEN** there SHALL be tests asserting:
  - Default `focused === null`
  - `setFocused` updates the value
  - Provider mount/unmount cycle clears stale state

#### Scenario: BottomBar tests updated
- **GIVEN** `src/components/bottom-bar.test.tsx`
- **WHEN** the file is read post-change
- **THEN** the test setup SHALL provide a `FocusedTerminalProvider` with a mock focused-terminal value
- **AND** test fixtures SHALL NOT pass a `wsRef` prop

#### Scenario: Board e2e BottomBar focus
- **GIVEN** `app/frontend/tests/e2e/shell-rotation.spec.ts` (new)
- **WHEN** the test runs against a 2-pane board
- **THEN** it SHALL: focus pane 1 → open Compose → send text → assert pane 1 received it; cycle to pane 2 → send text → assert pane 2 received it (and pane 1 did NOT)
- **AND** a sibling `shell-rotation.spec.md` SHALL document the test per Constitution "Test Companion Docs"

#### Scenario: Sidebar order test
- **GIVEN** `src/components/sidebar/sidebar.test.tsx` or equivalent
- **WHEN** `<Sidebar>` is rendered with at least one board
- **THEN** the test SHALL assert the DOM order of section headers is `Boards`, `Server`, `Sessions` (top to bottom)

### Requirement: Constitutional alignment

The implementation SHALL respect Constitution principles IV (Minimal Surface Area), V (Keyboard-First), and VII (Convention Over Configuration).

#### Scenario: No new routes
- **GIVEN** `app/frontend/src/router.tsx` post-change
- **WHEN** the route tree is inspected
- **THEN** no new route SHALL exist beyond today's set (`/`, `/$server`, `/$server/$session/$window`, `/board/$name`)

#### Scenario: Keyboard sidebar toggle registered
- **GIVEN** the post-change keybindings
- **WHEN** the `KeyboardShortcuts` modal is opened
- **THEN** `Cmd+\` (or platform equivalent) SHALL appear with the description `Toggle sidebar`

#### Scenario: Convention over configuration
- **GIVEN** the post-change `app/frontend/src/components/shell/shell.tsx`
- **WHEN** the component API is inspected
- **THEN** it SHALL accept only `children: React.ReactNode` — no breakpoint, color, or sizing props
- **AND** all configuration SHALL flow through `ChromeContext` and `useVisualViewport` (existing surfaces)

## Deprecated Requirements

### BottomBar `wsRef` prop
**Reason**: BottomBar's input target now follows focus via `FocusedTerminalContext` rather than being prop-injected by the surrounding terminal-column component. This is the corollary of moving BottomBar up the tree to shell-level so it serves both single-terminal and board routes.
**Migration**: Tests and any direct caller of `<BottomBar wsRef=...>` SHALL drop the `wsRef` prop and ensure they render under a `FocusedTerminalProvider` with the appropriate focused-terminal value.

### `ChromeContext.drawerOpen` and `setDrawerOpen`
**Reason**: The previous mobile model had a separate "drawer" overlay distinct from the desktop "sidebar open" toggle. Under the new topology these collapse into a single `sidebarOpen` boolean — the only difference between mobile and desktop is the rendering form (overlay vs grid column), not the state.
**Migration**: Replace `drawerOpen` reads with `sidebarOpen`; replace `setDrawerOpen(...)` calls with `setSidebarOpen(...)`. The mobile overlay's render logic (today guarded by `drawerOpen && md:hidden`) becomes `sidebarOpen && < 640px`.

### "BoardsSection hidden when zero boards" rule (4vuv §5)
**Reason**: With Boards moved to the top of the sidebar, hiding-when-empty would create a layout shift when the first board materializes (Servers jumps up, then back down). Always-visible-with-hint avoids the shift.
**Migration**: `BoardsSection`'s render logic SHALL drop the `if (boards.length === 0 && !activeBoardName) return null;` early-return and SHALL render the hint text whenever `boards.length === 0` (regardless of route).

### Sidebar section order: `Server → Boards → Sessions`
**Reason**: User explicitly inverted this — boards are curated workspaces (highest-affinity destination), servers/sessions are raw material.
**Migration**: Swap the JSX order in `app/frontend/src/components/sidebar/index.tsx` so `<BoardsSection>` is rendered before `<ServerPanel>`.

### `BoardPage`'s bespoke header / sidebar layout
**Reason**: BoardPage's `h-screen w-screen flex` root with its inline `<header>` and `<aside>` is replaced by the shared `<Shell>` wrapper used by AppShell. This consolidates the topology and is the precondition for adding a BottomBar to the board route.
**Migration**: Replace `BoardPage`'s root with `<Shell>`, move children into grid-area wrappers, replace the inline mini-header (`Board ▸ {name} ▾`) with `<TopBar mode="board" boardName={name} paneCount={...} serverCount={...} />`. The `BoardSwitcherDropdown` component SHALL be moved into `TopBar` board-mode rendering or imported by `TopBar` from its existing location.

## Design Decisions

1. **CSS Grid vs nested flex**
   - *Why*: Sidebar spanning all three rows (topbar/content/bottombar) is awkward with nested flex (requires either flex sibling with explicit height management, or a 2-row layout with sidebar nested inside row 1 — neither matches the visual model). Grid encodes the topology directly via `grid-template-areas` and makes collapse a one-line column-width change. Modern browsers (Safari 14+, Chrome 100+) animate `grid-template-columns` reliably.
   - *Rejected*: Nested flex — keeps the dual-bounding-of-board-content issue, doesn't cleanly express "sidebar full-height".

2. **Sidebar collapses to 0px, not a 48px rail**
   - *Why*: User chose maximum content width when collapsed, accepting a small layout shift on toggle (the hamburger appears to "move" from sidebar-adjacent to page-adjacent, though it's structurally always at TopBar.left).
   - *Rejected*: 48px rail — matches VS Code/Linear/Slack and avoids the visual relocation, but consumes content width for a usability gain that's not aligned with the user's stated preference.

3. **Hamburger statically rendered at TopBar.left**
   - *Why*: Makes the "visual relocation on collapse" a free side effect of the grid column collapsing — no component-level relocation logic, no conditional mount/unmount, no animation orchestration. The hamburger's home is always TopBar.left; the column is what changes.
   - *Rejected*: Conditional placement (hamburger inside sidebar when open, inside topbar when closed) — adds a state-dependent component tree mutation that complicates focus management and adds animation responsibility.

4. **BottomBar is byte-identical across routes**
   - *Why*: BottomBar is a terminal-input toolbar, not an info strip. A board pane is a terminal that wants the same input affordances. Route-varying informational content (board breadcrumb, pane/server counts, cycle hint) belongs in TopBar where it doesn't compete with input.
   - *Rejected*: Route-aware BottomBar (different content per route) — duplicates the input toolbar across two paths and requires deciding which info each gets, with no clean "where does this affordance live" answer.

5. **`FocusedTerminalContext` as a separate context, not a slice of ChromeContext**
   - *Why*: ChromeContext is UI-state only (selection, sidebar open, fixed width); folding focused-terminal in would mix UI state with terminal-WS state and force every Chrome consumer to re-render on focus changes. A small dedicated context keeps the dependency narrow.
   - *Rejected*: Adding `focusedTerminal` to ChromeContext — couples WS lifetime to UI state and broadens unnecessary re-renders.

6. **Compose target frozen at open time**
   - *Why*: User specifically flagged the "compose buffer captured a target when opened, changing it under the user is bad" concern. Prevents accidental wrong-pane sends across focus changes that occur while compose is open.
   - *Rejected*: Live target (compose follows focus) — surprising behavior; the user starts composing for pane A but a stray cycle keystroke retargets to pane B.

7. **`sidebarOpen` and `drawerOpen` collapse into one state**
   - *Why*: The pre-change distinction was a mobile-vs-desktop split. Under the new topology the difference is rendering form (grid column vs overlay), not state. One boolean per device reflects the user's intent ("show me the sidebar"); the renderer picks the form by viewport.
   - *Rejected*: Keep two booleans — keeps the historical artifact at the cost of clarity and double the persistence/reset logic.

8. **Single `<Shell>` import shared by AppShell and BoardPage**
   - *Why*: Both routes need the identical 3-row × 2-column grid topology, sidebar collapse, and mobile overlay. Code duplication would diverge over time.
   - *Rejected*: Per-route shell components — divergent maintenance, inconsistent collapse animations.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Sidebar is full-height (page.top to page.bottom); topbar starts at sidebar.right | Confirmed from intake #1 — user explicitly described this in seed message; spec encodes it as `grid-template-areas` with sidebar spanning all 3 rows | S:100 R:80 A:95 D:100 |
| 2 | Certain | Sidebar collapse hides it fully (width: 0), not a 48px rail | Confirmed from intake #2 — user chose this in answered AskUserQuestion; spec adds explicit "no 48px rail" rule and `grid-template-columns: 0 1fr` semantics | S:100 R:75 A:90 D:95 |
| 3 | Certain | Hamburger lives at TopBar.left in both states; visual "relocation" is a side effect of column collapse | Confirmed from intake #3 — spec adds explicit scenarios that hamburger never moves between components | S:95 R:85 A:90 D:90 |
| 4 | Certain | Sidebar section order: Boards → Servers → Sessions | Confirmed from intake #4 — user corrected the mockup; spec encodes order in deprecated-requirements migration | S:100 R:75 A:90 D:100 |
| 5 | Certain | BoardsSection always visible with empty hint | Confirmed from intake #5 — placing Boards at top makes hide-when-empty cause layout shift | S:90 R:80 A:90 D:90 |
| 6 | Certain | BottomBar is byte-identical across routes | Confirmed from intake #6 — explicit user correction; spec deprecates `wsRef` prop and shifts target to context | S:100 R:90 A:95 D:100 |
| 7 | Certain | BottomBar input target is the focused terminal, exposed via FocusedTerminalContext | Confirmed from intake #7 — required corollary of BottomBar-unchanged + multi-pane board | S:90 R:75 A:85 D:90 |
| 8 | Certain | TopBar absorbs route-varying informational content (board breadcrumb + counts + cycle hint in board mode) | Confirmed from intake #8 — user identified topbar as the variable surface; spec adds `mode` prop | S:100 R:85 A:90 D:95 |
| 9 | Certain | BoardPage gets a BottomBar for the first time | Confirmed from intake #9 — corollary of BottomBar at shell-level | S:90 R:85 A:90 D:95 |
| 10 | Certain | CSS Grid with named areas (sidebar, topbar, content, bottombar); sidebar spans all 3 rows | Confirmed from intake #10 — agreed in design discussion; spec encodes exact `grid-template-areas` | S:90 R:80 A:90 D:90 |
| 11 | Certain | Mobile sidebar is a fixed-position overlay, not part of the grid | Confirmed from intake #11; spec adds explicit ARIA `role="dialog" aria-modal="true"` and the single-column mobile grid | S:100 R:85 A:90 D:95 |
| 12 | Certain | Board horizontal scroll viewport flush with sidebar.right (no left gutter) | Confirmed from intake #12 — falls out of grid topology naturally; spec adds explicit scenario | S:100 R:90 A:90 D:100 |
| 13 | Certain | Builds on dc0t's unified Sidebar — same component used by AppShell and BoardPage | Confirmed from intake #13 — already true post-dc0t; spec adds requirement that BoardPage uses shared `<Shell>` | S:95 R:95 A:95 D:100 |
| 14 | Certain | New `<Shell>` component at `src/components/shell/shell.tsx` wraps the grid | Confirmed from intake #14; spec adds explicit grid-area children placement contract | S:90 R:80 A:90 D:90 |
| 15 | Certain | New `FocusedTerminalContext` at `src/contexts/focused-terminal-context.tsx` tracks focused terminal | Confirmed from intake #15; spec adds explicit type signature and root mounting requirement | S:90 R:80 A:85 D:90 |
| 16 | Certain | TerminalClient registers as focused on mount | Confirmed from intake #16; spec adds explicit unmount-clears scenario | S:95 R:90 A:95 D:95 |
| 17 | Certain | BoardPane registers as focused on focus events (click, cycle, initial mount) | Confirmed from intake #17; spec adds explicit "do not clear on focus loss — next pane overwrites" rule | S:90 R:80 A:85 D:90 |
| 18 | Certain | Compose buffer target frozen at open time | Confirmed from intake #18; spec adds explicit reopen-captures-fresh scenario | S:90 R:80 A:85 D:90 |
| 19 | Certain | No backend changes | Confirmed from intake #19; spec adds explicit "no app/backend/, no configs/tmux/" requirement | S:100 R:100 A:100 D:100 |
| 20 | Certain | No new dependencies | Confirmed from intake #20; spec adds explicit package.json-unchanged requirement | S:100 R:100 A:100 D:100 |
| 21 | Certain | Initial focused pane on board mount is leftmost (`entries[0]`) | Upgraded from intake #21 Confident — `BoardPageContent` already initializes `focusedIndex = 0` via `useState(0)`; spec preserves existing behavior (no code change needed for this assumption); reversibility is high (single line) and disambiguation is clear (one obvious default) | S:90 R:90 A:95 D:95 |
| 22 | Certain | Drag handle hidden when collapsed; hamburger is the only re-open affordance | Upgraded from intake #22 Confident — direct corollary of "sidebar collapses to width 0": rendering a 5px drag handle on an invisible 0-width column is visually impossible; the constraint forces the rule. Reversibility high (CSS conditional) | S:90 R:90 A:90 D:95 |
| 23 | Certain | Sidebar-open state persists in `localStorage["runkit-sidebar-open"]` | Upgraded from intake #23 Confident — key is already used by `chrome-context.tsx` (existing infrastructure, see lines 11, 21-26, 53-58); persistence is a code-internal decision with no user-facing trade-off | S:95 R:85 A:90 D:90 |
| 24 | Certain | Mobile breakpoint for overlay-mode is 640px width | Upgraded from intake #24 Confident — `640px` matches the existing project-wide `sm:` Tailwind breakpoint and the BoardPage's pre-existing `useIsMobile()` hook (`(max-width: 640px)`); using a different breakpoint would create inconsistency. Disambiguation clear, alignment with existing convention | S:90 R:90 A:90 D:95 |
| 25 | Certain | Animation on collapse is `grid-template-columns` transition (~150ms ease-out) | Confirmed from intake #25 (clarified) — spec adds explicit transition string | S:95 R:80 A:75 D:75 |
| 26 | Certain | Empty-state hint copy is verbatim "Pin a window to start a board" (4vuv §5) | Upgraded from intake #26 Confident — copy already exists in `boards-section.tsx` line 48; reusing verbatim avoids translation/copy churn; user-confirmed plan. High reversibility (one string), strong agent competence (existing string), clear disambiguation | S:95 R:95 A:95 D:95 |
| 27 | Confident | Keyboard shortcut to toggle sidebar: `Cmd+\` / `Ctrl+\` | The chord is a choice — Constitution V mandates keyboard accessibility but not which chord. `Cmd+\` is unused in current keybindings (verified via the registry) and aligns with VS Code's sidebar-toggle convention; spec registers it in the KeyboardShortcuts modal. Reversible by changing one keybinding entry | S:80 R:90 A:75 D:80 |
| 28 | Certain | `sidebarOpen` and `sidebarWidth` live in ChromeContext (lifted from per-route local state) | Confirmed from intake #28 (clarified) — spec adds explicit type signatures for context exposure | S:95 R:60 A:80 D:80 |
| 29 | Certain | `ChromeContext.drawerOpen` is removed; `sidebarOpen` covers both desktop column and mobile overlay | New (spec-discovered) — collapsing the two booleans simplifies state and matches the user's stated mobile model. Reversibility: medium — touches `ChromeContext` shape and downstream consumers (`AppShell`, `TopBar` hamburger animation, mobile drawer overlay logic). Single direction (don't keep both) keeps the migration clean. | S:90 R:60 A:85 D:90 |
| 30 | Certain | TopBar accepts `mode: "terminal" \| "board" \| "root"` prop; pane/server counts and cycle hint render only in `board` mode | New (spec-discovered) — concrete encoding of intake §5 ("TopBar absorbs route-varying informational content"). Default `"terminal"` keeps existing AppShell call-sites compatible; explicit `mode="board"` is required from BoardPage | S:90 R:75 A:85 D:90 |
| 31 | Certain | Board-mode TopBar inline info hidden on `< 640px` viewport (`hidden sm:inline`) | Upgraded from Confident — directly mirrors the existing mobile-hide pattern documented in `ui-patterns.md` § Chrome (Top Bar) "Right section (mobile < 640px)" where logo, "Run Kit", connection dot, FixedWidthToggle, ⌘K all use `hidden sm:flex` / `hidden sm:inline-flex`. Following the established pattern, not inventing one. High reversibility, strong agent competence | S:90 R:95 A:95 D:90 |
| 32 | Certain | `FocusedTerminalProvider` is mounted in `RootWrapper` above `<Outlet />`, alongside `SessionProvider` | Upgraded from Confident — `architecture.md` § Chrome Architecture explicitly documents the existing pattern: `ThemeProvider > ChromeProvider > RootWrapper(SessionProvider > OptimisticProvider > Outlet)`. Adding `FocusedTerminalProvider` adjacent to `SessionProvider` follows the existing convention; per-route mounting would break focus continuity across navigation (well-understood pitfall, agent competence high) | S:90 R:80 A:90 D:90 |
| 33 | Certain | New e2e test `app/frontend/tests/e2e/shell-rotation.spec.ts` plus sibling `.spec.md` | Upgraded from Confident — Constitution "Test Companion Docs" makes the `.spec.md` requirement mandatory ("PRs that add or modify a `.spec.ts` SHALL update the matching `.spec.md` in the same commit"); naming follows existing convention. Not a discretionary choice | S:95 R:95 A:95 D:95 |
| 34 | Certain | The pre-existing `BoardSwitcherDropdown` moves into `TopBar` board-mode (or is imported by it); BoardPage's inline `<header>` is removed | Upgraded from Confident — required by Requirement "BoardPage adopts Shell" + "TopBar accepts a mode prop" (BoardPage's inline `<header>` is structurally replaced by `<TopBar mode="board">`); leaving the inline header would duplicate breadcrumbs. Single coherent migration path | S:90 R:75 A:90 D:95 |

34 assumptions (33 certain, 1 confident, 0 tentative, 0 unresolved).
