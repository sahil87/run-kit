# Plan: Board Pane Reorder UI

**Change**: 260708-rmiq-board-pane-reorder
**Intake**: `intake.md`

## Requirements

### Board Reorder: Neighbor Computation

#### R1: Pure neighbor computation from an insert-before move
A pure helper SHALL compute the moved pane's new `before`/`after` neighbor windowIds from the ordered entry list and an insert-before move (`fromIdx` → `toIdx`), returning `null` for a no-op (out-of-range index, or a move that leaves the pane in the same slot). `before` is the windowId that ends up immediately BEFORE the moved pane (or `null` when it lands first); `after` is the windowId immediately AFTER (or `null` when it lands last). This matches the backend `ComputeOrderKey(before, after)` contract (`app/backend/internal/tmux/board.go`), where a key strictly between `before` and `after` is minted.

- **GIVEN** an ordered list `[@a, @b, @c]` and a drag of `@a` (idx 0) onto `@c` (idx 2)
- **WHEN** neighbors are computed with insert-before semantics
- **THEN** the result is `{ before: "@c", after: null }` (moved item lands last: `[@b, @c, @a]`)
- **AND** dragging `@c` (idx 2) onto `@a` (idx 0) yields `{ before: null, after: "@a" }` (`[@c, @a, @b]`)
- **AND** dragging `@b` (idx 1) onto `@a` (idx 0) yields `{ before: null, after: "@a" }`
- **AND** a self-move (`fromIdx === toIdx`) or an out-of-range index yields `null`

#### R2: Palette Move Left/Right delegates to the same neighbor helper, boundary-gated
The palette Move Left/Right actions SHALL compute neighbors by moving the focused pane by `±1` via the same helper, and SHALL be a no-op / hidden at the boundary (index 0 cannot move left; last index cannot move right) with no wraparound — mirroring `computeMoveOrder` in `src/lib/palette-move.ts`.

- **GIVEN** a board with 3 panes and the focused pane at index 1
- **WHEN** "Move Focused Pane Left" is computed
- **THEN** the helper produces neighbors for landing the pane at index 0 (`before: null, after: <old idx-0 windowId>`)
- **AND** at index 0 the "Move Left" action is not present (hidden, not disabled)
- **AND** at the last index the "Move Right" action is not present

### Board Reorder: Drag-and-Drop

#### R3: Header-only drag handle with a custom MIME
Only the board pane HEADER (`BoardHeader`, `src/components/board/board-header.tsx`) SHALL be draggable — never the whole pane body (a live xterm terminal must not hijack the drag or become the drag image). The drag SHALL carry the custom MIME `application/x-board-pane-reorder`, which MUST NOT collide with `application/x-server-reorder`, `application/x-session-reorder`, or the window-move default-JSON payload. The drag payload SHALL carry both `server` and `windowId` (a board spans servers; `windowId` alone is ambiguous).

The drag SOURCE is the header; the drop TARGET SHALL be the whole pane root (`BoardPane`) — `onDragOver`/`onDrop` attach to the pane root so the preview updates and a release commits anywhere over a pane, not only over the ~24px header strip. *(Amended in rework cycle 1 — header-strip-only targets made cancelled drags the common outcome.)*

- **GIVEN** a desktop board row with ≥2 panes
- **WHEN** the user starts a drag on a pane header
- **THEN** `dataTransfer` carries `application/x-board-pane-reorder` with a `server:windowId` payload and the pane body is not itself draggable
- **AND** a drop released over another pane's BODY (not its header) still commits the move

