# Plan: Board List Reorder

**Change**: 260708-a2qd-board-list-reorder
**Intake**: `intake.md`

## Requirements

### Backend: Board-order persistence (`internal/settings`)

#### R1: `BoardOrder` field + accessors in `Settings`
The `Settings` struct SHALL carry an ordered board-name slice `BoardOrder []string` persisted in `~/.rk/settings.yaml`; `GetBoardOrder() []string` and `SetBoardOrder(names []string) error` SHALL mirror the `GetServerColor`/`SetServerColor` accessors, and the hand-rolled `parse`/`serialize` round-trip SHALL support it. Legacy settings files that predate `board_order:` MUST load without error, and serialization MUST remain byte-identical to today's output when `BoardOrder` is empty.

- **GIVEN** a `~/.rk/settings.yaml` with a `board_order:` list
- **WHEN** `settings.Load()` parses it
- **THEN** `Settings.BoardOrder` equals the listed names in order
- **AND** `SetBoardOrder(["b","a"])` followed by `GetBoardOrder()` returns `["b","a"]`
- **AND** a settings file without a `board_order:` block loads with `BoardOrder == nil` and no error
- **AND** `serialize(Settings{Theme:...})` with empty `BoardOrder` is byte-identical to the pre-change output (no `board_order:` line emitted)

### Backend: Order endpoint + rank-aware list sort (`api/boards.go`, `router.go`)

#### R2: `POST /api/boards/order` persists the full ordered board-name list
A new `POST /api/boards/order` handler SHALL accept `{"order": ["deploys", "reviews", ...]}` (the full ordered list), validate each name with `tmux.ValidBoardName` (rejecting an invalid or duplicate name with 400 before any write), persist via `settings.SetBoardOrder`, and return 200 `{"ok": true}`. Per Constitution IX the endpoint is a `POST`.

- **GIVEN** a valid `{"order": ["a","b","c"]}` body
- **WHEN** `POST /api/boards/order` is handled
- **THEN** `settings.SetBoardOrder(["a","b","c"])` is invoked and the response is 200 `{"ok": true}`
- **AND** a body with an invalid board name (e.g. `"bad name!"`) or a duplicate name returns 400 with no write
- **AND** a malformed body (`{"order": "not-an-array"}`) returns 400

#### R3: `GET /api/boards` response order is the display order (rank-aware sort at the API layer)
The `handleBoardsList` handler SHALL sort the `tmux.ListBoards` result by the stored board order before responding: boards present in `settings.GetBoardOrder()` first, ordered by their index; boards absent from the stored order after them, alphabetically. Stale names in the stored order (boards that no longer exist) SHALL be ignored on read. The sort SHALL be applied at the API layer via a pure helper — `internal/tmux` stays settings-unaware — and no `rank` field is added to `BoardSummary` and no client comparator is introduced.

- **GIVEN** boards `[apple, deploys, reviews]` from `ListBoards` and a stored order `["reviews", "deploys"]`
- **WHEN** `handleBoardsList` sorts them
- **THEN** the response order is `[reviews, deploys, apple]` (ranked-first-by-index, then unranked-alphabetical)
- **AND** a stored order containing a non-existent board name (`["ghost", "reviews"]`) ignores `ghost` and still ranks `reviews` first
- **AND** with no stored order the response stays alphabetical (unchanged behavior)

### Backend: server-global `event: board-order` SSE broadcast (`api/sse.go`)

#### R4: `board-order` broadcast with a single cached slot replayed on connect
After a successful order write, the handler SHALL broadcast a server-global `event: board-order` carrying the ordered name list to EVERY connected client, mirroring `broadcastServerOrder`: a single cached slot (`cachedBoardOrderJSON`) replayed to new clients in `addClient`, with `nil` normalized to `[]`. This SHALL NOT reuse the per-server `board-changed` event.

