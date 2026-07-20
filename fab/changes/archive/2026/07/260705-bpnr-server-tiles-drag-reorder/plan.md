# Plan: Server Tiles Drag Reorder

**Change**: 260705-bpnr-server-tiles-drag-reorder
**Intake**: `intake.md`

## Requirements

### Backend: `@rk_server_rank` Persistence

#### R1: Per-server rank tmux user option
The tmux layer SHALL persist a per-server integer rank in the server-scoped user option `@rk_server_rank`, read/written with the exact mechanism of `@rk_session_order` (`show-option -sv` to read, `set-option -s` to write, via `tmuxExecRawServer` under `context.WithTimeout(ctx, TmuxTimeout)`). Unset / "no server running" / "failed to connect" / "invalid option" / "unknown option" SHALL be treated as "no rank" (nil), never an error — mirroring `GetSessionOrder`'s taxonomy. A malformed integer value SHALL propagate as a wrapped error.

- **GIVEN** a running tmux server with no `@rk_server_rank` set
- **WHEN** `GetServerRank(ctx, server)` is called
- **THEN** it returns `(nil, nil)` (no rank, no error)
- **AND** **WHEN** `SetServerRank(ctx, server, 3)` then `GetServerRank(ctx, server)` is called
- **THEN** it returns `(*int == 3, nil)` (lossless round-trip)

#### R2: Rank read never breaks a dead-server case
- **GIVEN** no tmux server is running on a socket name
- **WHEN** `GetServerRank(ctx, server)` is called
- **THEN** it returns `(nil, nil)` — the absent socket is a normal state, not a 5xx-worthy error

### Backend: API — rank field + order endpoint

#### R3: `rank` field on `GET /api/servers`
Each `serverInfo` entry SHALL gain a nullable `rank *int` field (JSON `rank: 3` or `rank: null` when unset), read inside the existing per-server `ListSessions` fan-out goroutine (one extra tmux call per server, same concurrency pattern; a read failure yields `null` rank, never a 5xx). The array's alphabetical order SHALL NOT change (asserted contract — `servers_test.go` `TestHandleServersList_ReturnsAllServersIncludingTestSockets` / `TestHandleServersList_SortedAlphabetically`).

- **GIVEN** two servers, one with rank 0 and one with no rank
- **WHEN** `GET /api/servers` is requested
- **THEN** the response is alphabetical by name, each entry carries `rank` (`0` / `null` respectively)
- **AND** a per-server rank-read error yields `rank: null` for that entry with HTTP 200 overall

#### R4: `POST /api/servers/order` writes ranks best-effort
A new `POST /api/servers/order` endpoint SHALL accept `{"order": ["srv-a", "srv-b", ...]}`, validate each name via `validate.ValidateServerName`, then write rank `i` to the i-th listed server (fan-out, best-effort per server — one unreachable server logs a warning and is skipped; the next full write self-heals). It SHALL return `{"ok": true}` (HTTP 200) and be registered in `router.go`. POST per Constitution IX. A malformed body or an invalid name SHALL return HTTP 400 before any tmux write.

- **GIVEN** a valid `{"order": ["a", "b", "c"]}`
- **WHEN** `POST /api/servers/order` is requested
- **THEN** rank 0 is written to `a`, 1 to `b`, 2 to `c`, and the response is `{"ok": true}`
- **AND** **GIVEN** an order containing an invalid server name
- **WHEN** the endpoint is requested
- **THEN** it returns HTTP 400 and writes no ranks

#### R5: Server-global `event: server-order` SSE broadcast + snapshot replay
On a successful `POST /api/servers/order`, the SSE hub SHALL broadcast a **server-global** `event: server-order` carrying `{"order": [names]}` to EVERY connected client (all per-server streams AND the `?metrics=1` metrics-only stream), following the `event: metrics` / `event: services` server-global fan-out pattern. The latest payload SHALL be cached in a single global slot and replayed to every newly-connecting client during `addClient` (connect-time snapshot replay), so a late-joining Cockpit client with zero attached servers still receives the current order without a fetch race.

- **GIVEN** clients connected on a per-server stream and on the `?metrics=1` stream
- **WHEN** `POST /api/servers/order` succeeds with order `["a","b"]`
- **THEN** both clients receive `event: server-order` with `data: {"order":["a","b"]}`
- **AND** **WHEN** a new client connects afterward
- **THEN** it receives the cached `event: server-order` snapshot immediately on connect

