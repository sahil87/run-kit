# board-reorder.spec.ts

Behavioural contract for the board pane reorder backend surface as consumed by
the new frontend wiring: the fractional-index `POST /api/boards/{name}/reorder`
endpoint (moves a pinned pane by minting an orderKey strictly between its new
`before`/`after` neighbours), the reordered `GET /api/boards/{name}` result
(entries sorted by orderKey), and the per-server `event: board-changed` SSE
broadcast (`change: "reorder"`) that `useBoardEntries` refetches on with a 50ms
debounce to reconcile the optimistic drag override.

## Why this slice (not a drag simulation)

The frontend reorder is wired two ways — header drag-and-drop and the palette
Move Focused Pane Left/Right — but both converge on ONE `reorderPin` POST
carrying the moved pane's new neighbour windowIds. Native HTML5 drag is
unreliable to simulate in Playwright (the analogous `session-reorder` drag spec
has never passed and is `test.fixme`), and `page.reload()` does not commit under
the SPA's long-lived SSE connection, so a "drag then reload and assert order"
e2e cannot be made deterministic. This spec therefore exercises the load-bearing
surface the wiring drives — the reorder endpoint, the reordered GET, and the
`board-changed` SSE echo — end-to-end against the live backend, which IS
deterministic. The neighbour arithmetic (`computeReorderNeighbors` /
`computeMoveNeighbors`), the custom-MIME guard, the insert-before splice, and
the derive-over-store reconcile are covered by Vitest unit tests
(`board-reorder.test.ts`, `use-board-pane-reorder.test.ts`).

## Shared setup

- `beforeAll` creates a fresh tmux session `e2e-board-reorder-<ts>` on
  `E2E_TMUX_SERVER` (default `rk-test-e2e`) with two windows, `win-a` and
  `win-b` (a `new-session -n win-a` + a `new-window -n win-b`).
- `afterAll` kills that home session (`kill-session -t <session>`). NOTE this
  does NOT reap the windows' pin-sessions: pinning MOVES each window OUT of the
  home session into its own `_rk-pin-<id>` session (`tmux.Pin`), so once pinned
  the windows no longer live in the home session — killing it leaves the
  `_rk-pin-*` sessions behind. Each test unpins both windows in its own cleanup
  (restoring them home so the board empties), which is the normal reaping path;
  the `afterAll` home-session kill is belt-and-suspenders for the un-pinned
  windows. Any `_rk-pin-*` sessions that survive a mid-test failure are reaped
  by the isolated-server GLOBAL teardown (`global-teardown.ts` runs
  `tmux -L rk-test-e2e* kill-server`, dropping every session on the socket).
- Each test pins both windows to a fresh board `reo<ts>` via the API (pin order
  = win-a, win-b), reorders, asserts, then unpins both so the board disappears
  (empty boards are not kept).
- `winIds()` reads the two windows' tmux `window_id`s in index order.
- `apiBase(baseURL)` resolves the backend origin (default
  `http://localhost:${RK_PORT ?? 3020}`).

## Tests

### `reorder POST reorders entries by orderKey and GET reflects the new order`

**What it proves:** Pinning win-a then win-b yields board order `[win-a, win-b]`;
a single `POST …/reorder` moving win-b before win-a (`before: null, after:
win-a`) returns `{ok: true, newOrderKey}` and `GET …/{board}` then returns
`[win-b, win-a]` — the orderKey is authoritative and one POST per move is
sufficient (fractional indexing).

**Steps:**
1. Resolve win-a / win-b ids; `POST …/pin` each (assert ok).
2. `GET …/{board}`; assert `windowId` order is `[win-a, win-b]`.
3. `POST …/reorder` `{server, windowId: win-b, before: null, after: win-a}`;
   assert ok + non-empty `newOrderKey`.
4. `expect.poll` `GET …/{board}` until the `windowId` order equals
   `[win-b, win-a]` (absorbs the tmux user-option write settling).
5. Unpin both windows (cleanup).

### `a successful reorder POST broadcasts a board-changed SSE event`

**What it proves:** A successful reorder POST fans out an `event: board-changed`
frame (with `change: "reorder"`, the board name, and the moved `windowId`) to a
client connected on that server's SSE stream — the echo `useBoardEntries`
refetches on to reconcile the optimistic override.

**Steps:**
1. Pin both windows via `page.request`.
2. `page.goto('/board/<board>', { waitUntil: 'domcontentloaded' })` so the SPA
   attaches its per-server SSE stream.
3. In the page context, open an `EventSource` on
   `/api/sessions/stream?server=<TMUX_SERVER>` and register a `board-changed`
   listener that resolves with the frame data.
4. On the EventSource's `onopen` (stream actually open — no fixed delay),
   `fetch('POST …/reorder', {windowId: win-b, before: null, after: win-a})`
   from the page origin.
5. Await the resolved frame; parse it and assert `change === "reorder"`,
   `board === <board>`, and `windowId === win-b`. (Rejects if no frame arrives
   within the timeout.)
6. Unpin both windows (cleanup).
