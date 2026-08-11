# Plan: Reap sockets-v2 dead code

**Change**: 260811-j6oy-reap-sockets-v2-dead-code
**Intake**: `intake.md`

## Requirements

### Frontend: API Client

#### R1: Delete `getSessionOrder` from the API client
The `getSessionOrder` function in `app/frontend/src/api/client.ts` (lines 107-112) MUST be deleted. It has zero importers outside its own test block — session order arrives via the `/ws/state` socket. The adjacent live `setSessionOrder` (POST, `client.ts:114`) MUST remain untouched.

- **GIVEN** `getSessionOrder` exists in `app/frontend/src/api/client.ts` with no production importers
- **WHEN** the function is deleted
- **THEN** no reference to `getSessionOrder` remains anywhere in `app/frontend/src/` outside the API client test file
- **AND** `setSessionOrder` and all other exports remain intact

#### R2: Remove `getSessionOrder` test coverage
The `getSessionOrder` import (`app/frontend/src/api/client.test.ts:10`) and its three test cases (`client.test.ts:502-530`: "fetches GET /api/sessions/order with server query", "defaults to empty array when order is absent", "throws on non-2xx response") MUST be deleted. The rest of the suite MUST be untouched.

- **GIVEN** `client.test.ts` imports `getSessionOrder` and tests only the dead function in three cases
- **WHEN** the import and the three test cases are removed
- **THEN** the remaining suite compiles and passes under `just test-frontend`

### Backend: Bare `SelectWindow` chain

#### R3: Delete the bare `SelectWindow` across all four layers
The bare `SelectWindow(windowID, server string) error` chain — with zero production callers (everything uses session-scoped `SelectWindowInSession`) — MUST be deleted from:

- the `TmuxOps` interface (`app/backend/api/router.go:61`)
- the `prodTmuxOps.SelectWindow` wrapper (`app/backend/api/router.go:289-291`)
- the `tmux.SelectWindow` implementation including its doc comment (`app/backend/internal/tmux/tmux.go:1787-1794`)
- the `mockTmuxOps.SelectWindow` method (`app/backend/api/sessions_test.go:327-330`) and its recording fields `selectWindowCalled` (`sessions_test.go:68`) and `selectWindowWindowID` (`sessions_test.go:69`)

- **GIVEN** the bare `SelectWindow` exists on the interface, prod wrapper, tmux implementation, and mock
- **WHEN** all four layers are deleted
- **THEN** the backend compiles and a repo-wide grep for `SelectWindow(` finds only `SelectWindowInSession` occurrences
- **AND** `just test-backend` passes

#### R4: Retire the "bare SelectWindow must NOT be called" assertions
The runtime guard assertions in `app/backend/api/windows_test.go` become uncompilable once the mock method/fields are gone and MUST be retired — compile-time absence supersedes the runtime guard. Specifically:

- the `if ops.selectWindowCalled { … }` blocks at `windows_test.go:318-320` and `:338-340` MUST be deleted
- the assertion at `windows_test.go:354` MUST drop the `|| ops.selectWindowCalled` operand; the `selectWindowInSessionCalled` half MUST stay
- the file-level comment (`windows_test.go:291-294`, "…never a bare SelectWindow") MUST be updated to reflect that the bare variant no longer exists (not deleted — the scoped-select tests it introduces remain the positive guard)

- **GIVEN** `windows_test.go` guards against calls to the bare `SelectWindow` via mock recording fields
- **WHEN** the mock fields are removed (R3) and the assertions retired
- **THEN** the scoped-select assertions (`SelectWindowInSession` called on success, NOT called on resolve failure / invalid ID) still pass
- **AND** the section comment describes only the scoped-select behavior

### Backend: `relay_test.go` rename

#### R5: Rename `relay_test.go` and its helpers
`app/backend/api/relay_test.go` tests the `/ws/terminals` terminals mux; its name and helpers outlived the retired `/relay/{windowId}` endpoint. The file MUST be renamed to `app/backend/api/terminals_relay_test.go` (`terminals_ws_test.go` already exists, so the plain name is taken; "relay" is retained for the per-stream relay behavior the ported tests cover). Helper `withRelayTmux` MUST be renamed to `withTerminalsTmux` and `relayServerWithProdTmux` to `terminalsServerWithProdTmux`, with all call sites inside the file updated. No behavioral edits.

- **GIVEN** `relay_test.go` contains `withRelayTmux` / `relayServerWithProdTmux` and tests the `/ws/terminals` mux
- **WHEN** the file and helpers are renamed
- **THEN** no reference to `relay_test.go`, `withRelayTmux`, or `relayServerWithProdTmux` remains in the repo
- **AND** the renamed file's tests pass unchanged under `just test-backend`

### Non-Goals

- Backend GET `/api/sessions/order` route (`router.go:632`, `sessions.go:140`) — live server API surface; only the frontend client wrapper is dead
- Any behavioral change — every deleted symbol has zero production callers
- Memory updates (`docs/memory/run-kit/tmux-sessions.md`, `docs/memory/run-kit/architecture.md`) — handled at hydrate

### Design Decisions

#### Deletion over deprecation
**Decision**: Straight deletion of all three dead-code clusters.
**Why**: None of these symbols are part of any external surface; compile-time absence of the bare `SelectWindow` is a stronger guarantee than the current runtime "must NOT be called" test assertions.
**Rejected**: Deprecation — adds ceremony for symbols with zero callers and no external consumers.
*Introduced by*: 260811-j6oy-reap-sockets-v2-dead-code

