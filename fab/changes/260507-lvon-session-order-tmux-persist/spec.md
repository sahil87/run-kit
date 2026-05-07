# Spec: Persist Sidebar Session Order to tmux

**Change**: 260507-lvon-session-order-tmux-persist
**Created**: 2026-05-07
**Affected memory**: `docs/memory/run-kit/architecture.md`, `docs/memory/run-kit/tmux-sessions.md`, `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- **localStorage migration** — pre-existing per-device orders stored under `runkit-session-order-${server}` SHALL NOT be read or migrated. Users start with empty server-side order on first load.
- **Multi-user / merge resolution** — concurrent edits from different clients use last-write-wins. We do not detect or merge conflicting orders.
- **Optimistic UI rollback on PUT failure** — if the PUT errors, the local state stays as the user dragged. SSE will eventually reconcile when the server state changes.
- **Sequence numbers / version vectors** — SSE events do not carry monotonic sequence numbers. Out-of-order delivery is tolerated by last-write-wins semantics.
- **Reordering windows within a session** — out of scope. Existing window-drag-to-different-session behavior is unchanged.

## Backend: tmux Wrapper

### Requirement: GetSessionOrder reads `@rk_session_order` and decodes JSON

The function `GetSessionOrder(ctx context.Context, server string) ([]string, error)` SHALL run `tmux [-L <server>] show-option -sv @rk_session_order` via the existing `tmuxExecRawServer` helper and decode the resulting value as a JSON array of strings.

- It MUST return `[]string{}, nil` when the option is unset (tmux exits non-zero with `unknown option: @rk_session_order`).
- It MUST return `[]string{}, nil` when the option exists but its value is the empty string or whitespace-only.
- It MUST return a non-nil error wrapping `json.Unmarshal`'s error when the value is non-empty but not valid JSON.
- It MUST use `withTimeout()` (existing helper, ≤10s default).

#### Scenario: Option unset
- **GIVEN** a tmux server with no `@rk_session_order` set
- **WHEN** `GetSessionOrder(ctx, "default")` is called
- **THEN** it returns `([]string{}, nil)`

#### Scenario: Option set with valid JSON
- **GIVEN** `tmux set-option -s @rk_session_order '["main","dev","scratch"]'` was previously run
- **WHEN** `GetSessionOrder(ctx, "default")` is called
- **THEN** it returns `([]string{"main","dev","scratch"}, nil)`

#### Scenario: Option set with invalid JSON
- **GIVEN** `@rk_session_order` is set to the literal string `not-json`
- **WHEN** `GetSessionOrder(ctx, "default")` is called
- **THEN** it returns a non-nil error whose `errors.Unwrap()` is a `*json.SyntaxError`

### Requirement: SetSessionOrder JSON-encodes and writes via `set-option -s`

The function `SetSessionOrder(ctx context.Context, server string, order []string) error` SHALL JSON-encode `order` and run `tmux [-L <server>] set-option -s @rk_session_order <json>` via `tmuxExecRawServer`.

- The encoded value MUST be the result of `json.Marshal(order)` — quoted strings, no extra whitespace.
- The encoded value MUST be passed as a single argument-slice element to `exec.CommandContext` — never shell-interpolated (Constitution Principle I).
- An empty slice MUST be encoded as the JSON literal `[]`, not as the empty string. (This guarantees `Get` returns the empty slice on the next read, not the unset-option case.)
- A `nil` slice MUST be treated as the empty slice (encoded as `[]`).

#### Scenario: Round-trip
- **GIVEN** `SetSessionOrder(ctx, "default", []string{"a","b"})` returns nil
- **WHEN** `GetSessionOrder(ctx, "default")` is called immediately after
- **THEN** it returns `([]string{"a","b"}, nil)`

#### Scenario: Names with special characters
- **GIVEN** session names contain commas, quotes, and unicode (`"foo,bar"`, `"x\"y"`, `"é"`)
- **WHEN** `SetSessionOrder` then `GetSessionOrder` is called
- **THEN** the round-trip preserves all characters byte-for-byte

#### Scenario: Empty slice round-trip
- **GIVEN** `SetSessionOrder(ctx, "default", []string{})` returns nil
- **WHEN** `GetSessionOrder(ctx, "default")` is called
- **THEN** it returns `([]string{}, nil)` — distinguishable behavior from "unset" is not required, but the round-trip MUST be lossless

## Backend: HTTP Endpoints

### Requirement: GET `/api/sessions/order` returns the persisted order

The endpoint `GET /api/sessions/order?server=<name>` SHALL be registered in `router.go` (alongside other `/api/sessions/*` routes) and respond with `200 OK` and JSON body `{"order": [...]}`.

- The `server` query parameter MUST be resolved via the existing `serverFromRequest(r)` helper (which validates and defaults to `"default"`).
- On success: `200 OK`, body `{"order": ["main","dev","scratch"]}`.
- When the option is unset: `200 OK`, body `{"order": []}` — NOT a 404.
- When `tmux.GetSessionOrder` errors (e.g., invalid JSON in stored option): `500 Internal Server Error`, body `{"error": "<message>"}` via existing `writeError` helper.

#### Scenario: Unset returns empty array
- **GIVEN** no `@rk_session_order` is set on the default server
- **WHEN** the client sends `GET /api/sessions/order?server=default`
- **THEN** the response is `200 OK` with body `{"order": []}`

#### Scenario: Set returns the stored order
- **GIVEN** `@rk_session_order` on the default server holds `["main","dev"]`
- **WHEN** the client sends `GET /api/sessions/order?server=default`
- **THEN** the response is `200 OK` with body `{"order": ["main","dev"]}`

### Requirement: PUT `/api/sessions/order` persists and broadcasts

The endpoint `PUT /api/sessions/order?server=<name>` SHALL accept a JSON body `{"order": [...]}` and write via `tmux.SetSessionOrder`.

- On success: `200 OK`, body `{"ok": true}`.
- The handler MUST validate the body shape before calling tmux. **Wrong-typed** `order` field (e.g., string instead of array) and **malformed JSON** return `400 Bad Request`. A **missing** `order` field is treated as the empty array (`[]`) — `{}` is a shape-valid request that clears any persisted order, returning `200 {"ok": true}`. (Rationale: clients implementing "clear" via an empty PUT shouldn't have to special-case the property.)
- Each element of `order` MUST be validated with the existing `validate.ValidateName` helper (the same validator used by `serverFromRequest` for server names — appropriate here because tmux session names share the same character class). Names that fail validation cause `400 Bad Request`.
- The handler MUST tolerate names that don't currently match any live tmux session — clients can include stale names; the frontend's `orderedSessions` sort drops them to the bottom. (Stricter validation would race with concurrent session creation.)
- After `tmux.SetSessionOrder` returns nil, the handler MUST trigger an SSE broadcast via `s.sseHub.broadcastSessionOrder(server, order)` (synchronously, before returning the HTTP response).
- On `tmux.SetSessionOrder` error: `500 Internal Server Error`, body `{"error": "<message>"}`.

#### Scenario: Valid PUT round-trips and broadcasts
- **GIVEN** an SSE client connected to `?server=default`
- **WHEN** another client sends `PUT /api/sessions/order?server=default` with body `{"order":["main","dev"]}`
- **THEN** the response is `200 OK` with body `{"ok": true}`
- **AND** the SSE client receives a `session-order` event with payload `{"server":"default","order":["main","dev"]}` within 100ms
- **AND** a subsequent `GET /api/sessions/order?server=default` returns `{"order":["main","dev"]}`

#### Scenario: Invalid body shape
- **GIVEN** the client sends `PUT /api/sessions/order?server=default` with body `{"order":"main"}` (string instead of array)
- **WHEN** the request is processed
- **THEN** the response is `400 Bad Request` with an error message
- **AND** no tmux call was made

#### Scenario: Order contains an invalid name
- **GIVEN** `validate.ValidateName` rejects `"bad name"` (contains a space)
- **WHEN** the client sends `PUT /api/sessions/order?server=default` with body `{"order":["main","bad name"]}`
- **THEN** the response is `400 Bad Request`
- **AND** no tmux call was made

#### Scenario: Stale name accepted
- **GIVEN** session `"deleted-yesterday"` no longer exists on the server
- **WHEN** the client sends `PUT /api/sessions/order?server=default` with body `{"order":["main","deleted-yesterday"]}`
- **THEN** the response is `200 OK` and the order is persisted as-is

## Backend: SSE Broadcast

### Requirement: New `session-order` event type

The SSE hub SHALL broadcast a new event type `session-order` with payload `{"server": "<name>", "order": [...]}`. This is independent of the existing `sessions` event.

- The event format follows the same `event: session-order\ndata: <json>\n\n` shape used for `sessions` and `metrics`.
- The hub gains a new method: `func (h *sseHub) broadcastSessionOrder(server string, order []string)` that:
  1. Builds the event payload `{"server": server, "order": order}`.
  2. Marshals to JSON, returning silently on marshal failure (logged at Warn).
  3. Acquires `h.mu.Lock()`.
  4. Caches the JSON in a new field `previousOrderJSON map[string]string` (per-server) so future SSE clients receive it on connect.
  5. Pushes the event to every client where `c.server == server` via the same non-blocking select-on-channel pattern as the `sessions` broadcast.
  6. Releases the lock.
- The hub poll loop is **unchanged** — order broadcasts are eager, not polled.

#### Scenario: Broadcast reaches all matching clients
- **GIVEN** three SSE clients connected, two with `?server=default` and one with `?server=staging`
- **WHEN** `broadcastSessionOrder("default", []string{"main"})` is called
- **THEN** the two `default` clients receive a `session-order` event
- **AND** the `staging` client does not

#### Scenario: Broadcast caches for late joiners
- **GIVEN** `broadcastSessionOrder("default", []string{"main","dev"})` was called before any client connected
- **WHEN** an SSE client connects with `?server=default`
- **THEN** the client receives the cached `session-order` event during `addClient`, immediately after the cached `sessions` snapshot

### Requirement: Initial sync on SSE connect

When a new client connects via `addClient`, the hub SHALL push the cached `session-order` event for that server (if cached) immediately after the existing `sessions` snapshot.

- If no order has ever been broadcast for that server (no cached entry), no `session-order` event is sent on connect — the client treats absence as "empty order" (consistent with GET endpoint behavior).
- This means a frontend reconnecting an SSE stream receives the current order without an additional GET round-trip.

#### Scenario: Late-connecting client gets the cached order
- **GIVEN** a `session-order` event was previously broadcast for `default` with `["main","dev"]`
- **WHEN** a new SSE client connects with `?server=default`
- **THEN** the cached `session-order` event is delivered to that client during `addClient`, before the poll loop's next tick

#### Scenario: Cold cache — no event on connect
- **GIVEN** no PUT has been issued for `default` since server start
- **WHEN** a new SSE client connects with `?server=default`
- **THEN** no `session-order` event is sent until a PUT (or hub poll bootstrap) populates the cache

## Backend: Hub Bootstrap on First Poll

### Requirement: Hub seeds order cache from tmux on first poll per server

To avoid a cold-cache empty state when the rk-go server restarts but the tmux server retained `@rk_session_order`, the SSE hub SHALL read the persisted order via `tmux.GetSessionOrder` once per server during the first poll iteration and seed the `previousOrderJSON` cache.

- Implementation: in `poll()`, when iterating servers for the `sessions` fetch, if `previousOrderJSON[server]` is unset, call `tmux.GetSessionOrder(ctx, server)`. On success, build the same payload as `broadcastSessionOrder` would, cache it in `previousOrderJSON[server]`, and broadcast to existing clients.
- On `GetSessionOrder` error, log at Debug (best-effort) and increment a per-server bootstrap-attempts counter. Retries are bounded — after `orderBootstrapMaxAttempts` (default 3) failed attempts, bootstrap stops trying for that server. Transient tmux failures (timeouts, brief server unavailability) thus recover; persistent failures don't poll-spam.
- A successful bootstrap broadcast (or any successful PUT-driven broadcast) populates `previousOrderJSON[server]` and is the "seeded" gate — any later poll iteration that sees `previousOrderJSON[server]` populated skips bootstrap. Bootstrap state and the cached payload are tracked in separate maps (`orderBootstrapAttempts` vs. `previousOrderJSON`) so that error attempts don't pollute the cache and a successful PUT cleanly stops the bootstrap loop.

#### Scenario: Restart preserves order through SSE
- **GIVEN** `@rk_session_order` was set to `["main","dev"]` before rk-go restarted
- **WHEN** the rk-go server restarts and the first SSE client connects with `?server=default`
- **THEN** within one poll tick, the client receives a `session-order` event with `["main","dev"]`

## Frontend: API Client

### Requirement: New API client methods

`app/frontend/src/api/client.ts` SHALL gain two methods that mirror the backend endpoints, following the existing first-positional-`server` contract documented in `docs/memory/run-kit/tmux-sessions.md` § "Frontend Server Routing Contract":

```ts
export async function getSessionOrder(server: string): Promise<string[]>
export async function setSessionOrder(server: string, order: string[]): Promise<void>
```

- Both MUST use `withServer(url, server)` to construct the URL.
- `getSessionOrder` MUST return `body.order ?? []` (defensive — server always sends `order`, but tolerate absence).
- `setSessionOrder` MUST send `Content-Type: application/json` and `JSON.stringify({ order })`.
- Both MUST throw on non-2xx response, matching existing client patterns.

#### Scenario: getSessionOrder returns the array
- **GIVEN** the backend responds with `{"order":["main","dev"]}`
- **WHEN** `getSessionOrder("default")` is called
- **THEN** it resolves to `["main","dev"]`

#### Scenario: setSessionOrder posts JSON
- **GIVEN** `setSessionOrder("default", ["main","dev"])` is called
- **WHEN** the request is sent
- **THEN** the request method is `PUT`, URL is `/api/sessions/order?server=default`, headers include `Content-Type: application/json`, and body is `{"order":["main","dev"]}`

## Frontend: SSE Listener

### Requirement: Sidebar consumes `session-order` SSE events

The sidebar SHALL subscribe to `session-order` events on the SSE stream that the existing `SessionProvider` already manages (the same EventSource consumed by `sessions` events).

- A new event handler MUST be added wherever the `sessions` handler lives (likely `SessionProvider` or a dedicated hook). On `event: session-order`, parse `{"server":..., "order":...}` from `event.data` and update a `sessionOrder` state slice keyed by server.
- The sidebar reads the order for its current `server` prop from this state.
- When the user is actively dragging (`sessionDragSource !== null`), incoming SSE events for the active server MUST be queued and applied on `dragend`, not applied mid-drag. Events for other servers may be applied immediately.

#### Scenario: Order updates live on a second tab
- **GIVEN** two browser tabs open to the same server, both displaying the sidebar
- **WHEN** the user drags a session in tab A
- **THEN** tab B re-renders with the new order within 1s (one SSE round-trip)

#### Scenario: Mid-drag updates are deferred
- **GIVEN** the user has begun dragging session `main` in tab A
- **WHEN** an SSE `session-order` event arrives for the same server while drag is in progress
- **THEN** local state is not changed during the drag
- **AND** the SSE-delivered order is applied on dragend (replacing the drag's local order)

## Frontend: Drag & Drop UI

### Requirement: Drag-and-drop reorder with optimistic local update + debounced PUT

The sidebar SHALL render sessions in the order from `sessionOrder` (per-server, from SSE), falling back to the natural `sessions` order when no order is known. Sessions present in the live `sessions` list but absent from the saved order render at the bottom of the list, in their natural order.

- Each `<SessionRow>` MUST be `draggable={true}` (except optimistic ghost sessions, which are not draggable).
- The drag MUST use a custom MIME type `application/x-session-reorder` to avoid colliding with the existing window-drag-to-session feature on the same row.
- On `dragover` over a target session row, the source session MUST be repositioned in local state immediately (snappy live preview) and the new order MUST trigger a debounced PUT (250ms trailing) to `/api/sessions/order`.
- The debounce timer MUST be reset on every dragover that produces a new order; the actual PUT fires only after 250ms of inactivity.
- On `dragend`, the source highlight MUST clear and any pending debounced PUT MUST still fire (i.e., dragend does not cancel a pending timer — it remains scheduled to flush).
- The source session row MUST render with `opacity-50` while it is the drag source.

#### Scenario: Drag fires one PUT per drag operation
- **GIVEN** the user drags session `main` over `dev`, then over `scratch`, then drops on `scratch` over the course of 800ms
- **WHEN** the debounce timer expires
- **THEN** exactly one PUT is sent to `/api/sessions/order` with the final order

#### Scenario: Local order updates immediately on dragover
- **GIVEN** the user is dragging session `main`
- **WHEN** the cursor enters `dev`'s row
- **THEN** the sidebar re-renders with `main` in `dev`'s previous position
- **AND** `dev` shifts up

#### Scenario: Stale name in saved order
- **GIVEN** the saved order is `["main","old","dev"]` but live sessions are `["main","dev","new"]`
- **WHEN** the sidebar renders
- **THEN** the order is `[main, dev, new]` — `old` is dropped (no longer exists), `new` is appended (not in saved order)

#### Scenario: Optimistic ghost sessions are not draggable
- **GIVEN** an optimistic session row is rendering (`"optimistic" in session && session.optimistic`)
- **WHEN** the user attempts to drag it
- **THEN** the row's `draggable` attribute is `false` and no drag begins

### Requirement: localStorage path is removed entirely

The previous PR #178 design's `runkit-session-order-${server}` localStorage code SHALL NOT exist after this change. No reads, no writes, no migration shim.

#### Scenario: No localStorage interaction
- **GIVEN** a fresh browser with no `runkit-session-order-*` localStorage keys
- **WHEN** the user drags a session in the sidebar
- **THEN** localStorage remains untouched (verified via test stub)

## Testing

### Requirement: Backend Go unit tests cover the tmux wrappers

`internal/tmux/tmux_test.go` SHALL include tests for `GetSessionOrder` and `SetSessionOrder` exercising:
- Unset option returns empty slice (no error).
- Round-trip with simple names.
- Round-trip with names containing JSON-significant characters (commas, quotes, backslashes, unicode).
- Empty slice round-trip.
- Invalid JSON in option returns a JSON syntax error.

These tests MUST follow the existing pattern of starting an isolated tmux server in the test (see `tmux_test.go` for the convention) so they don't pollute the user's default tmux server.

### Requirement: Backend Go unit tests cover the HTTP handlers

`api/sessions_test.go` SHALL include tests for `GET` and `PUT /api/sessions/order` exercising:
- GET on unset returns `200` `{"order":[]}`.
- GET on set returns `200` `{"order":[...]}`.
- PUT with valid body returns `200` `{"ok":true}` and the next GET reflects the change.
- PUT with non-array `order` returns `400`.
- PUT with `order` containing a name that fails `validate.ValidateName` returns `400`.
- PUT with stale (unknown) names returns `200` (tolerance).
- PUT triggers a `session-order` SSE broadcast (verified via test SSE hub).

### Requirement: Frontend Vitest tests cover client + sidebar behavior

- `client.test.ts` extends to cover `getSessionOrder` and `setSessionOrder` shape and URL construction.
- `sidebar/index.test.tsx` (new or extended) covers:
  - Drag-over reorders local state immediately.
  - Debounced PUT fires once per drag operation after 250ms idle.
  - SSE event during drag is deferred and applied on dragend.
  - SSE event outside drag updates local state immediately.
  - localStorage key `runkit-session-order-*` is never read or written (assert via spied storage).

### Requirement: Playwright e2e covers persistence across reload

`app/frontend/tests/session-reorder.spec.ts` (with sibling `session-reorder.spec.md` per Constitution § "Test Companion Docs") SHALL test:
- User drags a session → reload page → order is preserved.

A second-tab live-sync e2e is desirable but optional — Playwright's multi-context support makes it feasible if test infrastructure permits within the change's scope.

## Design Decisions

1. **Storage = tmux user-option `@rk_session_order` (not filesystem JSON, not DB)**
   - *Why*: Already the run-kit pattern (`@color`, `@rk_type`, `@rk_url`). Naturally per-server. No new config path, no cleanup, no migration. Aligns with Constitution Principle II (No Database) and Principle VII (Convention Over Configuration).
   - *Rejected*: Filesystem JSON at `~/.config/run-kit/session-order.json` — adds new state to manage and a new convention. localStorage — fails the multi-device sync requirement.

2. **Encoding = JSON string (not CSV, not newline-separated)**
   - *Why*: Future-proof — supports schema upgrade (e.g., per-session metadata) without a separator-escape redesign. Negligible parse cost for ≤100 sessions.
   - *Rejected*: Comma-separated — requires escape logic for names containing commas. Newline-separated — works but commits to a flat-string format.

3. **SSE event type = `session-order` (separate from `sessions`)**
   - *Why*: The `sessions` event is a full snapshot triggered by polling `tmux list-sessions`. Order changes don't require a fresh snapshot. A separate event type lets clients update order without re-rendering session content.
   - *Rejected*: Embedding `order` in `sessions` event — couples a metadata-only update to the heavy poll path; would still require eager broadcast for low latency.

4. **Initial sync via SSE handshake (cached snapshot pushed on `addClient`)**
   - *Why*: Mirrors the existing `previousJSON` cached-on-connect pattern. Eliminates a GET round-trip on tab open. Guarantees ordering: clients receive `sessions` before `session-order` (consistent state).
   - *Rejected*: Frontend GETs on mount — extra round-trip and a window where the sidebar shows the wrong order.

5. **GET endpoint kept alongside SSE handshake**
   - *Why*: Useful for curl-based debugging and simpler test setup. Cheap to maintain (~10 lines).
   - *Rejected*: SSE-only — saves ~10 lines but loses standalone testability.

6. **Concurrency = last-write-wins (no merge, no version vector)**
   - *Why*: Sidebar order is a low-stakes UI preference. Two clients dragging simultaneously is rare; the cost of a misordered second is trivial.
   - *Rejected*: Optimistic concurrency with a version field — adds complexity for a non-problem.

7. **Debounce = 250ms trailing on PUT**
   - *Why*: Drag events fire on every hover frame (10s of events per second). Trailing debounce gives one PUT per drag op. 250ms is short enough to feel immediate when the user pauses, long enough to coalesce a typical drag.
   - *Rejected*: Per-event PUT — wasteful HTTP. Leading debounce — would PUT the wrong (intermediate) state.

8. **Mid-drag SSE events deferred until dragend**
   - *Why*: Applying a remote SSE event mid-drag would scramble the user's in-progress reorder. Deferring respects user agency.
   - *Rejected*: Apply immediately — surfaces ugly visual race conditions for sub-second multi-client edits.

9. **Hub bootstrap reads tmux on first poll per server**
   - *Why*: When rk-go restarts but tmux survives (Constitution Principle VI), the hub's `previousOrderJSON` cache is empty even though the persisted order exists. Without bootstrap, the first SSE connect after restart would deliver no order until a PUT happens. Bootstrap closes that gap with one tmux read per server on hub warm-up.
   - *Rejected*: Frontend GET on mount — defeats the SSE-only contract; adds latency. Hub eager reads on `addClient` — reads tmux once per client connect rather than once per server.

10. **PUT validation rejects invalid names but accepts stale ones**
    - *Why*: Constitution Principle I requires validating user input before subprocess call. `validate.ValidateName` is the existing validator. But rejecting names that don't match a current session would race with concurrent session creation/rename — frontend could optimistically include a name the server hasn't seen yet.
    - *Rejected*: Strict validation against live session list — race condition. No validation — security violation.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | tmux user-option `@rk_session_order` storage | Confirmed from intake #1 | S:95 R:80 A:90 D:90 |
| 2 | Certain | JSON string encoding | Confirmed from intake #2 | S:95 R:75 A:90 D:90 |
| 3 | Certain | No localStorage migration | Confirmed from intake #3 | S:95 R:90 A:95 D:95 |
| 4 | Certain | Live SSE sync across clients | Confirmed from intake #4 | S:95 R:75 A:90 D:90 |
| 5 | Certain | Last-write-wins concurrency | Confirmed from intake #5 | S:90 R:75 A:80 D:85 |
| 6 | Certain | 250ms trailing debounce on PUT | Confirmed from intake #6 (user clarified) | S:95 R:80 A:75 D:85 |
| 7 | Certain | Separate `session-order` SSE event type | Confirmed from intake #7 (user clarified) | S:95 R:70 A:75 D:75 |
| 8 | Certain | Initial sync via SSE handshake (cached snapshot) | Confirmed from intake #8 (user clarified) | S:95 R:60 A:75 D:70 |
| 9 | Certain | New routes registered alongside existing settings/sessions routes | Confirmed from intake #9 (user clarified) | S:95 R:80 A:90 D:85 |
| 10 | Certain | Validate session names with existing `validate.ValidateName` | Confirmed from intake #10. Validator already exists; Constitution I requires it. | S:95 R:65 A:90 D:85 |
| 11 | Certain | GET endpoint kept alongside SSE | Confirmed from intake #11. Cheap, useful for debugging and tests. | S:90 R:80 A:80 D:80 |
| 12 | Certain | Playwright e2e for persistence (reload check) | Confirmed from intake #12. Existing `app/frontend/tests/` infra. | S:90 R:80 A:80 D:85 |
| 13 | Certain | PUT does not reject stale (unknown) session names | Confirmed from intake #13. Strict validation would race with session creation. | S:90 R:75 A:80 D:80 |
| 14 | Certain | Hub bootstrap reads tmux once per server on first poll | New (spec stage). Closes the rk-restart-but-tmux-survives gap; mirrors existing `previousJSON` lazy-init pattern. | S:90 R:80 A:85 D:80 |
| 15 | Certain | Mid-drag SSE events are deferred to dragend (per active server only) | New (spec stage). Avoids visual race during user drag. Applies to active server only — events for other servers are processed immediately. | S:85 R:75 A:80 D:80 |
| 16 | Certain | Empty slice MUST be encoded as JSON `[]`, not empty string | New (spec stage). Disambiguates "explicitly cleared" from "never set" at the encode layer; lossless round-trip. | S:90 R:80 A:90 D:85 |
| 17 | Certain | dragend does not cancel pending debounced PUT — it flushes via timer | New (spec stage). Otherwise a fast drag-and-release within 250ms would lose the user's edit. | S:85 R:75 A:80 D:80 |
| 18 | Certain | Sessions absent from saved order render at the bottom in natural order | New (spec stage). Required UX behavior — new sessions must appear somewhere predictable. | S:85 R:80 A:85 D:85 |
| 19 | Certain | Optimistic ghost sessions are not draggable | New (spec stage). Mirrors PR #178 behavior; optimistic rows have no canonical name yet. | S:80 R:75 A:85 D:80 |
| 20 | Certain | `validate.ValidateName` is the validator used (matching `serverFromRequest`) | New (spec stage). Same character class for sessions and servers (tmux constraint); no need for a separate validator. | S:85 R:75 A:90 D:80 |

20 assumptions (20 certain, 0 confident, 0 tentative, 0 unresolved).
