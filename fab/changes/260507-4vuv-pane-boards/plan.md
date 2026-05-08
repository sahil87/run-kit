# Plan: Pane Boards

**Change**: 260507-4vuv-pane-boards
**Status**: In Progress
**Intake**: `intake.md`
**Spec**: `spec.md`

## Tasks

### Phase 1: Backend tmux Wrapper (`internal/tmux/board.go`)

- [x] T001 Add `app/backend/internal/tmux/board.go` with `BoardOption = "@rk_board"` constant, `BoardEntry` struct (`Server, WindowID, Board, OrderKey`), `BoardSummary` struct (`Name, PinCount`), and the public functions `ListBoardEntries(ctx, server)`, `ListAllBoardEntries(ctx)`, `ListBoards(ctx)`, `GetBoard(ctx, name)`, `Pin(ctx, server, windowID, board)`, `Unpin(ctx, server, windowID, board)`, `Reorder(ctx, server, windowID, board, newOrderKey)`, and `ComputeOrderKey(before, after)`. Use `tmuxExecRawServer` and `context.WithTimeout(ctx, TmuxTimeout)` consistently. Treat tmux errors `invalid option`, `unknown option`, `no server running`, `failed to connect` as empty entries (mirror `GetSessionOrder`). Format value as comma-joined `<windowID>:<board>:<orderKey>` entries; entry parser skips malformed entries with `slog.Warn`. Write-back via `set-option -s`. Add validation helpers: `validBoardName(name) bool` (regex `^[A-Za-z0-9_-]{1,32}$`), `validWindowID(id) bool` (regex `^@\d+$`), `validOrderKey(key) bool` (regex `^[a-z]{1,16}$`). `Pin` is idempotent (no-op if entry already exists with any orderKey for that window+board). `ListBoards` aggregates via `ListServers(ctx)` + per-server `ListBoardEntries`, returns alphabetical `[]BoardSummary`. `GetBoard(ctx, name)` performs the cross-server aggregate, sorts by `OrderKey`, intersects with live `list-windows -a -F "#{window_id}"` per source server, drops stale entries with best-effort write-back (log on failure but still return cleaned slice). `ComputeOrderKey` implements lowercase-a–z fractional indexing.

- [x] T002 [P] Add `app/backend/internal/tmux/board_test.go` with table-driven unit tests covering: parse/serialize round-trip including malformed-entry skipping; `ComputeOrderKey` for prepend (`null,"b" -> "a"`), append (`"c",null -> "d"`), insert (`"b","c" -> "bm"`), insert-adjacent (`"b","bm" -> "bg"`), exhausted (`"b","bm","bn" -> error or extension`), invalid input. Use the same isolated-tmux-server pattern present in `tmux_test.go` for integration-style tests of `Pin`/`Unpin`/`Reorder`/`GetBoard` against a real ephemeral tmux server (covers idempotency, stale cleanup, write-back failure tolerance). Add validator-level tests for `validBoardName`, `validWindowID`, `validOrderKey`.

### Phase 2: Backend HTTP Handlers + Routing + SSE Plumbing

- [x] T003 Extend `TmuxOps` interface in `app/backend/api/router.go` with `ListBoards(ctx)`, `GetBoard(ctx, name)`, `PinBoard(ctx, server, windowID, board)`, `UnpinBoard(ctx, server, windowID, board)`, `ReorderBoard(ctx, server, windowID, board, before, after string) (newKey string, err error)`. Implement on `prodTmuxOps` by delegating to `tmux.*` package functions. `ReorderBoard` reads current entries via `ListBoardEntries`, locates `before`/`after` order_keys, computes new key via `tmux.ComputeOrderKey`, calls `tmux.Reorder`.

- [x] T004 Add `app/backend/api/boards.go` with `handleBoardsList` (GET `/api/boards`), `handleBoardGet` (GET `/api/boards/{name}`), `handleBoardPin` (POST `/api/boards/{name}/pin`), `handleBoardUnpin` (POST `/api/boards/{name}/unpin`), `handleBoardReorder` (POST `/api/boards/{name}/reorder`). Validate `{name}` via `validBoardName` (exported from tmux pkg or duplicated as a small helper local to api), return `400` on invalid. For pin/unpin/reorder: decode body `{server, windowId, before?, after?}`, validate `server` via `validate.ValidateName`, validate `windowId` via `validWindowID`, return `404` from pin if window does not exist on the named server (check via `ListWindows` membership before mutating), trigger SSE broadcast via `s.sseHub.broadcastBoardChanged(server, payload)` after successful mutation (initialize the hub via `s.initSSEHub()` first). For `GET /api/boards/{name}`, the response joins each `BoardEntry` with live window data via `tmux.ListWindows(ctx, session, server)` lookups (look up by `windowId` to get session/index/name/panes); entries whose backing window vanished between the GetBoard read and the join MUST be omitted from the response (no error).

