# Plan: Session/Window Tile Grid on /$server with Live Pane Previews

**Change**: 260701-70a0-session-window-tile-grid
**Intake**: `intake.md`

## Requirements

### Backend: Per-window pane-text preview capture

#### R1: Reuse the existing capture primitive from the active pane
The enrichment path SHALL capture a window's pane text via the existing `tmux.CapturePane(paneID, lines, server)` (`app/backend/internal/tmux/tmux.go:1320`), targeting the window's **active pane** — the `PaneInfo` in `WindowInfo.Panes` whose `IsActive` is true (falling back to the first pane when none is flagged active). No new tmux helper SHALL be added.

- **GIVEN** a window whose `Panes` slice carries an active pane with `PaneID` `%12`
- **WHEN** a preview is requested for that window
- **THEN** `CapturePane("%12", <lines>, server)` is invoked and its raw text (blank lines preserved) becomes the window's preview snapshot
- **AND** a window with no panes yields no preview entry (skipped, not an error)

#### R2: Capture bounded to expanded windows only
Preview capture SHALL be bounded to windows belonging to sessions that at least one connected client has declared expanded (per R4). Windows in no client's expanded set SHALL NOT be captured.

- **GIVEN** a server with sessions `A` (expanded by a client) and `B` (expanded by no client)
- **WHEN** the SSE poll cycle runs
- **THEN** panes are captured only for windows in session `A`
- **AND** with no client declaring any expanded session, zero panes are captured (capture-nothing default)

#### R3: Capture rides the existing poll cadence
Preview capture SHALL run inside the existing SSE `poll()` cycle — no new goroutine and no new poll loop. The number of lines captured per pane SHALL be 18 (within the specified ~15–20 range), defined as a named constant.

- **GIVEN** the SSE hub is polling a server on its existing cadence
- **WHEN** a poll tick fires
- **THEN** preview capture happens within that same tick, after the sessions broadcast
- **AND** capture per window is deduplicated within a tick (a window captured for the union set is captured once, not once per client)

### Backend: Preview-scope endpoint (bounding signal)

#### R4: Per-connection expanded-set POST
A `POST /api/preview-scope` endpoint SHALL accept a JSON body `{ "conn": "<connId>", "expanded": ["<sessionName>", ...] }` and set the expanded-session set for the SSE connection identified by `conn`. The endpoint MUST be POST (Constitution IX). The expanded set SHALL be stored in-memory on the matching `sseClient`, scoped to that connection, and dropped on disconnect (Constitution II — no database).

- **GIVEN** an open SSE connection carrying connection id `abc`
- **WHEN** the client POSTs `{ "conn": "abc", "expanded": ["session-1"] }` for that connection's server
- **THEN** that connection's expanded set becomes `{session-1}` and the next poll emits a preview event covering `session-1`'s windows
- **AND** an empty `expanded` array clears the set (capture-nothing)
- **AND** a POST whose `conn` matches no live connection on that server is a no-op returning `200`
- **AND** a POST with an invalid/oversized body returns `400`

#### R5: Connection identity threaded from the client
The SSE stream endpoint SHALL correlate a connection to a client-supplied identifier read from the `conn` query parameter (`GET /api/sessions/stream?server=<s>&conn=<id>`), consistent with the existing per-connection relay identity model. The identifier SHALL be stored on the `sseClient`. When absent, the connection simply has no addressable id (its expanded set can never be set, so it captures nothing).

- **GIVEN** the frontend opens `GET /api/sessions/stream?server=default&conn=abc`
- **WHEN** the SSE hub registers the client
- **THEN** the `sseClient` carries `connID == "abc"`
- **AND** the same `abc` used in a later preview-scope POST addresses exactly that connection

### Backend: SSE delivery — separate `event: preview`

#### R6: Dedicated lightweight preview event
Preview text SHALL be delivered as a dedicated `event: preview` whose data is a JSON map `{windowId: previewText}`, covering only the windows the receiving connection has expanded. The `event: sessions` payload SHALL be unchanged — no `preview` field added to `WindowInfo`.

- **GIVEN** a connection with `{session-1}` expanded, where `session-1` has windows `@3` and `@5`
- **WHEN** the poll cycle captures previews
- **THEN** that connection receives `event: preview\ndata: {"@3":"...","@5":"..."}`
- **AND** the `event: sessions` payload for that server contains no `preview` field