### Frontend: rank-aware ordering + event consumption

#### R6: Rank-aware `compareServers` composition at the fetch choke point
The frontend SHALL compose an effective sort key of **(infra-class, rank, name)**: infra servers (`isInfraServer`) stay pinned last as a class and ignore rank; within the regular class, ranked servers sort by rank ascending, unranked servers sort after all ranked ones (byte-order alphabetical among themselves). The sort SHALL remain at the single ingestion choke point (`fetchServers` in `session-context.tsx`) so all four consumer surfaces inherit it. An all-regular-unranked list SHALL remain byte-alphabetical (unchanged from current behavior); the infra class ordering SHALL be unchanged.

- **GIVEN** servers `[{b, rank 1}, {a, rank null}, {a2, rank 0}, {rk-daemon, rank null}]`
- **WHEN** sorted by the rank-aware comparator
- **THEN** the order is `[a2 (rank 0), b (rank 1), a (unranked), rk-daemon (infra last)]`
- **AND** **GIVEN** an all-regular list with no ranks
- **THEN** the sort is byte-alphabetical (unchanged)

#### R7: `ServerInfo.rank` type + `setServerOrder` client
`ServerInfo` SHALL gain an optional `rank?: number | null` field. A `setServerOrder(order: string[])` client function SHALL POST `{order}` to `/api/servers/order` (server-independent, like `listServers`/`createServer`/`killServer`). SessionContext SHALL listen for `event: server-order` and re-sort the held `servers` array (state update via the same rank-aware comparator, no refetch).

- **GIVEN** SessionContext holds a `servers` list
- **WHEN** an `event: server-order` with a new order arrives
- **THEN** `servers` is re-sorted so the ranks implied by the new order take effect, with no `/api/servers` refetch

### Frontend: drag surfaces (two tile grids)

#### R8: Sidebar ServerPanel tile drag reorder
Sidebar Server-panel tiles SHALL become draggable via HTML5 DnD using custom MIME `application/x-server-reorder`, following the session-reorder pattern (`setData` on start, `types.includes` guard on over, insert-before semantics, drop commits + POSTs the full new order). Infra tiles (`isInfraServer`) SHALL NOT be draggable and SHALL NOT be valid drop targets. Optimistic feedback SHALL use the derive-over-store override pattern (a render-time override ref holds the dragged order, cleared when the authoritative order element-wise equals it — no whole-array watcher effect, no snap-back on drag-end). Touch devices get no drag (HTML5 DnD limitation, accepted).

- **GIVEN** a regular server tile in the sidebar
- **WHEN** the user drags it before another regular tile and drops
- **THEN** the tiles reorder optimistically and `POST /api/servers/order` is sent with the new full order
- **AND** the SESSIONS-tree groups and every other server consumer follow the new order once the SSE echo lands
- **AND** an infra tile cannot initiate a drag or accept a drop

#### R9: Cockpit TMUX SERVERS grid drag reorder
The Cockpit `/` TMUX SERVERS tile grid (`server-list-page.tsx`) SHALL get the same drag treatment on its server tile buttons, sharing the reorder handler logic rather than duplicating it. Infra tiles SHALL NOT be draggable/droppable. The SESSIONS-tree server groups and palette entries follow the order (via the choke point) but expose NO server-level drag affordance.

- **GIVEN** the Cockpit page with ≥2 regular server tiles
- **WHEN** the user drags one before another and drops
- **THEN** the grid reorders optimistically and `POST /api/servers/order` is sent

### Frontend: command palette Move up/down

#### R10: Palette `Server: Move up` / `Server: Move down`
The palette SHALL add `Server: Move up` / `Server: Move down` actions acting on the **current** route-context server (matching `Server: Kill` semantics). Each computes the new full effective order (regular-class only) by swapping the current server one position and POSTs it via `setServerOrder`. The action SHALL be a no-op / hidden when the current server is infra or already at its class boundary (no wraparound).

