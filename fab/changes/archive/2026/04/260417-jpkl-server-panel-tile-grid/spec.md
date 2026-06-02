# Spec: Server Panel Tile Grid

**Change**: 260417-jpkl-server-panel-tile-grid
**Created**: 2026-04-17
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`, `docs/memory/run-kit/architecture.md`

## Non-Goals

- Window panel and Host panel redesigns — they stay on their current fixed-height `CollapsiblePanel` layout. The new `resizable` prop exists for them to opt in later.
- Server creation and kill flows — reuse existing `onCreateServer` / `onKillServer` props and the existing `+` header button / hover × button pattern. No changes to underlying `POST /api/servers` or `POST /api/servers/kill`.
- Theme/palette changes — reuse `computeRowTints`, `serverColors`, `getAllServerColors`, `setServerColor` as today.
- Arrow-key 2D grid navigation — Tab-only nav is in scope; Up/Down/Left/Right cell traversal is a follow-up.
- Mobile long-press menus for color-picker / kill actions — deferred. Mobile hides these hover actions entirely this change.
- Drag-to-reorder tiles — server tiles preserve the list order returned by `/api/servers`; no reorder UI.
- Persisting the active tile's scroll position across panel collapse/expand cycles.

## Server Panel: Grid Layout

### Requirement: Tile Grid Replaces Vertical List
The `ServerPanel` component (`app/frontend/src/components/sidebar/server-panel.tsx`) SHALL render tmux servers as a CSS grid of tile buttons instead of a vertical list. The existing `CollapsiblePanel` wrapper, header (including title `Tmux · {active}`, toggle chevron, `+` action, refresh spinner), and active-server tinted header background SHALL be preserved unchanged.

The grid SHALL use `grid-template-columns: repeat(auto-fill, minmax(72px, 1fr))` and `gap: 6px` on desktop / fine-pointer viewports. Tiles MUST fill the full width of the container by distributing any remainder space across the columns (the `1fr` max in `minmax`).

Each tile SHALL be a focusable `<button>` element with `aria-current="true"` when it represents the active server. Tabbing through the grid MUST visit tiles in left-to-right, top-to-bottom DOM order.

#### Scenario: Grid Renders on Desktop Sidebar
- **GIVEN** the sidebar is open on desktop (>= 768px) at default width (240px)
- **AND** the `/api/servers` response contains 6 servers
- **WHEN** the user expands the `Tmux` panel
- **THEN** the server list SHALL render as a grid with exactly 3 columns (computed via `auto-fill, minmax(72px, 1fr)` at an interior width of ~220px)
- **AND** the 6 tiles SHALL occupy 2 rows
- **AND** each tile's width MUST be equal and fill its column

#### Scenario: Active Tile Styling
- **GIVEN** the active server is `default`
- **WHEN** tiles render
- **THEN** the `default` tile SHALL have `aria-current="true"`
- **AND** display an inset 1px accent-colored ring (`box-shadow: inset 0 0 0 1px var(--color-accent)`)
- **AND** if `default` has an assigned ANSI color, its tile body background SHALL use `rowTints.get(color).selected` (brighter than `base`)
- **AND** if `default` has no assigned color, the active-tile body background SHALL use the default accent tint (`bg-accent-subtle` or `rgba(var(--color-accent-rgb), 0.14)`)

#### Scenario: Clicking a Non-Active Tile Switches Server
- **GIVEN** the active server is `default` and the user clicks the `work` tile
- **WHEN** the click handler fires
- **THEN** `onSwitchServer("work")` SHALL be invoked
- **AND** no other tile-level side effects SHALL occur (no new API calls, no optimistic state)

### Requirement: Tile Visual Structure
Each tile SHALL render the following structure, mirroring Mock A from the approved preview:

- A 4px-tall top color stripe (`div.stripe`), background color = `rowTints.get(color).base` for tiles with an assigned ANSI color, or a neutral muted color (`var(--color-border)`, a.k.a. untinted gray) for tiles without an assigned color
- A tile body (`div.body`) with horizontal padding `6px`, vertical padding `4px 0 5px 0`
- A name row (`div.name`) rendering the server name at `font-size: 11px`, `font-weight: 500`, `white-space: nowrap`, `overflow: hidden`, `text-overflow: ellipsis`
- A meta row (`div.meta`) at `font-size: 10px`, `color: var(--color-text-secondary)`, showing the session count as `"{N} sess"` (no pluralization toggle; always "sess")

Tile container styling: `background: var(--color-bg-card)`, `border: 1px solid var(--color-border)`, `border-radius: 4px`, `overflow: hidden`, hover `border-color: var(--color-border)`.

#### Scenario: Server With Color and Multiple Sessions
- **GIVEN** server `work` has ANSI color 2 (green) assigned in `serverColors` and currently runs 4 sessions
- **WHEN** its tile renders
- **THEN** the stripe SHALL be colored with `rowTints.get(2).base` (green-tinted)
- **AND** the name SHALL read `work`
- **AND** the meta SHALL read `4 sess`

#### Scenario: Server Without Color
- **GIVEN** server `scratch` has no entry in `serverColors` and runs 1 session
- **WHEN** its tile renders
- **THEN** the stripe SHALL use the neutral gray (`var(--color-border)` or equivalent)
- **AND** the tile body background SHALL remain `var(--color-bg-card)` (no row tint)
- **AND** the meta SHALL read `1 sess`

#### Scenario: Server With Very Long Name
- **GIVEN** server `bench-really-long-name` exists
- **WHEN** its tile renders at 72px column width
- **THEN** the name SHALL truncate mid-string with an ellipsis
- **AND** the full name SHALL be accessible via the tile's `title` attribute (native browser tooltip)

### Requirement: Hover-Revealed Tile Actions
On viewports where `@media (pointer: fine)` applies, each tile SHALL reveal an actions cluster (`div.actions`) in the tile's top-right corner on hover. The cluster SHALL contain:

1. A color-picker button (`■`, opens `SwatchPopover` for that server) — present only when `onServerColorChange` prop is provided
2. A kill button (`✕`) — present only for the active server tile (matches today's "kill only the active server" constraint in `ServerPanel`)

The actions MUST be absolutely positioned (`position: absolute; top: 4px; right: 4px`) inside the tile, and MUST NOT cause layout shift when they appear on hover.

On `@media (pointer: coarse)` or `max-width: 639px`, the actions cluster SHALL NOT be rendered at all.

#### Scenario: Hover on Active Tile (Desktop)
- **GIVEN** the mouse pointer hovers over the active server tile on a desktop browser
- **WHEN** the pointer enters the tile bounds
- **THEN** the color-picker `■` and kill `✕` buttons SHALL become visible in the top-right of the tile
- **AND** on mouse leave, the buttons SHALL hide again

#### Scenario: Hover on Non-Active Tile
- **GIVEN** the mouse pointer hovers over a non-active tile (e.g., `work`)
- **WHEN** the pointer enters the tile
- **THEN** the color-picker `■` button SHALL be visible
- **AND** the kill `✕` button SHALL NOT be rendered (only the active tile shows kill, matching the existing behavior)

#### Scenario: Color Picker Opens from Tile
- **GIVEN** the user hovers a tile and clicks its color-picker `■` button
- **WHEN** the click handler fires
- **THEN** click propagation SHALL be stopped (the outer tile button SHALL NOT trigger `onSwitchServer`)
- **AND** a `SwatchPopover` SHALL open anchored to the tile, offering the standard color selection + Clear

#### Scenario: Mobile Viewport Hides Actions
- **GIVEN** a coarse-pointer device (`@media (pointer: coarse)`) or viewport width < 640px
- **WHEN** tiles render
- **THEN** no `.actions` cluster SHALL be rendered in any tile (regardless of hover state)
- **AND** the `SwatchPopover` and kill flow remain accessible from the command palette for mobile users

## Server Panel: Default Height and Scroll

### Requirement: Low Default Panel Height With Internal Scroll
The `ServerPanel` SHALL pass `resizable={true}` and `defaultHeight={140}` to its wrapping `CollapsiblePanel`. The panel body's content area SHALL render the tile grid inside a scroll container with `overflow-y: auto; overflow-x: hidden` so that additional rows are scrollable independently when the grid overflows the 140px default.

The existing "refresh on expand" behavior (`onToggle` handler calling `onRefreshServers`) SHALL be preserved unchanged.

#### Scenario: Many Servers Fit Within Default Height
- **GIVEN** the panel's default height is 140px and 6 servers exist
- **WHEN** the panel is expanded
- **THEN** the tile grid (3 cols × 2 rows = ~88px total at standard tile height) SHALL fit without scroll
- **AND** no scrollbar SHALL appear in the panel body

#### Scenario: Overflow Triggers Internal Scroll
- **GIVEN** 12 servers exist rendering 4 rows of tiles
- **WHEN** the panel is expanded at default 140px height
- **THEN** the first 2 rows of tiles SHALL be visible
- **AND** a vertical scrollbar SHALL appear inside the panel body
- **AND** the outer sidebar scroll (sessions, bottom panels) SHALL NOT scroll when the user scrolls inside the server grid

## CollapsiblePanel: Resize Affordance

### Requirement: Opt-In Resizable Variant
The shared `CollapsiblePanel` component (`app/frontend/src/components/sidebar/collapsible-panel.tsx`) SHALL accept the following new optional props:

- `resizable?: boolean` — default `false`. When `true`, enables the drag handle and height persistence.
- `defaultHeight?: number` — default `200` (matches today's hard-coded `max-height`). Specifies the initial open height in pixels when no persisted value exists.
- `minHeight?: number` — default `80`. Floor for drag-resize.
- `maxHeight?: number | string` — default `'calc(100vh - 120px)'`. Ceiling for drag-resize. Numeric values are treated as pixels.

When `resizable={false}` (default), the component's rendering and behavior MUST remain bit-for-bit identical to the pre-change behavior: `max-height: {defaultHeight}px` transition from 0, no drag handle, no height persistence. This ensures Window and Host panels are unaffected.

#### Scenario: Resizable False Preserves Existing Behavior
- **GIVEN** `CollapsiblePanel` is instantiated with `resizable={false}` (or omitted) and `defaultOpen={true}`
- **WHEN** it mounts
- **THEN** the content area SHALL render with `max-height: 200px` and the existing open/close transition
- **AND** no drag handle SHALL appear at the bottom
- **AND** no `${storageKey}-height` entry SHALL be read or written to localStorage

#### Scenario: Resizable True Renders Drag Handle
- **GIVEN** `CollapsiblePanel` is instantiated with `resizable={true}` and `defaultHeight={140}`
- **WHEN** it mounts in the open state
- **THEN** the content area SHALL render with `height: 140px` (no `max-height` transition at this value)
- **AND** a 6px-tall drag handle SHALL appear directly below the content area
- **AND** the drag handle SHALL have `cursor: ns-resize` and a 1px top border matching `var(--color-border)`

#### Scenario: Collapse Animation Still Works on Resizable Panels
- **GIVEN** a resizable panel is open with a persisted height of 300px
- **WHEN** the user clicks the header chevron to collapse
- **THEN** the content area SHALL animate from `height: 300px` to `height: 0` with the same 150ms transition as non-resizable panels
- **AND** the drag handle SHALL hide while collapsed
- **AND** on re-expand, the content SHALL animate back to 300px (the persisted value)

### Requirement: Drag Handle Adjusts Height
When `resizable={true}` and the panel is open, pressing and dragging the drag handle SHALL adjust the panel's content-area height live.

- `onMouseDown` on the handle SHALL record the starting `clientY` and the current height
- `onMouseMove` (attached to `document` while a drag is active) SHALL compute the delta and update the content-area height to `startHeight + (event.clientY - startY)`, clamped to `[minHeight, maxHeight]`
- `onMouseUp` (attached to `document`) SHALL end the drag, remove the document listeners, and persist the final height
- The handle MUST also respond to `onTouchStart` / `onTouchMove` / `onTouchEnd` with equivalent behavior for touch devices — BUT since mobile uses the horizontal-swipe layout (which hides the handle entirely on coarse pointer / narrow viewport), this applies primarily to tablets on desktop breakpoints

The component MUST NOT call `setState` on every `mousemove` in a way that triggers a layout thrash — the height MAY be updated via inline `style.height` on a ref during the drag, with a final `setState` on drop.

`maxHeight` values expressed as strings (e.g., `'calc(100vh - 120px)'`) MUST be resolved to a pixel value for clamp at drag time using `window.innerHeight` arithmetic when the string is of the form `calc(100vh - Npx)`. For other string forms, the component MAY fall back to `window.innerHeight - 120` as a safe default.

#### Scenario: Drag Expands Panel
- **GIVEN** a resizable panel with height 140px and `maxHeight: calc(100vh - 120px)` in a 900px tall viewport (ceiling 780px)
- **WHEN** the user presses the drag handle at `clientY: 300` and drags to `clientY: 500` then releases
- **THEN** the panel height SHALL update live during the drag to values between 140px and 340px
- **AND** on release, the final height SHALL be `340`px
- **AND** `localStorage["runkit-panel-server-height"]` SHALL contain `"340"`

#### Scenario: Drag Clamped at minHeight
- **GIVEN** a resizable panel with height 140px and `minHeight: 80`
- **WHEN** the user drags the handle to `clientY` values that would compute a height of 40px
- **THEN** the panel height SHALL clamp to 80px (not 40px)
- **AND** on release, `localStorage` SHALL store `"80"`

#### Scenario: Drag Clamped at maxHeight
- **GIVEN** a resizable panel with `maxHeight: calc(100vh - 120px)` in a 900px viewport (ceiling 780px)
- **WHEN** the user drags the handle to a `clientY` that would compute a height of 1000px
- **THEN** the panel height SHALL clamp to 780px
- **AND** on release, `localStorage` SHALL store `"780"`

### Requirement: Height Persistence
Resizable panels SHALL read and write height to `localStorage` under the key `${storageKey}-height`, mirroring the existing `storageKey` / open-state persistence pattern. The value SHALL be stored as a string containing the pixel integer (no units, no JSON wrapping).

On mount, the component SHALL:
1. Read `localStorage[`${storageKey}-height`]`
2. Parse as integer
3. If valid and within `[minHeight, maxHeight]`, use as initial height
4. Otherwise fall back to `defaultHeight`

On drag end, the component SHALL write the final (clamped) integer pixel value to the same key.

`localStorage` access MUST be wrapped in `try/catch` — if localStorage is unavailable (e.g., incognito with strict settings), the component SHALL fall back to in-memory state and continue functioning normally without error.

#### Scenario: Persisted Height Applied on Next Mount
- **GIVEN** the user previously dragged the `ServerPanel` to 260px and `localStorage["runkit-panel-server-height"]` = `"260"`
- **WHEN** the user reloads the page
- **THEN** on mount, the panel SHALL initialize with height 260px (not 140px default)

#### Scenario: Corrupted Persisted Value Falls Back to Default
- **GIVEN** `localStorage["runkit-panel-server-height"]` = `"not-a-number"`
- **WHEN** the panel mounts
- **THEN** the parse SHALL fail silently
- **AND** the panel SHALL render at 140px (the `defaultHeight`)

#### Scenario: Persisted Value Outside Bounds
- **GIVEN** `localStorage["runkit-panel-server-height"]` = `"50"` (below `minHeight: 80`)
- **WHEN** the panel mounts
- **THEN** the value SHALL be rejected as out-of-range
- **AND** the panel SHALL render at 140px (the `defaultHeight`)

## Mobile Layout: Horizontal Swipe Row

### Requirement: Single-Row Horizontal Grid on Mobile
On viewports where `@media (pointer: coarse)` matches OR viewport width is < 640px, the server tile grid SHALL reformat as a single horizontal row:

- `grid-template-columns: none`
- `grid-auto-flow: column`
- `grid-auto-columns: 88px` (slightly narrower than desktop `minmax(72px, 1fr)` to fit more per screen)
- `overflow-x: auto`
- `overflow-y: hidden`
- `scroll-snap-type: x mandatory`
- Each tile sets `scroll-snap-align: start`

The panel body's `overflow-y: auto` SHALL be replaced with `overflow-y: hidden` on mobile — vertical scrolling inside the panel is disabled; horizontal scroll is the only interaction model.

The panel's drag handle SHALL be hidden on mobile (the resizable affordance is irrelevant in single-row mode).

The panel's effective height on mobile SHALL be a fixed value of 56px (enough for one row of tiles plus a ~4px horizontal scrollbar track / scroll indicator). The `defaultHeight` prop SHALL be ignored on mobile.

#### Scenario: Mobile Viewport Renders Single Row
- **GIVEN** a viewport at 375px width (iPhone) or `@media (pointer: coarse)` on any viewport
- **WHEN** the `ServerPanel` expands
- **THEN** the tile grid SHALL render as a single horizontal row
- **AND** tiles wider than the viewport SHALL be reachable via horizontal swipe
- **AND** the panel body height SHALL be 56px
- **AND** no drag handle SHALL be rendered at the bottom of the panel

#### Scenario: Tap to Select on Mobile
- **GIVEN** the user sees 3 tiles visible with 5 more to the right
- **WHEN** they tap the second tile
- **THEN** `onSwitchServer` SHALL fire with that server's name
- **AND** no swipe / pan gesture interpretation SHALL be applied (the native `overflow-x: auto` handles scroll)

#### Scenario: Scroll-Snap Centers Active Tile
- **GIVEN** the active server is the 6th tile in a horizontal list of 8
- **WHEN** the panel first renders
- **THEN** the scroll container SHALL `scrollIntoView({ block: 'nearest', inline: 'nearest' })` on the active tile (or an equivalent one-shot scroll adjustment on mount) so the active tile is visible
- **AND** subsequent swipes SHALL snap to tile edges (`scroll-snap-type: x mandatory`)

#### Scenario: Mobile Hides Hover Actions
- **GIVEN** a coarse-pointer viewport
- **WHEN** the user taps and holds a tile
- **THEN** no `.actions` cluster SHALL appear (color-picker and kill are not reachable from the tile on mobile)
- **AND** the color and kill flows remain accessible via the command palette (existing `Server: ...` entries, out of scope for this spec)

## Backend: /api/servers Response Shape

### Requirement: Response Includes Session Count Per Server
The `GET /api/servers` endpoint (`app/backend/api/servers.go:handleServersList`) SHALL return a JSON array of objects with the shape `{"name": string, "sessionCount": number}` instead of the current `[]string`.

Example response:

```json
[
  {"name": "default", "sessionCount": 4},
  {"name": "work",    "sessionCount": 2},
  {"name": "e2e",     "sessionCount": 0}
]
```

Session counts SHALL be computed server-side by calling the existing `tmux.ListSessions(ctx, server)` helper per server and taking `len(sessions)`. If `ListSessions` returns an error for a given server (e.g., socket present but `tmux list-sessions` fails), the handler SHALL emit `sessionCount: 0` for that server and continue processing others — no per-server error SHALL surface to the client.

The handler SHALL invoke `ListSessions` for each server concurrently (`sync.WaitGroup` + a local results map) to keep the endpoint responsive when many servers are present. Each `ListSessions` call already uses `exec.CommandContext` with the request's context per Constitution I.

#### Scenario: Single Server, Four Sessions
- **GIVEN** the `default` tmux server is running with 4 sessions
- **WHEN** `GET /api/servers` is called
- **THEN** the response status SHALL be 200
- **AND** the body SHALL be `[{"name":"default","sessionCount":4}]`

#### Scenario: Multiple Servers, One Failing
- **GIVEN** servers `default` (3 sessions), `work` (2 sessions), and `broken` (socket exists but `list-sessions` returns a nonzero exit) are discovered by `ListServers`
- **WHEN** `GET /api/servers` is called
- **THEN** the response SHALL be 200
- **AND** the body SHALL contain three entries — `default: 3`, `work: 2`, and `broken: 0`
- **AND** no 5xx SHALL surface to the client
- **AND** the failure for `broken` SHALL be logged at warn level server-side

#### Scenario: No Servers Discovered
- **GIVEN** no tmux sockets exist
- **WHEN** `GET /api/servers` is called
- **THEN** the response SHALL be 200 with body `[]` (empty array, not null)

### Requirement: Existing Clients Remain Callable But Must Upgrade Types
The frontend `listServers()` function (`app/frontend/src/api/client.ts`) SHALL be updated to return `Promise<ServerInfo[]>`, where `ServerInfo = { name: string; sessionCount: number }`. All internal callers of `listServers` (sidebar, `session-context`, `server-list-page`) SHALL be updated to consume the new shape.

Existing callers that only needed names SHALL be migrated to read `.name` from each `ServerInfo` entry. No backwards-compatibility fallback or adapter SHALL be introduced — this is a coordinated change across backend + frontend.

The exported `ServerInfo` type SHALL live in a frontend types module co-located with `listServers` (either `app/frontend/src/api/client.ts` directly exported, or `app/frontend/src/types.ts` if that is the established pattern for shared API types — the implementation chooses the closer-fit location).

#### Scenario: Sidebar Consumes New Shape
- **GIVEN** the sidebar receives `servers: ServerInfo[]`
- **WHEN** it renders the `ServerPanel`
- **THEN** each tile SHALL read `.name` for the tile label and `.sessionCount` for the meta line
- **AND** no calls to `servers.map(name => ...)` SHALL remain — all map callbacks destructure `{ name, sessionCount }`

#### Scenario: ServerListPage Consumes New Shape
- **GIVEN** `/` (`ServerListPage`) calls `listServers()`
- **WHEN** the response is rendered
- **THEN** the page SHALL extract `.name` for each server's link/label
- **AND** the page MAY optionally show the session count alongside each server (nice-to-have — the primary goal is type-safety, not the visual change here)

## Testing

### Requirement: Unit Tests Cover Tile Grid, Resize, and Mobile Layout
`app/frontend/src/components/sidebar/server-panel.test.tsx` SHALL cover:

- Grid renders one tile per server with the expected `.name` and `.meta` content
- Active tile has `aria-current="true"` and the accent ring
- Clicking a tile invokes `onSwitchServer` with its name
- Hover on a tile (desktop pointer) reveals `.actions`; `.actions` absent on coarse pointer viewport simulation
- Color-picker click opens `SwatchPopover` and stops click propagation (outer `onSwitchServer` NOT called)
- Kill `✕` button only rendered on the active tile
- Mobile-viewport render (simulated via matchMedia mock) produces the single-row grid with `overflow-x: auto` and no drag handle

`app/frontend/src/components/sidebar/collapsible-panel.test.tsx` SHALL additionally cover:

- `resizable={false}` (default) renders the legacy `max-height` transition, no drag handle, no height persistence
- `resizable={true}` renders the drag handle
- Drag mousedown → mousemove → mouseup sequence updates height and writes to localStorage
- Clamping: drags outside `[minHeight, maxHeight]` clamp correctly
- Persisted height read on mount applies; invalid values fall back to `defaultHeight`
- Collapse animates from persisted height to 0 and restores on re-expand

### Requirement: Backend Tests Cover the New Response Shape
A Go test in `app/backend/api/servers_test.go` SHALL:

- Stub or inject a `tmux` helper returning a fixed `(servers, err)` pair
- Call `handleServersList` with a synthetic `httptest.NewRecorder` and assert the body is `[]ServerInfo` with correct names and session counts
- Cover the error-per-server case (one server's `ListSessions` fails → `sessionCount: 0` for that entry, others succeed)
- Cover the empty case (no servers → `[]`)

### Requirement: E2E Coverage via Playwright
A new Playwright spec under `app/frontend/e2e/` SHALL cover:

- Default desktop sidebar: server tile grid renders, active tile has accent ring, click another tile switches server (URL updates to `/$server`)
- Mobile viewport (375×812): server panel renders as a single row, horizontal swipe reveals off-screen tiles, tap to select switches server

A companion `.spec.md` file (per the project's e2e-spec-md requirement introduced in `260417-0f9b4eb`) SHALL accompany every new spec file. The `.spec.md` SHALL describe the test's intent and the scenarios covered.

Resize drag is NOT required in e2e (unit tests on `collapsible-panel.test.tsx` provide sufficient coverage) — resize Playwright coverage is nice-to-have.

#### Scenario: Playwright Desktop Grid Interaction
- **GIVEN** a Playwright session on a 1024×768 viewport at `/$server` route
- **WHEN** the test expands the Tmux panel and clicks the second tile
- **THEN** the URL SHALL update to the clicked server's path
- **AND** the new active tile SHALL have the accent ring

#### Scenario: Playwright Mobile Swipe
- **GIVEN** a Playwright session on 375×812 viewport with 8+ servers
- **WHEN** the test scrolls the server panel horizontally and taps a previously off-screen tile
- **THEN** the URL SHALL update to that server
- **AND** the tap gesture SHALL NOT be misinterpreted as a swipe (click-not-drag fires reliably)

## Design Decisions

1. **Mock A (color-tile grid) over Mock B (chips) and Mock C (info cards)**
   - *Why*: User explicitly chose Option A after reviewing all three rendered mocks. A balances density with color prominence (4px stripe surfaces ANSI tint clearly), whereas B uses a small dot (less prominent) and C takes more vertical real estate with window counts that aren't needed at server-selection granularity.
   - *Rejected*: B (chips) de-emphasized the color feature; C (info cards) reduced tile density and added unneeded window-count detail.

2. **Session count on the endpoint vs. lazy per-tile fetch**
   - *Why*: User explicitly chose "Add counts to the endpoint." Single round-trip is simpler, no fan-out, and the count is cheap server-side (one `tmux list-sessions` per server, already needed by other endpoints). Concurrent per-server `ListSessions` keeps latency proportional to the slowest server, not the sum.
   - *Rejected*: Lazy fetch would require per-tile `useEffect` + state, spinner-on-tile UI, and additional loading-state bookkeeping for something as cheap as a socket-scoped session count.

3. **Resize as an opt-in prop on shared `CollapsiblePanel`**
   - *Why*: User explicitly chose "Standardize." Window and Host panels currently share this component; an opt-in prop lets them adopt the same resize affordance later without forcing it now. A `ServerPanel`-only resize would have inlined logic that later needs re-extraction.
   - *Rejected*: Inline resize logic in `ServerPanel`; creating a parallel `ResizableCollapsiblePanel` (duplication).

4. **Full replacement of the vertical list (no toggle)**
   - *Why*: User explicitly chose "replace." A density toggle adds permanent UI surface area for what is ultimately a one-time UX migration. If the tile grid proves worse in practice, rollback is a single PR.
   - *Rejected*: Keeping the list as a density mode; feature flag for A/B testing (scope and complexity overkill for a sidebar subcomponent).

5. **Mobile single-row horizontal swipe (vs. single-column list or stacked grid)**
   - *Why*: User explicitly described this approach ("to simplify things, the whole server grid can be a single row - you swipe left<->right"). Vertical single-column would compete with the session list for drawer height; a stacked grid compresses tiles too small to tap reliably. Horizontal swipe preserves tile size + tap affordance while minimizing vertical footprint in the drawer.
   - *Rejected*: Single-column vertical list (eats drawer height); stacked grid with shrunken tiles (poor touch ergonomics); hiding the panel on mobile (loses functionality).

6. **Active tile uses `.selected` tint (brighter) + accent ring**
   - *Why*: Matches the existing `SessionRow` active treatment, providing visual consistency across sidebar rows. The brighter tint reinforces the accent ring, especially for non-accent-colored active servers where the ring alone provides less contrast.
   - *Rejected*: Accent ring only (weaker visual signal for tinted tiles); accent-colored background overriding the tint (loses the color identity of the server).

7. **Hover actions on `pointer: fine` only**
   - *Why*: Mobile long-press menus add meaningful complexity (gesture detection, menu positioning, accidental trigger avoidance). Deferring them scopes this change tight, and the command palette provides a keyboard-first mobile path to color / kill.
   - *Rejected*: Long-press menu (scope creep for first iteration); always-visible actions on mobile (visual clutter in the narrow row).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Grid container `grid-template-columns: repeat(auto-fill, minmax(72px, 1fr))`, gap 6px, per Mock A. | Confirmed from intake #8 — directly from approved Mock A. Spec preserved the value. | S:95 R:80 A:90 D:95 |
| 2 | Certain | Replace `ServerPanel` list body with a grid of `<button>` tiles; preserve `CollapsiblePanel` wrapper, header, and refresh behavior. | Confirmed from intake #1, #3 — user explicitly chose "Option A" and "replace." | S:98 R:70 A:85 D:95 |
| 3 | Certain | `/api/servers` returns `[]ServerInfo` with `{name, sessionCount}`; frontend types updated coordinately. | Confirmed from intake #2 — user explicitly chose "Add counts to the endpoint." | S:95 R:65 A:90 D:95 |
| 4 | Certain | `CollapsiblePanel` gains opt-in `resizable`, `defaultHeight`, `minHeight`, `maxHeight` props; default behavior bit-for-bit unchanged. | Confirmed from intake #4 — user explicitly chose "Standardize." Non-resizable preservation is essential to avoid regressing Window/Host panels. | S:95 R:75 A:90 D:95 |
| 5 | Certain | Mobile reformats as a single-row scroll-snap horizontal grid on `pointer: coarse` or `max-width: 639px`. | Confirmed from intake #5 — user explicitly described this simplification. | S:95 R:75 A:85 D:90 |
| 6 | Certain | Reuse `computeRowTints`, `serverColors`, `SwatchPopover`, `onCreateServer`, `onKillServer`, `onRefreshServers`, `onServerColorChange` — no new palette or API mechanics. | Confirmed from intake #6 — Constitution VII + explicit scope exclusion. | S:95 R:85 A:95 D:98 |
| 7 | Certain | Default `ServerPanel` height 140px; internal `overflow-y: auto` for grid overflow. | Confirmed from intake #10 — user verbatim statement. Spec encoded the exact pixel value. | S:95 R:85 A:85 D:90 |
| 8 | Certain | Active tile = inset accent ring + `rowTints.get(color).selected` tint (fallback to accent-subtle for untinted). | Confirmed from intake #11 — matches Mock A and existing `SessionRow` active treatment. | S:90 R:80 A:85 D:90 |
| 9 | Certain | Backend computes `sessionCount` concurrently per server via existing `ListSessions(ctx, server)`; per-server errors → 0, not a 5xx. | Confirmed from intake #12 — Constitution I mandates `exec.CommandContext` (already used inside `ListSessions`). Concurrent fan-out is an implementation refinement for latency. | S:90 R:75 A:95 D:90 |
| 10 | Certain | Hover-revealed actions rendered only on `pointer: fine`; coarse pointer / narrow viewport hides `.actions` entirely. | Confirmed from intake #15 — scope decision made explicit in intake. | S:85 R:75 A:80 D:90 |
| 11 | Certain | Drag handle hidden on mobile single-row layout. | Confirmed from intake #17 — follows from the single-row layout (no vertical dimension to resize). | S:90 R:80 A:85 D:90 |
| 12 | Certain | `localStorage` height key `${storageKey}-height`; invalid / out-of-range values fall back to `defaultHeight`; all access wrapped in try/catch. | Confirmed from intake #9; matches existing `readPersistedState` pattern in `CollapsiblePanel` (wrap-in-try, default-on-failure). | S:95 R:85 A:95 D:95 |
| 13 | Certain | Tab-only keyboard nav this change; arrow-key 2D grid nav deferred. | Confirmed from intake #16 — Constitution V satisfied by Tab navigation across focusable `<button>` tiles. | S:85 R:80 A:85 D:90 |
| 14 | Confident | Drag handle is 6px tall, `ns-resize` cursor, 1px top border in `--color-border`; `minHeight` 80 / `maxHeight: calc(100vh - 120px)` defaults. | Mock-sketch values, not pixel-audited by user. Refinement during apply is low-risk. | S:75 R:80 A:70 D:75 |
| 15 | Confident | Mobile tile width 88px (slightly wider than desktop 72px min) for better tap ergonomics at the narrower scroll viewport. | Reasonable default for finger-tap targets at coarse-pointer sizes; may refine during apply + Playwright. | S:70 R:80 A:70 D:75 |
| 16 | Confident | `maxHeight` string `calc(100vh - 120px)` parsed by detecting the `calc(100vh - Npx)` form; other string forms fall back to `window.innerHeight - 120`. | Pragmatic parser covering the only form actually used; broader CSS calc parsing is overkill for this scope. | S:70 R:70 A:75 D:75 |
| 17 | Confident | Concurrent `ListSessions` fan-out via `sync.WaitGroup` + a mutex-protected result map keyed by server name. | Standard Go concurrency idiom; existing `ListSessions` is goroutine-safe (each call spawns its own `exec.Cmd`). Alternative (serial) is simpler but slower proportional to server count. | S:75 R:75 A:80 D:75 |
| 18 | Certain | Server name with no assigned color gets a neutral-gray stripe (`var(--color-border)`) rather than no stripe. | Every tile in approved Mock A carries a stripe; variable-presence stripes would break row alignment. Determined by mock. | S:85 R:80 A:85 D:90 |
| 19 | Certain | `ServerInfo` type lives in `app/frontend/src/api/client.ts`, colocated with `listServers`. | Determined by existing codebase convention — `listServers`, `createServer`, etc. already live here; a separate types module is not used for API shapes. | S:85 R:85 A:95 D:90 |
| 20 | Confident | Active-tile `scrollIntoView({ block: 'nearest', inline: 'nearest' })` on mount for the mobile single-row layout. | Ensures the current server is visible without forcing full-center scroll. Non-invasive on desktop (where the grid fits). | S:70 R:75 A:75 D:75 |

20 assumptions (15 certain, 5 confident, 0 tentative, 0 unresolved).