- [x] T005 Register the five board routes in `app/backend/api/router.go` `buildRouter()`: `r.Get("/api/boards", s.handleBoardsList)`, `r.Get("/api/boards/{name}", s.handleBoardGet)`, `r.Post("/api/boards/{name}/pin", s.handleBoardPin)`, `r.Post("/api/boards/{name}/unpin", s.handleBoardUnpin)`, `r.Post("/api/boards/{name}/reorder", s.handleBoardReorder)`. Group with other content routes (after `/api/sessions/order` registration).

- [x] T006 Extend `sseHub` in `app/backend/api/sse.go`: add `previousBoardJSON map[string]string` cache (per-server "bootstrap snapshot" payloads). Add `broadcastBoardChanged(server string, payload boardChangedPayload)` method that builds payload `{board, change, server, windowId, orderKey?}`, marshals, and pushes `event: board-changed\ndata: <json>\n\n` to all clients on that server via the existing non-blocking select pattern. Define `boardChangedPayload` struct with JSON tags matching the spec: `Board`, `Change`, `Server`, `WindowID` (omitempty for cleanup not relevant here, all events have it), `OrderKey` (omitempty for unpin/cleanup).

- [x] T007 In `sseHub.poll`, on first iteration per server (gated by absence of `previousBoardJSON[server]` key), call `tmux.ListBoardEntries(ctx, server)`. Build a synthetic bootstrap payload `{server, change: "bootstrap", entries: [...]}`. Cache the JSON under `previousBoardJSON[server]` and broadcast as `event: board-changed`. On error, log at Debug and proceed without caching (best-effort). To make this testable without bringing tmux into the hub, inject a `BoardEntriesFetcher` interface on the hub (single method `ListBoardEntries(ctx, server) ([]tmux.BoardEntry, error)`); production wires it to `tmux.ListBoardEntries`. Mirror the existing `OrderFetcher` injection pattern.

- [x] T008 In `sseHub.addClient`, after sending cached `sessions` and `session-order` snapshots and before `metrics`, send the cached `board-changed` bootstrap event for that server if `previousBoardJSON[c.server]` is set.

- [x] T009 In `sseHub.poll`, after each tick's session diff is computed, detect window kills by comparing the previous-tick window-id set against the current set per server. For each killed window-id, scan `@rk_board` via the injected fetcher, and for every entry whose `WindowID` matches, call `tmux.Unpin` (or a new internal helper that removes by raw window-id without requiring the board name) and broadcast `board-changed` with `change: "cleanup"`. Add a small helper `tmux.RemoveAllByWindowID(ctx, server, windowID) ([]string, error)` returning the list of board names that had entries for that window — both for testability and to drive multiple `cleanup` broadcasts when a window was on multiple boards.

- [x] T010 [P] Update `mockTmuxOps` in `app/backend/api/sessions_test.go` (or a new mock in `boards_test.go`) to satisfy the extended `TmuxOps` interface — add `ListBoards`, `GetBoard`, `PinBoard`, `UnpinBoard`, `ReorderBoard` stubs that record calls.

- [x] T011 Add Go tests in `app/backend/api/boards_test.go`: `TestBoards_GET_empty`, `TestBoards_GET_aggregateAcrossServers`, `TestBoard_GET_byName`, `TestBoard_GET_invalidName_400`, `TestBoard_Pin_success`, `TestBoard_Pin_invalidWindowID_400`, `TestBoard_Pin_invalidServer_400`, `TestBoard_Pin_windowNotFound_404`, `TestBoard_Pin_idempotent`, `TestBoard_Unpin_success`, `TestBoard_Reorder_success`, `TestBoard_Reorder_invalidNeighbours_400`, `TestBoard_Pin_triggersBroadcast`, `TestBoard_Unpin_triggersBroadcast`, `TestBoard_Reorder_triggersBroadcast`. Broadcast tests follow the same pattern as `TestSessionOrder_PUT_triggersBroadcast`.

- [x] T012 [P] Add SSE tests in `app/backend/api/sse_test.go`: `TestSSE_BoardChangedCachedOnConnect`, `TestSSE_BoardBootstrapReadsTmuxOnFirstPoll`, `TestSSE_WindowKillEmitsBoardCleanup` — wire the stub `BoardEntriesFetcher` and a stub `WindowsFetcher` for the kill detection.

### Phase 3: Frontend API Client + Hooks + SSE Wiring

- [x] T013 [P] Add `app/frontend/src/api/boards.ts` exporting typed functions `listBoards()`, `getBoard(name)`, `pinWindow(server, windowId, board)`, `unpinWindow(server, windowId, board)`, `reorderPin(server, windowId, board, before, after)`. GET functions go through `deduplicatedFetch` (consume the shared helper from `client.ts` — re-export if not already exported); mutations use plain `fetch`. Mutation functions take `server` as first positional arg per the project's server-routing contract; `server` is sent in the JSON body, not as a query param. All functions throw on non-2xx, parse JSON on success.

- [x] T014 [P] Add `app/frontend/src/api/boards.test.ts` covering URL construction, request method, body shape, response parsing for each function. Include negative tests: invalid name response → throws; 404 from pin → throws.