#### R7: Cached-on-connect preview delivery
A newly-registered SSE connection SHALL receive the latest cached preview snapshot immediately on connect (mirroring the `sessions`/`session-order`/`metrics` cached-on-connect delivery in `addClient`), filtered to that connection's currently-declared expanded windows. Because scope is declared by a POST that arrives after connect, a fresh connection with no scope yet receives nothing (correct: it has expanded nothing).

- **GIVEN** the hub holds a cached preview map for a server
- **WHEN** a new client connects and later declares an expanded set
- **THEN** the client receives previews for its expanded windows on the next poll tick without waiting for pane text to change
- **AND** the emit is a no-op while its expanded set is empty

### Frontend: Session-tiles density view on serverIndexRoute

#### R8: serverIndexRoute renders the tiles view (no new route)
The existing empty `serverIndexRoute` (`app/frontend/src/router.tsx:42`) SHALL render a session-tiles component in place — no new route SHALL be added (Constitution IV). The tiles view SHALL replace the current `Dashboard` render in the no-`$window` branch of `AppShell` (`app.tsx`), reusing the existing `sessions` data, `onNavigate`, `onCreateSession`, and `onCreateWindow` wiring.

- **GIVEN** the URL is `/$server` with no `$window` segment
- **WHEN** `AppShell` renders the content area
- **THEN** the session-tiles view renders (not the old Dashboard)
- **AND** no route entry beyond the existing `serverIndexRoute` / `terminalRoute` is introduced

#### R9: Session tiles expand into window tiles with text previews
Each session SHALL render a tile bearing its name and window count. Expanding a session tile SHALL reveal one window tile per window; each window tile SHALL display the pane **text preview** (the `capture-pane` snapshot) as static, monospace, multi-line text — never an xterm/relay instance. Each tile SHALL reuse the existing `StatusDot` component. Clicking a window tile SHALL navigate to `/$server/$window` (the existing live-terminal route) via the passed `onNavigate`.

- **GIVEN** the tiles view is rendered with a collapsed session `A`
- **WHEN** the user expands `A`
- **THEN** `A`'s window tiles appear, each showing a `StatusDot` and (once previews arrive) the pane text preview as static monospace text
- **AND** clicking a window tile calls `onNavigate(windowId)` (navigates to the live terminal) and opens NO preview relay

#### R10: Preview subscription lifecycle bounded to expansions
The tiles view SHALL open exactly ONE SSE connection per server (the existing `SessionProvider` stream), consume the new `event: preview`, and POST `/api/preview-scope` with the current expanded-session set whenever it changes (expand/collapse). It SHALL NOT open a live relay per tile and SHALL NOT poll via `setInterval`+fetch. On unmount / server change, the declared scope SHALL naturally lapse (connection drop clears server-side state).

- **GIVEN** the tiles view with sessions all collapsed
- **WHEN** the user expands session `A` then collapses it
- **THEN** the client POSTs `{expanded:["A"]}` on expand and `{expanded:[]}` on collapse
- **AND** exactly one SSE connection per server is used for both sessions data and previews (no per-tile relay)

## Tasks

### Phase 1: Backend — capture + per-connection scope plumbing

- [x] T001 Add a `previewCaptureLines` named constant (value `18`) and a `capturePreviewForWindow(w tmux.WindowInfo, server string) (string, bool)` helper (finds the active pane, calls `tmux.CapturePane`, returns text + ok) in a new `app/backend/api/preview.go`. <!-- R1 -->
- [x] T002 Extend `sseClient` in `app/backend/api/sse.go` with `connID string` and `expanded map[string]bool` fields; populate `connID` from a new `conn` query param in `handleSSE` (`serverFromRequest`-adjacent read, validated/trimmed). <!-- R5 -->

### Phase 2: Backend — preview capture + broadcast in poll

- [x] T003 In `app/backend/api/sse.go`, add a `previousPreviewJSON map[string]string` per-server cache field to `sseHub` and initialize it in `newSSEHub`; add a `setPreviewScope(server, connID string, expanded []string)` method that finds the matching client and replaces its `expanded` set under the hub lock. <!-- R4 -->
- [x] T004 In `poll()`, after the sessions broadcast for each server, compute the union of expanded session names across that server's clients; capture previews (once per window, deduped) for windows in those sessions using `capturePreviewForWindow`; cache the full union map in `previousPreviewJSON`; then send each client an `event: preview` filtered to ITS expanded windows. Skip entirely when the union is empty. <!-- R2 R3 R6 -->
- [x] T005 In `addClient` (`app/backend/api/sse.go`), after the metrics cached-on-connect send, deliver the cached preview snapshot filtered to the new client's current expanded set (no-op while empty) — mirroring the sessions/order/metrics cached-on-connect pattern. <!-- R7 -->

