# Plan: Move-Based Server-Scoped Boards (Pin Sessions)

**Change**: 260602-qn62-move-based-board-pin-sessions
**Status**: In Progress
**Intake**: `intake.md`

## Requirements

### Naming & Session Model: Pin Sessions

#### R1: Reserved `_rk-pin-` prefix and window-id-derived pin-session names
The tmux layer SHALL define a reserved session-name prefix `_rk-pin-` (constant `PinSessionPrefix`)
alongside `ControlAnchorSessionName` in `internal/tmux/tmux.go`. Each pinned window lives in exactly
one single-window session whose name is derived deterministically from the window's `@N` id by
stripping the leading `@` (tmux session names disallow `@`), e.g. `@42` → `_rk-pin-42`. A pure helper
SHALL map a window id to its pin-session name and back (and validate the derived name).

- **GIVEN** a window id `@42`
- **WHEN** its pin-session name is derived
- **THEN** the result is `_rk-pin-42`
- **AND** the inverse maps `_rk-pin-42` back to window id `@42`

#### R2: `parseSessions` skips `_rk-pin-*`, no longer skips `rk-relay-*`
`parseSessions` (the single chokepoint feeding every user-facing session list) SHALL early-skip any
session whose name has the `_rk-pin-` prefix, and SHALL NO LONGER skip `rk-relay-*` (relay ephemerals
are removed). The `_rk-ctl` anchor skip SHALL remain unchanged.

- **GIVEN** a `list-sessions` output containing `dev`, `_rk-pin-42`, and `_rk-ctl`
- **WHEN** `parseSessions` runs
- **THEN** only `dev` is returned (pin-session and anchor filtered)
- **AND** a `rk-relay-xxxx` name, if present, is NOT filtered (the relay-skip is gone)

### Board Membership: tmux-derived, no `@rk_board` server-option encoding

#### R3: Membership stored as session vars on pin-sessions
Board membership SHALL be derived entirely from `_rk-pin-*` sessions and their session-scoped user
options: `@rk_board=<name>` (which board), `@rk_home=<homeSessionName>` (restore target), and
`@rk_board_order=<orderKey>` (order within board). The comma/colon `@rk_board` server-option encoding
(`parseBoardValue`/`serializeBoardValue`/`setBoardValue`/`BoardOption`), fractional cross-server
union (`ListAllBoardEntries`), `nextAppendKey`, and stale-cleanup (`RemoveAllByWindowID`,
`GetBoard` write-back) SHALL be removed. `ComputeOrderKey` SHALL survive and be reused for
`@rk_board_order`.

- **GIVEN** a pin-session `_rk-pin-42` with `@rk_board=main`, `@rk_home=dev`, `@rk_board_order=m`
- **WHEN** board membership is listed
- **THEN** the entry `{server, windowId:@42, board:main, orderKey:m}` is derived from the session vars
- **AND** no `@rk_board` server option is read or written anywhere

#### R4: Boards are server-scoped; board list derives from pin-sessions
`ListBoards` SHALL enumerate pin-sessions per reachable server, group by `@rk_board`, and return an
alphabetical `[]BoardSummary` with per-board pin counts. A board exists only while at least one
pin-session carries its `@rk_board` value (no empty boards, no name registry). `GetBoard(name)` SHALL
return the entries whose `@rk_board == name`, sorted by `@rk_board_order`, with NO stale write-back.

- **GIVEN** pin-sessions `_rk-pin-1 (@rk_board=main)`, `_rk-pin-2 (@rk_board=main)`, `_rk-pin-3 (@rk_board=deploy)`
- **WHEN** `ListBoards` runs
- **THEN** it returns `[{deploy,1},{main,2}]` (alphabetical)
- **AND** unpinning the last `deploy` pin removes `deploy` from the list with no placeholder

### Pin / Unpin / Reorder operations (move-based)

