# board-list-reorder.spec.ts

Behavioural contract for the board-list-reorder backend surface: the
`POST /api/boards/order` endpoint (persists the full ordered board-name list to
`~/.rk/settings.yaml`), the API-layer rank-aware sort on `GET /api/boards`
(stored order first by index, then unranked boards alphabetically), and the
**server-global** `event: board-order` SSE broadcast that fans out to every
connected client — including a server-neutral `?metrics=1` stream with no
attached tmux server.

## Why this slice (not a drag simulation)

Native HTML5 drag is unreliable to simulate in Playwright (the analogous
server/session-reorder drag specs are documented as `test.fixme` and the
server-reorder e2e exercises the endpoint/SSE surface instead of the drag). The
derive-over-store override, render-time reconcile, MIME discrimination, self-
target snap-back fix, debounce/flush, and palette Move actions are all covered by
Vitest unit tests (`use-board-list-reorder.test.ts`, `palette-move.test.ts`,
`boards.test.ts`, `boards-section.test.tsx`, `host-overview-page.test.tsx`). This
spec exercises the load-bearing new backend surface — the order endpoint, its
API-layer rank-aware sort, and the server-global SSE echo — end-to-end against
the live backend, which IS deterministic.

## Shared setup

- **Settings save/restore (real `~/.rk/settings.yaml`).** `scripts/test-e2e.sh`
  isolates the tmux server/port but NOT `$HOME`, so this suite's
  `POST /api/boards/order` writes hit the developer's real
  `~/.rk/settings.yaml`. `beforeAll` snapshots the file's raw bytes (recording
  whether it existed at all); `afterAll` restores those exact bytes — or deletes
  the file when none existed — so any curated board order round-trips
  byte-identically and no test residue persists. `afterAll` always runs (even on
  test failure) and its restore is best-effort so a teardown error never masks a
  test failure.
- `beforeAll` creates one tmux session (`e2e-board-reorder-<ts>`) with two
  windows (`win-a`, `win-b`) on `E2E_TMUX_SERVER` (default `rk-test-e2e`).
  `afterAll` kills the session.
- Two fresh board names per run: `aaa<ts>` (BOARD_A) and `zzz<ts>` (BOARD_Z),
  chosen so BOARD_A sorts alphabetically BEFORE BOARD_Z — a stored order of
  `[BOARD_Z, BOARD_A]` therefore proves the reorder overrides the default
  alphabetical sort.
- `apiBase(baseURL)` resolves the backend origin (default
  `http://localhost:${RK_PORT ?? 3020}`).
- `windowIds()` reads win-a/win-b's stable `#{window_id}` via `tmux list-windows`
  so pins are created deterministically via the API (not the hover popover).

## Tests

### `reorder POST persists and GET /api/boards reflects the stored order first, then alphabetical`

**What it proves:** After pinning win-a → BOARD_A and win-b → BOARD_Z, the board
list defaults to alphabetical (`[BOARD_A, BOARD_Z]`); a `POST /api/boards/order`
of `[BOARD_Z, BOARD_A]` returns `{ok: true}` and `GET /api/boards` then returns
`[BOARD_Z, BOARD_A]` — the API-layer rank-aware sort applies the stored order.

**Steps:**
1. Read win-a/win-b window ids.
2. `POST /api/boards/<BOARD_A>/pin` (win-a) and `POST /api/boards/<BOARD_Z>/pin`
   (win-b); assert each is ok.
3. `GET /api/boards`; filter to the two test boards; assert alphabetical
   baseline `[BOARD_A, BOARD_Z]`.
4. `POST /api/boards/order` with `{order: [BOARD_Z, BOARD_A]}`; assert ok +
   `{ok: true}`.
5. `GET /api/boards`; filter to the two test boards; assert `[BOARD_Z, BOARD_A]`
   (stored order overrides alphabetical).

### `an invalid board name in the order is rejected with 400`

**What it proves:** Names are validated before any write — an order containing
`"bad name!"` (fails `ValidBoardName`) returns HTTP 400.

**Steps:**
1. `POST /api/boards/order` with `{order: ["bad name!"]}`.
2. Assert status is `400`.

### `a successful order POST broadcasts a server-global event: board-order`

**What it proves:** A successful order POST fans out an `event: board-order`
frame to a client on the server-neutral `?metrics=1` stream (which has no
attached tmux server), proving the broadcast is server-global — the Host
BOARDS zone with zero attached servers still re-sorts live.

**Steps:**
1. Navigate to `/` (the Host home — zero attached tmux servers, so its
   `?metrics=1` stream is the server-neutral one) and wait for the HOST HEALTH
   region as the readiness signal.
2. In the page context, open an `EventSource` on `/api/sessions/stream?metrics=1`
   and register a `board-order` listener that resolves with the frame data.
3. On the EventSource's `onopen` (stream actually open — no fixed delay),
   `fetch('POST /api/boards/order', {order: [BOARD_Z, BOARD_A]})` from the page
   origin.
4. Await the resolved frame; parse it and assert `order` equals
   `[BOARD_Z, BOARD_A]`. (Rejects if no frame arrives within the timeout.)