### Phase 3: Backend — endpoint + wiring

- [x] T006 Add `handlePreviewScope` in `app/backend/api/preview.go`: decode `{conn, expanded}` (bounded body, `400` on malformed), resolve server via `serverFromRequest`, call `s.initSSEHub()` then `s.sseHub.setPreviewScope(...)`, return `200 {ok:true}`. Register `r.Post("/api/preview-scope", s.handlePreviewScope)` in `app/backend/api/router.go`. <!-- R4 -->

### Phase 4: Frontend — tiles view + preview subscription

- [x] T007 Add `preview` event support to `SessionProvider` (`app/frontend/src/contexts/session-context.tsx`): generate a per-connection `connId` (crypto.randomUUID) per pooled server, append `&conn=<id>` to the stream URL, add `previewsByServer: Map<string, Record<string,string>>` state + an `es.addEventListener("preview", ...)` handler that merges the map into the server's slice, and expose `previewsByServer` + `connIdByServer` + a `setPreviewScope(server, expanded[])` context method (posts `/api/preview-scope`). <!-- R6 R10 -->
- [x] T008 Add `setPreviewScope` API client function in `app/frontend/src/api/client.ts` (POST `/api/preview-scope` with `{conn, expanded}`, `withServer`). <!-- R4 R10 -->
- [x] T009 Create `app/frontend/src/components/session-tiles/session-tiles.tsx` — a tiles/dashboard view: session tiles that expand into window tiles, each window tile rendering `StatusDot` + the static monospace pane preview text, click → `onNavigate(windowId)`; on expand/collapse-set change it calls the context `setPreviewScope(server, expandedSessionNames)`. Consume `previewsByServer` for the current server. <!-- R8 R9 R10 -->
- [x] T010 Replace the `Dashboard` render in the no-`$window` branch of `AppShell` (`app/frontend/src/app.tsx`) with the new session-tiles view, passing the existing `sessions`, `onNavigate`, `onCreateSession`, `onCreateWindow`, and `server`. <!-- R8 -->

### Phase 5: Tests

- [x] T011 [P] Go test in `app/backend/api/preview_test.go`: `handlePreviewScope` sets scope and the poll emits an `event: preview` covering only expanded windows; empty scope emits nothing; unknown `conn` is a no-op `200`; malformed body → `400`. Include a unit test for `capturePreviewForWindow` active-pane selection. <!-- R1 R2 R4 R6 -->
- [x] T012 [P] Frontend unit test `app/frontend/src/components/session-tiles/session-tiles.test.tsx`: session tiles render, expanding reveals window tiles with preview text + StatusDot, clicking a window tile calls onNavigate, expand/collapse triggers setPreviewScope with the right session set, and NO relay/xterm is mounted. <!-- R8 R9 R10 -->
- [x] T013 [P] Playwright e2e `app/frontend/tests/e2e/session-tiles.spec.ts` + sibling `session-tiles.spec.md` (Constitution Test Companion Docs): landing on `/$server` shows session tiles; expanding a session reveals window tiles; clicking a window tile navigates to the live terminal route. <!-- R8 R9 -->

## Execution Order

- Phase 1 (T001, T002) before Phase 2 (T003–T005) — poll/capture depend on the constant, helper, and `sseClient` fields.
- T003 blocks T004 and T005 (they use `expanded`/`previousPreviewJSON`).
- Phase 3 (T006) depends on T003 (`setPreviewScope`).
- Phase 4 frontend (T007–T010) depends on the endpoint (T006) and event (T004) existing; T009 depends on T007/T008; T010 depends on T009.
- Phase 5 tests after their targets; T011/T012/T013 are mutually `[P]`.

## Acceptance

### Functional Completeness

- [x] A-001 R1: Previews are captured via the existing `tmux.CapturePane` from the window's active pane; no new tmux helper was added.
- [x] A-002 R2: Only windows in a client's expanded sessions are captured; empty scope captures nothing.
- [x] A-003 R3: Capture runs inside the existing `poll()` cycle (no new goroutine/loop) with an 18-line named constant, deduped per window per tick.
- [x] A-004 R4: `POST /api/preview-scope` sets a connection's expanded set in-memory (no DB), is POST-only, and CORS `AllowedMethods` stays `[GET, POST, OPTIONS]`.
- [x] A-005 R5: The SSE `sseClient` carries a `connID` read from the `conn` query param, matching the per-connection relay identity model.
- [x] A-006 R6: Previews travel on a dedicated `event: preview` `{windowId:text}` map; the `event: sessions` payload and `WindowInfo` are unchanged (no `preview` field).
- [x] A-007 R7: A newly-connected client receives the cached preview snapshot filtered to its expanded set (no-op while empty).
- [x] A-008 R8: `serverIndexRoute` renders the session-tiles view in place with no new route added.
- [x] A-009 R9: Window tiles show static monospace pane-preview text and reuse `StatusDot`; clicking navigates to `/$server/$window` and opens no preview relay.
- [x] A-010 R10: The tiles view uses the single per-server SSE stream + `setPreviewScope` POST on expand/collapse; no per-tile relay, no client `setInterval` polling.