#### R5: PIN moves the window into its own pin-session
`Pin(server, windowID, board)` SHALL: resolve the window's current (home) session; create
`_rk-pin-<id>`; `move-window` the window into it so the moved window is the pin-session's sole window
(no stray placeholder); and stamp `@rk_home`, `@rk_board`, and `@rk_board_order` (a fresh append key
via `ComputeOrderKey` over the board's existing keys). PIN SHALL be idempotent: if the pin-session
already exists for that window, it is a no-op (no re-move, no order-key churn). All tmux calls SHALL
use `exec.CommandContext` + `context.WithTimeout(ctx, TmuxTimeout)` via the `internal/tmux` exec
helpers, with `ValidWindowID`/`ValidBoardName` validated before use (Constitution §I).

- **GIVEN** window `@42` in home session `dev` and board `main` with existing pin keyed `m`
- **WHEN** `Pin(server, "@42", "main")` runs
- **THEN** `_rk-pin-42` exists holding only `@42`, with `@rk_home=dev`, `@rk_board=main`, and an order key `> m`
- **AND** `dev` no longer contains `@42`
- **AND** a second identical `Pin` call leaves the pin-session and its order key unchanged

#### R6: UNPIN moves the window back to its remembered home, recreating it if dead
`Unpin(server, windowID, board)` SHALL: read `@rk_home` from `_rk-pin-<id>`; if that home session
exists, `move-window` the window back into it (tmux appends at the next index); else recreate the
home session so the moved window becomes its only window (no placeholder); then `kill-session` the
now-empty pin-session. UNPIN SHALL be idempotent: a missing pin-session is a silent success.

- **GIVEN** pinned window `@42` in `_rk-pin-42` with `@rk_home=dev`
- **WHEN** `Unpin(server, "@42", "main")` runs and `dev` still exists
- **THEN** `@42` is appended back into `dev` at the next index and `_rk-pin-42` is killed
- **AND** when `dev` was killed first, it is recreated with `@42` as its only window

#### R7: REORDER rewrites exactly one `@rk_board_order` var
`Reorder` SHALL compute a new order key strictly between the supplied neighbours (via the surviving
`ComputeOrderKey`) and write it to the pin-session's `@rk_board_order` only — no sibling renumbering.

- **GIVEN** pinned windows with keys `m` and `t` on board `main`
- **WHEN** a window is reordered between them
- **THEN** only that window's `@rk_board_order` changes to a key strictly between `m` and `t`

### Relay: direct attach, no ephemeral

#### R8: Relay attaches the PTY directly to the resolved owning session
`handleRelay` SHALL resolve the owning session via `ResolveWindowSession(windowID)` (home or
`_rk-pin-*`) and attach the PTY directly to that session — removing per-WebSocket ephemeral
allocation (`newEphemeralRelayName`, `NewGroupedSession`), the `@rk_owner_pid` stamp
(`SetSessionOwnerPID`), the scoped `SelectWindowInSession` on the ephemeral, and the deferred
ephemeral `KillSessionCtx`. Active-window selection for the common case becomes a direct
`select-window` on the real session. `ResolveWindowSession` SHALL stop filtering `rk-relay-*`
(ephemerals are gone) so a window living in a `_rk-pin-*` session resolves to that pin-session.

- **GIVEN** a relay connection for window `@42` whose owning session is `dev`
- **WHEN** the WebSocket connects
- **THEN** the PTY attaches directly to `dev` (no `rk-relay-*` session is created)
- **AND** a relay for a pinned window `@42` attaches directly to `_rk-pin-42`

### SSE: no board cleanup, no bootstrap broadcast

#### R9: SSE drops eager board cleanup and the board bootstrap broadcast
The SSE hub SHALL remove the per-tick window-kill diff that emitted `board-changed {cleanup}` (and
the `RemoveAllByWindowID` dependency on `BoardEntriesFetcher`) and the `@rk_board` bootstrap
broadcast (`broadcastBoardBootstrap`, `previousBoardJSON`, first-poll board read). Board membership
changes SHALL be surfaced only via the explicit pin/unpin/reorder `board-changed` events the handlers
already emit; a killed pinned window simply empties and removes its pin-session (observed by the
frontend's existing refetch on the next session-list change).

- **GIVEN** the SSE poll loop is running with board entries present
- **WHEN** a pinned window is killed externally
- **THEN** no `board-changed {cleanup}` event is emitted and no `RemoveAllByWindowID` call is made
- **AND** no `board-changed {bootstrap}` event is emitted on first poll

### Startup: no relay sweep

#### R10: Delete the relay startup sweep
`cmd/rk/serve_sweep.go` (`sweepOrphanedRelaySessions`, `pidAlive`, `relayOwnerIsDead`) and its wiring
in `cmd/rk/serve.go` SHALL be deleted. Pins are persistent across rk restarts (Constitution §VI);
ephemerals are gone; there is no orphan class to sweep. `ListRawSessionNames`, `RelaySessionPrefix`,
`OwnerPIDOption`, `NewGroupedSession`, `SetSessionOwnerPID`, `GetSessionOwnerPID` SHALL be removed
from `internal/tmux/tmux.go`. The `_rk-ctl` anchor and `exit-empty off` backstop SHALL stay untouched.

- **GIVEN** an `rk serve` start
- **WHEN** the process boots
- **THEN** no relay sweep runs and no `rk-relay-*` reaping is attempted
- **AND** existing `_rk-pin-*` sessions from a prior run are left intact (persistent pins)

### Frontend: transparent pin-session resolution

#### R11: API response shape unchanged; frontend board contracts updated for server-scoping
The `GET /api/boards/{name}` response (`BoardEntryResponse`: server, windowId, session, windowIndex,
windowName, orderKey, panes) SHALL keep its existing field shape so `board-pane.tsx` and
`board-page.tsx` need no structural change — the `windowId` now resolves to a `_rk-pin-*` session
server-side, transparent to the component. `src/api/boards.ts` and `src/hooks/use-boards.ts` SHALL
reflect the new derivation in comments/contract (server-scoped; membership from pin-sessions). The
SESSIONS sidebar SHALL NOT show pinned windows (already true once the home session no longer contains
the moved window). All mutating endpoints SHALL stay POST (Constitution §IX).

- **GIVEN** a board with one pinned window
- **WHEN** the board page renders
- **THEN** `BoardPane` receives the same `BoardEntry` shape and renders `<TerminalClient windowId server />`
- **AND** the pinned window does not appear in its former home session's sidebar tab list

### Non-Goals

- Simplifying the `internal/tmuxctl/*` active-window event-derivation subsystem — intake scopes it as
  *investigate only, NOT assumed deletable*. It is driven by the `_rk-ctl` anchor and serves the
  SESSIONS sidebar highlight independent of boards. This change leaves it untouched.
- Any DB / persistent store (Constitution §II) — membership stays tmux-derived.
- Restore-sweep on startup — pins are durable, not orphans (Constitution §VI).

### Design Decisions

1. **One window per pin-session (`_rk-pin-<id>`)**: each pinned window is moved into its own
   single-window session — *Why*: a tmux session has exactly one active-window pointer, so N visible
   board panes require N sessions; a direct attach to a single-window session removes the ephemeral
   isolation layer entirely. — *Rejected*: one shared `_rk-board-<name>` session (proven by probe to
   collide on the single active-window pointer); keeping ephemerals for board panes only (forks the
   relay into two codepaths, more code).
2. **Pin-session name derived by stripping `@`**: `@42` → `_rk-pin-42` — *Why*: deterministic,
   reversible, avoids storing a name→id map; tmux session names disallow `@`. — *Rejected*: random
   suffix (needs a lookup map; not derivable from the window id).
3. **Keep the API response shape stable**: the move is invisible to the frontend because the relay
   resolves the owning session from the window id server-side — *Why*: minimizes frontend churn
   (Constitution §IV), the windowId is the stable identity `move-window` preserves. — *Rejected*:
   exposing the pin-session name to the client (leaks an implementation detail, more frontend change).
4. **Reuse `ComputeOrderKey` for `@rk_board_order`**: store one fractional key per pin-session —
   *Why*: a reorder rewrites exactly one var, no sibling renumber, preserves drag-to-insert-between.

### Deprecated Requirements

#### `@rk_board` server-option encoding
**Reason**: replaced by per-pin-session `@rk_board`/`@rk_home`/`@rk_board_order` vars; the bespoke
comma/colon serialization, cross-server union, and lazy/eager stale cleanup are removed.
**Migration**: membership is now the set of `_rk-pin-*` sessions and their session vars.

#### Per-WebSocket ephemeral relay grouped sessions (`rk-relay-*`)
**Reason**: single-window pin-sessions remove window *sharing*, so the isolation layer is unnecessary;
the relay attaches directly.
**Migration**: `handleRelay` attaches the PTY to the resolved owning session directly.

#### Relay startup sweep
**Reason**: ephemerals are gone and pins are persistent — no orphan class to reap.
**Migration**: N/A (deleted).

## Tasks

### Phase 1: tmux layer — naming + helpers (foundation)

- [x] T001 Add `PinSessionPrefix = "_rk-pin-"` constant and pure helpers `PinSessionName(windowID) (string, bool)` + `WindowIDFromPinSession(name) (string, bool)` in `app/backend/internal/tmux/tmux.go`, validating with `ValidWindowID`. <!-- R1 -->
- [x] T002 Update `parseSessions` in `app/backend/internal/tmux/tmux.go` to early-skip `PinSessionPrefix`, remove the `RelaySessionPrefix` skip; keep the `_rk-ctl` skip. Add `parseSessions` unit-test cases (skip `_rk-pin-*`, do NOT skip `rk-relay-*`, still skip `_rk-ctl`) in `app/backend/internal/tmux/tmux_test.go`. <!-- R2 -->

### Phase 2: tmux layer — board.go rewrite (move-based)

- [x] T003 Rewrite `app/backend/internal/tmux/board.go`: keep `BoardEntry`, `BoardSummary`, `ValidBoardName`, `ValidWindowID`, `ValidOrderKey`, `ComputeOrderKey`, `initialAppendKey`. Delete `BoardOption`, `boardEntrySep/boardFieldSep`, `parseBoardValue`, `serializeBoardValue`, `setBoardValue`, `nextAppendKey`, `ListAllBoardEntries`, `RemoveAllByWindowID`, and the `GetBoard` stale write-back. <!-- R3 -->
- [x] T004 Implement pin-session-backed reads in `board.go`: `pinSessionVars(ctx, server, pinSession)` reading `@rk_board`/`@rk_home`/`@rk_board_order` via `show-options -v -t`; `ListBoardEntries(ctx, server)` enumerating `_rk-pin-*` sessions (via `list-sessions -F #{session_name}`) and deriving `[]BoardEntry`; `ListBoards(ctx)` grouping per-server entries by board (alphabetical summary); `GetBoard(ctx, name)` filtering+sorting by order key, NO write-back. <!-- R3 R4 -->
- [x] T005 Implement `Pin(ctx, server, windowID, board)` in `board.go`: validate ids; idempotent no-op if `_rk-pin-<id>` exists; resolve home session via `ResolveWindowSession`; `new-session -d -s _rk-pin-<id>`; `move-window` the window in; kill the placeholder window so only the moved window remains; stamp `@rk_home`/`@rk_board`/`@rk_board_order` (append key from existing board keys via `ComputeOrderKey`). All via ctx+timeout exec helpers. <!-- R5 --> <!-- rework: (1) roll back the move+pin-session on post-move setSessionOption failure (else window stranded — absent from BOARDS and SESSIONS); (2) root all rollback/teardown KillSessionCtx + the rollback MoveWindowToSession in context.Background() so an expired Pin ctx cannot leave an orphan; (3) wrong-board idempotency: on has-session hit, re-stamp @rk_board if it differs rather than silent-success no-op -->
- [x] T006 Implement `Unpin(ctx, server, windowID, board)` in `board.go`: idempotent no-op if pin-session absent; read `@rk_home`; if home `has-session`, `move-window` back; else recreate home with the moved window as sole window (no placeholder); `kill-session _rk-pin-<id>`. <!-- R6 -->
- [x] T007 Implement `Reorder(ctx, server, windowID, board, newOrderKey)` in `board.go`: validate, set `@rk_board_order` on `_rk-pin-<id>` only; error if the pin-session/board does not match. <!-- R7 -->
- [x] T008 Rewrite `app/backend/internal/tmux/board_test.go` for the new model: drop `parseBoardValue`/`serializeBoardValue`/round-trip/`RemoveAllByWindowID`/stale-write-back tests; keep `ValidBoardName`/`ValidWindowID`/`ValidOrderKey`/`ComputeOrderKey` tests; add integration tests (against the existing `withBoardTmux` isolated server) for Pin-moves-window, Pin-idempotent, Unpin-restores-to-home, Unpin-recreates-dead-home, Reorder-one-var, ListBoards-derives-from-pin-sessions, empty-board-vanishes. <!-- R3 R4 R5 R6 R7 -->

### Phase 3: API layer — relay, router interface, sse

- [x] T009 Update `ResolveWindowSession` in `app/backend/internal/tmux/tmux.go` to stop filtering `RelaySessionPrefix` (removed); it returns the first non-empty owning session for the window id (home or `_rk-pin-*`). <!-- R8 -->
- [x] T010 Rewrite `app/backend/api/relay.go` `handleRelay`: remove `newEphemeralRelayName`, `NewGroupedSession`, `SetSessionOwnerPID`, `SelectWindowInSession`-on-ephemeral, and the deferred ephemeral `KillSessionCtx`; resolve the owning session and attach the PTY directly to it; do a direct `SelectWindow` on the real session for the common case. <!-- R8 -->
- [x] T011 Update `app/backend/api/router.go` `TmuxOps` interface + `prodTmuxOps`: remove `NewGroupedSession` and `SetSessionOwnerPID` methods; keep `PinBoard`/`UnpinBoard`/`ReorderBoard` wired to the rewritten `tmux.Pin`/`Unpin`/`Reorder` (ReorderBoard still uses `lookupNeighbourKeys` + `ComputeOrderKey`). <!-- R8 R7 -->
- [x] T012 Update `app/backend/api/sse.go`: drop `RemoveAllByWindowID` from the `BoardEntriesFetcher` interface + `prodBoardEntriesFetcher`; delete `detectKilledWindowIDs`, `previousWindowIDs`, the window-kill cleanup loop, `broadcastBoardBootstrap`, `boardBootstrapPayload`, `previousBoardJSON`, the board-bootstrap first-poll read, and the `addClient` cached-board send. Keep `broadcastBoardChanged` (pin/unpin/reorder) and the `"cleanup"`/`"bootstrap"` strings only where still emitted (none). <!-- R9 -->
- [x] T013 Update `app/backend/cmd/rk/serve.go`: remove the `sweepOrphanedRelaySessions` call + its ctx and the explanatory comments referencing the sweep ordering. Delete `app/backend/cmd/rk/serve_sweep.go` and `app/backend/cmd/rk/serve_sweep_test.go`. <!-- R10 -->
- [x] T014 Remove `RelaySessionPrefix`, `OwnerPIDOption`, `NewGroupedSession`, `SetSessionOwnerPID`, `GetSessionOwnerPID`, `ListRawSessionNames` from `app/backend/internal/tmux/tmux.go`; update `baseGroupName`/`parseActiveWindowsByGroup`/`realSessionNameSet` references to `RelaySessionPrefix` (these supported relay-group derivation — adjust to filter only the `_rk-ctl` anchor, since relays no longer exist). <!-- R10 -->

### Phase 4: Test fixups (Go) — mocks, deleted-symbol tests

- [x] T015 Update `app/backend/api/sessions_test.go` `mockTmuxOps`: remove `NewGroupedSession`/`SetSessionOwnerPID` methods + recorded fields; remove `RemoveAllByWindowID` from `stubBoardFetcher` if the interface no longer requires it. <!-- R8 R9 -->
- [x] T016 Update `app/backend/api/relay_test.go`: drop `TestRelay_EphemeralCleanupOnClose` and `TestRelay_OwnerStampFailureAbortsClean` (ephemeral path removed); rewrite `TestRelay_TwoWindowsTwoRelaysDistinctOutput` to assert each relay attaches directly to its window's session (no `rk-relay-*` created); keep `TestRelay_PercentEncodedAtNot400` and `TestRelay_MissingWindowClose4004` (adjust the latter's `ListRawSessionNames` leak-check, which is removed, to a `ListSessions`/`list-sessions`-based no-pin/no-relay assertion). <!-- R8 -->
- [x] T017 Update `app/backend/api/sse_test.go`: drop `TestSSE_BoardChangedCachedOnConnect`, `TestSSE_BoardBootstrapReadsTmuxOnFirstPoll`, `TestSSE_WindowKillEmitsBoardCleanup`, the `killTrackingFetcher`, and the `stubBoardFetcher.RemoveAllByWindowID` method; keep the pin/unpin/reorder broadcast coverage in `boards_test.go` untouched. <!-- R9 -->
- [x] T018 Update/delete `app/backend/api/socketsweep_test.go` and `app/backend/internal/tmux/socketsweep_test.go` only as needed: these test the rk-test-* socket reaper (TestMain post-sweep), NOT the relay sweep — keep them unless they reference removed symbols (`ListRawSessionNames`, `RelaySessionPrefix`). Adjust any reference to removed symbols. <!-- R10 -->

### Phase 5: Frontend

- [x] T019 Update `app/frontend/src/api/boards.ts` doc comments to reflect server-scoped, pin-session-derived membership (no cross-server union); keep the `BoardEntry`/`BoardSummary`/`ReorderResponse` types and function signatures stable. Update `app/frontend/src/hooks/use-boards.ts` comments where they assert "boards are explicitly cross-server" → server-scoped derivation; keep the SSE-refetch behavior. Adjust `app/frontend/src/api/boards.test.ts` / `use-boards.test.tsx` only if assertions reference removed cross-server semantics. <!-- R11 -->
- [x] T020 Verify `app/frontend/src/components/board/board-pane.tsx` and `board-page.tsx` need no structural change (same `BoardEntry` shape); run `npx tsc --noEmit` (via just) to confirm no type drift. <!-- R11 -->

### Phase 6: e2e spec companions

- [x] T021 Review the board e2e specs (`boards-pin-flow`, `boards-mobile`, `boards-multi-server`, `boards-same-session-multi-pane`, `boards-desktop-suspend`) under `app/frontend/tests/e2e/`: `boards-same-session-multi-pane.spec.ts` asserted the OLD multi-pane-same-session behavior (now each pin is its own session) and `boards-multi-server.spec.ts` asserted cross-server aggregation (now server-scoped) — update those `.spec.ts` to the new model and update their sibling `.spec.md` companions in the same change (Constitution Test Companion Docs). Specs that still hold (pin/unpin a window, render a live pane) stay. <!-- R11 -->

### Phase 7: Rework — board-render join through pin-sessions

- [x] T022 Fix `app/backend/api/boards.go` `handleBoardGet` (and `windowExistsOnServer`) to find pinned windows in their `_rk-pin-<id>` sessions. <!-- R4 --> <!-- rework: CI/e2e regression — handleBoardGet built its live-window join by scanning the user-facing `ListSessions`, which this change taught to HIDE `_rk-pin-*` sessions. Pinned windows live IN those hidden sessions, so the join matched nothing → `GET /api/boards/{name}` returned `[]` → board rendered zero panes (.xterm count 0; `getByText('win-a')` not visible). Fixed by joining each entry against its own pin-session directly (`tmux.PinSessionName(windowID)` → `ListWindows(pinSession)`, a by-name target query not subject to the session-list filter). Also fixed `windowExistsOnServer` to check the pin-session so re-pinning an already-pinned window (different board) is not wrongly 404'd before tmux.Pin's re-stamp path. Planning gap: no task covered the board HTTP handlers' dependency on `ListSessions`. -->

## Execution Order

- Phase 1 (T001-T002) is the foundation: the prefix constant + helpers are used by board.go and relay.
- Phase 2 (T003-T008) depends on T001; T004 depends on T003; T005-T007 depend on T004; T008 after T005-T007.
- Phase 3 (T009-T014) depends on Phase 1-2: T009/T010 (relay) need T001; T011 (interface) needs T010; T012-T014 are independent of board.go internals but depend on the symbol removals.
- Phase 4 (T015-T018) depends on Phase 3 (interface/symbol removals).
- Phase 5-6 (T019-T021) are frontend/e2e, independent of Go internals but validated last.

## Acceptance

### Functional Completeness

- [ ] A-001 R1: `PinSessionPrefix`, `PinSessionName`, and `WindowIDFromPinSession` exist in `tmux.go`; `@42` ↔ `_rk-pin-42` round-trips; invalid ids rejected.
- [ ] A-002 R2: `parseSessions` skips `_rk-pin-*` and `_rk-ctl`, does NOT skip `rk-relay-*`; covered by a unit test.
- [ ] A-003 R3: Membership is read from pin-session `@rk_board`/`@rk_home`/`@rk_board_order` vars; the old `@rk_board` *server-option encoding* is gone — no `parseBoardValue`/`serializeBoardValue`/`setBoardValue` remain. `ComputeOrderKey` is retained. <!-- amended: `BoardOption` constant DELIBERATELY RETAINED — repurposed in place as the `@rk_board` *session-var* key (membership is now a session var, so a named constant satisfies "no magic strings", A-024). `nextAppendKey` DELIBERATELY RETAINED as a thin wrapper over the surviving `ComputeOrderKey` (deleting it would inline identical logic). Both retentions preserve intent (§II tmux-derived membership, §IV minimal surface); only the bespoke comma/colon encoding was the removal target. -->
- [ ] A-004 R4: `ListBoards` derives an alphabetical per-board count from pin-sessions; `GetBoard` filters+sorts by order key with no write-back; the last unpin removes the board from the list.
- [ ] A-005 R5: `Pin` moves the window into `_rk-pin-<id>` (sole window, no placeholder), stamps the three vars, removes it from the home session, and is idempotent.
- [ ] A-006 R6: `Unpin` restores the window to `@rk_home` (or recreates a dead home as a single-window session), kills the pin-session, and is idempotent on a missing pin-session.
- [ ] A-007 R7: `Reorder` rewrites only the target pin-session's `@rk_board_order` (strictly-between key); no sibling renumber.
- [ ] A-008 R8: `handleRelay` attaches the PTY directly to the resolved session with no `rk-relay-*` creation; `NewGroupedSession`/`SetSessionOwnerPID`/`newEphemeralRelayName`/ephemeral-`SelectWindowInSession`/ephemeral-`KillSessionCtx` are gone; `ResolveWindowSession` no longer filters `rk-relay-*`.
- [ ] A-009 R9: SSE emits no `board-changed {cleanup}` or `{bootstrap}`; `RemoveAllByWindowID`, `broadcastBoardBootstrap`, `previousBoardJSON`, `previousWindowIDs`, `detectKilledWindowIDs`, and the kill-detection loop are removed.
- [ ] A-010 R10: `serve_sweep.go` (+ test) deleted, `sweepOrphanedRelaySessions` unwired from `serve.go`; `ListRawSessionNames`/`RelaySessionPrefix`/`OwnerPIDOption`/`NewGroupedSession`/`SetSessionOwnerPID`/`GetSessionOwnerPID` removed from `tmux.go`.
- [ ] A-011 R11: `GET /api/boards/{name}` keeps the `BoardEntryResponse` field shape; `board-pane.tsx`/`board-page.tsx` unchanged structurally; pinned windows absent from the home session sidebar; mutations stay POST.

### Behavioral Correctness

- [ ] A-012 R5: After `Pin`, `tmux list-windows -t dev` no longer lists `@42` and `_rk-pin-42` holds exactly one window (`@42`).
- [ ] A-013 R6: After `Unpin` of a window whose home was killed, the home session is recreated with the moved window as its only window (no extra placeholder window).
- [ ] A-014 R8: Two relays to two different windows each receive only their own window's PTY output (no cross-leak) while attaching directly to the real sessions.

### Removal Verification

- [ ] A-015 R3/R8/R9/R10: A repo-wide grep finds no remaining references to `parseBoardValue`, `serializeBoardValue`, `setBoardValue`, `RemoveAllByWindowID`, `newEphemeralRelayName`, `NewGroupedSession`, `SetSessionOwnerPID`, `GetSessionOwnerPID`, `RelaySessionPrefix`, `OwnerPIDOption`, `ListRawSessionNames`, `sweepOrphanedRelaySessions`, `broadcastBoardBootstrap` (outside this plan/intake/memory docs). <!-- amended: `BoardOption` removed from this no-references list — it is DELIBERATELY RETAINED as the `@rk_board` session-var key constant (see A-003). The deleted targets are the bespoke server-option *encoding* helpers, not the option-name constant. -->

### Scenario Coverage

- [ ] A-016 R5/R6/R7: Go integration tests cover Pin-moves, Pin-idempotent, Unpin-restore, Unpin-recreate-dead-home, Reorder-one-var, ListBoards-derivation, empty-board-vanishes (board_test.go).
- [ ] A-017 R8: `relay_test.go` proves direct-attach (no ephemeral created) and per-window isolation.
- [ ] A-018 R11: Board e2e specs updated for the move-based/server-scoped model with sibling `.spec.md` updated in the same change.

### Edge Cases & Error Handling

- [ ] A-019 R6: Unpin on a missing pin-session is a silent success (idempotent); Pin on an already-pinned window is a no-op.
- [ ] A-020 R4: An unreachable/empty server yields an empty board list (no error), consistent with the existing `isAbsentOption` tolerance.

### Code Quality

- [ ] A-021 Pattern consistency: New tmux funcs follow the `tmuxExecServer`/`tmuxExecRawServer` + `context.WithTimeout(ctx, TmuxTimeout)` pattern and the `killAudit` convention for any `kill-session`.
- [ ] A-022 No unnecessary duplication: Pin-session name derivation lives in one helper; `ComputeOrderKey` reused (not reimplemented); existing `ResolveWindowSession`/`windowExistsOnServer` reused.
- [ ] A-023 (Go subprocess security, §I): every new tmux call (`new-session`, `move-window`, `kill-session`, `set-option`, `show-options`, `has-session`) uses `exec.CommandContext` with a timeout context and an explicit argument slice — no shell strings; window ids validated with `ValidWindowID`, board names with `ValidBoardName` before use.
- [ ] A-024 (No magic strings, §anti-patterns): `_rk-pin-`, `@rk_board`, `@rk_home`, `@rk_board_order` are named constants in `internal/tmux`.
- [ ] A-025 (Inline tmux construction, §anti-patterns): all new tmux interaction goes through `internal/tmux/` helpers — no tmux command construction in `api/`.
- [ ] A-026 (Derive state from tmux, §principles): membership is derived from pin-sessions + session vars at request time; no in-memory cache, no DB (§II).
- [ ] A-027 (Constitution §VI): the `_rk-ctl` anchor and `exit-empty off` backstop are untouched; pins persist across restarts (no restore-sweep added).

### Security

- [ ] A-028 R5/R6/R7: Pin/Unpin/Reorder validate `windowID` (`ValidWindowID`) and `board` (`ValidBoardName`) before any subprocess; all mutating board endpoints remain POST and pass through the existing handler validation.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- The intake's "Investigate" item (`internal/tmuxctl/*` simplification) is intentionally a Non-Goal here — left untouched per assumption #8.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Pin-session name = `_rk-pin-` + windowID with the leading `@` stripped (`@42`→`_rk-pin-42`); a pure reversible helper derives it | tmux session names disallow `@`; deterministic + reversible avoids a name→id map; intake fixes the `_rk-pin-<windowID>` shape | S:90 R:80 A:90 D:85 |
| 2 | Certain | Keep the `GET /api/boards/{name}` `BoardEntryResponse` field shape stable so the frontend is structurally unchanged; the move is transparent because the relay resolves the session from the windowId server-side | Intake §Frontend: "windowId now resolves to a `_rk-pin-*` session server-side, transparent to the component"; minimizes surface (§IV) | S:90 R:75 A:90 D:85 |
| 3 | Certain | Remove BOTH the SSE board `{cleanup}` diff and the `{bootstrap}` broadcast; membership changes surface only via explicit pin/unpin/reorder events | Intake §Relay simplification + §Deletions: "eager board-cleanup ... and the `@rk_board` bootstrap broadcast" both listed for removal | S:92 R:65 A:85 D:80 |
| 4 | Confident | `baseGroupName`/`parseActiveWindowsByGroup`/`realSessionNameSet` (which referenced `RelaySessionPrefix` for relay-group derivation) are adjusted to filter only the `_rk-ctl` anchor, since `rk-relay-*` no longer exists | These helpers serve the tmuxctl active-window seed which the intake scopes as "untouched/investigate"; the minimal correct edit is to drop the now-dead relay branch while preserving anchor filtering | S:80 R:55 A:75 D:70 |
| 5 | Confident | `Pin` resolves the home session via the existing `ResolveWindowSession` rather than introducing a new lookup; the placeholder window from `new-session -d` is killed after `move-window` so the pin-session ends single-window | Intake PIN recipe explicitly notes "construct so the pin-session ends with the moved window as its sole window — no stray placeholder"; reuses an existing helper (§anti-duplication) | S:88 R:70 A:80 D:75 |
| 6 | Confident | The rk-test-* socket reaper tests (`socketsweep_test.go`, TestMain post-sweep) are KEPT; only the relay sweep (`serve_sweep.go`) is deleted — they are distinct subsystems | Intake §Deletions targets only the relay sweep; the socket reaper is the cross-run SIGKILL cleanup, unrelated to ephemerals | S:85 R:70 A:85 D:80 |

6 assumptions (3 certain, 3 confident, 0 tentative).
