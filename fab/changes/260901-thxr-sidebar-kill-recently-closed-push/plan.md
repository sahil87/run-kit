# Plan: Sidebar Kill Paths Push the Recently-Closed Record

**Change**: 260901-thxr-sidebar-kill-recently-closed-push
**Intake**: `intake.md`

## Requirements

### Frontend: Sidebar kill executors feed the recently-closed mirror

#### R1: Ctrl+click window kill pushes the closed record
The sidebar's ctrl+click window-kill executor (`executeKillWindow` in `app/frontend/src/components/sidebar/index.tsx`) MUST push the kill response's `closed` record onto the killed window's server mirror via `pushRecentlyClosed(srv, res.closed)` (imported from `@/hooks/use-recently-closed`), mirroring the `use-dialog-state.ts` executor shape: await `killWindowApi`, push when `res.closed` is present, and return the response. When the response carries no `closed` field (server-side capture failed), nothing SHALL be pushed.

- **GIVEN** a window row on server `srv`
- **WHEN** the user ctrl+clicks its kill control and the kill response carries `closed`
- **THEN** `pushRecentlyClosed(srv, closed)` is invoked with the exact server the response came from
- **AND** a response without `closed` invokes no push

#### R2: Kill-confirm-dialog window arm pushes the closed record; session arm untouched
The sidebar kill-confirm-dialog executor (`executeKillFromDialog`, same file) MUST push `res.closed` on its **window** arm only, using the same await/push/return shape (the `action` becomes `async`). The **session** arm (`killSessionApi`) MUST remain unchanged — session kills carry no `closed` record.

- **GIVEN** the sidebar kill dialog confirming a window kill on server `srv`
- **WHEN** the kill response carries `closed`
- **THEN** `pushRecentlyClosed(srv, closed)` is invoked
- **AND** confirming a session kill invokes no push and its code path is unchanged

#### R3: Unit tests cover the push contract at both executors
Unit tests MUST cover the added behavior per `fab/project/code-quality.md`: for each of the two sidebar executors, a kill whose response carries `closed` pushes that record (with the row's server), and a response without `closed` pushes nothing. Tests live in the existing colocated sidebar suite (`app/frontend/src/components/sidebar/index.core.test.tsx`), which already mocks `@/api/client`'s `killWindow` and exercises both kill paths.

- **GIVEN** the sidebar suite with `killWindow` mocked to resolve `{ ok: true, closed: <record> }`
- **WHEN** each kill path (ctrl+click; dialog confirm) fires
- **THEN** the test asserts the push occurred with `(server, record)` — and a `{ ok: true }` resolution asserts no push

### Non-Goals

- Agent-record survival after plain reopen (the 4s toast-dismiss window and its duplicate-offer-after-reload tradeoff) — known design tradeoff, explicitly out of scope per the intake.
- No backend, API, route, or schema change; no new e2e spec (state plumbing behind existing surfaces — the reopen flow's e2e coverage from 260829-11t0 stands).

## Tasks

### Phase 2: Core Implementation

- [x] T001 In `app/frontend/src/components/sidebar/index.tsx`, import `pushRecentlyClosed` from `@/hooks/use-recently-closed` and rework `executeKillWindow`'s `action` to the async await/push/return shape mirroring `use-dialog-state.ts:114-121` <!-- R1 -->
- [x] T002 Same file: make `executeKillFromDialog`'s `action` async and push `res.closed` on the window arm only, leaving the session arm as-is <!-- R2 -->
- [x] T003 Extend `app/frontend/src/components/sidebar/index.core.test.tsx`: mock/spy `pushRecentlyClosed`, drive both kill paths with a `closed`-carrying response (assert push with the row's server + record) and a bare `{ ok: true }` response (assert no push); run the sidebar suite + `tsc --noEmit` <!-- R3 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `executeKillWindow` awaits the kill, pushes `res.closed` when present via `pushRecentlyClosed(srv, res.closed)`, and returns the response
- [x] A-002 R2: `executeKillFromDialog`'s window arm does the same; the session arm's code is byte-identical to before

### Behavioral Correctness

- [x] A-003 R1: A kill response without `closed` results in no push from either executor
- [x] A-004 R2: The `srv` used for the push is the per-call captured server (Server Capture Convention Shape B), never an ambient one

### Scenario Coverage

- [x] A-005 R3: Unit tests exist in `index.core.test.tsx` covering push-on-closed and no-push-without-closed for both executors, and pass

### Code Quality

- [x] A-006 Pattern consistency: the new `action` bodies match the shipped `use-dialog-state.ts` executor shape; no new abstractions introduced
- [x] A-007 No unnecessary duplication: `pushRecentlyClosed` is reused, not reimplemented; no client-level push added to `api/client.ts`
- [x] A-008 Frontend type check passes (`npx tsc --noEmit` in `app/frontend`)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)

## Deletion Candidates

None — this change adds new functionality without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Test placement: extend `index.core.test.tsx` (it already mocks `killWindow` and drives both kill paths) and assert against a spied `pushRecentlyClosed` rather than reading the mirror's module state | The suite's existing kill tests are the natural anchor; spying the push isolates the executor contract from mirror internals (already covered by `use-recently-closed.test.ts`) | S:75 R:90 A:85 D:75 |

1 assumptions (0 certain, 1 confident, 0 tentative).