- **GIVEN** the current server is regular and not at the top of the regular class
- **WHEN** `Server: Move up` is invoked
- **THEN** the current server swaps one position earlier and the full new order is POSTed
- **AND** **GIVEN** the current server is infra OR at the boundary
- **THEN** the corresponding action is absent (or a no-op)

#### R11: Palette `Session: Move up` / `Session: Move down`
The palette SHALL add `Session: Move up` / `Session: Move down` acting on the current route-context session, computing the effective session order (override ?? SSE order ?? natural), swapping the current session one position, and persisting via the existing `setSessionOrder` client. Boundary = no-op / hidden, no wraparound.

- **GIVEN** the current session is not first in the effective order
- **WHEN** `Session: Move up` is invoked
- **THEN** the session swaps one position earlier and the new order is persisted via `setSessionOrder`

#### R12: Palette `Window: Move up` / `Window: Move down`
The palette SHALL add `Window: Move up` / `Window: Move down` acting on the current route-context window, moving it one index within its session via the existing `moveWindow(server, windowId, targetIndex)` client. Boundary = no-op / hidden, no wraparound. (The existing `Window: Move Left` / `Window: Move Right` actions already implement this operation; the new entries provide the up/down vocabulary parity the intake requires without regressing the existing ones.)

- **GIVEN** the current window is not at the lowest index in its session
- **WHEN** `Window: Move up` is invoked
- **THEN** the window moves one index earlier via `moveWindow` and the URL navigates to the same stable window ID

### Non-Goals

- No touch-based drag (HTML5 DnD does not fire on touch — the palette Move commands are the touch/keyboard path).
- No new routes or pages (Constitution IV).
- No GET twin for `/api/servers/order` — rank rides `/api/servers` already.
- No change to the backend `/api/servers` array ordering (stays alphabetical — display order is a frontend concern).
- No cross-server drag (unchanged; server reorder is same-host, within the single `/api/servers` list).

### Design Decisions

