# boards-multi-server.spec.ts

Validates that boards aggregate windows across multiple tmux servers — the
core cross-server requirement from the spec.

## Shared setup

- `beforeAll` creates a session on the primary tmux server (`rk-e2e`) plus a
  second tmux server (`rk-e2e-multi-<digits>`) with its own session, each
  with one named window (`srv-a-win`, `srv-b-win`).
- `afterAll` kills the primary session and the secondary tmux server
  entirely.

## Tests

### `a board with windows from two servers shows the union on /board/<name>`

**What it proves:** Pinning windows from two different tmux servers to the
same board makes both windows appear on the board page — the
cross-server aggregation contract holds end-to-end through the HTTP API and
the UI render path.

**Steps:**

1. Read each server's window id via `tmux list-windows -F #{window_id}` so
   pin POSTs target real windows.
2. Navigate to `/${TMUX_SERVER_A}` and wait for `Connected` (warms the SSE
   connection, ensures backend is ready).
3. POST `/api/boards/<name>/pin` for server A's window via `page.request`.
4. POST `/api/boards/<name>/pin` for server B's window via `page.request`.
5. GET `/api/boards/<name>` and assert the returned entries include both
   server names — the API-level union holds.
6. Navigate to `/board/<name>` and assert both `srv-a-win` and
   `srv-b-win` are visible — the UI render path also holds.