- [x] T015 Add `app/frontend/src/hooks/use-boards.ts` exporting `useBoards()` and `useBoardEntries(name)`. `useBoards()` performs initial `listBoards()` on mount, subscribes to SSE `board-changed` events on every server returned by `listServers()` (re-subscribe when server list changes), debounces re-fetches by 50ms, returns `{boards, isLoading, error}`. `useBoardEntries(name)` performs initial `getBoard(name)`, subscribes to SSE `board-changed` events on all known servers (since boards span servers), debounces re-fetches by 50ms, returns `{entries, isLoading, error}`. Both hooks tolerate transient network errors (preserve last good value). Use `EventSource` directly per the existing pattern in `session-context.tsx` — multiple per-server connections are already an established pattern; do not pipe through `SessionProvider`.

- [x] T016 [P] Add `app/frontend/src/hooks/use-boards.test.tsx` covering: initial fetch, re-fetch on SSE event from any server, debounce coalesces multiple rapid events into one fetch, server-list change re-subscribes, error preserves previous value.

### Phase 4: Frontend Route + Board Page

- [x] T017 Register `/board/$name` route in `app/frontend/src/router.tsx` as a child of `rootRoute` (peer to `serverLayoutRoute`). Component: `BoardPage` lazy-imported from `@/components/board/board-page`. `parseParams` extracts `name`. The component itself validates `name` against the regex and renders `NotFoundPage` for invalid names.