## Tasks

### Phase 1: Frontend client cleanup

- [x] T001 Delete the `getSessionOrder` function (lines 107-112) from `app/frontend/src/api/client.ts`; leave `setSessionOrder` intact <!-- R1 -->
- [x] T002 Remove `getSessionOrder` from the import list (line 10) and delete its three test cases (lines 502-530) in `app/frontend/src/api/client.test.ts` <!-- R2 -->

### Phase 2: Backend `SelectWindow` chain removal

- [x] T003 Delete `SelectWindow(windowID, server string) error` from the `TmuxOps` interface (`app/backend/api/router.go:61`) and the `prodTmuxOps.SelectWindow` wrapper (`app/backend/api/router.go:289-291`) <!-- R3 -->
- [x] T004 Delete the `SelectWindow` implementation and its doc comment (`app/backend/internal/tmux/tmux.go:1787-1794`) <!-- R3 -->
- [x] T005 Delete the `mockTmuxOps.SelectWindow` method (`app/backend/api/sessions_test.go:327-330`) and the `selectWindowCalled` / `selectWindowWindowID` fields (`sessions_test.go:68-69`) <!-- R3 -->
- [x] T006 Retire the bare-`SelectWindow` assertions in `app/backend/api/windows_test.go`: delete the `if ops.selectWindowCalled` blocks (:318-320, :338-340), drop the second operand at :354, and update the file-level comment (:291-294) to state the bare variant no longer exists <!-- R4 -->

### Phase 3: Test rider rename & verification

- [x] T007 Rename `app/backend/api/relay_test.go` → `app/backend/api/terminals_relay_test.go`; rename `withRelayTmux` → `withTerminalsTmux` and `relayServerWithProdTmux` → `terminalsServerWithProdTmux` with all in-file call sites <!-- R5 -->
- [x] T008 Run `just test-backend` and `just test-frontend`; confirm both suites green <!-- R1, R2, R3, R4, R5 -->

## Execution Order

- T003 and T004 are independent deletions but both block T005/T006 (mock + assertions must compile against the shrunk interface)
- T001/T002 (frontend) are independent of all backend tasks
- T008 runs last, after all edits

## Acceptance

### Functional Completeness

- [x] A-001 R1: `getSessionOrder` no longer exists in `app/frontend/src/api/client.ts`; `setSessionOrder` and other exports unchanged
- [x] A-002 R2: `client.test.ts` contains no `getSessionOrder` import or test case; remaining suite is byte-identical apart from those removals
- [x] A-003 R3: bare `SelectWindow` is gone from the `TmuxOps` interface, `prodTmuxOps`, `internal/tmux`, and `mockTmuxOps` (method + both recording fields)
- [x] A-004 R4: `windows_test.go` has no `selectWindowCalled` reference; the scoped-select assertions remain and the section comment reflects that the bare variant no longer exists
- [x] A-005 R5: `terminals_relay_test.go` exists in place of `relay_test.go` with helpers `withTerminalsTmux` / `terminalsServerWithProdTmux`; test behavior unchanged

### Behavioral Correctness

- [x] A-006 R3: The terminals mux and REST `/select` handler still select windows via `SelectWindowInSession` (existing scoped-select tests pass)

### Removal Verification

- [x] A-007 R1: Grep of `app/frontend/src/` for `getSessionOrder` returns zero matches (the backend `tmux.GetSessionOrder` wrapper and its `internal/snapshot` alias are live, unrelated symbols and stay)
- [x] A-008 R3: Grep of `app/backend/` shows no bare `SelectWindow` declaration — interface method, `prodTmuxOps` wrapper, `tmux.go` implementation, and mock method all gone — and no `selectWindowCalled`/`selectWindowWindowID` remain (`SelectWindowInSession` and the frontend `onSelectWindow` callbacks are distinct symbols and stay)
- [x] A-009 R5: Grep of `app/backend/` for `withRelayTmux` / `relayServerWithProdTmux` returns zero matches, and no file named exactly `relay_test.go` exists (the renamed `terminals_relay_test.go` intentionally carries the old name as a suffix substring)

### Scenario Coverage

- [x] A-010 R3, R4: `just test-backend` passes with the shrunk `TmuxOps` interface and retired assertions
- [x] A-011 R1, R2: `just test-frontend` passes without the `getSessionOrder` suite block

### Code Quality

- [x] A-012 Pattern consistency: deletions leave surrounding code style intact; comment updates match the file's existing tone
- [x] A-013 No unnecessary duplication: no replacement code introduced — this change is pure deletion plus a rename

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope is exactly the three intake clusters; all sites re-verified live at plan time (getSessionOrder client.ts:107, SelectWindow impl tmux.go:1787, mock sessions_test.go:327, assertions windows_test.go:318/338/354) | Intake is precise and grep re-confirmed zero production callers for every doomed symbol | S:85 R:85 A:95 D:90 |
| 2 | Confident | Backend GET `/api/sessions/order` route stays — only the frontend client fn is deleted | Route is live at router.go:632; intake scopes "delete fn + test block" — removing a server API surface is a different change | S:65 R:75 A:80 D:70 |
| 3 | Confident | Retire the "bare SelectWindow must NOT be called" assertions + mock method/fields; keep the scoped-select assertions and update the explanatory comment | Intake offers "retire or repurpose"; compile-time absence is the stronger guarantee, and the positive SelectWindowInSession assertions remain | S:75 R:80 A:85 D:65 |

3 assumptions (1 certain, 2 confident, 0 tentative).
