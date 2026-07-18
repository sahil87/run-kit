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
  `rk-test-e2e` with two named windows (`win-a`, `win-b`); `afterAll` kills it.
- A unique board name (`flow<digits>` / `pal<digits>`) is used per run so
  reruns don't collide on the persistent tmux server.
- The hover-reveal pin-icon + popover gestures (cold-start `main` prefill,
  empty-Enter-to-last-used, ordering) are exercised deterministically by unit
  tests around `PinPopover`, `usePinActions`, `last-pinned-board`, and
  `palette-pin`; these e2e tests focus on the end-to-end integration paths
  (real backend POST + toast navigation) that unit tests can't cover.

## Tests

### `pin a window via the API, navigate to the board, unpin`

**What it proves:** Pinning a real tmux window through the HTTP API moves
the system into a state where (1) `GET /api/boards` lists the new board,
(2) `/board/<name>` renders the pinned window's pane header inside a
full-viewport-height shell (regression guard: a missing `h-full` on the
board page's wrapper collapses the Shell grid to content height), and (3)
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
6. Assert the bottom bar (`footer`) sits at the viewport bottom — the
   Shell fills the full height (Shell is `height: 100%`, so the board
   wrapper must carry `h-full`).
7. Click the pane-header `Unpin…` button.
8. Poll `GET /api/boards` until the board disappears from the listing
   (empty boards are removed per spec — `Empty board cannot exist`).

### `palette 'Pin: Current Window to <board>' pins directly and shows the View board toast`

**What it proves:** The command-palette direct-pin action
(`lib/palette-pin.ts`, wired into AppShell `boardActions`) pins the current
window to an existing board without opening the popover, the successful pin
surfaces the `Pinned to <board>` toast with a `View board` action
(`use-pin-actions` + toast `action` support), the pin lands server-side, and
the `View board` action navigates to `/board/<board>`.

**Steps:**

1. Pre-create the board by POSTing `/api/boards/<board>/pin` for `win-a`
   (so it is an existing direct-pin candidate).
2. Resolve `win-b`'s `@N` id and navigate to its terminal route
   (`/<server>/<winB>`) so the palette's current window is `win-b` (not yet
   pinned to `<board>`, so the direct-pin entry is offered).
3. Open the palette (`Meta+k`), fill `Pin: Current Window to <board>`, wait
   for the filtered option to render (the entry exists only once the boards
   fetch and window context resolve — pressing Enter earlier is a silent
   no-op), then press Enter.
4. Assert the `Pinned to <board>` toast appears.
5. Click `View board` immediately (within the toast's 4s auto-dismiss
   window) and assert the URL becomes `/board/<board>`.
6. Poll `GET /api/boards/<board>` until `win-b`'s id is among the entries
   (the direct pin landed server-side).
7. Cleanup: unpin `win-a` and `win-b` from `<board>`.
