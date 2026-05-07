# Spec: Pane Boards

**Change**: 260507-4vuv-pane-boards
**Created**: 2026-05-07
**Affected memory**: `docs/memory/run-kit/architecture.md`, `docs/memory/run-kit/tmux-sessions.md`, `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- **Empty boards** — boards exist only while at least one window is pinned to them; deleting the last pin removes the board (no daemon, no tombstone).
- **Right-click / context-menu pin** — explicitly dropped from intake (no existing context-menu pattern in the sidebar).
- **Cross-device pane width sync** — pane widths are intentionally browser-local (`localStorage`); only pin state crosses devices via tmux.
- **Hover-to-focus** — off in v1; click and `Cmd+[` / `Cmd+]` are the focus mechanisms.
- **Reorder Pane palette action** — listed in intake but explicitly marked "Defer to v1.1 if scope-pressured"; this spec defers it.
- **Drag-and-drop reorder UI** — drag-to-resize is in v1; drag-to-reorder is not (reorder is via drag of the pane chrome → API call). The tmux-side `Reorder` API is in scope so future UI can wire it without backend churn.
- **Concurrent-edit conflict resolution** — last-write-wins with SSE re-broadcast is acceptable for v1 (intake assumption #14).

## Storage Layer: `@rk_board` server-scoped tmux option

### Requirement: Distributed per-server membership storage

Pin membership SHALL be persisted in the `@rk_board` server-scoped tmux user-option, with **each tmux server storing only its own windows**. The aggregate "boards" set is derived by reading `@rk_board` from every server discovered via `tmux.ListServers(ctx)` and unioning the entries.

The format of `@rk_board` SHALL be a comma-separated list of entries, each entry colon-separated `<window_id>:<board_name>:<order_key>`. Empty value or unset option SHALL be treated as zero entries (no error).

#### Scenario: Round-trip a single pin

- **GIVEN** server `runkit` has no `@rk_board` set, window `@1234` exists in session `dev:0`
- **WHEN** the user pins `@1234` to board `main`
- **THEN** `tmux -L runkit show-option -sv @rk_board` SHALL return `@1234:main:a`
- **AND** `GET /api/boards/main` SHALL include the entry with `server: "runkit"`, `window_id: "@1234"`, `order_key: "a"`

#### Scenario: Distributed across servers, single board

- **GIVEN** server `runkit` has `@rk_board = "@1234:main:a,@5678:main:c"` and server `default` has `@rk_board = "@def0:main:b"`
- **WHEN** `GET /api/boards/main` runs
- **THEN** the response SHALL contain three entries ordered `[@1234@runkit:a, @def0@default:b, @5678@runkit:c]` (sorted by `order_key`)

#### Scenario: Boards derived from membership, no separate registry

- **GIVEN** all reachable servers return empty `@rk_board`
- **WHEN** `GET /api/boards` runs
- **THEN** the response SHALL be `[]`
- **AND** no `@rk_boards` option is read or written anywhere in the codebase

#### Scenario: Empty board cannot exist

- **GIVEN** board `main` has exactly one pinned window `@1234` on server `runkit`
- **WHEN** the user unpins `@1234` from `main`
- **THEN** the entry SHALL be removed from server `runkit`'s `@rk_board`
- **AND** `GET /api/boards` SHALL not include `main`
- **AND** the sidebar Boards section SHALL hide `main` immediately upon receiving the SSE event

### Requirement: Format and field validation

Board names SHALL match the regex `^[A-Za-z0-9_-]{1,32}$` (alphanumeric, hyphen, underscore, length 1–32). Names containing `,` or `:` MUST be rejected because those are field separators in `@rk_board`.

Window IDs SHALL be validated to start with `@` followed by digits (matching tmux's `#{window_id}` form).

Order keys SHALL be ASCII strings of length 1–16 containing only lowercase letters `a`–`z`.

#### Scenario: Reject invalid board name on pin

- **GIVEN** the user attempts to pin a window to board `foo,bar`
- **WHEN** `POST /api/boards/foo,bar/pin` is called
- **THEN** the server SHALL return `400` with body `{"error":"invalid board name"}`
- **AND** no tmux mutation SHALL be performed

#### Scenario: Reject malformed entry on read (graceful)

- **GIVEN** `@rk_board` has been manually set to a malformed value (e.g., `not:a:valid:entry,@1234:main:a`)
- **WHEN** the read path parses entries
- **THEN** malformed entries SHALL be silently skipped (logged via `slog.Warn`)
- **AND** the well-formed entry `@1234:main:a` SHALL be returned

### Requirement: Lazy stale-entry cleanup

When `GetBoard(ctx, name)` reads entries, it SHALL intersect with the live window list per server (`tmux list-windows -a -F "#{window_id}"`). Entries whose `window_id` is not present on its source server SHALL be omitted from the response and removed from `@rk_board` in a write-back operation. Write-back failure MUST NOT fail the read — the response is still returned with stale entries dropped, and the failure is logged.

#### Scenario: Stale entry dropped at read time

- **GIVEN** server `runkit` has `@rk_board = "@1234:main:a,@9999:main:b"` and window `@9999` no longer exists
- **WHEN** `GET /api/boards/main` is called
- **THEN** the response SHALL contain only the entry for `@1234`
- **AND** `@rk_board` on `runkit` SHALL be rewritten to `@1234:main:a`

#### Scenario: Eager cleanup via SSE poll

- **GIVEN** the SSE hub poll-tick observes that window `@1234` no longer exists on server `runkit` and `@1234` had been pinned to board `main`
- **WHEN** the cleanup runs
- **THEN** the entry SHALL be removed from `@rk_board` on `runkit`
- **AND** the hub SHALL emit `event: board-changed` with payload `{board: "main", change: "cleanup", server: "runkit", window_id: "@1234"}`

### Requirement: Lexicographic / fractional order keys