- **GIVEN** two connected SSE clients on different server keys
- **WHEN** `broadcastBoardOrder(["a","b"])` fires
- **THEN** both clients receive an `event: board-order` frame with `{"order":["a","b"]}`
- **AND** a client that connects afterward receives the cached `board-order` snapshot on connect

### Frontend: order propagation in `useBoards` (`api/boards.ts`, `session-context.tsx`, `use-boards.ts`)

#### R5: `setBoardOrder` client + `board-order` subscription re-sorts every client live
`api/boards.ts` SHALL gain `setBoardOrder(order: string[])` posting to `/api/boards/order`. `session-context.tsx` SHALL expose a `subscribeBoardOrder` seam on the shared SSE pool (and the dedicated `?metrics=1` stream, since the event is server-global) mirroring the `server-order`/`board-changed` seams. `useBoards` SHALL subscribe and reuse its existing debounced-refetch machinery so a reorder on one client re-sorts every other client.

- **GIVEN** the boards list rendered by `useBoards`
- **WHEN** a `board-order` SSE event arrives on any attached stream
- **THEN** `useBoards` schedules a debounced re-fetch of `/api/boards`, picking up the new backend-sorted order
- **AND** `setBoardOrder(["b","a"])` issues `POST /api/boards/order` with `{"order":["b","a"]}`

### Frontend: shared drag-reorder hook (`hooks/use-board-list-reorder.ts`)

#### R6: `use-board-list-reorder` mirrors `useServerReorder` and wires into the two named surfaces
A new `hooks/use-board-list-reorder.ts` SHALL mirror `use-server-reorder.ts` structurally: a custom MIME `application/x-board-list-reorder` (distinct from all existing reorder/move MIMEs); insert-before splice on `dragOver`; a derive-over-store optimistic override (a ref) cleared by a render-time name-equality reconcile against the authoritative `boards` list (no snap-back on drag-end, override outlives the POST until the SSE echo lands); a 250ms debounced `setBoardOrder` POST with an immediate flush on `drop`; and `dragOver` accepting (`preventDefault()`) on the self-target tile BEFORE the self-target bail. Unlike servers there is no infra-exclusion — every board is draggable and a valid drop target. The hook SHALL be wired into the sidebar `BoardsSection` rows and the Cockpit BOARDS zone tiles, each rendering `orderedBoards` instead of raw `boards`.

- **GIVEN** boards `[a, b, c]` and a drag of `c` over `a`
- **WHEN** `dragOver(a)` then `drop` fire
- **THEN** the optimistic order becomes `[c, a, b]` and `setBoardOrder(["c","a","b"])` is flushed
- **AND** the override persists after drag-end until the authoritative `boards` list matches it (render-time reconcile clears it)
- **AND** a drag whose final `dragOver` lands on the dragged tile's own element is `preventDefault()`ed (no native cancelled-drag snap-back), then no-ops the reorder
- **AND** a foreign-MIME drag (e.g. a server-reorder payload) over a board tile is ignored

### Frontend: command-palette keyboard path (`lib/palette-move.ts` + board-page palette)

#### R7: `Board: Move up` / `Board: Move down` palette actions on board routes
On a `/board/$name` route, the board-page palette SHALL offer `Board: Move up` / `Board: Move down` for the current board, built on the existing `lib/palette-move.ts` `computeMoveOrder` helper, boundary-hidden (no action at a list edge, no wraparound) exactly like the existing `Server: Move up/down` actions, and invoking `setBoardOrder` with the computed full order. Constitution V mandates a keyboard path for every action.

- **GIVEN** the ordered boards `[a, b, c]` and the current board is `b`
- **WHEN** the palette computes the Move up/down actions
- **THEN** both `Board: Move up` (→ `[b,a,c]`) and `Board: Move down` (→ `[a,c,b]`) are present
- **AND** when the current board is the first (`a`) only `Board: Move down` is present; when last (`c`) only `Board: Move up`
- **AND** each action invokes `setBoardOrder` with the computed full order

### Design Decisions

