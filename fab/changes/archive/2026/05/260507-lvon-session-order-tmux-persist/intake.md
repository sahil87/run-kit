# Intake: Persist Sidebar Session Order to tmux

**Change**: 260507-lvon-session-order-tmux-persist
**Created**: 2026-05-07
**Status**: Draft

## Origin

Cherry-pick discussion from PR #178 (`feat: terminal multiplexing engine + session drag-and-drop reorder`). The PR bundled four features; user opted to take only the drag-and-drop reorder, but rejected its localStorage backing in favor of server-side persistence so the order syncs across devices connecting to the same tmux server.

Conversational decisions reached during `/fab-discuss` (interactive, multi-turn):

1. **Storage backend**: tmux user-option `@rk_session_order` on the server (Option A in the discussion). Rejected: filesystem JSON (Option B) — adds new config-path convention and cleanup burden; localStorage — does not sync across devices.
2. **Value encoding**: JSON string (`'["main","dev","scratch"]'`) — chosen over comma-separated and newline-separated for scalability (handles future schema additions without separator escapes).
3. **Migration**: None. Users with existing localStorage orders accept a one-time reset.
4. **Live sync**: Yes. PUT triggers SSE broadcast so other open tabs/devices reorder immediately.
5. **Concurrency**: Last-write-wins. Two clients dragging simultaneously: the later PUT clobbers; we don't merge.
6. **Debounce**: 250ms trailing on the frontend PUT. Drag events fire on every hover frame; we don't want one HTTP call per frame.

> Persist sidebar session reorder to tmux user-option `@rk_session_order` (JSON string) instead of localStorage. New `GET /api/sessions/order` and `PUT /api/sessions/order` endpoints. Debounced PUT (250ms trailing) on drag. SSE broadcast so reorder syncs live across all connected clients/devices on the same tmux server. Last-write-wins on concurrent edits. No migration from existing localStorage values. Backend wrapper functions in `internal/tmux/` via `exec.CommandContext` per constitution.

## Why

**Problem.** PR #178's drag-and-drop reorder uses localStorage keyed by server name (`runkit-session-order-${server}`). That works for a single-device user but fails the way run-kit is actually used: from a laptop on the desk, a phone on the couch, a tablet in bed — all hitting the same tmux server. Reorder on the laptop, the phone still shows the old order. Order is a shared property of *the tmux server*, not of *the browser that talked to it last*.

**Why now.** We're already cherry-picking the reorder UX from PR #178. Doing it once with server-side persistence is cheaper than shipping the localStorage version and migrating later (the migration would need to reconcile divergent per-device orders, which has no good answer).

**Why this approach.** tmux user-options (`set-option -s @key value`) are the idiomatic run-kit storage primitive — already used for `@color`, `@rk_type`, `@rk_url` (see `app/backend/internal/tmux/tmux.go:368-451`). They live on the tmux server they describe, naturally per-server, and require no new config path, no cleanup, no migration tooling. Filesystem JSON (rejected alternative) would add all three. Database (also rejected) violates Constitution Principle II.

**Why JSON encoding over CSV/newline.** Session names can contain commas. URL-encoding works but is uglier than a JSON string. Newline-separated would also work but commits to a flat-string format; JSON gives us a clean upgrade path if we ever want to attach metadata per session (e.g., `[{"name":"main","pinned":true}]`). The encoding overhead is negligible for sidebar lists (~10 sessions).

