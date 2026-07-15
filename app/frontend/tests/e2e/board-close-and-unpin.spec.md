# board-close-and-unpin.spec.ts

Validates the board pane-management controls after `260715-6jwn` (which
reworked `board-unpin-focused.spec.ts`): on `/board/<name>` the **tile-header**
pin glyph is the unpin affordance (a non-destructive move-out), while the
**top-bar ✕** is now a real close-pane (a tmux kill), uniform with terminal
mode — a deliberate reversal of the earlier board-✕-unpin behavior. These e2e
tests prove both data-flow contracts the backend and the board UI agree on:

1. The tile-header unpin button (`Unpin <window> from board`) drives
   `POST /api/boards/<name>/unpin`.
2. The top-bar ✕ carries the `Close pane` label (never `Unpin pane from board`)
   and drives `POST /api/windows/<id>/close-pane`; a single-pane tile then
   self-heals away (frontend refetch, since a window-killing kill emits no
   `board-changed` event) and the emptied board vanishes from the listing.

The per-mode button set, the disabled-at-no-focused-tile rule, the board
SplitButtons, the pin-glyph rendering, and the `Board: Split/Close/Unpin Focused
Pane` palette actions are covered by unit tests (`top-bar.test.tsx`,
`board-header.test.tsx` — the pin/unpin SVG-glyph render + no-drag/stopPropagation
contract, `command-palette.boards.test.tsx`); this e2e focuses on the
click → HTTP → board-state contract.

## Shared setup

- `beforeAll` creates an `e2e-board-close-<timestamp>` tmux session on
  `rk-test-e2e` with two named windows (`win-a`, `win-b`); `afterAll` kills it.
- Each test uses a fresh board name (`unpin<digits>` / `close<digits>`) so
  reruns don't collide on the persistent tmux server.
- `windowId(name)` reads a window's `#{window_id}` via `tmux list-windows -F`.

## Tests

### `the per-tile header pin glyph unpins the focused pane (POST /unpin), emptying the board`

**What it proves:** With `win-a` pinned via the HTTP API, `/board/<name>`
renders the tile and the tile-header unpin button exposes the per-window
`Unpin win-a from board` label; clicking it drives the click-triggered
`POST /api/boards/<name>/unpin` (no redundant API unpin masks a broken click),
and the now-empty board is dropped from `GET /api/boards`.

**Steps:**

1. Pin `win-a` via `POST /api/boards/<board>/pin`.
2. Navigate to `/board/<board>` (waitUntil `domcontentloaded`).
3. Assert `win-a` is visible (tile-header content).
4. Assert the tile-header button named `Unpin win-a from board` is visible.
5. Arm a `waitForRequest` for the click-triggered `POST /api/boards/<board>/unpin`,
   click the header unpin glyph, and await that request.
6. Poll `GET /api/boards` until the board disappears (empty boards are removed).

### `the top-bar ✕ closes the focused tile's pane (POST /close-pane); the single-pane tile self-heals away and the board vanishes`

**What it proves:** With `win-b` pinned, the board top-bar ✕ carries the
terminal `Close pane` label (never `Unpin pane from board` — the mode-aware
reversal); clicking it drives the click-triggered
`POST /api/windows/<id>/close-pane`. Killing the single pane kills the window,
collapsing the pin-session with no `board-changed` event, so ONLY the board
page's own `onPaneClosed`→`refetch` re-render can drop the dead tile — the test
asserts the tile disappears from the DOM (empty-state appears) to exercise that
self-heal wiring directly, then confirms the emptied board also vanishes from
the server listing.

**Steps:**

1. Pin `win-b` via `POST /api/boards/<board>/pin` (single-window pin — its one
   pane's kill kills the window, the self-heal path).
2. Navigate to `/board/<board>` and assert `win-b` is visible.
3. Assert NO `Unpin pane from board` button exists and the `Close pane` ✕ is
   visible (mode-aware wiring reversal).
4. Arm a `waitForRequest` for the click-triggered
   `POST /api/windows/<id>/close-pane`, click the ✕, and await that request.
5. Assert the `win-b` tile disappears from the DOM (`toHaveCount(0)`) and the
   `No panes pinned to this board yet.` empty-state becomes visible — the
   load-bearing self-heal-refetch assertion (fails if the `onPaneClosed`→refetch
   seam is deleted, unlike the server-derived poll below).
6. Poll `GET /api/boards` until the board disappears (server-side truth: empty
   board removed per spec — `Empty board cannot exist`).