1. **Board order persists in `~/.rk/settings.yaml`, not a tmux option**: a slice `BoardOrder []string`, rank = index — *Why*: boards are emergent cross-server aggregates of `_rk-pin-*` sessions with no single tmux object to carry a rank; settings.yaml already holds host-level prefs (`ServerColors`); Constitution II permits filesystem-derived state — *Rejected*: fanning a rank out to every pin-session (across servers) would create disagreement/rank-loss on pin/unpin.
2. **Sort applied at the API layer via a pure helper**, not inside `internal/tmux` — *Why*: `internal/tmux` stays settings-unaware; `/api/boards` is the sole list source so the backend is the single sort choke point (no `rank` field on `BoardSummary`, no client comparator, unlike servers which have two list sources) — *Rejected*: a `rank` field + client comparator (needless for a single-source list).
3. **Dedicated server-global `event: board-order`** (single cached slot, replay-on-connect), NOT the per-server `board-changed` event — *Why*: an order write is host-global, scoped to no tmux server; `broadcastServerOrder` is the exact precedent with the cached-slot machinery already present — *Rejected*: overloading `board-changed` (per-server, uncached).
4. **`useBoards` re-fetches on `board-order`** rather than applying the order client-side — *Why*: the backend-sorted `GET /api/boards` response IS the display order (single choke point per DD-2), so a debounced re-fetch is the minimal, consistent propagation; the existing `REFETCH_DEBOUNCE_MS` machinery already coalesces SSE chatter — *Rejected*: a client-side `applyBoardOrder` reducer (would duplicate the backend sort and risk drift).

## Tasks

### Phase 1: Backend persistence

- [x] T001 Add `BoardOrder []string` to the `Settings` struct and extend `parse`/`serialize` in `app/backend/internal/settings/settings.go` — parse a `board_order:` nested list (indented `- name` entries under the heading), serialize it only when non-empty (byte-identical output otherwise); add `GetBoardOrder() []string` / `SetBoardOrder(names []string) error` accessors mirroring `GetServerColor`/`SetServerColor` <!-- R1 -->
- [x] T002 [P] Add settings tests in `app/backend/internal/settings/settings_test.go`: `board_order` parse (ordered list), round-trip via `SetBoardOrder`/`GetBoardOrder` under a temp `HOME`, legacy-file tolerance (no `board_order:` block → `nil`, no error), and empty-`BoardOrder` serialize byte-identity <!-- R1 -->

### Phase 2: Backend endpoint, sort, and broadcast

- [x] T003 Add a pure `sortBoardsByStoredOrder(boards []tmux.BoardSummary, order []string) []tmux.BoardSummary` helper in `app/backend/api/boards.go` (ranked-first-by-index, unranked-alphabetical-after, stale-name tolerant) and apply it in `handleBoardsList` using `settings.GetBoardOrder()` <!-- R3 -->
- [x] T004 Add `handleBoardOrderPost` in `app/backend/api/boards.go` (validate each name via `tmux.ValidBoardName`, reject invalid/duplicate/malformed with 400, `settings.SetBoardOrder`, broadcast `board-order`, 200 `{"ok": true}`) and register `POST /api/boards/order` in `app/backend/api/router.go` <!-- R2 -->
- [x] T005 Add `cachedBoardOrderJSON` slot + `broadcastBoardOrder(order []string)` to `app/backend/api/sse.go` mirroring `broadcastServerOrder`, and replay the cached `board-order` snapshot in `addClient` <!-- R4 -->
- [x] T006 [P] Add sort-helper unit tests in `app/backend/api/boards_test.go` for `sortBoardsByStoredOrder` (ranked-first, unranked-alphabetical, stale-name tolerance, empty-order alphabetical) <!-- R3 -->
- [x] T007 [P] Add `handleBoardOrderPost` handler tests in `app/backend/api/boards_test.go` (writes order + 200; invalid name 400; duplicate 400; malformed body 400; broadcast reaches a connected client) using the `TestBoard_Pin_triggersBroadcast` scaffolding and temp-`HOME` isolation for the `SetBoardOrder` path <!-- R2 R4 -->
- [x] T008 [P] Add a `broadcastBoardOrder` fan-out + cached-replay-on-connect test in `app/backend/api/sse_test.go` mirroring `TestBroadcastServerOrderFansOutToAllClients` <!-- R4 -->