Reorder operations SHALL compute new order keys via fractional indexing — given the keys of the neighbours `before` and `after` (either may be null for prepend/append), produce a key that is strictly greater than `before` and strictly less than `after` in lexicographic order. Inserts MUST NOT renumber existing entries.

The algorithm SHALL be implemented in pure Go (no external deps) following the well-known fractional indexing pattern (lowercase `a`–`z` only, with append of fresh letters when no in-between key exists at the current depth).

#### Scenario: Prepend (no before)

- **GIVEN** the current first key is `b`
- **WHEN** computing a key with `before=null`, `after="b"`
- **THEN** the result SHALL be `a` (or any string strictly less than `b`)

#### Scenario: Append (no after)

- **GIVEN** the current last key is `c`
- **WHEN** computing a key with `before="c"`, `after=null`
- **THEN** the result SHALL be `d` (or any string strictly greater than `c`)

#### Scenario: Insert between

- **GIVEN** neighbours have keys `b` and `c`
- **WHEN** computing a key between them
- **THEN** the result SHALL be a string strictly between, e.g. `bm`

#### Scenario: Insert between adjacent suffixes

- **GIVEN** neighbours have keys `b` and `bm`
- **WHEN** computing a key between them
- **THEN** the result SHALL be a string strictly between, e.g. `bg`

## Backend: Go Internal API

### Requirement: `internal/tmux/board.go` package surface

A new file `app/backend/internal/tmux/board.go` SHALL define the board entry type and CRUD wrappers that go through `tmuxExecRawServer` (mirroring the `@rk_session_order` pattern). The constant `BoardOption = "@rk_board"` SHALL be the canonical option name.

```go
type BoardEntry struct {
    Server   string `json:"server"`
    WindowID string `json:"windowId"`
    Board    string `json:"board"`
    OrderKey string `json:"orderKey"`
}

func ListBoardEntries(ctx context.Context, server string) ([]BoardEntry, error)
func ListAllBoardEntries(ctx context.Context) ([]BoardEntry, error)
func ListBoards(ctx context.Context) ([]BoardSummary, error)
func GetBoard(ctx context.Context, name string) ([]BoardEntry, error)
func Pin(ctx context.Context, server, windowID, board string) error
func Unpin(ctx context.Context, server, windowID, board string) error
func Reorder(ctx context.Context, server, windowID, board, newOrderKey string) error
func ComputeOrderKey(before, after string) (string, error)
```

`BoardSummary` SHALL be `{Name string, PinCount int}`.

All read functions MUST treat "no server running", "failed to connect", "invalid option", and "unknown option" as empty (zero entries, nil error) — same pattern as `GetSessionOrder`.

All wrapper functions MUST wrap their context with `context.WithTimeout(ctx, TmuxTimeout)` (10s) consistent with other tmux helpers.

#### Scenario: ListBoards aggregates across servers

- **GIVEN** `ListServers(ctx)` returns `["runkit", "default"]`, `runkit` has 2 entries on board `main` and 1 on `deploy`, `default` has 1 entry on `main`
- **WHEN** `ListBoards(ctx)` is called
- **THEN** the result SHALL be `[{Name: "deploy", PinCount: 1}, {Name: "main", PinCount: 3}]` (alphabetical by name)

#### Scenario: ListBoardEntries treats empty servers as zero entries

- **GIVEN** server `work` has no `@rk_board` option set (tmux returns "invalid option")
- **WHEN** `ListBoardEntries(ctx, "work")` is called
- **THEN** the result SHALL be `([]BoardEntry{}, nil)` (empty, no error)

#### Scenario: Pin appends to existing list

- **GIVEN** `runkit` has `@rk_board = "@1234:main:a"` and window `@5678` exists
- **WHEN** `Pin(ctx, "runkit", "@5678", "main")` is called
- **THEN** `@rk_board` SHALL be updated to `@1234:main:a,@5678:main:b` (or any append-suffix)
- **AND** the function SHALL return nil

#### Scenario: Unpin removes matching entry only

- **GIVEN** `runkit` has `@rk_board = "@1234:main:a,@1234:deploy:a,@5678:main:b"`
- **WHEN** `Unpin(ctx, "runkit", "@1234", "main")` is called
- **THEN** `@rk_board` SHALL be updated to `@1234:deploy:a,@5678:main:b`

#### Scenario: Pinning the same window to the same board is idempotent

- **GIVEN** `runkit` has `@rk_board = "@1234:main:a"`
- **WHEN** `Pin(ctx, "runkit", "@1234", "main")` is called a second time
- **THEN** `@rk_board` SHALL remain unchanged
- **AND** the function SHALL return nil

### Requirement: Window ID stability across `move-window`

The implementation SHALL rely on tmux's documented contract that `move-window` preserves the `window_id` (`@N` form) and only changes the `window_index` (`:N` form). Pinned windows that are moved between sessions on the same tmux server MUST remain pinned without manual intervention.

#### Scenario: move-window preserves pin

- **GIVEN** window `@1234` is pinned to board `main` and lives in session `dev:2`
- **WHEN** the window is moved to session `prod:0` on the same server
- **THEN** `@rk_board` SHALL still contain `@1234:main:<key>`
- **AND** `GET /api/boards/main` SHALL return the entry with the new `session: "prod"`, `window_index: 0`

## Backend: HTTP API

### Requirement: Board endpoints