### Behavioral Correctness

- [x] A-011 R2: Collapsing all sessions results in a `{expanded:[]}` POST and the backend captures nothing on subsequent ticks.
- [x] A-012 R9: Expanding a session shows its window tiles' previews only after `event: preview` arrives; the view degrades gracefully (empty preview area) before the first snapshot.

### Edge Cases & Error Handling

- [x] A-013 R4: A preview-scope POST with an unknown `conn` returns `200` as a no-op; a malformed/oversized body returns `400`.
- [x] A-014 R1: A window with no panes (or no active pane flagged) is handled without error (skipped / first-pane fallback).
- [x] A-015 R4: The per-connection expanded set is dropped on SSE disconnect (removeClient) with no leaked hub state.

### Code Quality

- [x] A-016 Pattern consistency: New code follows surrounding patterns — Go tmux exec via the existing `CapturePane` (Constitution I), SSE broadcast/cached-on-connect mirrors `sessions`/`session-order`/`metrics`, frontend consumes SSE (no client polling), StatusDot reused.
- [x] A-017 No unnecessary duplication: Reuses `tmux.CapturePane`, `StatusDot`, `withServer`/`throwOnError` client helpers, and the existing SessionProvider stream rather than reimplementing them.
- [x] A-018 No magic numbers: The 18-line capture depth is a named constant.
- [x] A-019 SSE disconnect safety: The preview path and preview-scope handler never throw on client disconnection; per-connection state is cleaned up on removeClient.

### Security

- [x] A-020 R1: All tmux interaction goes through `tmux.CapturePane` (`exec.CommandContext` + timeout, arg slices) — no shell strings, no inline tmux construction (Constitution I).

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- `run-kit/tmux-sessions` memory modify is conditional and NOT triggered: no per-window active-pane resolution helper was needed (the active pane ID is already present on `WindowInfo.Panes`).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Active pane ID sourced from `WindowInfo.Panes` (the `IsActive` pane), so no new tmux resolution helper is added | `ListWindows` already populates `Panes` with `PaneID`+`IsActive` (verified `tmux.go:444`/`582`); intake Assumption 3 + conditional memory note confirm | S:95 R:85 A:100 D:90 |
| 2 | Confident | Connection correlation = client-generated `conn` UUID passed as SSE query param AND in the preview-scope POST body; hub keys per-connection state on it | Intake left "the exact per-connection correlation mechanism" for apply; a query-param conn id is the lightest fit with the per-connection relay identity model and needs no header/cookie plumbing | S:70 R:55 A:70 D:75 |
| 3 | Confident | Union-capture per server, deduped per window, then per-client filtered emit; full union map cached for cached-on-connect | Bounds capture cost to the expanded union (matches "only expanded/visible"), dedups repeated windows across clients, and gives one cache to seed new clients — the natural seam over the existing poll | S:75 R:60 A:75 D:70 |
| 4 | Confident | Expanded set is keyed by session NAME (the SSE session identity the client already holds), matching the intake body shape `{expanded:[<sessionId>]}` | run-kit session identity in the SSE snapshot is the session name (`ProjectSession.Name`); the frontend expand-state in Dashboard is already keyed by `session.name` | S:80 R:60 A:80 D:75 |
| 5 | Confident | The tiles view REPLACES the current `Dashboard` render in the no-`$window` branch rather than adding a sibling component | Intake says enrich the empty index route; the Dashboard is what currently fills that branch and is the exact expand-into-window-cards pattern, so replacing it keeps one density surface (no dead duplicate) | S:70 R:55 A:70 D:65 |
| 6 | Confident | Capture depth fixed at 18 lines (named constant) | Intake Assumption 5 specifies ~15–20; 18 is the mid-range reversible constant | S:75 R:90 A:85 D:85 |

6 assumptions (1 certain, 5 confident, 0 tentative).