### Phase 3: Frontend propagation + drag hook + palette

- [x] T009 Add `setBoardOrder(order: string[])` to `app/frontend/src/api/boards.ts` (POST `/api/boards/order`, `{ order }` body, `throwOnError`) <!-- R5 -->
- [x] T010 Add a `subscribeBoardOrder` seam to `app/frontend/src/contexts/session-context.tsx` (a subscriber-set ref + `board-order` `addEventListener` on both the pool streams and the `?metrics=1` stream, mirroring `subscribeBoardChange`), expose it on the context value + tolerant default <!-- R5 -->
- [x] T011 Subscribe `useBoards` to `board-order` in `app/frontend/src/hooks/use-boards.ts` reusing the existing `scheduleRefetch`/`REFETCH_DEBOUNCE_MS` machinery <!-- R5 -->
- [x] T012 Create `app/frontend/src/hooks/use-board-list-reorder.ts` mirroring `use-server-reorder.ts`: custom MIME `application/x-board-list-reorder`, insert-before splice, derive-over-store ref override + render-time name-equality reconcile, 250ms debounce + drop-flush, self-target dragover-accept-before-bail; no infra exclusion (every tile draggable + drop target); exports `orderedBoards`, `getTileProps(name)`, `isDragging`, `draggingName` <!-- R6 -->
- [x] T013 Wire `use-board-list-reorder` into `app/frontend/src/components/sidebar/boards-section.tsx` — render `orderedBoards`, spread `getTileProps(b.name)` onto each row, dim the drag source <!-- R6 -->
- [x] T014 Wire `use-board-list-reorder` into the BOARDS zone of `app/frontend/src/components/server-list-page.tsx` — render `orderedBoards`, spread `getTileProps(b.name)` onto each tile, dim the drag source <!-- R6 -->
- [x] T015 Add `Board: Move up` / `Board: Move down` palette actions to `boardRouteActions` in `app/frontend/src/components/board/board-page.tsx` using `computeMoveOrder` over the ordered board names, boundary-hidden, invoking `setBoardOrder` (mirrors `Server: Move up/down`) <!-- R7 -->

### Phase 4: Frontend tests + e2e

- [x] T016 [P] Add `app/frontend/src/hooks/use-board-list-reorder.test.ts` mirroring `use-server-reorder.test.ts`: override lifecycle, render-time reconcile, debounce/flush, self-target accept, foreign-MIME ignore <!-- R6 -->
- [x] T017 [P] Add `app/frontend/src/api/boards.test.ts` coverage for `setBoardOrder` (posts to `/api/boards/order` with the `{order}` body) <!-- R5 -->
- [x] T018 [P] Extend `app/frontend/src/lib/palette-move.test.ts` (or add board-move assertions) exercising `computeMoveOrder` boundary/no-wraparound behavior as consumed by `Board: Move up/down` <!-- R7 -->
- [x] T019 [P] Add wiring tests for `BoardsSection` (`app/frontend/src/components/sidebar/boards-section.test.tsx`) and the Cockpit BOARDS zone rendering `orderedBoards` with drag props present <!-- R6 -->
- [x] T020 Add a Playwright e2e `app/frontend/tests/board-list-reorder.spec.ts` (+ sibling `board-list-reorder.spec.md` companion, same commit-scope per constitution) exercising a board-list drag reorder on the Cockpit and/or sidebar where warranted <!-- R6 -->

## Execution Order

