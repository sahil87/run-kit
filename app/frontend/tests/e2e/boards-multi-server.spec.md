# boards-multi-server.spec.ts

Validates that the board view aggregates pinned windows sharing a board name
across multiple tmux servers. In the move-based model each pinned window's
pin-session (`_rk-pin-<id>`) lives on a single tmux server (boards are
server-scoped), but `GET /api/boards/<name>` and the board page UNION every
pin-session carrying that `@rk_board` name across all reachable servers.

## Shared setup

- `beforeAll` creates a session on the primary tmux server (`rk-test-e2e`)
  plus a second tmux server (`rk-test-e2e-multi-<pid>-<suffix>`, where `<pid>`
  is the Playwright `process.pid` so the automatic post-sweep can parse it)
  with its own session, each with one named window (`srv-a-win`, `srv-b-win`).
- A module-scoped `pinnedEntries` array tracks every `(server, windowId)`
  pinned during the test.
- `afterAll` first POSTs `/api/boards/<name>/unpin` for each tracked entry
  (best-effort) so the persistent `rk-test-e2e` server doesn't carry stale
  `_rk-pin-*` pin-sessions into later runs, then kills the primary session and
  the secondary tmux server entirely.

## Tests

### `a board with windows from two servers shows the union on /board/<name>`

**What it proves:** Pinning windows from two different tmux servers to the
same board name makes both windows appear on the board page — the
cross-server board-name aggregation contract holds end-to-end through the HTTP
API and the UI render path, even though each pin-session is server-local.

**Steps:**

1. Read each server's window id via `tmux list-windows -F #{window_id}` so
   pin POSTs target real windows.
2. POST `/api/boards/<name>/pin` for server A's window via `page.request`,
   and record the entry for cleanup.
3. POST `/api/boards/<name>/pin` for server B's window via `page.request`,
   and record the entry for cleanup.
4. GET `/api/boards/<name>` and assert the returned entries include both
   server names — the API-level union holds.
5. Navigate to `/board/<name>` (waitUntil `domcontentloaded` to skip waiting
   for every xterm WebSocket to settle) and assert both `srv-a-win` and
   `srv-b-win` are visible — the UI render path also holds.
