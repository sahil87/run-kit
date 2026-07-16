# server-reorder.spec.ts

Behavioural contract for the server-reorder backend surface: the
`POST /api/servers/order` endpoint (writes each server's `@rk_server_rank`),
the nullable `rank` field on `GET /api/servers` (array stays alphabetical), and
the **server-global** `server-order` broadcast that fans out to every state-socket
connection — including a metrics-only subscription with no attached tmux server.

## Why this slice (not a drag simulation)

Server drag-reorder needs ≥2 *regular* (non-infra) servers, but the isolated
e2e harness only provides `rk-test-*` sockets (which `isInfraServer` treats as
non-draggable infra) and cannot create genuinely-regular servers without leaking
sockets outside the `rk-test-e2e*` teardown glob. Native HTML5 drag is also
unreliable to simulate in Playwright (the analogous session-reorder drag spec
has never passed and is `test.fixme`), and `page.reload()` does not commit under
the SPA's long-lived state socket. So this spec exercises the load-bearing new
surface — the order endpoint and its server-global echo — end-to-end against
the live backend, which IS deterministic. The comparator, context re-sort, drag
handlers, and palette Move actions are covered by Vitest unit tests.

## Shared setup

- Uses `E2E_TMUX_SERVER` (default `rk-test-e2e`) as the live server. No extra
  sessions are created — the endpoint operates on the server socket itself.
- `apiBase(baseURL)` resolves the backend origin (default
  `http://localhost:${RK_PORT ?? 3020}`).
- Persisted rank is harmless leftover state; no teardown reset is needed (the
  option has no HTTP "unset" and ranks don't affect the alphabetical `/api/servers`
  array).

## Tests

### `POST /api/servers/order persists rank and returns ok`

**What it proves:** Posting `{order: [rk-test-e2e]}` returns `{ok: true}`,
writes rank 0 to that server, and `GET /api/servers` then reports `rank: 0` on
its entry while the array remains alphabetical (the asserted #311 contract).

**Steps:**
1. `POST /api/servers/order` with `{order: [TMUX_SERVER]}`; assert `ok` +
   `{ok: true}` body.
2. `GET /api/servers`; assert the `name` array equals its own alphabetical
   sort (order contract preserved).
3. Find the `TMUX_SERVER` entry; assert `rank === 0`.

### `an invalid server name in the order is rejected with 400`

**What it proves:** Names are validated before any tmux write — an order
containing `"bad name!"` (fails `ValidateServerName`) returns HTTP 400.

**Steps:**
1. `POST /api/servers/order` with `{order: ["bad name!"]}`.
2. Assert status is `400`.

### `a successful order POST broadcasts a server-global event: server-order`

**What it proves:** A successful order POST fans out a `server-order` global event
to a state-socket connection subscribed to metrics only (no attached tmux server),
proving the broadcast is server-global — the Host with zero attached servers still
hears order changes.

**Steps:**
1. Navigate to `/${TMUX_SERVER}` and wait for `Connected`.
2. In the page context, open a `WebSocket` to `/ws/state`, send `hello` +
   `subscribe {kind:"metrics"}`, and resolve on the first
   `{op:"event",kind:"global",type:"server-order"}` frame's `data`.
3. On the socket's `onopen` (deterministic — no fixed delay), `fetch('POST
   /api/servers/order', {order: [TMUX_SERVER]})` from the page origin.
4. Await the resolved frame; parse it and assert `order` contains
   `TMUX_SERVER`. (Rejects if no frame arrives within the timeout.)
