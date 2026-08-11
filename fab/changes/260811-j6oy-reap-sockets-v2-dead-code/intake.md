# Intake: Reap sockets-v2 dead code

**Change**: 260811-j6oy-reap-sockets-v2-dead-code
**Created**: 2026-08-11

## Origin

One-shot `/fab-new j6oy` from backlog entry `[j6oy]` (2026-07-18):

> Reap pre-existing dead code surfaced by the sockets-v2 review (PR #378) but out of that PR's scope (dead BEFORE the socket unification, verified by call-site sweeps 2026-07-17): (1) frontend src/api/client.ts:50 getSessionOrder — zero importers outside its own client.test.ts block (session-order rides the state socket, previously SSE); delete fn + test block. (2) backend bare SelectWindow chain — router.go:58 interface method + router.go:236 prodTmuxOps wrapper + tmux.go:1636 implementation + the test-mock method: zero production callers (everything uses session-scoped SelectWindowInSession; windows_test.go asserts bare-select is NEVER called) — delete across interface/impl/mock and retire or repurpose that assertion with it. (3) cosmetic rider: app/backend/api/relay_test.go helper names (withRelayTmux, relayServerWithProdTmux) outlived the retired /relay endpoint — the file now tests /ws/terminals; rename file + helpers if touching. Re-verify call sites before deleting.

All three sites were re-verified live at intake time (2026-08-11); line numbers have drifted since the backlog entry was written — current locations are used throughout this intake.

## Why

1. **Pain point**: Three dead-code clusters survive from before the sockets-v2 unification (PR #378). Dead code carries maintenance cost: the bare `SelectWindow` stays on the `TmuxOps` interface so every mock must implement it, `windows_test.go` spends assertions guarding against calling a function nothing calls, and `getSessionOrder`'s only "coverage" is a test block testing the dead function itself. The `relay_test.go` file/helper names reference a retired `/relay` endpoint, misleading readers about what the file tests (it tests the `/ws/terminals` mux).
2. **If not fixed**: Future changes to `TmuxOps` or the API client keep paying the dead weight — new mocks implement a never-called method, reviewers re-discover the same dead code (it already cost review time in PR #378), and memory (`tmux-sessions.md`) must keep documenting a helper with "no production callers".
3. **Approach**: Straight deletion (with the memory docs updated at hydrate), not deprecation — none of these symbols are part of any external surface. Compile-time absence of the bare `SelectWindow` is a stronger guarantee than the current runtime "must NOT be called" test assertions, so those assertions retire with the method.

## What Changes

### Frontend: delete `getSessionOrder`

- `app/frontend/src/api/client.ts:107-112` — delete the `getSessionOrder` function. Zero importers outside its own test block (session order arrives via the `/ws/state` socket). The adjacent `setSessionOrder` (POST, `client.ts:114`) is **live** and stays.
- `app/frontend/src/api/client.test.ts` — remove `getSessionOrder` from the import list (line 10) and delete its three test cases (`client.test.ts:502-530`: "fetches GET /api/sessions/order…", "defaults to empty array…", "throws on non-2xx response"). The rest of the suite is untouched.

The backend GET route `/api/sessions/order` (`router.go:632`, `sessions.go:140`) is **out of scope** — it is a live server API surface; only the frontend client wrapper is dead. <!-- assumed: backend GET /api/sessions/order endpoint kept — backlog scopes only the frontend fn + test block; removing a server route is an API-surface change beyond this reap -->

### Backend: delete the bare `SelectWindow` chain

Zero production callers — both the terminals mux and the REST `/select` handler use session-scoped `SelectWindowInSession` (a bare `select-window -t @N` is ambiguous inside session groups). Delete across all four layers:

- `app/backend/api/router.go:61` — the `SelectWindow(windowID, server string) error` method on the `TmuxOps` interface
- `app/backend/api/router.go:289-291` — the `prodTmuxOps.SelectWindow` wrapper
- `app/backend/internal/tmux/tmux.go:1787-…` — the `SelectWindow` implementation (function + doc comment)
- `app/backend/api/sessions_test.go` — the `mockTmuxOps.SelectWindow` method (`sessions_test.go:327-330`) and its recording fields `selectWindowCalled` (`:68`) and `selectWindowWindowID` (`:69`)

**Assertion retirement** in `app/backend/api/windows_test.go`: the "bare SelectWindow must NOT be called" checks become uncompilable once the mock method/fields are gone. Retire them — compile-time absence supersedes the runtime guard:

- `windows_test.go:318-320` and `:338-340` — delete the `if ops.selectWindowCalled { … }` blocks
- `windows_test.go:354` — `if ops.selectWindowInSessionCalled || ops.selectWindowCalled` drops the second operand; the scoped-select half of the assertion **stays**
- The file-level comment (`windows_test.go:291-294`, "…never a bare SelectWindow") is updated to reflect that the bare variant no longer exists, rather than deleted — the scoped-select tests it introduces remain the positive guard

### Test rider: rename `relay_test.go` and its helpers

The file tests the `/ws/terminals` terminals mux (`relay_test.go:25-26` says so explicitly); its name and helpers outlived the retired per-pane `/relay/{windowId}` endpoint. Cosmetic rename, no behavioral edits:

- `app/backend/api/relay_test.go` → `app/backend/api/terminals_relay_test.go` (`terminals_ws_test.go` already exists, so the plain name is taken; "relay" is retained because per-stream relay behavior is what the ported tests cover)
- Helper `withRelayTmux` → `withTerminalsTmux`; helper `relayServerWithProdTmux` → `terminalsServerWithProdTmux`; all call sites inside the file updated

### Memory updates (hydrate)

- `docs/memory/run-kit/tmux-sessions.md` — the helper inventory documents `SelectWindow(windowID, server)` with "Has **no production callers** (still on the `TmuxOps` interface)"; that bullet is removed (the helper no longer exists)
- `docs/memory/run-kit/architecture.md:1107` — the handler-test inventory notes `relay_test.go`'s helper names as "a cosmetic-rename deletion candidate"; updated to the new file/helper names

## Affected Memory

- `run-kit/tmux-sessions`: (modify) remove the bare-`SelectWindow` helper bullet from the `internal/tmux` helper inventory
- `run-kit/architecture`: (modify) update the handler-integration-test inventory line — `relay_test.go` rename, helper renames, cosmetic-candidate note resolved

## Impact

- **Frontend**: `app/frontend/src/api/client.ts`, `app/frontend/src/api/client.test.ts` — pure deletion
- **Backend**: `app/backend/api/router.go`, `app/backend/api/sessions_test.go`, `app/backend/api/windows_test.go`, `app/backend/api/relay_test.go` (renamed), `app/backend/internal/tmux/tmux.go` — deletion + one file/helper rename
- **Behavior**: none — every deleted symbol has zero production callers (re-verified 2026-08-11 via repo-wide grep). No API surface, route, or UI change
- **Tests**: `just test-backend` and `just test-frontend` must stay green; the deleted test cases test only the deleted symbols. No e2e impact (no `.spec.ts` touched, so no `.spec.md` obligation)

## Open Questions

- None — scope is fully enumerated by the backlog entry and all call sites were re-verified at intake time.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope is exactly the three backlog clusters; all sites re-verified live 2026-08-11 (line numbers drifted: getSessionOrder now client.ts:107, SelectWindow impl tmux.go:1787, mock sessions_test.go:327) | Backlog enumerates the scope precisely; fresh grep confirmed zero production callers for every doomed symbol | S:85 R:85 A:95 D:90 |
| 2 | Certain | `change_type: chore` pinned explicitly (refresh inferred `feat`) | Dead-code removal with zero behavior change is a chore; pinned via set-change-type so refresh cannot flip it | S:80 R:95 A:90 D:80 |
| 3 | Confident | Backend GET `/api/sessions/order` route stays (only the frontend client fn is deleted) | Route is live at router.go:632; backlog scopes "delete fn + test block" — removing a server API surface is a different change | S:65 R:75 A:80 D:70 |
| 4 | Confident | Retire the "bare SelectWindow must NOT be called" assertions + mock method/fields; keep the scoped-select assertions and update the explanatory comment | Backlog offers "retire or repurpose"; compile-time absence is the stronger guarantee, and the positive SelectWindowInSession assertions remain | S:75 R:80 A:85 D:65 |
| 5 | Confident | Rename `relay_test.go` → `terminals_relay_test.go`; helpers → `withTerminalsTmux` / `terminalsServerWithProdTmux` | `terminals_ws_test.go` name is taken; "relay" kept for the per-stream relay behavior the file covers; trivially renameable later | S:55 R:90 A:75 D:40 |

5 assumptions (2 certain, 3 confident, 0 tentative, 0 unresolved).
