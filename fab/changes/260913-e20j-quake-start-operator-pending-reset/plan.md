# Plan: Quake Terminal — Start Operator Pending State Reset

**Change**: 260913-e20j-quake-start-operator-pending-reset
**Intake**: `intake.md`

## Requirements

### run-kit/ui: Quake terminal Start operator pending state

#### R1: Pending is keyed to the requesting server
The operator-less body's Start operator pending state SHALL be held as the name of the server whose `POST /api/operator/start` is in flight (`startPendingServer: string | null`), and the button SHALL render pending (`disabled`, `aria-busy="true"`, label `starting…`) only while the drawer's resolved `server` equals that pending server. A click sets the pending server to the drawer's current server and clears any start error.

- **GIVEN** the drawer shows operator-less `srv1` and Start operator was clicked there (202 answered, no window yet)
- **WHEN** the drawer's server switches to operator-less `srv2` (picker or pinned-server path)
- **THEN** `srv2`'s body renders an enabled `Start operator` button
- **AND WHEN** the drawer switches back to `srv1`, **THEN** its button still reads `starting…` (disabled) until `srv1`'s operator window appears

#### R2: Pending clears on observed appearance of the pending server's operator window
An effect over `sessionsByServer` SHALL clear the pending server when `findOperatorWindow(sessionsByServer.get(startPendingServer) ?? [])` resolves — keyed on the pending server's own sessions, not the drawer's current server. Because the clear fires on appearance (not on body unmount), a window that appears and later vanishes leaves the button idle and re-armed. The 409 `operator_exists` rejection remains a no-op (the effect clears pending).

- **GIVEN** Start operator was clicked on `srv1` and the backend answered 202
- **WHEN** the sessions payload carries `srv1`'s operator window (the embedded terminal mounts) and a later payload drops it
- **THEN** the operator-less body renders an enabled `Start operator` button (not `starting…`)

- **GIVEN** pending on `srv1` while the drawer shows `srv2`
- **WHEN** the sessions payload gains `srv1`'s operator window
- **THEN** pending clears; switching back to `srv1` shows the embedded terminal, and if `srv1`'s operator is then removed the button is idle

#### R3: Bounded fallback re-arm on a pending timeout
While a pending server is set, a single `setTimeout` of `START_OPERATOR_PENDING_TIMEOUT_MS` (45 000 ms, a named constant) SHALL be armed; on expiry it clears the pending server and sets a server-scoped start error `operator did not appear — check the operator terminal or run rk operator` for that server. The timer is cleared when pending changes or clears, and on unmount. No polling (`setInterval` + fetch) is introduced — SSE stays the truth source.

- **GIVEN** Start operator was clicked on `srv1` (202) and no operator window appears
- **WHEN** 45 s elapse
- **THEN** the button is enabled and `quake-terminal-start-error` renders the timeout note
- **AND GIVEN** the window arrives at 10 s instead, **THEN** the timer is cancelled and no note renders

#### R4: Start errors are server-scoped and stale rejections never re-arm another server
`startError` SHALL be stored as `{ server, message } | null` and rendered (`role="alert"`, `data-testid="quake-terminal-start-error"`, `text-signal-red`) only when `startError.server === server`. A non-409 rejection of `startOperator(srv)` SHALL set the error for `srv` and clear pending only if the pending server is still `srv` (read through a ref mirror of the pending server, the `targetRef` idiom) — a stale rejection for a server the user has since left must not touch another server's pending state.

- **GIVEN** pending on `srv1`, drawer switched to operator-less `srv2`
- **WHEN** `srv1`'s POST rejects 502
- **THEN** `srv2`'s body shows no error line and its button is enabled
- **AND WHEN** the drawer switches back to `srv1`, **THEN** the error renders and `srv1`'s button is enabled

#### R5: Existing behaviors hold
The happy body swap (202 → payload carries the window → embedded terminal mounts), the 409-stays-pending behavior, and the inline failure re-arm SHALL keep passing unchanged; the operator-less body's layout, hint text, and mobile toast path are untouched.

- **GIVEN** the existing "Start operator" unit tests
- **WHEN** the suite runs
- **THEN** they pass without modification to their assertions

### Non-Goals
- No change to `POST /api/operator/start`, its 202/409/5xx contract, or `startOperator` in `api/client.ts`
- No client polling; no new SSE event
- No change to the operator-less body's layout, the hint text, or the mobile toast path
- The launch-side fixes (project-root cwd, kickoff visibility, wall wait) are `260913-t7vy`
- No new Playwright spec — the state paths are unit-testable; existing quake/operator-compose specs already cover the body render

### Design Decisions

#### Pending is keyed to the requesting server and cleared on observed appearance
**Decision**: hold the pending state as the requesting server's name, clear it in an effect when that server's operator window appears in the sessions payload, and re-arm after a bounded 45 s timeout.
**Why**: the drawer stays mounted for the page's lifetime and switches servers, so a boolean cleared on body unmount survives both a vanished window and a server switch — the incident's two symptoms. Keying on the server and clearing on observed appearance mirrors how the file already derives `target` and waits on it (the `pendingSend` effect). No SSE event says "no window is coming", so a single timer is the only fallback.
**Rejected**: clear-on-unmount (the incident — the body remounts with the flag still true); clear-on-202 (the button would re-arm while the window is still launching, inviting a duplicate start); client polling (forbidden by code-quality; SSE is the truth source).
*Introduced by*: 260913-e20j-quake-start-operator-pending-reset

## Tasks

### Phase 2: Core Implementation