**Loss tradeoff acknowledged.** tmux user-options die when the tmux server dies. The order resets on machine reboot (since tmux servers don't survive reboot by default). This is acceptable — Constitution Principle VI guarantees tmux survives *server (rk-go) restarts*, not OS reboots, and users can rebuild their preferred order in seconds.

## What Changes

### Backend — `app/backend/internal/tmux/tmux.go`

Two new wrapper functions matching the existing `tmuxExecRawServer` / `tmuxExecServer` pattern:

```go
// GetSessionOrder returns the user-defined session order from tmux user-option
// @rk_session_order, decoded from JSON. Empty slice if option is unset or empty.
func GetSessionOrder(ctx context.Context, server string) ([]string, error) {
    args := append(serverArgs(server), "show-option", "-sv", "@rk_session_order")
    out, err := tmuxExecRawServer(ctx, server, args...)
    if err != nil {
        // tmux returns non-zero when option is unset — treat as empty
        return []string{}, nil
    }
    out = strings.TrimSpace(out)
    if out == "" {
        return []string{}, nil
    }
    var order []string
    if err := json.Unmarshal([]byte(out), &order); err != nil {
        return nil, fmt.Errorf("decode @rk_session_order: %w", err)
    }
    return order, nil
}

// SetSessionOrder writes the session order to tmux user-option @rk_session_order
// as a JSON string.
func SetSessionOrder(ctx context.Context, server string, order []string) error {
    encoded, err := json.Marshal(order)
    if err != nil {
        return fmt.Errorf("encode session order: %w", err)
    }
    args := append(serverArgs(server),
        "set-option", "-s", "@rk_session_order", string(encoded))
    _, err = tmuxExecRawServer(ctx, server, args...)
    return err
}
```

All subprocess calls go through the existing `tmuxExecRawServer` helper, which already wraps `exec.CommandContext` with timeouts (Constitution Principle I). No shell strings.

### Backend — `app/backend/api/sessions.go` (new handlers)

Two new HTTP handlers, registered in `router.go` alongside the existing settings handlers:

```go
r.Get("/api/sessions/order", s.handleSessionOrderGet)
r.Put("/api/sessions/order", s.handleSessionOrderPut)
```

**GET `/api/sessions/order?server=<name>`** → `200 OK` `{"order": ["main","dev","scratch"]}`

- Calls `tmux.GetSessionOrder(ctx, server)`
- Returns `{"order": []}` if option unset (not a 404)
- Returns `500` on tmux/decode failure

**PUT `/api/sessions/order?server=<name>`** body `{"order": ["main","dev","scratch"]}` → `200 OK` `{"ok": true}`

- Validates body: must be an object with `order: []string` field, each element non-empty
- Calls `tmux.SetSessionOrder(ctx, server, order)`
- On success, triggers SSE broadcast (see below)
- Returns `400` on body validation failure, `500` on tmux failure

### Backend — `app/backend/api/sse.go` (broadcast trigger)

The SSE hub currently broadcasts `event: sessions` only when polled session JSON changes. We add a second event type for order changes, broadcast eagerly on PUT:

```go
event: session-order
data: {"server": "default", "order": ["main","dev","scratch"]}
```

**Mechanism.** The `sseHub` gains a method `broadcastSessionOrder(server string, order []string)` that builds the event payload and pushes to all clients on that server immediately (no waiting for the next poll tick). The PUT handler invokes it after `SetSessionOrder` succeeds. The poll loop is unchanged.

**Why a separate event type.** The `sessions` event is a full snapshot that's expensive to recompute (requires `tmux list-sessions`). Order changes don't need a fresh snapshot — they're a self-contained piece of metadata. A separate event type lets clients update local state without triggering the heavier re-render path.

**Initial sync.** New SSE clients connecting via `addClient` already receive the cached `sessions` snapshot. We extend this to also send the cached `session-order` for that server, so a fresh tab loads with the right order immediately (no GET on mount needed — the SSE handshake suffices).

### Frontend — `app/frontend/src/api/client.ts`

Two new client methods:

```ts
export async function getSessionOrder(server: string): Promise<string[]> {
  const res = await fetch(`/api/sessions/order?server=${encodeURIComponent(server)}`);
  if (!res.ok) throw new Error(`getSessionOrder: ${res.status}`);
  const body = await res.json();
  return body.order ?? [];
}

export async function setSessionOrder(server: string, order: string[]): Promise<void> {
  const res = await fetch(`/api/sessions/order?server=${encodeURIComponent(server)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order }),
  });
  if (!res.ok) throw new Error(`setSessionOrder: ${res.status}`);
}
```

### Frontend — `app/frontend/src/components/sidebar/index.tsx`

Replace the localStorage approach with server state + SSE:

- Remove the `SESSION_ORDER_KEY` localStorage logic.
- Replace `useState` initial-from-localStorage with an empty array; populate from the SSE stream's `session-order` event (and from the cached snapshot the hub sends on connect).
- On drag (`handleSessionReorderOver`), update local state optimistically (snappy) and call a debounced `setSessionOrder` (250ms trailing). Use a ref-held timer.
- Listen for incoming `session-order` SSE events: if currently dragging (`sessionDragSource !== null`), ignore the incoming order until drag-end, then re-merge. Otherwise apply directly.
- Per-server reset on `server` prop change still works — local state clears, SSE pushes the new server's order.

### Frontend — `app/frontend/src/components/sidebar/session-row.tsx`

Unchanged from the PR #178 design — same drag handlers, same `draggable`/`isDragSource`/`onDragStart`/`onDragEnd` props, same `opacity-50` source-highlight.

### Tests

- **Backend Go tests**:
  - `internal/tmux/tmux_test.go` — `TestGetSessionOrder_unset` (empty), `TestSetSessionOrder_roundTrip`, `TestSetSessionOrder_jsonEncoding` (commas in names).
  - `api/sessions_test.go` — `TestSessionOrder_GET_unset`, `TestSessionOrder_PUT_roundTrip`, `TestSessionOrder_PUT_invalidBody`.
- **Backend SSE test**: `api/sse_test.go` — new test verifying PUT triggers a `session-order` event to connected clients within one tick.
- **Frontend tests**:
  - `sidebar/index.test.tsx` — extend or add: drag triggers debounced PUT, ignores incoming SSE events during active drag, applies SSE event when not dragging.
- **E2E**: optional `session-reorder.spec.ts` — drag a session, reload page, verify order persisted (covers backend + SSE roundtrip).

## Affected Memory

- `run-kit/architecture`: (modify) — add note on tmux user-option `@rk_session_order` as a server-side persistence mechanism alongside `@color`, `@rk_type`, `@rk_url`.
- `run-kit/tmux-sessions`: (modify) — document session-order persistence semantics (per-server, JSON-encoded, lost on tmux server death).
- `run-kit/ui-patterns`: (modify) — document drag-and-drop session reorder pattern in sidebar.

## Impact

**Code areas touched**:
- `app/backend/internal/tmux/tmux.go` — 2 new functions (~30 lines)
- `app/backend/api/sessions.go` — 2 new handlers (~40 lines)
- `app/backend/api/router.go` — 2 new route registrations (2 lines)
- `app/backend/api/sse.go` — broadcast trigger method + initial-snapshot extension (~30 lines)
- `app/frontend/src/api/client.ts` — 2 new methods (~15 lines)
- `app/frontend/src/components/sidebar/index.tsx` — replace localStorage block, add SSE listener, debounced PUT (~50 lines net change)
- `app/frontend/src/components/sidebar/session-row.tsx` — 4 new optional props (~10 lines)

**APIs changed**: 2 new endpoints (`GET`/`PUT /api/sessions/order`). No breaking changes to existing endpoints.

**Dependencies**: None. Uses existing tmux wrappers, existing SSE hub, existing fetch-based API client pattern.

**Constitution alignment**:
- I (Security First): tmux calls go through `tmuxExecRawServer` / `serverArgs`, both already use `exec.CommandContext`. Session names from request body are passed as argument-slice elements, never shell-interpolated. Need a validator to ensure body session names match the regex tmux already enforces.
- II (No Database): tmux user-option *is* the storage. No DB introduced.
- III (Wrap, Don't Reinvent): Reuses `tmuxExecRawServer`, `serverArgs`, existing SSE hub.
- VII (Convention Over Configuration): tmux user-options are the existing convention.

## Open Questions

- Should the GET endpoint be removed once SSE delivers the cached snapshot on connect? (Probably yes — simpler API, one source of truth — but defer to spec stage.)
- Validation: should we reject PUT bodies whose `order` contains names that don't currently exist as sessions? (Probably no — order can include stale names that fall to the bottom; rejecting would race with session creation.)
- Should the SSE event include a sequence number / timestamp for clients to detect out-of-order delivery? (Unlikely worth the complexity for a property where last-write-wins is fine; defer.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Storage backend = tmux user-option `@rk_session_order` (not filesystem, not DB) | Discussed — user chose Option A (tmux user-options) over Option B (JSON file). Confirmed during /fab-discuss. | S:95 R:80 A:90 D:90 |
| 2 | Certain | Value encoding = JSON string | Discussed — user chose JSON over CSV/newline for future scalability ("more scalable") | S:95 R:75 A:90 D:90 |
| 3 | Certain | No migration from existing localStorage values | Discussed — user explicitly said "skip migration" | S:95 R:90 A:95 D:95 |
| 4 | Certain | Live sync via SSE — order propagates across all connected clients on the same tmux server | Discussed — user explicitly said "include" | S:95 R:75 A:90 D:90 |
| 5 | Confident | Concurrency policy = last-write-wins (no merge) | Standard for low-stakes UI preferences. Confirmed in design discussion. | S:80 R:75 A:80 D:85 |
| 6 | Certain | Debounce = 250ms trailing on PUT | Clarified — user confirmed | S:95 R:80 A:75 D:85 |
| 7 | Certain | New SSE event type `session-order` (separate from `sessions`) | Clarified — user confirmed | S:95 R:70 A:75 D:75 |
| 8 | Certain | Initial sync via SSE handshake (cached snapshot pushed on `addClient`) — frontend may not need a GET | Clarified — user confirmed | S:95 R:60 A:75 D:70 |
| 9 | Certain | New endpoints registered alongside existing settings routes | Clarified — user confirmed | S:95 R:80 A:90 D:85 |
| 10 | Confident | Validator: PUT body session names must match tmux's session-name regex (existing validator in `internal/validate/`) | Constitution Principle I requires validation before passing user input to subprocess. The validator already exists. | S:75 R:65 A:85 D:80 |
| 11 | Confident | GET endpoint kept for completeness/debuggability even if SSE handshake covers the runtime use case | Default = keep both; spec stage may collapse to SSE-only. Front-runner: keep GET (cheap to maintain, helpful for curl-based debugging). | S:65 R:80 A:70 D:70 |
| 12 | Confident | E2E test included (drag → reload → verify order persisted) | Aligns with `code-quality.md` ("UI changes SHOULD include Playwright e2e tests where possible"). Existing `app/frontend/tests/` infra makes this cheap. | S:70 R:80 A:75 D:75 |
| 13 | Confident | PUT validation does NOT reject names that don't match current sessions | Stale names fall to bottom via existing `orderedSessions` sort; strict validation races with concurrent session creation. Standard tolerance pattern. | S:70 R:75 A:75 D:75 |

13 assumptions (8 certain, 5 confident, 0 tentative, 0 unresolved).