1. **Rank stored per-server as `@rk_server_rank`** (int-as-string) — *Why*: order data rides each server; a killed server takes only its own rank, no cross-server merge rule; mirrors `@rk_session_order`; satisfies Constitution II. *Rejected*: replicated JSON list on one server, filesystem file.
2. **`event: server-order` is server-GLOBAL with a single cached slot** — *Why*: the Cockpit `/` has zero attached per-server streams but must still hear order changes; matches `event: metrics`/`event: services` fan-out. *Rejected*: reusing the per-server `session-order` broadcast shape (would not reach `?metrics=1` clients and would need per-server caching semantics that don't fit a host-global concern).
3. **Rank-aware comparator wraps `compareServers`** rather than replacing it — *Why*: preserves the existing infra-last + byte-order class semantics (and its tests) verbatim while inserting rank as a secondary key inside the regular class.
4. **Palette `Window: Move up/down` are NEW entries alongside existing `Window: Move Left/Right`** — *Why*: the intake explicitly requires up/down parity across all three levels; the existing Left/Right actions are kept to avoid regressing current behavior/tests.

## Tasks

### Phase 1: Backend persistence

- [x] T001 Add `ServerRankOption = "@rk_server_rank"` constant and `GetServerRank(ctx, server) (*int, error)` / `SetServerRank(ctx, server, rank int) error` to `app/backend/internal/tmux/tmux.go`, mirroring `GetSessionOrder`/`SetSessionOrder` (same `tmuxExecRawServer` + `context.WithTimeout(ctx, TmuxTimeout)`, same unset/no-server/failed-to-connect/invalid-option taxonomy → nil; `strconv.Atoi` decode error wrapped). <!-- R1 R2 -->
- [x] T002 Add `internal/tmux` round-trip + unset-taxonomy tests to `app/backend/internal/tmux/tmux_test.go` (reuse the `withSessionOrderTmux` isolated-server helper pattern): unset returns `(nil, nil)`; `SetServerRank`→`GetServerRank` round-trips a value; overwrite replaces. <!-- R1 R2 -->

### Phase 2: Backend API

- [x] T003 Add `Rank *int json:"rank"` to `serverInfo` in `app/backend/api/servers.go` and read it inside the existing `handleServersList` fan-out goroutine (call `s.tmux.GetServerRank(r.Context(), name)`; on error log a warning and leave rank nil). Keep the alphabetical `sort.Slice` unchanged. <!-- R3 -->
- [x] T004 Add `GetServerRank`/`SetServerRank` to the `TmuxOps` interface and the `prodTmuxOps` wrapper in `app/backend/api/router.go`; add the two methods to the test mock (`mockTmuxOps` / `serversTmuxMock`) so existing tests compile. <!-- R3 R4 -->
- [x] T005 Add `handleServerOrderPost` to `app/backend/api/servers.go`: decode `{order:[]string}` (DisallowUnknownFields), validate each name via `validate.ValidateServerName`, write rank `i` best-effort per server (warn+skip on error), then `initSSEHub()` + `s.sseHub.broadcastServerOrder(order)`, return `{"ok": true}`. Register `POST /api/servers/order` in `router.go`. <!-- R4 R5 -->
- [x] T006 Add the server-global `event: server-order` broadcast to `app/backend/api/sse.go`: a single `cachedServerOrderJSON` hub field, a `broadcastServerOrder(order []string)` method that marshals `{order}`, fans out to ALL clients across every server key (like the metrics broadcast), and caches the payload; replay it in `addClient` to every new client (server-global — not gated on `c.server`). <!-- R5 -->
- [x] T007 Add `api` tests to `app/backend/api/servers_test.go`: `GET /api/servers` includes `rank` (value + null) and stays alphabetical (keep the existing order-contract tests passing); `POST /api/servers/order` writes ranks in order and returns `{ok:true}`; invalid name → 400 with no writes. Add an SSE hub test for the server-global `broadcastServerOrder` fan-out + cached-on-connect replay reaching a `metricsOnlyServer` client (follow the existing `broadcastSessionOrder` / metrics-broadcast test patterns). <!-- R3 R4 R5 -->

### Phase 3: Frontend client + context

- [x] T008 In `app/frontend/src/api/client.ts`: add `rank?: number | null` to `ServerInfo`; add a rank-aware comparator (extend/wrap `compareServers` — effective key (infra-class, rank, name); ranked-before-unranked within the regular class); add `setServerOrder(order: string[])` posting `{order}` to `/api/servers/order`. <!-- R6 R7 -->
- [x] T009 In `app/frontend/src/contexts/session-context.tsx`: sort with the rank-aware comparator at the `fetchServers` choke point; add an `event: server-order` listener on both the per-server pool streams and the dedicated `?metrics=1` stream that re-sorts the held `servers` array (state update, no refetch). <!-- R6 R7 -->
- [x] T010 [P] Add Vitest cases to `app/frontend/src/api/client.test.ts` for the rank-aware comparator: rank ascending within regular class, unranked sorts after ranked (alphabetical), infra still pinned last & ignores rank, all-regular-unranked stays byte-alphabetical (regression guard for R6). <!-- R6 -->
- [x] T011 [P] Add a Vitest test to `app/frontend/src/contexts/session-context.test.tsx` asserting a `server-order` SSE event re-sorts `ctx.servers` without a refetch (use the existing `MockEventSource`/`SessionProvider` pattern). <!-- R7 -->

### Phase 4: Frontend drag surfaces + palette

- [x] T012 Lift a shared server-reorder handler/hook (start/over/end + derive-over-store `orderOverrideRef` + debounced `setServerOrder` + render-time equality reconcile) usable by both grids — model on the sidebar session-reorder handlers (`sidebar/index.tsx:657-697`, `:1092-1105`). Place it where both `server-panel.tsx` and `server-list-page.tsx` can consume it (e.g. a small `use-server-reorder` hook in `app/frontend/src/hooks/`), keyed on the effective displayed order derived from `ctx.servers`. <!-- R8 R9 -->
- [x] T013 Wire drag reorder into the Sidebar `ServerPanel` tiles (`app/frontend/src/components/sidebar/server-panel.tsx`): `draggable` on regular `ServerTile`s only, `application/x-server-reorder` MIME, insert-before semantics on `dragOver`, drop commits + POSTs; infra tiles are neither draggable nor drop targets. <!-- R8 -->
- [x] T014 Wire the same drag reorder into the Cockpit TMUX SERVERS grid buttons (`app/frontend/src/components/server-list-page.tsx:272-290`) using the shared handler from T012; infra tiles excluded. <!-- R9 -->
- [x] T015 Add palette actions in `app/frontend/src/app.tsx`: `Server: Move up`/`Server: Move down` in `serverActions` (compute new full regular-class order, POST via `setServerOrder`; hidden when current server is infra or at boundary). <!-- R10 -->
- [x] T016 Add `Session: Move up`/`Session: Move down` in `sessionActions` (effective session order override??SSE??natural, swap current session, persist via existing `setSessionOrder`; boundary no-op/hidden). <!-- R11 -->
- [x] T017 Add `Window: Move up`/`Window: Move down` in `windowActions` (move current window ±1 index via existing `moveWindow`, navigate to same window ID; boundary no-op/hidden), preserving the existing `Window: Move Left`/`Right` entries. <!-- R12 -->

### Phase 5: E2E

- [x] T018 Add a Playwright e2e (`app/frontend/tests/e2e/server-reorder.spec.ts` + sibling `.spec.md` companion per Constitution): drag a sidebar server tile and assert both the tile grid and the SESSIONS-tree group order follow; invoke palette `Server: Move down` and assert reorder. Use the existing multi-server e2e harness patterns (`withServer` route mocks with trailing `*`, per memory note); treat pre-existing unrelated e2e failures as out of scope. <!-- R8 R9 R10 -->

### Phase 6: Review Rework (cycle 1)

<!-- rework cycle 1: review verdict fail — untested drag hook + palette Move actions (must-fix), zero-call-site isDragging (must-fix), missing debounce unmount cleanup (should-fix), two trivial cleanups (nice-to-have) -->

- [x] T019 Add `app/frontend/src/hooks/use-server-reorder.test.ts` (Vitest) covering the hook's reorder logic: MIME-type discrimination (`application/x-server-reorder` accepted, others ignored), insert-before splice correctness (up/down/first/last targets), infra tiles excluded as source and target, optimistic override seeding + render-time reconcile (override cleared when authoritative order element-wise matches), and debounce + drop-flush POST behavior (single `setServerOrder` call with the final order). <!-- R8 R9 -->
- [x] T020 Add Vitest coverage for the six palette Move actions in `app/frontend/src/app.tsx` (extract the order-computation helpers into testable functions if needed): `Server: Move up/down` full-new-order computation with infra pinned and boundary hidden/no-op, `Session: Move up/down` effective-order (override ?? SSE ?? natural) swap, `Window: Move up/down` targetIndex ±1 with boundary no-op and Move Left/Right preserved. <!-- R10 R11 R12 -->
- [x] T021 Consume `isDragging` from `use-server-reorder.ts` in BOTH grids (sidebar `server-panel.tsx` tile + Cockpit `server-list-page.tsx` tile): drag-source visual feedback via the session-reorder pattern (`opacity-50` on the dragged tile), resolving the zero-call-site finding in the pattern-consistent direction (do NOT delete the field). <!-- R8 R9 -->
- [x] T022 Add the mount-scoped unmount cleanup effect for the debounce timer in `app/frontend/src/hooks/use-server-reorder.ts`, mirroring `sidebar/index.tsx:258-262`: `useEffect(() => () => { if (putTimerRef.current) clearTimeout(putTimerRef.current); }, [])`. <!-- R8 -->
- [x] T023 Cleanups: delete the dead empty `afterAll` in `app/frontend/tests/e2e/server-reorder.spec.ts:10-16`; trim the inaccurate React-bail comment at `app/frontend/src/contexts/session-context.tsx:201-204`; verify the `.spec.md` Vitest-coverage claim now matches reality (after T019/T020 it becomes true — adjust wording if needed). <!-- R8 -->

## Execution Order

- T001 blocks T002, T003, T004, T005.
- T004 (interface/mock) blocks T007 compiling.
- T005 depends on T006 (`broadcastServerOrder` must exist).
- T008 blocks T009, T010, T012.
- T012 blocks T013, T014.
- T010, T011 are `[P]` (independent test files).
- T015–T017 depend on T008 (`setServerOrder`) and the effective-order derivations.
- T018 depends on the full frontend chain (T009, T013, T015).
- T019, T020 are `[P]` (independent test files); T021 blocks T019's drag-source assertions only if written against tile props — otherwise independent.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `tmux.GetServerRank`/`SetServerRank` exist, use `@rk_server_rank` via `tmuxExecRawServer` with a timeout, and round-trip a value losslessly.
- [x] A-002 R2: `GetServerRank` returns `(nil, nil)` for unset / no-server / failed-to-connect / invalid-option cases (never a bubbled error).
- [x] A-003 R3: `GET /api/servers` entries carry a nullable `rank` field read in the existing fan-out; the array stays alphabetical (order-contract tests pass).
- [x] A-004 R4: `POST /api/servers/order` validates names, writes ranks 0..N-1 best-effort, returns `{ok:true}`, and is registered in `router.go`; invalid input → 400.
- [x] A-005 R5: a successful order POST broadcasts a server-global `event: server-order` to all clients (incl. `?metrics=1`) and replays a cached snapshot on new-client connect.
- [x] A-006 R6: the rank-aware comparator produces (infra-class, rank, name) ordering; unranked sort after ranked; infra ignore rank and stay last.
- [x] A-007 R7: `ServerInfo.rank` exists, `setServerOrder` POSTs `{order}`, and SessionContext re-sorts on `server-order` without a refetch.
- [x] A-008 R8: sidebar server tiles reorder via HTML5 DnD (custom MIME, insert-before, optimistic derive-over-store) and POST the new order; infra tiles are not draggable/droppable.
- [x] A-009 R9: the Cockpit TMUX SERVERS grid reorders via the same shared handler; infra tiles excluded.
- [x] A-010 R10: palette `Server: Move up/down` act on the current server, POST the full new order, and are hidden/no-op at infra/boundary.
- [x] A-011 R11: palette `Session: Move up/down` reorder the current session via `setSessionOrder`; boundary no-op.
- [x] A-012 R12: palette `Window: Move up/down` move the current window via `moveWindow`; boundary no-op; existing Move Left/Right preserved.

### Behavioral Correctness

- [x] A-013 R3: an existing `/api/servers` consumer sees no ordering change (still alphabetical) and simply gains the `rank` key.
- [x] A-014 R6: an all-regular unranked server list renders byte-alphabetical, identical to pre-change behavior (no regression to the #311 comparator tests).

### Scenario Coverage

- [x] A-015 R1: `internal/tmux` tests cover unset→nil and set→round-trip.
- [x] A-016 R4 R5: `api` tests cover the order POST (valid + invalid name) and the server-global SSE broadcast + cached-on-connect replay (incl. a metrics-only client).
- [x] A-017 R6 R7: Vitest covers the comparator and the `server-order` context re-sort.
- [x] A-018 R8 R9 R10: the server-reorder e2e (`server-reorder.spec.ts` + sibling `.spec.md`) covers the API+SSE slice end-to-end (order POST, rank field, server-global broadcast incl. a `?metrics=1` client); the drag-handler and palette-Move logic is covered by Vitest (A-026, A-027). <!-- revised at rework cycle 1: the original live-drag e2e is infeasible in the harness (RK_SERVER_ALLOWLIST=rk-test-e2e — a single infra-classed server, so no drag/palette surface exists; the analogous session-drag e2e is test.fixme) — acceptance now matches the reviewed descope, with the compensating Vitest coverage made real by T019/T020 -->
- [x] A-026 R8 R9: `use-server-reorder.ts` has Vitest coverage for MIME discrimination, insert-before splice, infra exclusion, override seed/reconcile, and debounce/drop-flush.
- [x] A-027 R10 R11 R12: all six palette Move actions have Vitest coverage for order computation, boundary behavior, and infra gating.
- [x] A-028 R8 R9: the drag-source tile shows visual feedback (`isDragging` consumed by both grids, session-reorder `opacity-50` pattern) — no zero-call-site exports remain in the hook.
- [x] A-029 R8: the reorder debounce timer is cleared on unmount (no stray post-unmount POST).

### Edge Cases & Error Handling

- [x] A-019 R4: a partial write failure (one unreachable server) warns and skips without failing the whole POST (self-heals on next full write).
- [x] A-020 R8 R10: reorder at a class boundary and on infra servers is a no-op (no wraparound, infra never moves).

### Code Quality

- [x] A-021 Pattern consistency: new Go code follows the `GetSessionOrder`/`SetSessionOrder` and `handleSessionOrderPost` shapes; new frontend code follows the derive-over-store reorder and server-global SSE-listener patterns.
- [x] A-022 No unnecessary duplication: the two drag grids share one reorder handler (not copy-pasted); the comparator reuses `isInfraServer`/`compareServers`; palette Session/Window moves reuse existing `setSessionOrder`/`moveWindow`.
- [x] A-023 Security (Constitution I/Process Execution): all new tmux calls go through `internal/tmux/` via `tmuxExecRawServer` with `context.WithTimeout`; no shell strings; server names validated before any subprocess.
- [x] A-024 Uniform verb (Constitution IX): the new mutation is `POST /api/servers/order` (no PUT/PATCH/DELETE).
- [x] A-025 Test companion docs: every new/modified `.spec.ts` ships a sibling `.spec.md`.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/frontend/src/app.tsx` `Window: Move Left` / `Window: Move Right` palette entries (ids `move-window-left`/`move-window-right`) — the new `Window: Move up`/`Window: Move down` entries perform the identical `moveWindow(±1)` operation with identical boundary gating; four palette entries now express two operations. Kept deliberately per plan Design Decision 4 (avoid regressing existing behavior/tests), so this is a flagged consolidation candidate for a future change, not an auto-delete.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | New tmux funcs named `GetServerRank`/`SetServerRank` with `ServerRankOption = "@rk_server_rank"`, mirroring `GetSessionOrder`/`SetSessionOrder` structure and error taxonomy | Intake specifies the exact mechanism + option name; the `@rk_session_order` pair at tmux.go:1608-1670 is the deterministic template | S:90 R:80 A:90 D:90 |
| 2 | Certain | `rank` is a nullable `*int` JSON field (`rank: 3` / `rank: null`), read in the existing `handleServersList` fan-out; array stays alphabetical | Intake states this verbatim and cites the asserted `servers_test.go` order contract | S:90 R:75 A:90 D:90 |
| 3 | Certain | `POST /api/servers/order` `{order:[names]}` writes rank i best-effort, returns `{ok:true}`, no GET twin | Intake specifies the body/semantics; mirrors `handleSessionOrderPost` minus GET | S:85 R:75 A:85 D:85 |
| 4 | Confident | `event: server-order` is server-global with a SINGLE cached slot fanned to all clients (incl. `?metrics=1`) and replayed on connect — NOT the per-server `session-order` shape | Intake requires it reach the zero-attached-server Cockpit; the `event: metrics`/`services` broadcast+cache is the server-global template, distinct from `broadcastSessionOrder`'s per-server cache | S:60 R:65 A:80 D:70 |
| 5 | Confident | Rank-aware comparator WRAPS `compareServers` (adds rank as a secondary key inside the regular class) rather than rewriting it | Preserves the #311 infra-last + byte-order semantics and its existing tests verbatim; minimal-diff | S:60 R:80 A:85 D:75 |
| 6 | Confident | The two drag grids share one lifted reorder hook/handler (e.g. `use-server-reorder`) instead of duplicating; keyed on the effective displayed order from `ctx.servers` | Intake says "lift shared pieces rather than duplicating"; code-quality forbids duplication; the session-reorder handlers are the shape template | S:60 R:70 A:80 D:70 |
| 7 | Confident | Palette `Window: Move up/down` are NEW entries added alongside the existing `Window: Move Left/Right` (same `moveWindow` primitive), not a rename | Intake requires up/down vocabulary for all three levels; renaming would regress existing actions/tests — additive is safer | S:55 R:80 A:80 D:65 |
| 8 | Confident | Palette Server/Session move computes the new order over the REGULAR class only (infra excluded), swapping one position with boundary = hidden/no-op, no wraparound | Intake states boundary=no-op and infra excluded; matches `Server: Kill` current-entity semantics and the existing window Move Left/Right boundary gating | S:60 R:75 A:80 D:70 |
| 9 | Confident | Server reorder writes go through a short debounce (like session reorder's `SESSION_ORDER_DEBOUNCE_MS`) with derive-over-store optimistic override cleared on authoritative-echo equality | Intake mandates the PR #240 optimistic pattern; the sidebar session-reorder debounce+override is the shipped template | S:55 R:75 A:80 D:70 |

9 assumptions (3 certain, 6 confident, 0 tentative).