#### R4: Optimistic insert-before preview via a derive-over-store transient override
While a drag is in progress, the displayed pane order SHALL reflect an optimistic insert-before splice held in a **ref** (not React state), cleared by a **render-time element-wise equality reconcile** against the authoritative `entries`. There SHALL be NO whole-array watcher effect and NO snap-back on drag-end (same discipline as `useServerReorder` / sidebar session-reorder, PR #240). The `dragover` handler SHALL call `preventDefault()` BEFORE the self-target bail, guarding the MIME first, so HTML5 DnD does not play the native cancelled-drag snap-back ghost.

- **GIVEN** an in-progress drag of `@a` over `@c`
- **WHEN** the dragover fires
- **THEN** the displayed order updates to the spliced preview and the drop is accepted (`preventDefault` called, `dropEffect = "move"`)
- **AND** a dragover on the dragged pane's OWN element still calls `preventDefault` (no snap-back) but performs no reorder
- **AND** when the authoritative `entries` element-wise match the override, the override is dropped with no snap-back

A CANCELLED drag SHALL revert the preview: when the drag ends without a committed drop (Escape, or release outside any valid drop target — detectable as no `onDrop` having fired for this drag, or `dropEffect === "none"` at `dragend`), `onDragEnd` SHALL clear the override so the display returns to the authoritative order. With drop as the single commit point (Design Decision 3), native HTML5 cancel semantics = revert; the no-snap-back rule applies only to committed drops and SSE reconciles, never to cancels. *(Amended in rework cycle 1 — an uncleared override after a cancelled drag rendered a phantom order the server never had.)*

- **GIVEN** an in-progress drag with a spliced preview
- **WHEN** the user presses Escape or releases outside any pane
- **THEN** no POST fires and the display reverts to the authoritative order (override cleared)

#### R5: One reorderPin POST per move (no debounce)
On drop, exactly ONE `reorderPin(server, windowId, board, before, after)` POST SHALL fire (via `usePinActions().reorder`) with `before`/`after` = the moved pane's new neighbors' windowIds (`null` at edges). No debounce — fractional indexing is one call per moved item (unlike server-reorder's debounced full-order writes). The `board-changed` SSE echo (refetched by `useBoardEntries` with a 50ms debounce) reconciles the override away. A self-drop or no-op move SHALL fire no POST.

If the reorder POST rejects, the optimistic override SHALL be rolled back (cleared) so the display returns to the authoritative order; the existing `usePinActions` toast still fires. The hook must be able to observe the rejection (rethrow or a settle signal from the wrapper). *(Amended in rework cycle 1 — a swallowed rejection left the failed order rendered indefinitely.)*

- **GIVEN** a completed drag of `@a` to land last in `[@a,@b,@c]`
- **WHEN** the drop fires
- **THEN** exactly one `reorder(server, "@a", board, "@c", null)` call is made
- **AND** dropping a pane back onto its own slot fires no POST
- **AND** if the POST rejects, the override is cleared (display reverts) and the toast fires

### Board Reorder: Command Palette Parity (Constitution V)

#### R6: Move Focused Pane Left / Right actions with focus tracked by pane key
`boardRouteActions` (`src/components/board/board-page.tsx`) SHALL include `Board: Move Focused Pane Left` and `Board: Move Focused Pane Right`, boundary-hidden per R2, acting on the focused pane. Each SHALL compute `before`/`after` from the current `entries` via the R1 helper and fire the same single-POST reorder path as DnD. Focus SHALL be tracked by the moved pane's `server:windowId` key through the round-trip: both the focus ring AND the imperative xterm focus must land in the MOVED pane's terminal — immediately on the optimistic move and again once the authoritative (SSE-echoed) order settles. An index bump alone is insufficient: with `paneRefs` keyed to the authoritative order, `setFocusedIndex(i ± 1)` before the echo routes DOM focus into the displaced NEIGHBOUR's terminal (wrong-terminal keystrokes). Key-tracking also makes focus survive reorders arriving from another client. *(Amended in rework cycle 1 — promotes the intake's deferred nice-to-have to required; review must-fix #3.)*

- **GIVEN** the focused pane at index 1 of a 3-pane board
- **WHEN** "Move Focused Pane Right" is selected
- **THEN** one reorder POST fires landing the pane at index 2, the focus ring shows the moved pane, and keystrokes land in the MOVED pane's terminal both before and after the SSE echo
- **AND** no regression to `Cmd+]` / `Cmd+[` focus cycling
- **AND** a reorder arriving from another client keeps focus on the same pane (by key), not the same index

Imperative focus SHALL fire only on user intent. An SSE-driven `entries` refetch alone (any `board-changed` from any board/server — pin, unpin, remote reorder) MUST NOT yank DOM focus into a pane terminal: the key-authority reconcile may correct `focusedIndex` silently, but `.focus()` is called only when the focused pane changes as a result of a user action on this board (own move follow, `Cmd+]`/`Cmd+[`, click). Board load MUST NOT auto-focus pane 0's terminal. This is the documented "SSE must not steal focus" invariant (`docs/memory/run-kit/ui-patterns.md` § Keyboard Navigation). A gate on `focusedIndex` actually changing preserves R6's own-move follow (a successful own move always changes the index post-echo). *(Amended in rework cycle 2 — the cycle-1 key-authority effect focused the terminal on every `entries` identity change.)*

- **GIVEN** the user is typing in the pin-popover input (or palette, dialog, compose buffer) on a board page
- **WHEN** a `board-changed` SSE event refetches `entries` (own or another client's, any board)
- **THEN** DOM focus stays where it was — no xterm steals it
- **AND** after the user's OWN palette move, focus still lands in the moved pane's terminal post-echo
- **AND** loading a board page does not auto-focus pane 0's terminal

### Board Reorder: Cross-Server Neighbour Resolution (backend)

#### R7: Reorder neighbour lookup aggregates board entries across servers
The reorder handler's neighbour resolution (`lookupNeighbourKeys`, `app/backend/api/router.go`) SHALL resolve `before`/`after` windowIds against the board's entries aggregated across ALL servers — mirroring `handleGetBoard`'s cross-server aggregation (`app/backend/api/boards.go:94`) — not only the moved pane's own server. A 400 `neighbour window not found on board` SHALL occur only when the neighbour is truly absent from the board on every server. *(Added in rework cycle 1 — review must-fix #1: on a mixed-server board, any move whose new neighbour was pinned from a different server returned 400, failing the reorder and permanently desyncing the optimistic preview. This supersedes the intake's "zero backend changes" premise with a single scoped fix — no new endpoints, verbs, or schema.)*

- **GIVEN** a board with panes from servers `s1` and `s2` in order `[a(s1), b(s2), c(s1)]`
- **WHEN** `c` is moved between `a` and `b` (POST with `before: a`, `after: b` — `b` lives on a different server than `c`)
- **THEN** the reorder returns 200 with a `newOrderKey` strictly between `a`'s and `b`'s keys
- **AND** a reorder naming a windowId absent from the board on every server still returns 400

### Non-Goals

- Mobile carousel reorder — swipe is navigation there; `MobileCarousel` is untouched.
- New backend surface — no new endpoints, verbs, or schema. The ONLY backend change is the scoped R7 fix inside the existing reorder handler's neighbour lookup. *(Amended in rework cycle 1 — the original "zero backend changes" non-goal was invalidated by must-fix #1.)*
- Board autofit (`[738w]`) — independent, sequenced after this change.
- ~~Cross-client focus survival by `server:windowId` key — deferred~~ *(promoted to R6 in rework cycle 1)*

### Design Decisions

1. **Neighbor computation extracted to a pure helper** (`src/lib/board-reorder.ts`): both DnD and palette need the same `orderedIds + move → {before, after}` arithmetic — *Why*: unit-testable without mounting the shell, mirrors the `palette-move.ts` precedent — *Rejected*: inlining in the hook (would force an e2e/DOM test for the arithmetic the intake wants unit-covered). — *Amended (rework cycle 1)*: `onDrop` deliberately derives `before`/`after` inline from the final override order instead of calling `computeReorderNeighbors` — the override (what the user sees) is robust to mid-drag entry churn where index-based arithmetic over the authoritative list is not. The pure helper remains the palette's path (`computeMoveNeighbors`). A-014's "shared by DnD and palette" wording is superseded accordingly; `computeReorderNeighbors` is removed only if it ends up with zero callers (T015).
2. **DnD state in a dedicated hook** (`src/hooks/use-board-pane-reorder.ts`) adapted from `useServerReorder` — *Why*: repo convention (sibling hook + colocated test), keeps `board-page.tsx` lean — *Rejected*: inlining the handlers in `DesktopRow` (harder to unit-test the MIME guard + reconcile).
3. **No debounce on the reorder POST** — *Why*: fractional indexing means one authoritative call per completed move; the drop is the single commit point — *Rejected*: copying server-reorder's 250ms debounce + drop-flush (unnecessary; there is no full-order sweep to coalesce).
4. **Override keyed by `server:windowId`** (not name): a board spans servers, so `windowId` alone is ambiguous — the override array and the drag payload both carry the composite key, matching the `key={`${entry.server}:${entry.windowId}`}` used in `DesktopRow`.
5. **e2e mirrors `server-reorder.spec.ts`, not the `test.fixme` drag path**: native HTML5 drag simulation is unreliable in Playwright (the session-reorder drag spec has never passed) and `page.reload()` does not commit under the SPA's long-lived SSE. So the e2e exercises the load-bearing surface — the reorder endpoint + `board-changed` SSE echo + reload-free order assertion — against the live backend; the neighbor arithmetic, MIME guard, and reconcile are Vitest-covered (Assumption 5).

## Tasks

### Phase 1: Pure helper + unit tests

- [x] T001 Create `app/frontend/src/lib/board-reorder.ts` exporting `computeReorderNeighbors(orderedIds: string[], fromIdx: number, toIdx: number): { before: string | null; after: string | null } | null` using insert-before splice semantics; return `null` for out-of-range or no-op moves. Include a `MoveDelta`-style helper or reuse the delta convention for the palette (`toIdx = fromIdx + delta`, boundary → `null`). <!-- R1 R2 -->
- [x] T002 [P] Create `app/frontend/src/lib/board-reorder.test.ts` mirroring `palette-move.test.ts`: cover move-down, move-up, move-first-to-last, move-last-to-first, self-move no-op, out-of-range no-op, boundary (delta at edges → null), and non-mutation of the input array. <!-- R1 R2 -->

### Phase 2: DnD hook + unit tests

- [x] T003 Create `app/frontend/src/hooks/use-board-pane-reorder.ts` adapting `use-server-reorder.ts`: MIME `application/x-board-pane-reorder`; entries keyed by `server:windowId`; ref-based override + `forceRender`; render-time element-wise equality reconcile against authoritative entries (no watcher effect, no drag-end snap-back); `onDragOver` calls `preventDefault()` after the MIME guard and BEFORE the self-target bail; on drop compute neighbors via `computeReorderNeighbors` and fire exactly one `reorder(...)` (no debounce). Expose `orderedEntries`, `getHandleProps(server, windowId)`, `isDragging`, `draggingKey`. Accept the `reorder` fn + `entries` + `board` name as inputs. <!-- R3 R4 R5 -->
- [x] T004 [P] Create `app/frontend/src/hooks/use-board-pane-reorder.test.ts` mirroring `use-server-reorder.test.ts` (`makeDragEvent` MIME-guard pattern): MIME discrimination (foreign MIME ignored on dragover + drop), insert-before splice correctness, self-target drop acceptance (preventDefault, no reorder, no POST), single-POST-on-drop with correct `before`/`after` (incl. `null` at edges), and the render-time reconcile clearing the override with no snap-back. <!-- R3 R4 R5 -->

### Phase 3: Integration — DnD wiring + palette actions

- [x] T005 Make the pane header the drag handle: thread drag props (`draggable` + `onDragStart`/`onDragOver`/`onDragEnd`/`onDrop`) from `use-board-pane-reorder` through `DesktopRow` → `BoardPane` → `BoardHeader` (`board-page.tsx`, `board-pane.tsx`, `board-header.tsx`). Only the header element is `draggable`; the pane body and terminal are not. Render `DesktopRow` over `orderedEntries` from the hook. Add drag-source dimming (`opacity-50` on `draggingKey`) matching server/session reorder. <!-- R3 R4 --> <!-- rework cycle 2 (delta only): the dim is defeated for unfocused drag sources — board-pane.tsx:127-132 emits BOTH opacity-50 and opacity-90 (unfocused branch) and Tailwind emits .opacity-90 later so it wins; suppress opacity-90 when dimmed (should-fix #1) -->
- [x] T006 Wire the drop path: in `BoardPageContent` pass `usePinActions().reorder` + `entries` + board `name` into the hook (or into `DesktopRow` which owns the hook) so drop fires one `reorder(...)` POST; ensure `paneRefs`/`focusedIndex`/`waitingWindowIds` still align to the displayed (`orderedEntries`) order during a drag. <!-- R5 -->
- [x] T007 Add `Board: Move Focused Pane Left` / `Board: Move Focused Pane Right` to `boardRouteActions` (`board-page.tsx`): boundary-hidden (only push Left when `focusedIndex > 0`, Right when `focusedIndex < entries.length - 1`), compute neighbors via `computeReorderNeighbors(entries.map(server:windowId or windowId), focusedIndex, focusedIndex ± 1)`, fire one `reorder(...)`, and `setFocusedIndex(focusedIndex ± 1)`. Include them in the `boardRouteActions` memo deps. <!-- R6 -->

### Phase 4: e2e + companion doc

- [x] T008 Create `app/frontend/tests/e2e/board-reorder.spec.ts` mirroring `server-reorder.spec.ts` (endpoint + SSE, NOT a flaky HTML5 drag): pin ≥2 windows to a fresh board via the API, `POST /api/boards/{name}/reorder` with `before`/`after`, assert `{ok:true, newOrderKey}` and that `GET /api/boards/{name}` returns entries in the new orderKey order; assert the reorder POST broadcasts a `board-changed` SSE frame (in-page EventSource, `onopen`-triggered POST, resolve on the frame) as `server-reorder.spec.ts` does for `server-order`. Teardown kills the test sessions. <!-- R5 -->
- [x] T009 [P] Create `app/frontend/tests/e2e/board-reorder.spec.md` companion (constitution Test Companion Docs) documenting each `test()` — what it proves + numbered steps + a "Why this slice (not a drag simulation)" section mirroring `server-reorder.spec.md`. <!-- R5 -->

### Phase 5: Rework (review cycle 1)

- [x] T010 Backend: make reorder neighbour resolution cross-server — in the reorder handler's neighbour lookup (`lookupNeighbourKeys`, `app/backend/api/router.go`), resolve `before`/`after` against the board's entries aggregated across ALL servers (mirror `handleGetBoard`'s aggregation, `app/backend/api/boards.go:94`); 400 only when the neighbour is truly absent from the board on every server. Add a Go test: mixed-server board, move whose neighbour lives on a different server → 200 + orderKey strictly between the neighbours; keep a truly-absent-neighbour 400 case. Run `just test-backend`. <!-- R7 --> <!-- rework: cross-server reorder 400s — must-fix #1 --> <!-- rework cycle 2 (delta only): the per-server skip at router.go:281-284 claims "log-and-continue like GetBoard/ListBoards" but logs nothing — add the slog.Warn so an unreachable server during neighbour resolution leaves a trace instead of silently degrading to a 400 (should-fix #2) -->
- [x] T011 Clear the override on cancelled drags: add a committed-drop flag (or `dropEffect === "none"` check) so `onDragEnd` (`use-board-pane-reorder.ts`) reverts the preview when no drop committed (Escape / release outside a target); unit-test cancel-revert and that a committed drop still has no snap-back. <!-- R4 --> <!-- rework: phantom unpersisted order after cancelled drag — must-fix #2 -->
- [x] T012 Widen drop targets to the pane root: attach `onDragOver`/`onDrop` to the pane root in `BoardPane` (keep `draggable` + `onDragStart`/`onDragEnd` on the header only); unit-test that a drop on the pane body commits the move. <!-- R3 --> <!-- rework: header-strip-only targets made cancels the common case — should-fix #1 -->
- [x] T013 Track focus by `server:windowId` key: the focused pane's identity survives reorders (own palette move, own drop echo, cross-client echo) and the imperative xterm focus lands in the MOVED pane's terminal both on the optimistic move and after the authoritative order settles (`board-page.tsx` `focusedIndex` seam + `paneRefs` bookkeeping). Unit-test the key-follow derivation; assert no regression to `Cmd+]`/`Cmd+[` cycling. <!-- R6 --> <!-- rework: palette move focused the displaced neighbour's terminal — must-fix #3 --> <!-- rework cycle 2 (delta only): the key-authority effect (board-page.tsx:207-230) calls paneRefs.current[focusedIndex]?.focus() unconditionally on EVERY entries identity change — useBoardEntries refetches a fresh array on every board-changed SSE from ANY board/server, so pins/unpins/remote reorders yank DOM focus into the xterm while the user types elsewhere, and board load auto-focuses pane 0. Gate the imperative .focus() on user intent per amended R6 (e.g. only when focusedIndex actually changed); keep the silent index reconcile (cycle-2 must-fix #1) -->
- [x] T014 Roll back the optimistic override on reorder POST failure: let the hook observe rejection (rethrow from `usePinActions().reorder` or a settle signal) and clear the override; the toast is unchanged; unit-test failure-rollback. Update A-012's wording if the wrapper contract changes. <!-- R5 --> <!-- rework: swallowed rejection left the failed order rendered — should-fix #3 -->
- [x] T015 Reconcile drift: remove `computeReorderNeighbors` if it has zero remaining callers (the palette path uses `computeMoveNeighbors`; DD-1 as amended documents the inline onDrop derivation) or keep it with a doc comment naming its caller; fix the `board-reorder.spec.md` Shared-setup claim — pinned windows live in `_rk-pin-*` sessions that outlive the home-session kill; the isolated-server global teardown is what reaps them. <!-- R1 R5 --> <!-- rework: plan deviation + doc inaccuracy — should-fix #2, nice-to-have #4 -->

## Execution Order

- T001 blocks T002, T003 (helper must exist), T007.
- T003 blocks T004, T005, T006.
- T005/T006/T007 are the integration wiring (T005 before T006; T007 independent once T001 lands).
- T008 blocks T009 (doc mirrors the spec).
- Phase 5 (rework): T010 (backend) is independent of T011–T014 (frontend); T011 before T012 (both touch the hook's drag lifecycle); T013 and T014 independent; T015 last (doc/drift reconcile after code settles).

## Acceptance

### Functional Completeness

- [x] A-001 R1: `computeReorderNeighbors` returns correct `{before, after}` (with `null` at edges) for insert-before moves and `null` for no-op/out-of-range, verified by `board-reorder.test.ts`.
- [x] A-002 R2: Palette Move Left/Right compute neighbors via the same helper and are boundary-gated (hidden at edges, no wraparound), verified by the helper's boundary tests + the action's presence gating.
- [x] A-003 R3: The pane header is the only draggable element; the drag carries `application/x-board-pane-reorder` with a `server:windowId` payload; the pane body/terminal is not draggable.
- [x] A-004 R4: Dragover produces an optimistic insert-before preview from a ref override, accepts the drop before the self-target bail (MIME guarded first), and the render-time equality reconcile clears the override with no snap-back — verified by `use-board-pane-reorder.test.ts`. *(Review note: the no-snap-back discipline as implemented also keeps the override after a CANCELLED drag — see review finding on the phantom-order desync.)*
- [x] A-005 R5: Drop fires exactly ONE `reorderPin` POST with the correct `before`/`after` (null at edges) and no debounce; a no-op/self-drop fires none — verified by the hook test and the e2e endpoint test.
- [x] A-006 R6: Palette Move Left/Right fire one reorder POST and focus follows the MOVED pane by `server:windowId` key — the focus ring and the imperative xterm focus agree (keystrokes land in the moved pane's terminal) both on the optimistic move and after the SSE echo settles. *(Reworked in cycle 1 — the index-bump implementation focused the displaced neighbour's terminal; R6 as amended requires key-tracking.)* **Met**: `moveFocusedPane` no longer bumps `focusedIndex` (the pre-echo display does not reorder for the palette path, so the moved pane keeps focus in place); a single focus effect reconciles `focusedIndex` from `focusedKeyRef` on every order change and focuses by key, so imperative xterm focus lands in the MOVED pane both pre- and post-echo. Key-follow derivation unit-tested via `focusedIndexForKey` (`board-reorder.test.ts`). *(Review note, cycle 2: the R6 behavior itself is met and loop-free, but the same effect (`board-page.tsx:207-230`) calls `paneRefs.current[focusedIndex]?.focus()` unconditionally on EVERY `entries` identity change — `useBoardEntries` refetches with a fresh array on every `board-changed` SSE event from ANY board on ANY server — so any pin/unpin/reorder (own or another client's) yanks real DOM focus into the focused pane's xterm while the user may be typing in the compose buffer / pin-popover / dialogs / palette. Pre-change, imperative focus fired only on `focusedIndex` change. Focus-steal regression → cycle-2 must-fix #1: gate the imperative `.focus()` on user intent, e.g. only when `focusedIndex` actually changed — a successful own move always changes the index post-echo, so R6 stays satisfied.)* **Resolved (cycle 2)**: the effect now gates `paneRefs.current[focusedIndex]?.focus()` behind `shouldFocusPane(prevFocusedIndexRef.current, focusedIndex)` (fires only when the index changed from the last focused index); the silent key→index reconcile (the `setFocusedIndex(j)` early-return) is unchanged, so own-move follow still fires — the reconcile bumps the index, and the re-entered settled pass sees the change and focuses the moved pane. `shouldFocusPane` is unit-tested in `board-reorder.test.ts`.

### Behavioral Correctness

- [x] A-007 R5: The `board-changed` SSE echo (refetched by `useBoardEntries`, 50ms debounce) reconciles the optimistic override, and order persists across a fresh load (server `orderKey` authoritative) — verified by the e2e endpoint + GET-order assertion.
- [x] A-008 R7: Cross-server boards reorder correctly — the backend resolves `before`/`after` neighbours against the board's entries aggregated across ALL servers; a mixed-server move whose neighbour lives on a different server succeeds (200 + orderKey strictly between the neighbours), verified by the new Go test (T010). The payload continues to carry `server`+`windowId` for the moved pane. *(Reworked in cycle 1 — was: server-scoped `lookupNeighbourKeys` 400'd on any foreign-server neighbour.)* **Met**: `lookupNeighbourKeys` now enumerates `ListServers` and aggregates the board's `windowId → orderKey` map across every reachable server (mirroring `GetBoard`), 400ing only when the neighbour is absent on every server. `TestLookupNeighbourKeys_crossServer` proves a foreign-server neighbour resolves + the minted key is strictly between; `TestLookupNeighbourKeys_trulyAbsent`/`_ignoresOtherBoards` keep the 400. *(Review note, cycle 2: the per-server skip at `router.go:281-284` claims to match GetBoard/ListBoards "log-and-continue" but logs nothing — an unreachable server silently degrades to a 400 with no trace; should-fix: add the `slog.Warn` like GetBoard.)* **Resolved (cycle 2)**: the skip now emits `slog.Warn("board: ListBoardEntries failed", "server", srv, "err", lerr)` matching `board.go`'s GetBoard/ListBoards style, so an unreachable server during neighbour resolution leaves a trace. Confirmed firing in the e2e run (`level=WARN msg="board: ListBoardEntries failed" server=rk-test-e2e err="...context canceled"`).

### Scenario Coverage

- [x] A-009 R5: An e2e (`board-reorder.spec.ts`) exercises the reorder endpoint + `board-changed` SSE broadcast end-to-end against the live backend, with a companion `.spec.md`.
- [x] A-010 R6: No regression to `Cmd+]` / `Cmd+[` focus cycling, pane drag-resize, or unpin (the header ✕ / palette unpin) — the drag handle is scoped to the header text region and does not shadow the ✕ button or the resize handle. *(Implemented as: whole header draggable; ✕ opted out via `draggable={false}` + `stopPropagation`; resize handle lives outside the header on the pane root — unshadowed.)*

### Edge Cases & Error Handling

- [x] A-011 R4: A dragover on the dragged pane's own element calls `preventDefault` (no native snap-back ghost) but performs no reorder and schedules no POST.
- [x] A-012 R5: A reorder POST failure surfaces via the `usePinActions().reorder` toast AND rolls back the optimistic override (display returns to the authoritative order) — the hook observes the rejection. *(Reworked in cycle 1 — was: rejection swallowed, failed order left rendered.)* **Met**: wrapper contract changed — `usePinActions().reorder` now shows the toast AND rethrows (pin/unpin still swallow, having no optimistic order); the DnD hook attaches `.catch()` to clear the override on rejection, and the palette move `.catch()`es to avoid an unhandled rejection. Failure-rollback unit-tested (`use-board-pane-reorder.test.ts`).
- [x] A-018 R4: A cancelled drag (Escape, or release outside any drop target) clears the override and reverts the preview to the authoritative order — no phantom unpersisted order; unit-tested (T011). **Met**: `committedRef` is set only when `onDrop` fires the POST; `onDragEnd` clears the override when uncommitted (cancel = revert), keeps it when committed (no snap-back). Both cases unit-tested.
- [x] A-019 R3: A drop released anywhere over a pane (body included) commits the move; only the header initiates drags — unit-tested (T012). **Met**: the hook returns split props — `{ handle }` (draggable + onDragStart/onDragEnd) on the header, `{ drop }` (onDragOver/onDrop) on the pane root. Unit test asserts the split shape and that a drop via the pane-root target commits.
- [x] A-020 R7: `just test-backend` green including the new cross-server neighbour-resolution test (mixed-server 200 + truly-absent 400) (T010). **Met**: `just test-backend` passes (`ok rk/api`) with `router_test.go`'s four `TestLookupNeighbourKeys_*` cases.
- [x] A-021 R6: An SSE-driven `entries` refetch alone (any `board-changed` — pin/unpin/remote reorder, any board/server) does not move DOM focus into a pane terminal, and board load does not auto-focus pane 0; the user's OWN move still lands imperative focus in the moved pane post-echo. Unit-tested at the focus-gate seam (T013 cycle-2 delta). *(Added in rework cycle 2 — must-fix #1: focus-steal on every board-changed refetch.)* **Met**: `shouldFocusPane(prev, current)` returns `false` when the index is unchanged — so a passive refetch that leaves the focused pane put (or a same-content refetch, `orderChanged=false`) does not call `.focus()`, and board load (index 0 unchanged from its seed, `prevFocusedIndexRef` seeded to 0) does not auto-focus pane 0. It returns `true` on a real index change (`Cmd+]`/`Cmd+[`, click, own-move post-echo follow), so the OWN move still focuses the moved pane. Three unit cases in `board-reorder.test.ts` cover load/steal/index-change; effect stays loop-free (the only `setState` is the unchanged reconcile early-return, which converges on `orderChanged=false`). *(Review note, cycle 3 — residual, should-fix, non-blocking: the index-change gate cannot distinguish an own-move follow from a REMOTE-driven index reconcile. A `board-changed` from another client/tab that shifts the focused pane's index on THIS board — a remote reorder crossing the focused position, or a remote unpin of an earlier pane — silently reconciles `focusedIndex` and the settled pass then fires `.focus()`, yanking DOM focus into the xterm. The dominant steal vectors (any-board refetch, same-order refetch, board load) are closed and unit-tested, and the amended R6 itself endorses the index-change gate, so this narrow multi-client subcase is graded should-fix: a true intent flag (mirror the sidebar's `focusMovedRef` — set on `moveFocusedPane`/click/cycle/own drop; reconcile branch updates `prevFocusedIndexRef` to `j` when no intent is pending) would close it; reconcile R6/A-021 wording with whichever ships.)*

### Code Quality

- [x] A-013 Pattern consistency: New hook + helper follow the naming/structure of `use-server-reorder.ts` and `palette-move.ts` (derive-over-store ref override, render-time reconcile, pure helper + colocated test). *(Review note, cycle 2: the T005 drag-source dim is defeated for UNFOCUSED drag sources — `board-pane.tsx:127` emits both `opacity-50` (dimmed) and `opacity-90` (unfocused branch) on the same element, and Tailwind 4.2.2 emits `.opacity-90` later so it wins (verified against the compiled utilities). Dragging a non-focused pane — the common case — shows no dim. Cycle-2 should-fix: suppress the `opacity-90` when `dimmed`.)* **Resolved (cycle 2)**: the unfocused branch now emits `` `border border-border${dimmed ? "" : " opacity-90"}` `` — `opacity-90` is omitted entirely from the class string when `dimmed`, so `opacity-50` stands alone (no ordering dependency), and an unfocused drag source dims correctly.
- [x] A-014 No unnecessary duplication: The neighbor arithmetic lives once in `board-reorder.ts`; the toast-wrapped `reorder` from `usePinActions` is reused (not re-wrapped). **Met (deviation documented per T015)**: `computeReorderNeighbors` has one live caller (`computeMoveNeighbors`, the palette path) and its unit tests, so it is NOT dead — kept with a doc comment naming its caller and explaining why the DnD hook deliberately derives `before`/`after` inline (robust to mid-drag entry churn; DD-1 as amended). The `usePinActions` reuse holds (rethrow added, not re-wrapped). No arithmetic duplication remains.
- [x] A-015 Security First (Constitution I): No new subprocess/exec surface; pure frontend wiring over the existing validated endpoint (`ValidWindowID` guards `before`/`after` server-side).
- [x] A-016 Uniform HTTP Verb (Constitution IX): Reorder uses the existing POST endpoint; no new verbs introduced.
- [x] A-017 Keyboard-First (Constitution V): Palette Move Left/Right give full keyboard parity for the drag action.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant; it wires previously-dark plumbing (`reorderPin` in `src/api/boards.ts`, `usePinActions().reorder` in `src/hooks/use-pin-actions.ts`) into its first live call sites. One stale DOC row: `docs/memory/run-kit/ui-patterns.md` § Boards Command Palette "v1 limits" still says "`Board: Reorder Pane` palette action is deferred to v1.1" — superseded by the Move Focused Pane Left/Right entries; update at hydrate (not a code deletion).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Neighbor arithmetic extracted to a pure `src/lib/board-reorder.ts` helper shared by DnD + palette, unit-tested like `palette-move.test.ts` | Intake calls for unit-testing the before/after computation + palette gating; `palette-move.ts` is the in-repo precedent for exactly this shape | S:90 R:90 A:95 D:90 |
| 2 | Certain | DnD state lives in a dedicated `use-board-pane-reorder.ts` hook adapted from `use-server-reorder.ts` (MIME, ref override, render-time reconcile, preventDefault-before-self-bail) | Intake front-runs this file layout; repo convention is sibling hook + colocated test; both hard-won fixes already exist in the source hook | S:80 R:90 A:85 D:75 |
| 3 | Confident | ~~Focus-tracking by `server:windowId` key DEFERRED; R6 uses the optimistic index bump only~~ **Superseded in rework cycle 1**: key-tracking promoted to a hard R6 requirement — the index bump routed imperative xterm focus into the displaced neighbour's terminal (review must-fix #3) | Original rationale (intake nice-to-have, "only if cheap") overturned by the review's wrong-terminal-input finding | S:80 R:85 A:75 D:70 |
| 4 | Certain | No debounce on the reorder POST — the drop is the single commit point (fractional indexing = one call per move) | Intake explicit: "No debounce needed — fractional indexing is one call per moved item, unlike server-reorder debounced full-order writes" | S:95 R:85 A:95 D:90 |
| 5 | Confident | e2e mirrors `server-reorder.spec.ts` (endpoint + `board-changed` SSE echo + reload-free order assertion), NOT a native HTML5 drag simulation | The session-reorder drag spec is `test.fixme` (never passed: unreliable native drag + reload doesn't commit under SSE); server-reorder deliberately tests the endpoint/SSE surface instead — the drag handlers are Vitest-covered | S:75 R:80 A:80 D:70 |
| 6 | Confident | The drag handle is scoped to the header's name/text region (the draggable element), leaving the ✕ unpin button and the pane resize handle unshadowed | Intake says "drag handle = pane HEADER only"; the ✕ is a button inside the header — making the whole header draggable could interfere with the ✕ click, so scope `draggable` to the header container while keeping the ✕ button's own click working (buttons are not draggable by default and stop drag-start) | S:70 R:80 A:75 D:65 |

6 assumptions (3 certain, 3 confident, 0 tentative).
