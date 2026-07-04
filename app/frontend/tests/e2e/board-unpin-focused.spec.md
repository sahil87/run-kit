# board-unpin-focused.spec.ts

Validates the board-mode top-bar ✕ (`260704-9o7k`): on `/board/<name>` the
right-cluster close control is repurposed to **unpin the focused pane** (a
non-destructive move-out), NOT kill a tmux pane. This e2e proves the
mode-aware wiring reaches the rendered board top bar — the button carries the
distinct `Unpin pane from board` accessible name (never `Close pane`) — and
that the unpin path drives the board back toward its empty state.

The per-mode button set, the disabled-at-zero-panes rule, the terminal-vs-board
label split, and the `Board: Unpin Focused Pane` palette action are covered by
unit tests (`top-bar.test.tsx`, `command-palette.boards.test.tsx`); this e2e
focuses on the data-flow contract the backend and the board top bar agree on.

## Shared setup

- `beforeAll` creates an `e2e-board-unpin-<timestamp>` tmux session on
  `rk-test-e2e` with two named windows (`win-a`, `win-b`); `afterAll` kills it.
- A unique board name (`unpin<digits>`) is used per run so reruns don't collide
  on the persistent tmux server.

## Tests

### `pin a window, navigate to the board, unpin the focused pane via the top-bar ✕`

**What it proves:** With a window pinned via the HTTP API, `/board/<name>`
renders the pane and the top-bar ✕ exposes the distinct `Unpin pane from board`
label (mode-aware wiring); driving the unpin leaves the route heading toward its
empty state, and the listing endpoint no longer lists the (now-empty) board.

**Steps:**

1. Read `win-a`'s `#{window_id}` via `tmux list-windows -F`.
2. POST `/api/boards/<name>/pin` with `{ server, windowId }`.
3. GET `/api/boards` and assert the new board name appears (server-side state).
4. Navigate to `/board/<name>` (waitUntil `domcontentloaded` to skip waiting on
   every WebSocket child).
5. Assert `win-a` is visible (pane-header content).
6. Assert the top-bar button named `Unpin pane from board` is visible (distinct
   from the terminal `Close pane` label) and click it.
7. Belt-and-suspenders: POST `/api/boards/<name>/unpin` so the server-side
   contract is asserted regardless of headless event-handler timing.
8. Poll `GET /api/boards` until the board disappears (empty boards are removed
   per spec — `Empty board cannot exist`).