- [x] T001 Reshape the Start operator state in `app/frontend/src/components/quake-terminal.tsx`: replace `startPending: boolean` with `startPendingServer: string | null` (+ derived `startPending = startPendingServer === server`), a `startPendingServerRef` mirror, and `startError: { server: string; message: string } | null`; update the click handler (set pending server, clear error, non-409 rejection sets the server-scoped error and clears pending only if the ref still names that server) and the button/error render (`startError?.server === server`). <!-- R1, R4 -->
- [x] T002 Add the two effects in `app/frontend/src/components/quake-terminal.tsx`: the target-resolves effect over `[startPendingServer, sessionsByServer]` using `findOperatorWindow` to clear pending, and the `START_OPERATOR_PENDING_TIMEOUT_MS = 45_000` timeout effect that clears pending and sets the server-scoped timeout note, cleared on pending change / unmount. Update the operator-less body comment to state the new contract. <!-- R2, R3 -->

### Phase 3: Integration & Edge Cases

- [x] T003 Extend the "Start operator" block in `app/frontend/src/components/quake-terminal.test.tsx` with six cases: window appears then vanishes re-arms; pending is per server (picker switch); target resolution on the pending server clears pending while the drawer shows another server; timeout re-arms with the inline note (fake timers) and an early window cancels the timer; a stale 502 for `srv1` does not re-arm or error `srv2` and renders on `srv1` when switched back. Existing cases stay unchanged. <!-- R1, R2, R3, R4, R5 -->
- [x] T004 Run the gates: `cd app/frontend && pnpm exec tsc --noEmit`, then `just test-frontend` scoped to `quake-terminal` (all Start operator cases green, no regressions in the file). <!-- R5 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `startPendingServer` replaces the boolean; the button's `disabled`/`aria-busy`/label derive from `startPendingServer === server`
- [x] A-002 R2: an effect over `[startPendingServer, sessionsByServer]` clears pending when `findOperatorWindow` resolves for the pending server
- [x] A-003 R3: a single `setTimeout` bounded by the named constant `START_OPERATOR_PENDING_TIMEOUT_MS` (45 000) re-arms the button and sets the timeout note; cleanup clears it
- [x] A-004 R4: `startError` is `{ server, message } | null`, rendered only for the matching server; a non-409 rejection clears pending only when the ref still names the rejected server

### Behavioral Correctness

- [x] A-005 R2: after a 202 and a window that appears then vanishes, the operator-less body renders an enabled `Start operator` button
- [x] A-006 R1: a server switch away from the pending server renders that server's own idle button; switching back shows `starting…`

### Scenario Coverage

- [x] A-007 R1: unit test — pending is per server across a picker switch
- [x] A-008 R2: unit test — window appears then vanishes re-arms; unit test — resolution on the pending server clears pending while the drawer shows another server
- [x] A-009 R3: unit test with fake timers — 45 s timeout re-arms with the note; a window at 10 s cancels the timer (no note)
- [x] A-010 R4: unit test — stale 502 on `srv1` shows nothing on `srv2`, and renders the error + enabled button on `srv1` when switched back
- [x] A-011 R5: the three pre-existing Start operator tests pass without assertion changes

### Edge Cases & Error Handling

- [x] A-012 R4: a 409 `operator_exists` still renders no error and leaves the button pending until the payload carries the window
- [x] A-013 R3: the timeout timer is cleared on unmount and on any pending change (no state update after unmount, no stale timer firing against a new pending)

### Code Quality

- [x] A-014 Pattern consistency: the new effects follow the file's existing effect-over-`target`/ref-mirror idioms (`pendingSend` effect, `targetRef`)
- [x] A-015 No unnecessary duplication: `findOperatorWindow` and the session context are consumed as-is; no new helper duplicates the `target` derivation
- [x] A-016 No polling from the client: no `setInterval` + fetch introduced; SSE stays the truth source
- [x] A-017 No magic numbers: the timeout is a named constant with a comment stating the daemon's 30 s receipt bound as its rationale
- [x] A-018 Type narrowing over assertions: the server-scoped error and the pending server use plain type guards, no `as` casts
- [x] A-019 Comment discipline: comments state the cross-file contract (SSE payload as truth, daemon receipt bound) and never narrate the next line or cite change IDs
- [x] A-020 Tests cover the changed behavior: six new unit cases (the timeout path split into expiry and early-cancel), existing cases unchanged

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change reshapes the Start operator pending state in place (boolean → server-keyed slot plus a derived `startPending` that keeps the render call sites unchanged); no existing file, function, branch, or config became redundant or unused.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Pending keyed to the requesting server; cleared by an effect on observed appearance of that server's operator window | Intake decision, user-confirmed; matches the file's `target`/`pendingSend` idiom | S:90 R:90 A:95 D:95 |
| 2 | Confident | 45 s timeout as a named constant, note text `operator did not appear — check the operator terminal or run rk operator` | Intake value; daemon receipt bound is 30 s plus SSE wake latency | S:65 R:95 A:75 D:65 |
| 3 | Confident | `startError` server-scoped as `{ server, message }`, stale rejections ignored for other servers via a ref mirror | Intake §1 extension; small and revertible | S:60 R:95 A:80 D:60 |
| 4 | Confident | Per-server switching in tests rides the Host-route picker (`Operator server` combobox), the path the file already tests | Existing test precedent; the pinned-server path is equivalent for the state under test | S:70 R:95 A:85 D:75 |
| 5 | Confident | Unit tests only; no new Playwright spec | Intake non-goal; existing quake/operator-compose specs cover the body render | S:65 R:90 A:80 D:70 |

5 assumptions (1 certain, 4 confident, 0 tentative).