The router SHALL register five new endpoints (one new file `app/backend/api/boards.go`, route registration in `router.go`):

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/api/boards` | — | `[{name, pinCount}]` (alphabetical by `name`) |
| `GET` | `/api/boards/{name}` | — | `[{server, windowId, session, windowIndex, windowName, orderKey, panes}]` (joined with live window data, sorted by `orderKey`) |
| `POST` | `/api/boards/{name}/pin` | `{"server": "...", "windowId": "@1234"}` | `201 {"ok": true}` |
| `POST` | `/api/boards/{name}/unpin` | `{"server": "...", "windowId": "@1234"}` | `200 {"ok": true}` |
| `POST` | `/api/boards/{name}/reorder` | `{"server": "...", "windowId": "@1234", "before": "@5678" or null, "after": "@9abc" or null}` | `200 {"ok": true, "newOrderKey": "bm"}` |

The reorder endpoint SHALL compute the new order key server-side via `ComputeOrderKey`. The frontend MUST NOT generate keys.

`{name}` in the path SHALL be validated against the board-name regex; invalid names SHALL return `400`.

`server` in the request body SHALL be validated via `validate.ValidateName`. `windowId` SHALL be validated against the window-id regex (`^@\d+$`).

#### Scenario: List boards (empty)

- **GIVEN** no servers have any `@rk_board` entries
- **WHEN** `GET /api/boards` is called
- **THEN** the response status SHALL be `200`
- **AND** the body SHALL be `[]` (not `null`)

#### Scenario: Get board joined with live window data

- **GIVEN** `@1234@runkit` is pinned to board `main` with order_key `a`, window `@1234` is currently in session `dev`, index `2`, named `agent-frontend`
- **WHEN** `GET /api/boards/main` is called
- **THEN** the response SHALL be `[{server: "runkit", windowId: "@1234", session: "dev", windowIndex: 2, windowName: "agent-frontend", orderKey: "a", panes: [...]}]`

#### Scenario: Pin returns 400 on invalid window id

- **GIVEN** the request body is `{"server": "runkit", "windowId": "not-a-window"}`
- **WHEN** `POST /api/boards/main/pin` is called
- **THEN** the response status SHALL be `400`

#### Scenario: Pin returns 404 when window does not exist

- **GIVEN** server `runkit` is reachable but window `@9999` does not exist
- **WHEN** `POST /api/boards/main/pin` is called with that window id
- **THEN** the response status SHALL be `404`
- **AND** `@rk_board` MUST NOT be modified

#### Scenario: Reorder computes key server-side

- **GIVEN** board `main` has entries with order_keys `[a, c]`
- **WHEN** `POST /api/boards/main/reorder` with `{server, windowId: <last>, before: <first-windowId>, after: <last-windowId-other>}` (i.e. moving the last entry between the others)
- **THEN** the response SHALL include `newOrderKey: "b"` (or any string strictly between `a` and `c`)
- **AND** `@rk_board` SHALL reflect the new key for that entry

### Requirement: SSE event extension `board-changed`

The existing per-server SSE stream (`GET /api/sessions/stream`) SHALL be extended with a new event type `board-changed`. The event SHALL be emitted from the SSE hub after a successful pin/unpin/reorder and after a stale-entry cleanup.

Event format:

```
event: board-changed
data: {"board":"main","change":"pin"|"unpin"|"reorder"|"cleanup","server":"runkit","windowId":"@1234","orderKey":"bm"}
```

`orderKey` is present only for `pin` and `reorder` changes, omitted for `unpin` and `cleanup`.

The hub SHALL broadcast the event synchronously after the mutation API call returns success — same pattern as `event: session-order` after `PUT /api/sessions/order`. Frontend clients on any other server MUST also receive the event when subscribed (boards span servers).

#### Scenario: Pin emits board-changed on the source server's SSE stream

- **GIVEN** an SSE client is connected with `?server=runkit`
- **WHEN** `POST /api/boards/main/pin` succeeds for a window on `runkit`
- **THEN** the client SHALL receive `event: board-changed` with `change: "pin"` within 100ms

#### Scenario: Cross-server fan-out on board-changed

- **GIVEN** a frontend is viewing `/board/main` and the board has windows on servers `runkit` and `default`
- **AND** the frontend has opened SSE connections to both `?server=runkit` and `?server=default`
- **WHEN** a pin happens on `default`
- **THEN** the SSE connection for `default` SHALL deliver a `board-changed` event
- **AND** the frontend SHALL refresh the board view via `GET /api/boards/main`

### Requirement: SSE bootstrap parity with session-order

To survive an rk-go restart that left tmux running, the SSE hub SHALL bootstrap the per-server `board-changed` cache on first poll for that server (parity with the `session-order` bootstrap). On the first poll for a server, after fetching session data, the hub SHALL read `@rk_board` and broadcast a synthetic `board-changed` event with `change: "bootstrap"` carrying the current entries snapshot.

> **Note**: This is a deviation from the per-event payload shape — the bootstrap event payload is `{"server":"<name>","change":"bootstrap","entries":[...]}`. Frontend treats this identically to a fresh fetch.

#### Scenario: Bootstrap delivers existing pins after rk restart

- **GIVEN** rk-go was just restarted, tmux server `runkit` has `@rk_board = "@1234:main:a"` from before the restart
- **WHEN** the first SSE client connects to `?server=runkit` and the first poll-tick fires
- **THEN** the client SHALL receive a `board-changed` event with `change: "bootstrap"` containing the entry for `@1234`

## Frontend: Route and Page

### Requirement: New route `/board/$name`

`app/frontend/src/router.tsx` SHALL register a new route `/board/$name` peer to `/$server` (i.e., as a child of `rootRoute`, not under `serverLayoutRoute`). The board view spans all servers, so it cannot live under `/$server`.

Route component: `BoardPage` (new file `app/frontend/src/components/board/board-page.tsx`).

The route SHALL parse `name` from the URL path. If `name` does not match the validation regex, the route component SHALL render `NotFoundPage`.

#### Scenario: Direct navigation to board route

- **GIVEN** the user enters `/board/main` in the URL bar
- **WHEN** the page loads
- **THEN** `BoardPage` SHALL render with the board named `main`

#### Scenario: Invalid name renders NotFoundPage

- **GIVEN** the user enters `/board/foo,bar`
- **WHEN** the page loads
- **THEN** `NotFoundPage` SHALL render

### Requirement: Board page layout

`BoardPage` SHALL preserve the AppShell (sidebar + top bar + bottom bar visible) and render in the main content area:

1. A horizontally-scrollable container holding pane "cards" laid out left-to-right in `orderKey`-sorted order
2. Each card has a default width of **480px**, may be drag-resized between **280px (min)** and **viewport-minus-sidebar (max)**, and fills the available height
3. Each card contains:
   - A pane header with `<window-name> · <server>` (compact, server tag necessary because boards span servers) and an unpin button
   - A live xterm via the existing `TerminalClient` wired to a WebSocket targeting `?server=<entry.server>` (each pane has its own WebSocket connection)
4. Empty board state (`name` exists in URL but `GET /api/boards/{name}` returns `[]` after a successful fetch): show the message "No panes pinned to this board yet. Pin a window from the sidebar."
5. Non-existent board (`GET /api/boards/{name}` returns the board name in the list but with zero entries — impossible per "no empty boards" — OR the route name is not in the boards list): show "This board has no pinned windows." and a link back to `/`. (The two cases are functionally identical to the user.)

#### Scenario: Board with pins renders one card per entry

- **GIVEN** board `main` has 3 pinned windows on the same server
- **WHEN** the user navigates to `/board/main`
- **THEN** the main content area SHALL render 3 pane cards in order_key order
- **AND** each card SHALL contain a live xterm connected to the corresponding session/window

#### Scenario: Empty / non-existent board

- **GIVEN** there is no entry for board `foo` anywhere
- **WHEN** the user navigates to `/board/foo`
- **THEN** the page SHALL render the empty state with a link back to `/`

### Requirement: Drag-to-resize per-pane width

Each pane card SHALL have a draggable right-edge resize handle. While dragging:

- The pane's width updates live
- The width is clamped to the range `[280, viewport-minus-sidebar]`
- On drag end, the new width is persisted to `localStorage` under key `runkit:board-widths:<board-name>` as part of a `Record<window_id, number>` JSON object

On mount, the page SHALL read `localStorage["runkit:board-widths:<board-name>"]` and apply each persisted width to its corresponding pane (matching by `window_id`). Missing entries SHALL fall back to the 480px default. Malformed JSON SHALL fall back to defaults silently (best-effort read).

#### Scenario: Resize persists per-board

- **GIVEN** the user drags pane `@1234`'s right edge to width 600px on board `main`
- **WHEN** the user navigates away and back to `/board/main`
- **THEN** pane `@1234` SHALL render at width 600px

#### Scenario: Resize is per-board (different boards have separate widths)

- **GIVEN** `@1234` is pinned to both `main` and `deploy`, with widths `main: 600`, `deploy: 480`
- **WHEN** the user navigates between the two boards
- **THEN** the pane SHALL render at 600px on `main` and 480px on `deploy`

#### Scenario: Drag-to-resize disabled on coarse-pointer (mobile)

- **GIVEN** the device is detected as coarse-pointer (mobile/touch)
- **WHEN** the user views `/board/main`
- **THEN** no resize handle SHALL be visible (mobile uses single-pane carousel; resize is meaningless)

### Requirement: Mobile single-pane swipe carousel

When the viewport is below the `sm:` breakpoint (640px), `BoardPage` SHALL render a single-pane swipe carousel:

- One pane fills the viewport width
- Horizontal swipe (touch) cycles to the next/previous pane in `orderKey` order
- A small pagination dot strip SHALL indicate the current pane index
- Off-screen panes SHALL pause their WebSocket (close the connection); on swipe-in, the WebSocket SHALL be re-opened and the terminal SHALL re-attach

The breakpoint SHALL match the existing `min-width: 640px` convention used elsewhere in the project (per `context.md` mobile responsive design notes).

#### Scenario: Swipe cycles panes

- **GIVEN** the user is on a 375px viewport viewing board `main` with 3 pinned panes
- **WHEN** the user swipes left
- **THEN** the carousel SHALL advance to pane index 2 (1-based)
- **AND** the WebSocket for pane index 1 SHALL close; the WebSocket for pane index 2 SHALL open

#### Scenario: Pagination indicator shows position

- **GIVEN** the user is on the second of 3 panes
- **WHEN** the carousel renders
- **THEN** the pagination strip SHALL show 3 dots with the second highlighted

### Requirement: Click-to-focus and keyboard cycling

- Clicking a pane card SHALL transfer keyboard focus to its xterm
- `Cmd+]` (mac) / `Ctrl+]` (other) SHALL cycle focus to the next pane in `orderKey` order
- `Cmd+[` / `Ctrl+[` SHALL cycle focus to the previous pane in `orderKey` order
- Hover-to-focus SHALL be off (no hover handler attached in v1)
- The focused pane SHALL have a distinct visual indicator (e.g., colored border or glow); unfocused panes SHALL be visibly de-emphasized
- Keyboard input from the user MUST only reach the focused pane (xterm-level, naturally enforced)

#### Scenario: Click focuses

- **GIVEN** the board has 3 panes, pane 1 is focused
- **WHEN** the user clicks pane 3
- **THEN** pane 3 SHALL receive focus and pane 1 SHALL lose it
- **AND** subsequent keystrokes SHALL go to pane 3's xterm

#### Scenario: Cmd+] cycles forward, wrapping

- **GIVEN** the board has 3 panes, pane 3 is focused
- **WHEN** the user presses `Cmd+]`
- **THEN** focus SHALL move to pane 1 (wrap)

## Frontend: Top Bar

### Requirement: Board breadcrumb mode

When the user is on `/board/<name>`, the existing top bar's breadcrumb area SHALL replace the session/window breadcrumb with `Board ▸ <name> ▾`. The `▾` SHALL open a dropdown listing:

- `← Sessions` — navigates to `/` (server list)
- One entry per other existing board → navigates to `/board/<other-name>`

The `(current)` suffix SHALL appear next to the active board name.

Connection status, FixedWidthToggle, and command palette trigger remain unchanged.

The breadcrumb dropdown component already exists (`breadcrumb-dropdown.tsx`) — this requirement modifies `top-bar.tsx` to detect the board route and pass board-mode props.

#### Scenario: Breadcrumb dropdown lists other boards

- **GIVEN** the user is on `/board/main` and boards `main`, `deploy`, `staging` exist
- **WHEN** the user clicks `▾`
- **THEN** the dropdown SHALL show `← Sessions`, `deploy`, `staging` (no `main`, since it's current)

## Frontend: Sidebar

### Requirement: Boards section

A new component `app/frontend/src/components/sidebar/boards-section.tsx` SHALL render above the existing sessions section.

Visibility rules:

- **Hidden entirely** when `useBoards()` returns zero boards
- **Visible** as soon as the first board materializes (first pin)
- One-line hint "Pin a window to start a board" SHALL appear within the section *only* when:
  1. The user is currently on `/board/<name>` AND
  2. The hint is for an empty-board state (e.g., the user just unpinned the last window of the active board mid-session — the section becomes empty but the user is already on the route). In all other "zero boards" cases, the section is hidden entirely.

Each row in the section:

- Board name (left-aligned, truncate with ellipsis if too long)
- Pin count (right-aligned, muted)
- Active state — when current route is `/board/<name>`, the row SHALL have a highlighted background

Click on a row SHALL navigate to `/board/<name>`.

#### Scenario: Hidden when no boards exist

- **GIVEN** all servers return zero board entries
- **WHEN** the sidebar renders
- **THEN** no Boards section SHALL be present in the DOM

#### Scenario: Visible after first pin

- **GIVEN** zero boards exist, user pins a window
- **WHEN** the SSE event arrives
- **THEN** the Boards section SHALL appear with one row

#### Scenario: Hint shown when active board becomes empty

- **GIVEN** the user is on `/board/main` and `main` had one window
- **WHEN** the user unpins that window
- **THEN** `main` is removed from `useBoards()`
- **AND** the sidebar SHALL show the hint "Pin a window to start a board" (because the user is on the now-vanished board route)

### Requirement: Pin icon on window rows

`window-row.tsx` SHALL gain a pin icon button. Behavior:

- Hover-revealed (matching existing icon-on-hover pattern in the sidebar)
- **Filled** (different visual) when the window is pinned to ANY board; outline when not pinned
- Click opens a small popover with:
  - One row per existing board → click pins the window to that board (or unpins, if already pinned)
  - Inline text input "Pin to new board…" → on Enter, validates the name and pins (creating the board)

Validation errors SHALL be surfaced inline in the popover (e.g., "Board name must be alphanumeric, hyphen, or underscore").

#### Scenario: Pin icon filled when pinned to any board

- **GIVEN** window `@1234` is pinned to board `deploy`
- **WHEN** the sidebar renders
- **THEN** the pin icon for `@1234` SHALL be in the filled state

#### Scenario: Pin to new board via inline input

- **GIVEN** the popover is open and no boards exist
- **WHEN** the user types `experiments` and presses Enter
- **THEN** `POST /api/boards/experiments/pin` SHALL be called
- **AND** the popover SHALL close
- **AND** the Boards section SHALL show `experiments` after the SSE arrives

### Requirement: Active-board highlight in Sessions tree

When the user is on `/board/<name>`, `window-row.tsx` SHALL apply a subtle highlight (e.g., colored left border or background tint) to windows pinned **to the current board only**. Pins to other boards SHALL NOT trigger the highlight. The pin icon's filled state remains independent (reflects "pinned to ANY board").

#### Scenario: Highlight scoped to current board

- **GIVEN** `@1234` is pinned to `main` and `@5678` is pinned to `deploy` and `main`
- **AND** the user is on `/board/main`
- **WHEN** the sidebar renders
- **THEN** both `@1234` and `@5678` SHALL have the highlight (both are pinned to `main`)

#### Scenario: No highlight on non-board route

- **GIVEN** `@1234` is pinned to `main`
- **AND** the user is on `/runkit/dev/0`
- **WHEN** the sidebar renders
- **THEN** `@1234` SHALL NOT have the highlight (no current board)

## Frontend: Command Palette

### Requirement: New `Board:` prefix in palette

The palette construction in `app.tsx` SHALL gain a new `boardActions: PaletteAction[]` `useMemo` block, mirroring the structure of `serverActions`. The block SHALL be folded into `paletteActions` between `windowActions` and `viewActions`:

```ts
const paletteActions = useMemo(
  () => [...sessionActions, ...windowActions, ...boardActions, ...viewActions, ...themeActions, ...configActions, ...serverActions, ...terminalActions],
  [...]
);
```

Entries:

| Entry label | Visibility | Action |
|---|---|---|
| `Board: Switch to <name>` (one per board, append `(current)` when on that board) | Always | Navigate to `/board/<name>` |
| `Board: Pin Current Window` | Only when on `/$server/$session/$window` | Open the same picker popover used by the sidebar pin icon |
| `Board: Unpin Current Window` | Only when current window is pinned to ≥1 board | If pinned to 1 board: unpin directly. If pinned to ≥2: open a small picker for which board(s) to unpin from |
| `Board: Leave Board View` | Only when on `/board/<name>` | Navigate to last viewed window route, or `/` if none |
| `Board: Cycle Pane Focus →` | Only when on `/board/<name>` and ≥1 pane | Same as `Cmd+]` |
| `Board: Cycle Pane Focus ←` | Only when on `/board/<name>` and ≥1 pane | Same as `Cmd+[` |

**Excluded from v1**: `Board: Reorder Pane` — deferred to v1.1 (intake §7).

Conventions:

- Sentence-case after the colon (e.g., `Board: Pin Current Window`)
- Append `(current)` to the active board's switch entry
- No `…` ellipsis (matches existing palette pattern observed in `app.tsx:540-833`)
- Conditional entries use the `...(condition ? [...] : [])` spread pattern
- Dynamic per-board entries use `...boards.map(...)` (matches `serverActions`)

#### Scenario: Switch-to entries one per board

- **GIVEN** boards `main`, `deploy`, `staging` exist and the user is on `/board/main`
- **WHEN** the palette opens
- **THEN** the actions list SHALL include three entries: `Board: Switch to main (current)`, `Board: Switch to deploy`, `Board: Switch to staging`

#### Scenario: Pin Current Window action only on window route

- **GIVEN** the user is on `/`
- **WHEN** the palette opens
- **THEN** `Board: Pin Current Window` SHALL NOT appear in the actions list

#### Scenario: Cycle Pane Focus only on board route

- **GIVEN** the user is on `/runkit/dev/0`
- **WHEN** the palette opens
- **THEN** `Board: Cycle Pane Focus →` and `Board: Cycle Pane Focus ←` SHALL NOT appear

## Frontend: Hooks and API client

### Requirement: `useBoards()` hook

A new hook `app/frontend/src/hooks/use-boards.ts` SHALL expose the list of boards aggregated across servers. The hook subscribes to all server SSE streams (one per server returned by `listServers`) and updates on `board-changed` events from any of them. Initial fetch via `GET /api/boards` on mount.

Return shape: `{boards: Array<{name: string, pinCount: number}>, isLoading: boolean, error: Error | null}`.

The hook SHALL deduplicate concurrent SSE-driven re-fetches via a debounce (50ms) — multiple cross-server `board-changed` events arriving within the debounce window trigger a single `GET /api/boards`.

#### Scenario: Hook re-fetches on board-changed event

- **GIVEN** a component is mounted and renders boards via `useBoards()`
- **WHEN** an SSE `board-changed` event arrives on any server
- **THEN** the hook SHALL re-fetch `GET /api/boards` and update the returned `boards` value

### Requirement: `useBoardEntries(name)` hook

A new hook (in the same file or a sibling) SHALL fetch and live-update entries for a specific board: `GET /api/boards/<name>` plus subscription to SSE on every server contributing entries.

Return shape: `{entries: BoardEntry[], isLoading, error}`.

#### Scenario: Hook updates on cross-server pin

- **GIVEN** the user is on `/board/main`, `main` has entries on `runkit` only
- **WHEN** a pin to `main` happens on server `default`
- **THEN** the hook SHALL receive the SSE event on the `default` stream and re-fetch
- **AND** the new entry SHALL appear in `entries`

### Requirement: API client functions

`app/frontend/src/api/client.ts` (or a new `app/frontend/src/api/boards.ts`) SHALL export typed functions:

```ts
function listBoards(): Promise<{name: string; pinCount: number}[]>;
function getBoard(name: string): Promise<BoardEntryWithLiveData[]>;
function pinWindow(server: string, windowId: string, board: string): Promise<{ok: true}>;
function unpinWindow(server: string, windowId: string, board: string): Promise<{ok: true}>;
function reorderPin(
  server: string,
  windowId: string,
  board: string,
  before: string | null,
  after: string | null,
): Promise<{ok: true; newOrderKey: string}>;
```

Functions that operate on a specific server (`pinWindow`, `unpinWindow`, `reorderPin`) SHALL take `server` as the **first positional argument** to match the server-routing contract documented in `tmux-sessions.md` § Frontend Server Routing Contract. Functions that aggregate across servers (`listBoards`, `getBoard`) do NOT take `server`.

GET functions SHALL go through `deduplicatedFetch`; mutations SHALL use plain `fetch`.

#### Scenario: pinWindow signature matches server-routing contract

- **GIVEN** the implementation
- **WHEN** any call site invokes `pinWindow(...)`
- **THEN** the first argument MUST be `server: string`
- **AND** the URL constructed MUST NOT use `withServer` (server is in the body, not the query, since `/api/boards/{name}/pin` is not server-scoped at the route level)

> **Note**: The pin/unpin/reorder endpoints place `server` in the request body rather than a query param because the operation is conceptually "modify board X's membership"; the board itself is server-aggregated. The `server` field in the body identifies which server's `@rk_board` to mutate.

## SSE Hub Integration

### Requirement: Eager cleanup on window kill

The SSE hub poll-tick (`app/backend/api/sse.go`) SHALL detect window kills (a `window_id` present in the previous tick's `ListWindows` result that is absent in the current tick). For each killed `window_id` that has a matching entry in `@rk_board` on that server, the hub SHALL:

1. Remove the entry from `@rk_board`
2. Broadcast `event: board-changed` with `change: "cleanup"` to all SSE clients on that server

This logic MUST live in the existing `poll()` function, alongside the `session-order` bootstrap and metrics broadcast.

#### Scenario: Window killed externally → board cleaned up

- **GIVEN** window `@1234` on server `runkit` is pinned to board `main`
- **AND** an SSE client is connected to `?server=runkit`
- **WHEN** the user kills `@1234` from a tmux command line (outside run-kit)
- **THEN** within one poll-tick (≤ 2.5s), the `runkit` `@rk_board` SHALL no longer contain `@1234`
- **AND** the SSE client SHALL receive `event: board-changed` with `change: "cleanup", windowId: "@1234"`

## Constitution Alignment

### Requirement: Constitution compliance

The implementation SHALL satisfy:

- **II (No Database)** — pin state lives only in tmux server-scoped options + browser `localStorage` for view widths. No database imports, no migrations, no persistent state files
- **IV (Minimal Surface Area)** — adds exactly one new route (`/board/$name`); no settings or admin pages
- **V (Keyboard-First)** — every new action reachable via keyboard:
  - Pin/unpin via command palette (`Cmd+K` → `Board: Pin Current Window` / `Board: Unpin Current Window`)
  - Switch boards via command palette (`Board: Switch to <name>`) and breadcrumb dropdown (keyboard accessible)
  - Pane focus cycle via `Cmd+[` / `Cmd+]`
  - Leave board view via `Board: Leave Board View`
- **VI (Tmux Sessions Survive Server Restarts)** — pin state persists with the tmux server; rk-go restart preserves state via the SSE bootstrap (parity with `@rk_session_order`)
- **VII (Convention Over Configuration)** — no new env vars, no new config files

#### Scenario: rk-go restart preserves pins

- **GIVEN** boards `main` and `deploy` exist with pinned windows on `runkit`
- **WHEN** the rk-go process is killed and restarted (tmux server is left running)
- **THEN** after the first SSE poll-tick, all clients SHALL receive bootstrap `board-changed` events with the existing entries
- **AND** the boards UI SHALL be fully populated

#### Scenario: Tmux server restart loses pins (acceptable)

- **GIVEN** boards exist on `runkit`
- **WHEN** the tmux server is killed (`tmux kill-server`)
- **THEN** all boards on that server SHALL vanish — this is expected behaviour per Constitution VI (state survives only as long as the tmux server)

## Design Decisions

1. **Route placement under root, not under `/$server`** — chosen approach: `/board/$name` is a child of `rootRoute`, peer to `/$server`.
   - *Why*: Boards aggregate windows across servers; placing the route under `/$server` would require either an arbitrary "primary server" choice or a redirect at navigation time, both worse than a top-level route. Bookmark-stable URLs are preserved.
   - *Rejected*: `/$server/board/$name` — would scope the board route to a single server, contradicting the cross-server aggregation that motivates the feature.

2. **`server` in pin/unpin request body, not query param** — chosen approach: identify the source server in the request body.
   - *Why*: The endpoint `/api/boards/{name}/pin` is conceptually a board-level resource (the board aggregates servers); putting `server` in the URL would either duplicate it from the body or require a different route shape (`/api/{server}/boards/...`) inconsistent with the aggregate `/api/boards` listing.
   - *Rejected*: `?server=` query param — inconsistent with the aggregate read endpoints that don't take `server`.

3. **`event: board-changed` reuses the existing per-server SSE stream** — chosen approach: extend the existing stream rather than introducing a new endpoint.
   - *Why*: Per `tmux-sessions.md`, the project's pattern for cross-server features is "open multiple per-server SSE connections"; introducing a new endpoint would duplicate connection management and contradict the existing pattern.
   - *Rejected*: New endpoint `/api/boards/stream` — adds a route, requires separate hub plumbing, and breaks the established pattern.

4. **Field separator `:` and entry separator `,` in `@rk_board`** — chosen approach: `,` between entries, `:` within entries.
   - *Why*: tmux option values treat whitespace specially; `:` and `,` are unambiguous and don't collide with `@`-prefixed window IDs or alphanumeric/hyphen/underscore board names. Mirrors the lightweight encoding pattern in similar features (no JSON to keep tmux read paths simple — JSON is reserved for richer values like `@rk_session_order` which carries a full array of strings).
   - *Rejected*: JSON — overkill for the entry format; harder to read in `tmux show-option` output during debugging.
   - *Rejected*: Tab `\t` — risky inside tmux option values.

5. **Lazy + eager stale cleanup** — chosen approach: belt-and-suspenders.
   - *Why*: Lazy alone misses cleanup when a board is rendered rarely; eager alone misses cleanup when no SSE poller is active. Both together cover all paths at minimal cost (write-back is cheap and idempotent).
   - *Rejected*: Lazy-only — would leave stale entries until next read.
   - *Rejected*: Eager-only — depends on the SSE poll being active for that server.

6. **Defer `Board: Reorder Pane` palette action to v1.1** — chosen approach: ship reorder via drag interaction only (or directly via API for tests); palette action follows in v1.1.
   - *Why*: Reorder UX (picker-driven) is non-trivial to design; the drag interaction satisfies the keyboard-first constraint indirectly via `Cmd+[`/`Cmd+]` for focus and via the underlying API for power users / scripting. Intake §7 explicitly marks this as deferable.
   - *Rejected*: Ship in v1 with a multi-step picker — adds scope without measurable v1 user value beyond drag.

7. **No new memory file in v1; modifications spread across architecture / tmux-sessions / ui-patterns** — chosen approach: extend three existing files at hydrate time.
   - *Why*: Intake assumption #21 — the boards feature touches storage (tmux-sessions), API+route (architecture), and UI (ui-patterns). A standalone `board-feature.md` would be smaller than each of those three sections and arbitrarily extracted; staying inline keeps related context together.
   - *Rejected*: New `docs/memory/run-kit/board-feature.md` — defer to a future change if the feature grows.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Storage layer is tmux server-scoped options (`@rk_board`), not browser localStorage | Confirmed from intake #1 — Constitution II requires tmux-derived state | S:95 R:90 A:90 D:95 |
| 2 | Certain | Distributed storage: each tmux server stores membership only for its own windows | Confirmed from intake #2 — aligns with `@rk_session_order` server-scoped pattern | S:95 R:80 A:90 D:90 |
| 3 | Certain | Boards are derived from `@rk_board` membership; no separate `@rk_boards` registry | Confirmed from intake #3 | S:95 R:75 A:90 D:95 |
| 4 | Certain | Empty boards are not supported (board materializes on first pin, vanishes on last unpin) | Confirmed from intake #4 | S:95 R:70 A:90 D:90 |
| 5 | Certain | Columns are visual slots, not state-bearing Kanban columns | Confirmed from intake #5 | S:90 R:80 A:90 D:95 |
| 6 | Certain | Sidebar "Boards" section placed above Sessions section | Confirmed from intake #6 | S:100 R:95 A:100 D:100 |
| 7 | Certain | Active-board pinned windows are subtly highlighted in Sessions tree | Confirmed from intake #7 | S:95 R:95 A:90 D:95 |
| 8 | Certain | Sidebar Boards section uses one-line hint "Pin a window to start a board" only when user is on a now-empty board route; otherwise hide section entirely when zero boards exist | Confirmed from intake #8 — narrowed the trigger condition for the hint to one specific case during spec analysis | S:95 R:95 A:90 D:90 |
| 9 | Certain | New route `/board/$name` placed at root level (peer to `/$server`), not under `/$server/board/...` | Confirmed from intake #9 — spec-stage analysis confirmed the cross-server aggregation requires a top-level route. Rejected `/$server/board/...` (single-server scoping) | S:90 R:60 A:85 D:90 |
| 10 | Certain | Top bar shows board breadcrumb dropdown (`Board ▸ name ▾`) when on a board | Confirmed from intake #10 | S:90 R:80 A:85 D:90 |
| 11 | Certain | Fixed-width panes (480px default) in horizontally-scrollable container | Confirmed from intake #11 | S:90 R:70 A:85 D:90 |
| 12 | Certain | Lexicographic / fractional order keys for cross-server ordering, lowercase a–z only, length 1–16 | Upgraded from intake #12 — narrowed alphabet and length during spec analysis to make validation deterministic | S:90 R:70 A:85 D:85 |
| 13 | Certain | Lazy stale-entry cleanup at read time + eager cleanup via SSE on window-kill | Confirmed from intake #13 | S:85 R:80 A:80 D:80 |
| 14 | Certain | Concurrent-edit handling is last-write-wins; SSE re-broadcast for reconciliation; v1-acceptable | Confirmed from intake #14 | S:90 R:60 A:80 D:80 |
| 15 | Certain | Field separator `:` and entry separator `,` for `@rk_board` value format | Confirmed from intake #15 | S:95 R:70 A:80 D:75 |
| 16 | Certain | Pin entry points: sidebar icon, command palette, board pane header (no right-click) | Confirmed from intake #16 | S:95 R:80 A:75 D:75 |
| 17 | Certain | Click-to-focus + `Cmd+[`/`Cmd+]` keyboard cycling; hover-to-focus off | Confirmed from intake #17 | S:95 R:85 A:80 D:75 |
| 18 | Certain | Each pane is an independent live xterm with its own WebSocket relay | Confirmed from intake #18 | S:95 R:80 A:85 D:80 |
| 19 | Certain | Backend exposes `/api/boards`, `/api/boards/{name}`, `/api/boards/{name}/{pin,unpin,reorder}` | Confirmed from intake #19 | S:95 R:75 A:80 D:75 |
| 20 | Certain | New Go file `internal/tmux/board.go` for option I/O + parsing; new `api/boards.go` for HTTP | Confirmed from intake #20 | S:95 R:80 A:85 D:80 |
| 21 | Certain | No new memory file in v1; modifications spread across architecture / tmux-sessions / ui-patterns | Confirmed from intake #21 | S:95 R:80 A:75 D:70 |
| 22 | Certain | Default pane width 480px, minimum 280px | Confirmed from intake #22 | S:95 R:75 A:60 D:65 |
| 23 | Certain | Drag-to-resize per-pane width is in v1; widths persisted per-board in browser localStorage key `runkit:board-widths:<board-name>` | Confirmed from intake #23 | S:95 R:80 A:65 D:55 |
| 24 | Certain | Hover-to-focus is OFF by default in v1 | Confirmed from intake #24 | S:95 R:90 A:60 D:55 |
| 25 | Certain | Mobile layout: single-pane swipe carousel | Confirmed from intake #25 | S:95 R:70 A:55 D:55 |
| 26 | Certain | Mobile carousel: pin order = swipe order; off-screen panes pause WebSocket and resume on swipe-in | Confirmed from intake #26 | S:95 R:60 A:55 D:55 |
| 27 | Certain | Board name validation: alphanumeric + hyphens + underscores, length 1–32 | Confirmed from intake #27 | S:95 R:75 A:75 D:65 |
| 28 | Certain | SSE event shape: extend existing per-server stream with `board-changed` events carrying `{board, change, server, windowId, orderKey?}` | Confirmed from intake #28 — event name uses kebab-case (`board-changed`) for consistency with `event: session-order` already in the codebase | S:95 R:70 A:70 D:60 |
| 29 | Certain | Pane header content: `<window-name> · <server>` | Confirmed from intake #29 | S:95 R:90 A:65 D:65 |
| 30 | Certain | Command palette gets new `Board:` prefix with `Switch to <name>`, `Pin Current Window`, `Unpin Current Window`, `Leave Board View`, `Cycle Pane Focus →/←` (Reorder Pane deferred to v1.1) | Confirmed from intake #30 — narrowed v1 scope by deferring Reorder Pane palette action per intake §7 ("Defer to v1.1 if scope-pressured") | S:95 R:80 A:90 D:85 |
| 31 | Certain | SSE bootstrap broadcast on first poll for each server (parity with `session-order`) so rk-go restart with tmux still running preserves the boards UI | New (spec-level): mirrors the existing pattern documented in tmux-sessions.md § Server-Scoped User Options for `@rk_session_order`. Without this, an rk-go restart would render the boards UI empty until a mutation fires | S:95 R:65 A:90 D:85 |
| 32 | Certain | Pin/unpin idempotency: re-pinning the same window to the same board is a no-op | New (spec-level): standard idempotency for distributed last-write-wins systems; prevents duplicate entries from re-tries | S:95 R:80 A:90 D:90 |
| 33 | Certain | Pin endpoint returns 404 when target window does not exist on the named server | New (spec-level): consistent with how `selectWindow` and other window-mutation endpoints surface "no such window" — avoids creating orphan entries | S:90 R:75 A:85 D:80 |
| 34 | Certain | `event: board-changed` uses kebab-case to match existing `event: session-order` | New (spec-level): consistency with the established SSE event-naming convention in `sse.go` | S:100 R:90 A:95 D:95 |
| 35 | Certain | API client `pinWindow`/`unpinWindow`/`reorderPin` take `server` as the first positional argument per the project's server-routing contract | New (spec-level): explicit reaffirmation of `tmux-sessions.md` § Frontend Server Routing Contract — server is in the body, but the function signature still leads with `server` to match the established pattern | S:95 R:85 A:95 D:90 |

35 assumptions (35 certain, 0 confident, 0 tentative, 0 unresolved).
