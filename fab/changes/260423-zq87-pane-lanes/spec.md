# Spec: Pane Lanes

**Change**: 260423-zq87-pane-lanes
**Created**: 2026-04-23
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`, `docs/memory/run-kit/architecture.md`

## Non-Goals

- Backend API changes — the existing `/relay/:session/:window` WebSocket and `/api/sessions/stream` SSE endpoints are sufficient
- Mobile-optimized lanes layout — lanes are a desktop/tablet power-user feature; mobile can navigate to `/lanes` but the UX is not optimized for small screens
- Drag-and-drop lane reordering — pins are ordered by insertion; reordering is a future enhancement

## Routing: Lanes Route

### Requirement: Root-Level Lanes Route

The router SHALL define a new root-level route at `/lanes` as a direct child of `rootRoute`. The route SHALL NOT be nested under `/$server` because the lanes view aggregates panes across multiple tmux servers. The `LanesPage` component SHALL be rendered directly, without `ServerShell` or `AppShell` wrapping — it manages its own layout.

#### Scenario: Navigate to Lanes via URL

- **GIVEN** the router is initialized
- **WHEN** the user navigates to `/lanes`
- **THEN** the `LanesPage` component renders
- **AND** all pinned lanes load their terminal connections

#### Scenario: Navigate to Lanes from Command Palette

- **GIVEN** the user is on any route (server list, dashboard, or terminal view)
- **WHEN** the user opens the command palette and selects "View: Open Lanes"
- **THEN** the router navigates to `/lanes`

#### Scenario: Navigate Back from Lanes

- **GIVEN** the user is on the `/lanes` route
- **WHEN** the user clicks a lane's "open in terminal" link or uses browser back
- **THEN** navigation goes to `/$server/$session/$window` for that lane's pane, or browser history

### Requirement: Lanes Route Registration

The `lanesRoute` SHALL be added to `router.tsx` as a child of `rootRoute` alongside `indexRoute` and `serverLayoutRoute`:

```typescript
const lanesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/lanes",
  component: LanesPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  lanesRoute,
  serverLayoutRoute.addChildren([serverIndexRoute, terminalRoute]),
]);
```

#### Scenario: Route Tree Structure

- **GIVEN** the application routes are defined
- **WHEN** the route tree is built
- **THEN** `/lanes` is a sibling of `/` and `/$server`, not a child of `/$server`

## Pin State: Management and Persistence

### Requirement: Pin Data Model

A pin SHALL be represented as a tuple of `{ server: string, session: string, windowIndex: number }`. Pin state SHALL be stored in `localStorage` under the key `runkit-lanes-pins` as a JSON-serialized array of pin objects. Duplicate pins (same server+session+windowIndex) SHALL be prevented.

#### Scenario: Pin a Window

- **GIVEN** the user is viewing `/$server/$session/$window`
- **WHEN** the user triggers "Lanes: Pin Current Window" via command palette
- **THEN** the pin `{ server, session, windowIndex }` is appended to the pins array in localStorage
- **AND** if the user is on the `/lanes` route, the new lane appears immediately

#### Scenario: Unpin a Window

- **GIVEN** a window is pinned
- **WHEN** the user triggers unpin via any discovery path (lane header, sidebar, command palette, context menu)
- **THEN** the matching pin is removed from localStorage
- **AND** the lane is removed from the lanes view if currently displayed

#### Scenario: Prevent Duplicate Pins

- **GIVEN** a window is already pinned
- **WHEN** the user attempts to pin the same window again
- **THEN** no duplicate is added
- **AND** the action is silently ignored (no error toast)

### Requirement: Pin State Hook

A `usePinnedLanes()` hook SHALL provide reactive access to pin state. It SHALL:
- Return `{ pins, pinWindow, unpinWindow, isPinned, clearPins }` 
- Synchronize across tabs via `storage` event listener on `window`
- Be usable from any component (lanes page, sidebar, command palette)
- Live in `app/frontend/src/hooks/use-pinned-lanes.ts`

#### Scenario: Cross-Tab Pin Sync

- **GIVEN** two browser tabs are open
- **WHEN** the user pins a window in tab A
- **THEN** tab B's `usePinnedLanes()` hook reflects the new pin within one event loop tick

## Pin Discovery: UI Entry Points

### Requirement: Command Palette Actions

The following command palette actions SHALL be registered in `AppShell`:

| Action ID | Label | Condition | Behavior |
|-----------|-------|-----------|----------|
| `lanes-pin` | "Lanes: Pin Current Window" | `currentWindow` exists AND not already pinned | Pin current window |
| `lanes-unpin` | "Lanes: Unpin Current Window" | `currentWindow` exists AND is pinned | Unpin current window |
| `lanes-open` | "View: Open Lanes" | On server routes (inside AppShell) | Navigate to `/lanes` |

#### Scenario: Pin via Command Palette

- **GIVEN** the user is on `/$server/$session/$window` and the window is not pinned
- **WHEN** the user opens the command palette and selects "Lanes: Pin Current Window"
- **THEN** the window is pinned
- **AND** the "Pin" action is replaced by "Unpin" in subsequent palette opens

### Requirement: Sidebar Pin Icon

Each window row in the sidebar (`window-row.tsx`) SHALL render a pin icon button. The icon SHALL toggle between pinned (filled) and unpinned (outline) states. The pin button SHALL be visible on hover (desktop) and always visible on touch devices (`coarse:opacity-100`), following the existing kill button reveal pattern.

#### Scenario: Pin from Sidebar

- **GIVEN** the user is on `/$server` and the sidebar shows session windows
- **WHEN** the user clicks the pin icon on a window row
- **THEN** the window is pinned with `{ server, session, windowIndex }` derived from the current server context and the window row's data

#### Scenario: Visual Feedback on Pinned Window

- **GIVEN** a window is pinned
- **WHEN** the sidebar renders its window row
- **THEN** the pin icon shows a filled/active state (e.g., `text-accent` instead of `text-text-secondary`)

### Requirement: Right-Click Context Menu

Right-clicking a window row in the sidebar SHALL open a context menu with a "Pin to Lanes" or "Unpin from Lanes" option (toggled based on pin state). The context menu SHALL dismiss on outside click, Escape, or selection.

#### Scenario: Pin via Context Menu

- **GIVEN** a window row is visible in the sidebar
- **WHEN** the user right-clicks the window row
- **THEN** a context menu appears with "Pin to Lanes" (or "Unpin from Lanes" if already pinned)
- **AND** selecting the option toggles the pin state

### Requirement: Lane Header Unpin

Each lane's header bar SHALL include an unpin button (✕ or unpin icon) that removes the pin when clicked.

#### Scenario: Unpin from Lane Header

- **GIVEN** the lanes view is displayed with pinned lanes
- **WHEN** the user clicks the unpin button in a lane's header
- **THEN** the pin is removed and the lane disappears from the view

## Lanes View: Layout and Rendering

### Requirement: Horizontal Scroll Container

The `LanesPage` component SHALL render a horizontally scrolling container. Lanes are arranged side by side as flex children in a `flex-row` container with `overflow-x: auto`. The container SHALL have `scroll-snap-type: x mandatory` and each lane SHALL have `scroll-snap-align: start` for smooth scrolling.

#### Scenario: Horizontal Scroll with Multiple Lanes

- **GIVEN** 5 panes are pinned and the viewport can display 3 lanes
- **WHEN** the lanes view renders
- **THEN** 3 lanes are visible and the user can scroll horizontally to reveal the remaining 2
- **AND** scroll snaps to lane boundaries

### Requirement: Lane Component

Each lane SHALL be rendered by a `Lane` component (`app/frontend/src/components/lanes/lane.tsx`) containing:

1. **Header bar** — server name · session name · window name, plus an unpin button and an "open in terminal" link (navigates to `/$server/$session/$window`)
2. **Terminal area** — a full xterm.js `Terminal` instance connected via WebSocket relay
3. **Resize handle** — a vertical drag handle on the right edge for resizing lane width

#### Scenario: Lane Renders Terminal Content

- **GIVEN** a pane is pinned with `{ server: "default", session: "work", windowIndex: 2 }`
- **WHEN** the lane mounts in the lanes view
- **THEN** a WebSocket connection is established to `/relay/work/2?server=default`
- **AND** xterm.js renders the terminal output in the lane's terminal area

### Requirement: Lane Width — Resizable

Each lane SHALL be resizable via a vertical drag handle on its right edge. The drag handle SHALL use the same pointer-event pattern as the existing sidebar resize handle (document-level `pointermove`/`pointerup`, `document.body.style.cursor = "col-resize"` during drag). Lane width SHALL be persisted in `localStorage` under key `runkit-lanes-widths` as a JSON object mapping pin identity (`${server}:${session}:${windowIndex}`) to pixel width. Default width for new lanes: 480px. Minimum width: 280px. No maximum width.

#### Scenario: Resize a Lane

- **GIVEN** the lanes view displays multiple lanes
- **WHEN** the user drags a lane's right-edge resize handle
- **THEN** the lane width changes in real-time
- **AND** the xterm.js terminal reflows to fit the new width (via `FitAddon.fit()`)
- **AND** the new width is persisted to localStorage

### Requirement: Empty State

When no panes are pinned, the lanes view SHALL display a centered empty-state message with:
- Text: "No panes pinned"
- Subtext: "Pin windows from the sidebar or command palette to monitor them here"
- A link/button to navigate back to `/$server` (or `/` if no server context)

#### Scenario: Empty Lanes View

- **GIVEN** the user navigates to `/lanes`
- **WHEN** no panes are pinned (localStorage array is empty)
- **THEN** the empty state renders with guidance text and a navigation link

## Lanes View: Focus and Interaction

### Requirement: Click-to-Focus

Clicking anywhere within a lane's terminal area SHALL focus that lane. The focused lane SHALL receive keyboard input via its xterm.js terminal instance. Visual indicator: focused lane gets a `ring-2 ring-accent` outline.

#### Scenario: Click to Focus a Lane

- **GIVEN** the lanes view displays 3 lanes, lane 2 is focused
- **WHEN** the user clicks in lane 3's terminal area
- **THEN** lane 3 becomes focused (accent ring)
- **AND** lane 2 loses focus (ring removed)
- **AND** subsequent keyboard input goes to lane 3's terminal

### Requirement: Hover-to-Focus

Moving the mouse into a lane's terminal area SHALL focus that lane. This provides zero-click interaction for monitoring workflows. Focus follows the mouse pointer.

#### Scenario: Hover to Focus

- **GIVEN** the lanes view displays multiple lanes
- **WHEN** the user moves the mouse into lane 2's terminal area
- **THEN** lane 2 becomes focused and receives keyboard input

### Requirement: Keyboard Cycling

<!-- clarified: Changed from Ctrl+Tab (browser-reserved) to Ctrl+]/Ctrl+[ — interceptable by JS, mnemonic for next/previous brackets -->

`Ctrl+]` SHALL cycle focus to the next lane (left to right). `Ctrl+[` SHALL cycle to the previous lane. Focus wraps from the last lane to the first and vice versa.

#### Scenario: Cycle Focus with Keyboard

- **GIVEN** 4 lanes are displayed and lane 1 is focused
- **WHEN** the user presses `Ctrl+]`
- **THEN** lane 2 becomes focused
- **WHEN** the user presses `Ctrl+]` three more times
- **THEN** focus wraps back to lane 1

## Lanes View: Connection Management

### Requirement: WebSocket Per Lane

Each mounted lane SHALL establish its own WebSocket connection to `/relay/:session/:window?server=:server`. Connection lifecycle follows the existing `TerminalClient` pattern: connect on mount, reconnect with exponential backoff on disconnect, close on unmount. Each lane independently manages its connection state.

#### Scenario: Multiple Concurrent WebSocket Connections

- **GIVEN** 4 panes are pinned across 2 servers
- **WHEN** the lanes view mounts
- **THEN** 4 independent WebSocket connections are established (2 per server)
- **AND** each lane streams terminal I/O independently

### Requirement: SSE Per Server

The lanes view SHALL establish one SSE connection per unique server among the pinned lanes, using the existing `/api/sessions/stream?server=:server` endpoint. SSE data is used to detect window kills and session state changes.

#### Scenario: SSE Detects Window Kill

- **GIVEN** a lane is connected to server "default", session "work", window 3
- **WHEN** the tmux window is killed externally
- **THEN** the SSE stream reports the window as gone
- **AND** the lane shows a "window closed" overlay with an unpin button
- **AND** the lane auto-unpins after 5 seconds

### Requirement: Connection State Indicator

Each lane header SHALL show a connection status dot (green = connected, gray = disconnected), matching the existing top-bar connection indicator pattern.

#### Scenario: Lane Disconnects and Reconnects

- **GIVEN** a lane's WebSocket connection drops
- **WHEN** the connection state changes to disconnected
- **THEN** the lane header dot turns gray
- **WHEN** the WebSocket reconnects
- **THEN** the dot turns green

## Lanes Page: Chrome

### Requirement: Minimal Page Chrome

The `LanesPage` SHALL render its own minimal chrome — not the full `AppShell`. Chrome consists of:

1. **Top bar** — "Lanes" title (left), pin count badge, "View: Open Lanes" keyboard shortcut hint, theme toggle, and a link back to `/` (right)
2. **No sidebar** — the lanes view is a standalone layout; session navigation happens through the lane headers' "open in terminal" links

#### Scenario: Lanes Page Renders Own Chrome

- **GIVEN** the user navigates to `/lanes`
- **WHEN** the page renders
- **THEN** a minimal top bar is shown (not the full AppShell with sidebar)
- **AND** the terminal area is maximized for lane display

## Design Decisions

1. **Root-level route, not server-scoped**: The lanes view aggregates across servers, so it must live outside `/$server`. This is a third top-level route (alongside `/` and `/$server`), justified because neither existing route can host multi-server terminal columns.
   - *Why*: User explicitly requested cross-server pinning
   - *Rejected*: `/$server/lanes` — would limit to single server, contradicting the requirement

2. **Own chrome instead of AppShell**: Lanes don't need the sidebar (pinned panes are already displayed as lanes) or the session-scoped SSE connection. A minimal chrome keeps the layout focused on terminals.
   - *Why*: Maximize terminal real estate; avoid confusion between sidebar navigation and lane pinning
   - *Rejected*: Wrapping in AppShell — sidebar would duplicate the lane headers; SSE per-server management conflicts with multi-server model

3. **localStorage for pin persistence**: Consistent with all other UI state persistence in run-kit (sidebar width, theme, panel state). No backend storage needed per constitution (no database).
   - *Why*: Convention over configuration; no database by constitution
   - *Rejected*: Server-side persistence — violates "no database" principle

4. **Multiple xterm.js instances (not capture-pane snapshots)**: TweetDeck columns are live. Each lane is a full terminal — you can type, scroll back, see real-time output. `capture-pane` would be read-only and periodic, losing interactivity.
   - *Why*: User's mental model is TweetDeck (live, interactive columns)
   - *Rejected*: `tmux capture-pane` snapshots — read-only, 1-2s latency, no interactivity

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Horizontal scroll layout with columns | Confirmed from intake #1 — user explicitly described "infinite horizontal scroll" | S:95 R:85 A:90 D:90 |
| 2 | Certain | Live xterm.js terminals, not static snapshots | Confirmed from intake #2 — TweetDeck model is definitionally live | S:85 R:45 A:70 D:80 |
| 3 | Certain | Pin/unpin model for selecting panes | Confirmed from intake #3 — user said "pin" and "subscribe" | S:90 R:85 A:85 D:90 |
| 4 | Certain | Full xterm.js + WebSocket relay per lane | Confirmed from intake #4 — natural implementation of live terminal | S:95 R:40 A:70 D:65 |
| 5 | Certain | Pin state in localStorage as {server, session, windowIndex} tuples | Confirmed from intake #5 — matches project convention | S:95 R:85 A:75 D:75 |
| 6 | Certain | Pin via command palette, sidebar icon, context menu, lane header | Confirmed from intake #6 — multiple discovery paths | S:95 R:90 A:85 D:70 |
| 7 | Certain | Root-level /lanes route | Confirmed from intake #7 — cross-server requires root-level | S:95 R:50 A:65 D:50 |
| 8 | Certain | Cross-server and cross-session pinning | Confirmed from intake #8 — user explicitly requested | S:95 R:55 A:50 D:45 |
| 9 | Certain | Click-to-focus + hover-to-focus + keyboard cycling | Confirmed from intake #9 — user wanted all three | S:95 R:75 A:60 D:55 |
| 10 | Tentative | Soft cap of ~8-12 simultaneous pinned lanes | Inherited from intake #10 — performance boundary, no data yet | S:25 R:70 A:50 D:50 |
| 11 | Certain | Resizable lane width via drag handle, 480px default, persisted | Confirmed from intake #11 — user chose resizable | S:95 R:85 A:70 D:70 |
| 12 | Confident | LanesPage renders own minimal chrome, not AppShell | Spec decision — sidebar is redundant when lanes are the primary view; multi-server SSE model conflicts with AppShell's single-server assumption | S:70 R:60 A:75 D:65 |
| 13 | Confident | Scroll-snap on lane boundaries | Spec decision — improves horizontal scroll UX; easily removed if annoying | S:40 R:90 A:70 D:70 |
| 14 | Confident | Auto-unpin killed windows after 5s delay | Spec decision — keeps lanes tidy; delay gives user time to notice before lane disappears | S:35 R:85 A:65 D:60 |

14 assumptions (10 certain, 3 confident, 1 tentative, 0 unresolved).