- Phase 1 (T001) blocks the settings-dependent backend work (T003 sort uses `GetBoardOrder`; T004 uses `SetBoardOrder`).
- T003 and T004 both edit `boards.go`; T005 edits `sse.go` (T004 calls `broadcastBoardOrder` from T005) — do T005 before/with T004's broadcast wiring.
- T009 (client) blocks T012 (hook uses `setBoardOrder`) and T015 (palette uses `setBoardOrder`).
- T010 (context seam) blocks T011 (`useBoards` subscribes to it).
- T012 (hook) blocks T013/T014 (surface wiring) and T016 (hook test).
- Test tasks marked `[P]` within a phase are independent once their production code exists.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `Settings.BoardOrder` persists through `parse`/`serialize`; `GetBoardOrder`/`SetBoardOrder` round-trip under a temp HOME; a legacy file with no `board_order:` loads cleanly
- [x] A-002 R2: `POST /api/boards/order` persists the full ordered list via `settings.SetBoardOrder` and returns 200 `{"ok": true}`; registered in `router.go`
- [x] A-003 R3: `GET /api/boards` sorts ranked-first-by-index then unranked-alphabetical, applied at the API layer via a pure helper; no `rank` field on `BoardSummary`, no client comparator
- [x] A-004 R4: a successful order write broadcasts a server-global `event: board-order` (single cached slot) replayed on connect, distinct from `board-changed`
- [x] A-005 R5: `setBoardOrder` posts to `/api/boards/order`; `session-context` exposes `subscribeBoardOrder`; `useBoards` re-fetches on the event
- [x] A-006 R6: `use-board-list-reorder` provides `orderedBoards`/`getTileProps`/`isDragging`/`draggingName`, wired into both BoardsSection and the Cockpit BOARDS zone
- [x] A-007 R7: `Board: Move up`/`Board: Move down` palette actions exist on `/board/$name`, boundary-hidden, invoking `setBoardOrder`

### Behavioral Correctness

- [x] A-008 R1: empty-`BoardOrder` serialization is byte-identical to the pre-change output (existing `TestSaveAndLoad`/`TestSerialize` still pass)
- [x] A-009 R3: a stale board name in the stored order is ignored on read and a full-list write self-heals it; with no stored order the list stays alphabetical
- [x] A-010 R6: the derive-over-store override outlives the debounced POST and is cleared only by the render-time name-equality reconcile (no snap-back on drag-end); the self-target dragover is `preventDefault()`ed before the bail (no native cancelled-drag ghost)

### Scenario Coverage

- [x] A-011 R2 R3 R4: Go handler/sort/broadcast tests pass (`cd app/backend && go test ./...`)
- [x] A-012 R5 R6 R7: Vitest covers `setBoardOrder`, the reorder hook lifecycle, palette move boundaries, and surface wiring (`just test-frontend`)
- [x] A-013 R6: a Playwright e2e exercises a board-list drag reorder with a sibling `.spec.md` companion updated in the same commit-scope (endpoint/SSE-surface form per the server-reorder precedent, drag mechanics Vitest-covered). The spec snapshots the real `~/.rk/settings.yaml` raw bytes in `beforeAll` and restores them verbatim (or deletes the file when none existed) in `afterAll`, so no test residue persists — verified byte-identical before/after a `just test-e2e "board-list-reorder"` run (constitution Test Companion Docs: the `.spec.md` documents the save/restore in Shared setup)

### Edge Cases & Error Handling

- [x] A-014 R2: invalid board name, duplicate name, and malformed body each return 400 with no write
- [x] A-015 R6: a foreign-MIME drag (server/session/window payload) over a board tile is ignored — MIMEs never cross-fire

### Code Quality