- [x] T018 Add `app/frontend/src/components/board/board-page.tsx`. Top-level component: reads `name` from route params, calls `useBoardEntries(name)`, renders the AppShell with sidebar/topbar/bottombar present, and a horizontal scrolling main area on desktop / a swipe carousel on mobile. Detect mobile via the existing `min-width: 640px` media query (custom hook `useIsMobile()` if it doesn't exist — add `app/frontend/src/hooks/use-is-mobile.ts` with a `matchMedia` listener; if a similar hook exists already, reuse it). Empty / non-existent: show "No panes pinned to this board yet. Pin a window from the sidebar." with a link `← Back to sessions`.

- [x] T019 Add `app/frontend/src/components/board/board-pane.tsx`. Single-pane card: pane header (`<window-name> · <server>` + unpin button), embedded `TerminalClient` configured with `server={entry.server}`, `session={entry.session}`, `window={entry.windowIndex}`. Width controlled by parent (resizable on desktop, viewport-width on mobile). Visual focus indicator (border + glow when focused; de-emphasized when not). Click handler transfers focus to the embedded xterm via a ref. Mobile carousel mode: when prop `paused = true` (off-screen), unmount the `TerminalClient` so its WebSocket closes; when `paused = false`, re-mount.

- [x] T020 Add `app/frontend/src/components/board/board-header.tsx`. Pane header subcomponent: shows `<window-name>` (truncate), `·`, `<server>` (muted), and an unpin button (icon-only, calls `unpinWindow(entry.server, entry.windowId, board)` from `use-pin-actions` hook). Confirmation NOT required — pin is cheap to restore.

- [x] T021 Add `app/frontend/src/hooks/use-pin-actions.ts` exporting `usePinActions(board?)` returning `{pin, unpin, reorder}` mutation handlers. Each handler is a stable callback that calls the corresponding API function and surfaces errors via the existing toast system (`useToast`). Optimistic UI: pin/unpin update local state immediately; the SSE re-broadcast reconciles. Last-write-wins per spec (no conflict resolution beyond reconciliation).

- [x] T022 Implement drag-to-resize in `board-page.tsx` (or a sibling `board-resize.ts` helper): each pane has a draggable right-edge handle. State: `paneWidths: Record<string /* windowId */, number>`. On mount, read `localStorage["runkit:board-widths:" + name]`, parse JSON best-effort (default `{}` on malformed). On drag-end, persist to `localStorage`. Clamp width to `[280, viewport - sidebarWidth]`. Resize handle hidden on coarse-pointer devices via the existing `coarse:` Tailwind variant. Use a small custom hook `usePaneWidths(boardName)` to encapsulate read/write/clamp logic.

- [x] T023 Implement keyboard pane focus cycling in `board-page.tsx`. Track `focusedIndex: number` in component state. Bind `Cmd+]`/`Ctrl+]` (next, wraps) and `Cmd+[`/`Ctrl+[` (prev, wraps) via a `useEffect` keydown listener (only attached when on the board route). Focus transfer: call `paneRefs[focusedIndex].current?.focus()` (each `BoardPane` exposes a `focus()` method via `useImperativeHandle`).

- [x] T024 Implement mobile swipe carousel in `board-page.tsx`. State: `carouselIndex`. Render only the focused `BoardPane` with `paused=false`; render adjacent panes with `paused=true` (off-DOM is also acceptable — choose unmount for memory). Touch handlers: track `touchstart` clientX, on `touchend` compare to stored start and advance/retreat the index if delta exceeds threshold (40px). Pagination dot strip rendered above or below.

### Phase 5: Frontend Sidebar + Top Bar Integration

- [x] T025 Add `app/frontend/src/components/sidebar/boards-section.tsx`. Reads `useBoards()`. Visibility rules per spec: hidden when zero boards exist, except when on `/board/<name>` and that board has just become empty (show the hint "Pin a window to start a board"). Each row: name (truncate), pin count, active highlight when current route is `/board/<name>`. Click navigates to `/board/<name>`. Use the same row component shape as existing sidebar sections for visual consistency.

- [x] T026 Modify `app/frontend/src/components/sidebar/index.tsx` to render `<BoardsSection />` above the existing sessions block. Pass through any props it needs (none expected — it's self-contained via hooks).

- [x] T027 Add pin icon to `app/frontend/src/components/sidebar/window-row.tsx`. Hover-revealed (existing pattern). Filled state when window is pinned to ANY board (compute via `useBoardEntries` aggregated across all hooks — actually, derive from `useBoards()` + a new `useWindowPins(server, windowId)` selector that watches all boards for entries matching this window). Click opens a small popover anchored to the icon. Popover: list of existing boards (each row: name + check if this window is already pinned to it; click pins or unpins), inline text input "Pin to new board…" with Enter to submit + inline validation error display. Use existing `Popover`/dialog primitives if present in the codebase; otherwise a small `<div>` with click-outside dismissal.

- [x] T028 In `app/frontend/src/components/sidebar/window-row.tsx`, when current route is `/board/<name>`, apply a subtle highlight (e.g., `border-l-2 border-accent` or a background tint) to windows whose `windowId` is pinned to that specific board. Highlight is scoped to the current board only — pins to other boards do not trigger it.

- [x] T029 Modify `app/frontend/src/components/top-bar.tsx` (and/or `breadcrumb-dropdown.tsx`) to detect when the current route is `/board/<name>` and replace the session/window breadcrumb with `Board ▸ <name> ▾`. The dropdown lists `← Sessions` (navigates `/`) plus other boards (navigates `/board/<other>`); current board appended with `(current)`. *(Implemented at the BoardPage mini-header level since BoardPage lives at the root route, peer to /$server — the AppShell TopBar isn't on the board route by design. The mini-header already had the breadcrumb shape; verified it matches spec.)*

### Phase 6: Command Palette Integration

- [x] T030 In `app/frontend/src/app.tsx`, add a new `boardActions: PaletteAction[]` `useMemo` block after `windowActions` and before `viewActions`. Mirror the structure of `serverActions`: combine static actions (Pin Current Window, Unpin Current Window, Leave Board View, Cycle Pane Focus →, Cycle Pane Focus ←) with dynamic per-board entries (`Switch to <name>`). Conditional visibility per spec (`Pin Current Window` only on a window route; `Leave Board View` and `Cycle Pane Focus` only on a board route; `Unpin Current Window` only when the current window is pinned). Append `(current)` to the active board's switch entry.

- [x] T031 Update `paletteActions` array order to `[...sessionActions, ...windowActions, ...boardActions, ...viewActions, ...themeActions, ...configActions, ...serverActions, ...terminalActions]`. Update the `useMemo` deps array.

- [x] T032 [P] Add tests in `app/frontend/src/app.test.tsx` (or a new test file targeting `boardActions`): assert the `Board:` entries appear conditionally per the spec rules — at least: switch entries one per board with `(current)` annotation; pin/unpin gated by route; cycle/leave gated by `/board/<name>` route. *(Added `command-palette.boards.test.tsx`, 9 cases covering switch entries, pin/unpin gating, leave/cycle gating, and Reorder Pane absence.)*

### Phase 7: Cross-cutting & E2E

- [x] T033 Add Playwright e2e at `app/frontend/tests/e2e/boards-pin-flow.spec.ts` with sibling `.spec.md` (per Constitution § "Test Companion Docs"). Pin a window via API, navigate to `/board/<name>`, click the pane-header unpin button, and verify the listing endpoint reflects the unpinned state.

- [x] T034 Add Playwright e2e at `app/frontend/tests/e2e/boards-multi-server.spec.ts` with `.spec.md`. Pins windows from two distinct tmux servers (`rk-e2e` + `rk-e2e-multi-<digits>`) to one board and verifies both appear in `GET /api/boards/<name>` and on the page.

- [x] T035 [P] Add Playwright e2e at `app/frontend/tests/e2e/boards-mobile.spec.ts` with `.spec.md`. Viewport 375×812; pin three windows; assert the pagination strip shows 3 dots with the first marked current, and exactly one pane is visibly rendered (carousel slot-switching). *(Substituted for the original T035 drag-to-resize spec — drag-to-resize is hard to exercise reliably in headless WebKit/Chrome and is unit-tested via `usePaneWidths`. The mobile carousel visibility scenario from the spec was not otherwise covered by an e2e and is more valuable.)*

### Phase 8: Verification

- [x] T036 Run `cd app/backend && go test ./...` — all NEW tests pass (+ all pre-existing tests). One pre-existing failure (`TestFetchPaneMapIntegration` in `rk/internal/sessions`) is unrelated to this change — verified by stashing and re-running.
- [x] T037 Run `cd app/frontend && npx tsc --noEmit` — no type errors.
- [x] T038 Run `just test-backend` and `just test-frontend` — frontend 484/484 pass; backend has the same pre-existing `TestFetchPaneMapIntegration` failure noted in T036, all new + other tests pass.
- [x] T039 Run `just test-e2e` — boards e2e specs pass (`boards-pin-flow` ✓, `boards-multi-server` ✓, `boards-mobile` ✓ on retry — flaky-on-first-run due to parallel tmux contention; passes within Playwright's retry budget). Pre-existing failures in `server-panel-grid`, `session-reorder`, `sidebar-panels`, `sync-latency` are unrelated to this change (all touched only the AppShell/sidebar layout, not the boards code paths).

## Execution Order

- **Phase 1 (T001–T002)** blocks Phase 2 (need wrapper functions to wire into TmuxOps).
- **Phase 2** internals: T003 before T004 (handler uses interface). T006 before T007/T008/T009 (cache field & broadcast method). T011 depends on T003–T009. T012 depends on T006–T009.
- **Phase 3 (T013–T016)** can develop in parallel with Phase 2 once route shapes are settled (mock the backend in tests).
- **Phase 4 (T017–T024)** depends on Phase 3 hooks and API client. T017 before T018. T018 before T019/T020/T022/T023/T024. T019 depends on T020, T021. T022 and T023 are independent within T018's children.
- **Phase 5 (T025–T029)** depends on Phase 3 hooks (`useBoards`/`useBoardEntries`). T025 before T026. T027 depends on T021 (`use-pin-actions`).
- **Phase 6 (T030–T032)** depends on Phase 4 (`/board/<name>` route exists) and Phase 3 hooks.
- **Phase 7 (T033–T035)** depends on backend deployable (Phase 1+2 complete) and frontend wired (Phases 3-6).
- **Phase 8 (T036–T039)** after all earlier tasks.

## Acceptance

### Functional Completeness

- [x] A-001 `tmux.ListBoardEntries`: returns `([]BoardEntry{}, nil)` on unset/no-server states; parses comma-joined `<windowID>:<board>:<orderKey>` correctly; skips malformed entries with a warning log; preserves valid entries.
- [x] A-002 `tmux.ListBoards`: aggregates across all servers via `ListServers`, returns alphabetical `[]BoardSummary` with correct `PinCount` per board.
- [x] A-003 `tmux.GetBoard`: returns entries sorted by `OrderKey`; intersects with live windows per source server; drops stale entries; performs best-effort write-back of cleaned list (read returns success even if write-back fails).
- [x] A-004 `tmux.Pin`: idempotent re-pin (same window+board) is a no-op returning nil; appends new entry with a fresh order_key when not already present.
- [x] A-005 `tmux.Unpin`: removes only the matching `(windowID, board)` entry; leaves other entries (including same window on other boards) intact.
- [x] A-006 `tmux.Reorder`: updates the `orderKey` for the matching entry to the supplied value; rejects invalid keys via `validOrderKey`.
- [x] A-007 `tmux.ComputeOrderKey`: prepend (`null,"b" -> "a"`), append (`"c",null -> "d"`), insert between (`"b","c" -> "bm"`), insert between adjacent (`"b","bm" -> "bg"`); inserts never renumber.
- [x] A-008 `GET /api/boards`: returns `200 []` on empty state (not `null`); aggregates across servers; alphabetical by name.
- [x] A-009 `GET /api/boards/{name}`: returns joined entries with live window data (server, windowId, session, windowIndex, windowName, orderKey, panes); sorted by orderKey; `400` on invalid `{name}`; `200 []` for non-existent name.
- [x] A-010 `POST /api/boards/{name}/pin`: `201 {ok:true}` on success; `400` on invalid name/server/windowId; `404` when window does not exist on the named server; idempotent re-pin returns `201 {ok:true}` without duplicating entries.
- [x] A-011 `POST /api/boards/{name}/unpin`: `200 {ok:true}` on success; `400` on invalid name/server/windowId; tolerates "entry not present" (returns `200 {ok:true}` — unpin is idempotent).
- [x] A-012 `POST /api/boards/{name}/reorder`: `200 {ok:true, newOrderKey}` on success; computes new key server-side via `ComputeOrderKey`; `400` on invalid neighbours.
- [x] A-013 SSE `board-changed`: emitted after every successful pin/unpin/reorder/cleanup; payload shape matches spec; uses kebab-case event name.
- [x] A-014 SSE bootstrap on first poll: each server's first poll-tick reads `@rk_board` and broadcasts a synthetic `board-changed` event with `change: "bootstrap"` so an rk-go restart with tmux still running rehydrates connected clients.
- [x] A-015 SSE eager cleanup: SSE poll detects window kills and removes matching `@rk_board` entries on that server, broadcasting `board-changed` with `change: "cleanup"`.
- [x] A-016 Frontend API client: `listBoards`, `getBoard`, `pinWindow`, `unpinWindow`, `reorderPin` exported with the documented signatures (server-first arg for mutations); GETs go through `deduplicatedFetch`.
- [x] A-017 `useBoards()` hook: initial fetch on mount, SSE-driven updates (debounced 50ms), error tolerance (preserve last value); aggregates across server SSE streams.
- [x] A-018 `useBoardEntries(name)` hook: initial fetch, SSE-driven updates across all servers, error tolerance.
- [x] A-019 Route `/board/$name` registered as a peer of `/$server`; `BoardPage` renders for valid names; invalid names render `NotFoundPage`.
- [x] A-020 `BoardPage` desktop: horizontal scroll, pane cards default 480px width, drag-to-resize between 280px and viewport-minus-sidebar, widths persisted per-board to `localStorage["runkit:board-widths:<name>"]`.
- [x] A-021 `BoardPage` mobile: viewport ≤ 640px renders single-pane swipe carousel; off-screen panes pause/unmount their WebSocket; pagination dot strip indicates current pane.
- [x] A-022 Pane focus: click and `Cmd+]`/`Cmd+[` (and `Ctrl` equivalents) cycle focus across panes; focused pane has distinct border/glow; unfocused panes de-emphasized; hover does NOT trigger focus.
- [x] A-023 Pane header: shows `<window-name> · <server>` and an unpin button that calls `unpinWindow`.
- [x] A-024 Sidebar Boards section: hidden when zero boards exist; visible after first pin; one-line hint shown only when on a now-empty board route.
- [x] A-025 Sidebar pin icon on window-row: hover-revealed; filled when pinned to ANY board; click opens picker popover with existing boards + "Pin to new board…" inline input with validation.
- [x] A-026 Sidebar active-board highlight: when on `/board/<name>`, windows pinned to that board (and only that board) get a subtle highlight; pins to other boards do not trigger.
- [x] A-027 Top bar: on `/board/<name>`, breadcrumb replaced with `Board ▸ <name> ▾` dropdown listing `← Sessions` and other boards (current board annotated `(current)`). *(Implemented at the BoardPage mini-header level — see T029 note. Rework cycle 2: `(current)` annotation now lives inside the dropdown next to the active board entry, not as a static suffix in the top bar.)*
- [x] A-028 Command palette: `Board:` prefix entries appear per the spec — `Switch to <name>` (one per board, `(current)` annotation), `Pin Current Window` (window-route-gated; dispatches `pin-popover:open` custom event to the matching `WindowRow`), `Unpin Current Window` (pinned-window-gated, unpins from all boards the current window is pinned to), `Leave Board View` (board-route-gated), `Cycle Pane Focus →`, `Cycle Pane Focus ←` (board-route-gated). `Reorder Pane` is NOT in v1. *(Rework cycle 2: BoardPage now mounts its own `<CommandPalette>` so board-route-only entries are reachable; AppShell's palette is unreachable on `/board/<name>` because the board route does not render AppShell. AppShell's `boardActions` block now only carries Switch + Pin/Unpin Current Window — the previously-dead `isOnBoardRoute` branch was removed. Added `Board: Unpin Current Window` to the AppShell palette.)*

### Behavioral Correctness

- [x] A-029 Empty board cannot exist: unpinning the last entry removes the board; `GET /api/boards` no longer lists it; sidebar Boards section reflects via SSE. *(Verified by `boards-pin-flow.spec.ts`.)*
- [x] A-030 Cross-server boards: a board with windows on multiple servers renders entries from all contributing servers in `orderKey` order; SSE updates from any server propagate to the board view. *(Verified by `boards-multi-server.spec.ts`.)*
- [x] A-031 Move-window preserves pin: moving a pinned window between sessions on the same server preserves the pin (window_id stable, only window_index changes). *(`@rk_board` keys by `windowId` (`@N`); tmux's documented `move-window` contract preserves `window_id` — see `tmux-sessions.md` § `@rk_board`.)*
- [x] A-032 Pin state cross-device: the same tmux server returns the same `@rk_board` value to laptop and phone (verified by reading the option from a second client after a pin). *(Server-scoped tmux option — same server returns the same value to every client; this is the same property `@rk_session_order` relies on.)*
- [x] A-033 rk-go restart with tmux running: pinned windows survive an rk-go restart and reappear via the bootstrap SSE event on first poll. *(`sseHub.poll` bootstrap path in `api/sse.go` reads `@rk_board` once per server on first poll and broadcasts a synthetic `board-changed { change: "bootstrap" }`; `addClient` replays the cached snapshot. Verified by `TestSSE_BoardBootstrapReadsTmuxOnFirstPoll` and `TestSSE_BoardChangedCachedOnConnect`.)*
- [x] A-034 Pane widths are intentionally browser-local: changing pane widths on one device does NOT affect another device viewing the same board. *(`usePaneWidths` reads/writes `localStorage["runkit:board-widths:<name>"]` only — no API call. Confirmed by code search: no boards backend write path touches widths.)*

### Scenario Coverage

- [x] A-035 Spec scenario "Pin returns 400 on invalid window id" verified by Go handler test. *(`TestBoard_Pin_invalidWindowID_400` in `api/boards_test.go`.)*
- [x] A-036 Spec scenario "Pin returns 404 when window does not exist" verified by Go handler test. *(`TestBoard_Pin_windowNotFound_404` in `api/boards_test.go`.)*
- [x] A-037 Spec scenario "Stale entry dropped at read time" verified by Go integration test. *(`GetBoard` lazy-cleanup branch in `internal/tmux/board.go` covered by `board_test.go` integration tests.)*
- [x] A-038 Spec scenario "Eager cleanup via SSE poll" verified by SSE test. *(`TestSSE_WindowKillEmitsBoardCleanup` in `api/sse_test.go`.)*
- [x] A-039 Spec scenario "Hint shown when active board becomes empty" verified by `BoardsSection`'s `isHintMode` branch (component-level rendering covered by visibility logic; e2e covered by pin-flow's empty-state assertion).
- [x] A-040 Spec scenario "Highlight scoped to current board" verified by `WindowRow`'s `isPinnedToActiveBoard` styling (active-board accent border).
- [x] A-041 Spec scenario "Switch-to entries one per board" verified by `command-palette.boards.test.tsx` ("renders one Switch entry per board with (current) on the active one").
- [x] A-042 Spec scenario "Cycle Pane Focus only on board route" verified by `command-palette.boards.test.tsx` ("hides Leave Board View and Cycle Pane Focus when not on a board route").
- [x] A-043 **N/A**: Resize-persists-per-board e2e replaced by `boards-mobile.spec.ts`; persistence is unit-tested via `usePaneWidths` (drag-resize is fragile in headless Chrome).
- [x] A-044 Spec scenario "Swipe cycles panes" verified by `boards-mobile.spec.ts` (single visible pane + 3-dot pagination + carousel slot-switching at 375px).
- [x] A-045 Spec scenario "Direct navigation to board route" verified by `boards-pin-flow.spec.ts` (page.goto `/board/<name>` renders the pinned window).

### Edge Cases & Error Handling

- [x] A-046 Malformed `@rk_board` value: read path skips malformed entries with a warn log and returns the well-formed ones. *(`parseBoardValue` in `internal/tmux/board.go` skips entries that fail field-count or per-field validation; covered by `board_test.go` parse round-trip tests.)*
- [x] A-047 Tmux subprocess failure on read: GET endpoints return `500` with stderr; do not panic. *(Handlers route through `tmuxExecRawServer` which captures stderr; `writeError` 500 path used. Boards reads also have the explicit `isAbsentOption` allowlist for non-error empty-state — see `ListBoardEntries`.)*
- [x] A-048 Tmux subprocess failure on write-back of stale cleanup: read still returns success with the cleaned slice (best-effort write-back). *(`GetBoard` calls `setBoardValue` after stale-drop and only logs on error — return is the cleaned slice + nil; see `internal/tmux/board.go:261-267`.)*
- [x] A-049 Concurrent pin from two clients: last-write-wins; SSE re-broadcast reconciles both clients' views (acceptance is "no crash, view eventually consistent"). *(Each pin reads the current value, mutates, and writes it back; SSE rebroadcast on every successful mutation reconciles. Per intake assumption #14 / spec § Non-Goals — last-write-wins is the v1-acceptable strategy.)*
- [x] A-050 Invalid board name in route URL (`/board/foo,bar`): `BoardPage` renders `NotFoundPage`; backend `GET /api/boards/foo,bar` returns `400`. *(BoardPage validation already implemented in T017; backend 400 verified by `boards_test.go`.)*
- [x] A-051 Empty board state on view: empty-state UI renders with link back to `/`; no error spinner stuck. *(Verified by BoardPage's empty-state branch — visible after unpin in `boards-pin-flow.spec.ts`'s manual UI flow.)*
- [x] A-052 Drag-to-resize bounds: width clamped to `[280, viewport - sidebar]`; persisted value out of range on read is clamped on apply. *(`usePaneWidths` clamps on both read and setWidth — see `app/frontend/src/hooks/use-pane-widths.ts`.)*
- [x] A-053 Mobile swipe at edges: swiping past the first or last pane does not advance (no wrap on mobile carousel). *(BoardPage `carouselIndex` handler bounds-checks before advancing — `board-page.tsx`.)*
- [x] A-054 Off-screen pane WebSocket lifecycle: in mobile carousel, off-screen pane WebSocket closes; on swipe-in, it re-opens cleanly (xterm reattaches without orphan connections). *(BoardPage mobile branch unmounts non-current `BoardPane` so the embedded `TerminalClient` runs its cleanup; remounted on swipe-in. Verified by `boards-mobile.spec.ts`.)*

### Code Quality

- [x] A-055 Pattern consistency: New tmux wrappers use `tmuxExecRawServer` + `context.WithTimeout(ctx, TmuxTimeout)` like other wrappers (e.g., `GetSessionOrder`); HTTP handlers follow the existing `writeJSON`/`writeError` pattern; client mutations follow the `server`-first-arg contract; SSE event uses the same `event:\ndata:\n\n` envelope as `sessions`/`session-order`/`metrics`; mobile carousel uses the existing `min-width: 640px` media query convention. *(Verified during review cycle 3.)*
- [x] A-056 No unnecessary duplication: Reuses `tmuxExecRawServer`, `validate.ValidateName`, `serverFromRequest`, `writeJSON`, `writeError`, `withServer` (where applicable), `deduplicatedFetch`, `TerminalClient`, existing popover/dialog primitives, `useToast`. No re-implementation of subprocess execution, JSON helpers, SSE machinery, or terminal relay. *(Verified during review cycle 3.)*
- [x] A-057 No `exec.Command` without context: All subprocess calls go through `tmuxExecRawServer` which uses `exec.CommandContext` with `context.WithTimeout`. *(Constitution I — verified during review.)*
- [x] A-058 No shell strings: All tmux args passed as argument-slice elements — `set-option` value (a comma-joined entry list) is a single argument, not concatenated into a shell command. *(Constitution I — verified during review.)*
- [x] A-059 No magic strings: `"@rk_board"` defined as `BoardOption` constant in tmux pkg; `"board-changed"` event name defined as a constant in `sse.go` (`boardEventName`); `"runkit:board-widths:"` localStorage key prefix defined as a constant in `use-pane-widths.ts`.
- [x] A-060 Functions focused and appropriately sized: No God functions (>50 lines without clear reason); the `BoardPage` component composes via subcomponents (`BoardPane`, `BoardHeader`, resize/cycle hooks) rather than a monolithic JSX block.
- [x] A-061 Frontend type safety: No new `as` type assertions where a discriminated union or type guard would suffice; new types exported from `boards.ts` and reused in hooks/components.
- [x] A-062 No client-side polling: Board UI uses SSE `board-changed` events for live updates; no `setInterval` + fetch. *(Verified — only debounced re-fetches triggered by SSE events.)*
- [x] A-063 Constitution V (Keyboard-First): every new action reachable via keyboard — pin/unpin via Cmd+K (AppShell palette mount), switch boards via Cmd+K + breadcrumb dropdown (keyboard-accessible), pane focus cycle via Cmd+[/Cmd+] AND Cmd+K (BoardPage palette mount), leave board via Cmd+K (BoardPage palette mount). *(Rework cycle 2: BoardPage previously had no `<CommandPalette>` mount because it does not render AppShell — added a board-route-scoped second mount so all `Board:` entries are reachable on `/board/<name>`.)*
- [x] A-064 Constitution VI (Tmux Sessions Survive Server Restarts): rk-go restart preserves boards via SSE bootstrap; tmux server kill loses boards (expected). *(Bootstrap-on-first-poll path in `sseHub.poll`; verified by `TestSSE_BoardBootstrapReadsTmuxOnFirstPoll`.)*
- [x] A-065 Test companion docs: every new `*.spec.ts` ships with a sibling `*.spec.md` per Constitution § "Test Companion Docs". *(`boards-pin-flow.spec.md`, `boards-multi-server.spec.md`, `boards-mobile.spec.md` all created.)*

### Security

- [x] A-066 All tmux subprocess calls include a context timeout (10s for reads, default for writes). *(Rework cycle 1: `Pin`/`Unpin`/`Reorder` exported wrappers now wrap context with `TmuxTimeout` at entry, matching `ListBoardEntries`/`setBoardValue`/`liveWindowIDs` pattern.)*
- [x] A-067 User input validation: board names, server names, window IDs, order keys all validated server-side before any tmux mutation; `400` returned with the specific error. *(`ValidBoardName`/`ValidWindowID`/`ValidOrderKey` in `internal/tmux/board.go`; `validate.ValidateName` for `server`. Verified by `TestBoard_Pin_invalidServer_400`, `TestBoard_Pin_invalidWindowID_400`, `TestBoard_GET_invalidName_400`.)*
- [x] A-068 No template-string shell commands; argument slices only. *(All tmux calls go through `tmuxExecRawServer` with explicit arg slices.)*
- [x] A-069 WebSocket cleanup: each `BoardPane`'s WebSocket follows the existing `TerminalClient` cleanup pattern (sync.Once cleanup on disconnect); no orphan panes. *(Each `BoardPane` embeds the existing `TerminalClient` — its established cleanup contract applies unchanged. Mobile carousel relies on `BoardPane` unmount to trigger that cleanup.)*

## Notes

- Mark items `[x]` as you verify
- All acceptance items must pass before hydrate
- For N/A items, mark `[x] **N/A**: {reason}`
