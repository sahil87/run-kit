# boards-pin-flow.spec.ts

Validates the end-to-end pin lifecycle: pinning a real tmux window via the
HTTP API surfaces it in the listing endpoint and on the `/board/<name>`
page; the pane-header unpin button removes the entry, leaving the page in
the empty-state.

The hover-reveal pin icon + popover gesture is exercised by unit tests
around `WindowRow`, `PinPopover`, and the API client (`useBoards`,
`useBoardEntries`); this e2e focuses on the data-flow contract that the
backend and frontend agree on.

## Shared setup

- `beforeAll` creates an `e2e-board-pin-<timestamp>` tmux session on
  `rk-e2e` with two named windows (`win-a`, `win-b`); `afterAll` kills it.
- A unique board name (`flow<digits>`) is used per run so reruns don't
  collide on the persistent tmux server.

## Tests

### `pin a window via the API, navigate to the board, unpin`

**What it proves:** Pinning a real tmux window through the HTTP API moves
the system into a state where (1) `GET /api/boards` lists the new board,
(2) `/board/<name>` renders the pinned window's pane header, and (3)
clicking the pane-header unpin button leaves the route on its empty-state
copy.

**Steps:**

1. Read `win-a`'s `#{window_id}` via `tmux list-windows -F`.
2. POST `/api/boards/<name>/pin` with `{ server, windowId }`.
3. GET `/api/boards` and assert the new board name appears in the list
   (the server-side state is correct).
4. Navigate directly to `/board/<name>` (waitUntil `domcontentloaded` to
   skip waiting for every WebSocket child to settle).
5. Assert `win-a` is visible (pane-header content).
6. Click the pane-header `Unpin…` button.
7. Poll `GET /api/boards` until the board disappears from the listing
   (empty boards are removed per spec — `Empty board cannot exist`).