- [x] A-016 Pattern consistency: new code follows the `useServerReorder` / `broadcastServerOrder` / `GetServerColor` patterns it mirrors, and surrounding naming/structure (BoardsSection now wires `useToast().addToast` as the reorder-POST `onError` handler, matching the server-panel / Cockpit precedent)
- [x] A-017 No unnecessary duplication: reuses `computeMoveOrder`, the `useBoards` debounce machinery, the SSE cached-slot idiom, and `tmux.ValidBoardName` rather than reimplementing
- [x] A-018 No database/ORM/migration imports (Constitution II — board order is filesystem state in `~/.rk/settings.yaml`)
- [x] A-019 Uniform POST (Constitution IX): the order endpoint is `POST /api/boards/order`, not PUT/PATCH
- [x] A-020 No new routes/pages beyond `POST /api/boards/order` (Constitution IV untouched); keyboard path shipped (Constitution V)
- [x] A-021 Test companion docs: the new Playwright `.spec.ts` ships a sibling `.spec.md` in the same commit-scope (constitution Test Companion Docs)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. (`tmux.ListBoards`'s alphabetical sort remains load-bearing as the stable input base and the unranked-boards fallback ordering.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Sort applied at the API layer via a pure `sortBoardsByStoredOrder(boards, order)` helper in `boards.go`, called by `handleBoardsList` with `settings.GetBoardOrder()` — keeps `internal/tmux` settings-unaware and makes the sort unit-testable without HOME isolation | Intake DD says "ordering applied at the API layer (handler wrapping `tmux.ListBoards`)"; a pure helper is the cleanest testable seam and mirrors the codebase's pure-parse/pure-helper convention | S:80 R:85 A:90 D:85 |
| 2 | Certain | `board_order:` is serialized as an indented `- name` YAML list under the heading, and ONLY when `len(BoardOrder) > 0`, so the theme-only serialize output stays byte-identical (existing `TestSaveAndLoad`/`TestSerialize` assert exact bytes) | The hand-rolled serializer emits blocks conditionally already (`server_colors:` only when non-empty); byte-identity is a hard constraint from existing exact-string tests | S:75 R:80 A:90 D:85 |
| 3 | Confident | The `board-order` SSE seam is added to BOTH the per-server pool streams AND the dedicated `?metrics=1` stream (a `subscribeBoardOrder` subscriber-set ref fired from both listeners), mirroring how `server-order` is wired on both, so a Cockpit with zero attached servers still hears reorders | `server-order` is the exact precedent and is listened to on both stream types; the Cockpit BOARDS zone can render with zero attached servers, so the metrics stream must carry it | S:55 R:75 A:80 D:70 |
| 4 | Confident | `Board: Move up/down` live in `board-page.tsx`'s `boardRouteActions` (the board-route palette mount), not AppShell's — they act on the CURRENT board (the `/board/$name` param) exactly as `Server: Move up/down` act on the current server | Board routes mount their own palette (AppShell is not rendered on `/board/*`); "current board" only has meaning on a board route; the intake says "for the current board on `/board/$name` routes" | S:60 R:80 A:85 D:75 |
| 5 | Confident | `useBoards` propagates a reorder by a debounced re-fetch of `/api/boards` on the `board-order` event (reusing `scheduleRefetch`), NOT a client-side order reducer — the backend-sorted response is the single display-order source (DD-2) | Intake says useBoards "reuses its existing debounced-refetch machinery so a reorder on one client re-sorts every other client live"; a client reducer would duplicate the backend sort and risk drift | S:70 R:80 A:85 D:80 |
| 6 | Confident | The Cockpit BOARDS zone and sidebar BoardsSection render `orderedBoards` from the hook; the drag source is dimmed (`opacity-50`) matching the server-tile treatment; no infra-exclusion branch (every board draggable + drop target) | Intake explicitly names both surfaces and "No infra-exclusion analog"; the server-tile grids are the visual precedent for the drag-source dim | S:70 R:85 A:85 D:80 |
| 7 | Confident | Playwright e2e is scoped to a single focused board-list drag-reorder spec (Cockpit and/or sidebar) with its companion `.spec.md`, run via `just test-e2e`; broad multi-surface e2e is out of scope for this change | Intake says e2e "where warranted"; code-quality mandates tests for new behavior but unit/vitest carry the bulk; one focused e2e satisfies the UI-change SHOULD without over-investing | S:45 R:75 A:70 D:65 |

7 assumptions (2 certain, 5 confident, 0 tentative).
