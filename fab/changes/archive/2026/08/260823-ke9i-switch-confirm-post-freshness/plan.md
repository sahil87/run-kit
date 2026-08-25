# Plan: Window-Switch Confirmation Survives Sleep/Wake

**Change**: 260823-ke9i-switch-confirm-post-freshness
**Intake**: `intake.md`

## Requirements

### Backend: select response carries the post-select active window

#### R1: `handleWindowSelect` returns the active window in its 200 body
`POST /api/windows/{windowId}/select` SHALL return `{"ok": true, "activeWindow": "@N"}` where `activeWindow` is the resolved session's active window id read from tmux AFTER the `select-window` executed (Constitution II — derived at response time). The endpoint stays a POST with no new route (Constitution IX — response-body extension only). The read MUST use a session-scoped target in the exact-match form (`=<session>:` — a bare session target is a window-target collision hazard). If the post-select read fails, the handler SHALL fall back to reporting the requested `{windowId}` (the select itself succeeded, so tmux executed it) — the read failure MUST NOT fail the request.

- **GIVEN** a live tmux server with session `s` containing windows `@1` (active) and `@2`
- **WHEN** the client POSTs `/api/windows/@2/select`
- **THEN** the response is `200 {"ok":true,"activeWindow":"@2"}`

- **GIVEN** the select succeeds but the post-select active-window read errors
- **WHEN** the handler composes the response
- **THEN** it returns `200 {"ok":true,"activeWindow":"@2"}` (the requested id), never a 5xx

### Frontend: trust the POST — confirm on 200

#### R2: `selectWindow` surfaces the response body
`selectWindow(server, windowId)` in `app/frontend/src/api/client.ts` SHALL return the parsed body `{ ok: boolean; activeWindow?: string }`. A missing `activeWindow` field (older daemon) is valid — callers MUST treat it as "select executed, active window unreported".

- **GIVEN** the backend returns `{"ok":true,"activeWindow":"@2"}`
- **WHEN** `selectWindow` resolves
- **THEN** the caller receives `activeWindow === "@2"`

#### R3: a matching 200 cancels the failure bounce — and ONLY the failure bounce
When the `selectWindow` POST for the CURRENT pending switch resolves with `ok` and `activeWindow` equal to the pending target (or `activeWindow` absent), `app.tsx` SHALL cancel that switch's `CONFIRMATION_WINDOW_MS` bounce timer so `bouncePendingSwitch` can never fire for it. The confirmation MUST NOT clear `pendingClickRef` (the intent IS the writeback suppression — clearing it early re-exposes the URL to the stale-snapshot yank), MUST NOT settle the first-paint gate or touch the mask (paint feedback stays byte-driven; see Design Decisions), and MUST NOT cancel the grace-mask handle. Identity guards are load-bearing: the confirmation applies only while the tracked entry is still current (`pendingSwitchRef.current === tracked`, the still-points-at-itself pattern) AND the intent still records this `{server, windowId}` (`isSamePendingTarget`) — a superseded switch's late 200 is a no-op. A 200 whose `activeWindow` differs from the target does NOT confirm; it counts as fresh post-click evidence (R4) and the existing resolution paths (writeback / freshness-gated bounce) settle it. SSE remains the authority that clears the intent (`sseConfirmed` in the writeback) — unchanged.

- **GIVEN** a pending switch to `{server: "s", windowId: "@2"}` with its bounce timer armed, and a dead state socket
- **WHEN** the POST resolves `{ok:true, activeWindow:"@2"}`
- **THEN** the bounce timer is cancelled — no bounce, no toast — and `pendingClickRef` still records `@2` until SSE confirms

- **GIVEN** switch 1 to `@2` is superseded by switch 2 to `@3`
- **WHEN** switch 1's POST resolves late with `{ok:true, activeWindow:"@2"}`
- **THEN** switch 2's tracking is untouched (its timer stays armed)

- **GIVEN** a pending switch to `@2`
- **WHEN** the POST resolves `{ok:true, activeWindow:"@5"}` (an external switch won the race)
- **THEN** the intent is not confirmed, and the mismatched response registers as fresh post-click evidence for the R4 verdict

#### R4: the bounce verdict is freshness-gated — never rendered from pre-click evidence
`bouncePendingSwitch` SHALL only declare failure on evidence that post-dates the click. On timer expiry the verdict resolves through a pure helper (`resolvePendingSwitchVerdict` in `src/lib/window-transition.ts`) over: whether the state socket is connected, whether post-click evidence exists (a per-server receipt tick newer than the tick recorded at switch start, OR a mismatched POST `activeWindow`), and what the latest evidence says. Outcomes: **confirm** (evidence shows the target active — the existing silent-clear rescue), **bounce** (fresh post-click evidence shows a DIFFERENT window active — today's bounce + toast), **re-arm** (no fresh evidence, or socket disconnected — re-arm the timer for another `CONFIRMATION_WINDOW_MS` and keep the intent; extend-until-evidence, no fetch-based re-verify — see Design Decisions). Existing guards (H1 server identity, route-match, teardown effects, supersession) are unchanged and run before the verdict.

- **GIVEN** the sleep/wake scenario: a pending switch to `@2` clicked while the state socket is half-open dead, `activeWindowRef` frozen on pre-sleep `@1`, no snapshot received since the click
- **WHEN** the confirmation timer expires
- **THEN** no bounce and no toast — the timer re-arms and the URL stays on `@2`

- **GIVEN** a pending switch to `@2`, and a post-click snapshot arrives showing `@5` active (external switch won)
- **WHEN** the confirmation timer expires
- **THEN** the bounce fires exactly as today (navigate to `@5`, failure toast)

- **GIVEN** a pending switch whose timer re-armed, and the reconnect snapshot then reports `@2` active
- **WHEN** the writeback effect runs
- **THEN** the intent clears via the existing `sseConfirmed` path and the re-armed timer is cancelled

### Session context: receive-freshness signal

#### R5: per-server receipt tick
`SessionProvider` (`src/contexts/session-context.tsx`) SHALL maintain a per-server monotonic receipt tick, incremented whenever a server-scoped snapshot or event is received for that server (the `onEvent` kind-`server` branch and the `onAck` server-snapshot branch), and expose a stable, ref-backed `getServerReceiptTick(server): number` through the context (imperative read — the bounce callback must not subscribe to re-renders). The tick is reset-free (monotonic for the provider's lifetime); a server never seen reads 0.

- **GIVEN** a subscribed server `s` with tick `n`
- **WHEN** a `sessions` event or a resubscribe ack snapshot for `s` arrives
- **THEN** `getServerReceiptTick("s")` returns a value `> n`

### Non-Goals

- Fix 3 (faster wake probes in `state-socket.ts` / `relay-mux.ts`) — explicitly out of scope.
- Fix 4 (skipping the relay's select-on-stream-open on reconnect re-opens, `terminals_ws.go:445`) — explicitly out of scope.
- Toast copy, bounce navigation mechanics, gate/mask machinery semantics — unchanged.
- No new Playwright e2e — sleep/wake socket half-open death is not reproducible in the e2e rig; the seams are unit-tested.

### Design Decisions

#### POST-200 cancels only the bounce timer, never the intent or the gate
**Decision**: Confirmation-on-200 disarms the failure detector (the 5s bounce timer) and nothing else: `pendingClickRef` stays set until SSE confirms, and `confirmSwitchArrived()` is NOT called at POST resolution.
**Why**: The pending intent is what suppresses the URL writeback while the SSE snapshot is stale — clearing it at POST time would let the very next writeback pass navigate back to the stale active window, recreating the bug through the front door. And `confirmSwitchArrived()` settles the first-paint gate as `"first-write"`; calling it at POST resolution (which typically precedes the tmux redraw bytes) would slide/unmask into not-yet-repainted stale content, violating the "slide = confirmed content arrival" contract. Paint feedback stays byte-driven; the POST 200 is navigation-truth evidence only.
**Rejected**: Calling `confirmSwitchArrived()` on 200 (breaks the earned-slide semantics); clearing `pendingClickRef` on 200 (re-exposes the stale-writeback yank the intent exists to suppress).
*Introduced by*: 260823-ke9i-switch-confirm-post-freshness

#### No-fresh-evidence policy: extend-until-evidence, no GET re-verify
**Decision**: On timer expiry with no post-click evidence (or a disconnected socket), the confirmation window re-arms indefinitely; no one-shot GET-of-sessions verdict path ships. (Resolves intake Assumption #9, deferred at promptless dispatch.)
**Why**: A bounce without post-click evidence is exactly the bug being fixed — bounding the re-arm ("one extension, then bounce anyway") reintroduces the evidence-free bounce, just later. The failure asymmetry favors extension: staying on the window the user chose (which R3 has usually already confirmed via the POST) is strictly better than a false yank + toast. The intent still clears through supersession, the three teardown effects, and the next SSE snapshot (reconnect resubscribes re-ack with a fresh snapshot, so evidence eventually arrives on every recovery path). A fetch-based verdict adds a client-polling path the project's code-quality anti-patterns rule out, for a case fix 1 already covers.
**Rejected**: Bounded re-arm then bounce (evidence-free verdict, deferred); one-shot GET re-verify (client-polling anti-pattern; redundant with POST confirmation).
*Introduced by*: 260823-ke9i-switch-confirm-post-freshness

#### Verdict logic is a pure helper in `window-transition.ts`
**Decision**: The expiry decision (`confirm | bounce | rearm`) and the POST-confirmation predicate are pure exported functions in `src/lib/window-transition.ts` with colocated Vitest coverage; `app.tsx` supplies the ambient facts.
**Why**: The pending-switch machinery's established pattern — `isSamePendingTarget`, `isRedundantSwitch`, the gate/mask state machine — keeps decision logic DOM-free and unit-testable, which is the only way to test the sleep/wake scenario deterministically (no real sockets or timers needed).
**Rejected**: Inline logic in `bouncePendingSwitch` (untestable without mounting AppShell; the exact class of drift the pure-helper pattern exists to prevent).
*Introduced by*: 260823-ke9i-switch-confirm-post-freshness

## Tasks

### Phase 1: Setup

- [x] T001 Add `ActiveWindowID(ctx, server, session) (string, error)` to `app/backend/internal/tmux/tmux.go` — `display-message -p -t "=<session>:" "#{window_id}"` via the existing `tmuxExecServer` + `withTimeout` convention (exact-match `=` target form) — plus a unit test in `app/backend/internal/tmux/tmux_test.go` for the arg construction/parse <!-- R1 -->

### Phase 2: Core Implementation

- [x] T002 Extend `handleWindowSelect` in `app/backend/api/windows.go` to call `ActiveWindowID` after a successful select and return `{ok:true, activeWindow:<id>}`, falling back to the requested `windowId` when the read errors; add `ActiveWindowID` to the `TmuxOps` interface + `prodTmuxOps` wiring in `app/backend/api/router.go`; extend the mock + assertions in `app/backend/api/windows_test.go` (success shape, read-failure fallback) <!-- R1 -->
- [x] T003 [P] Change `selectWindow` in `app/frontend/src/api/client.ts` to return `{ ok: boolean; activeWindow?: string }` (parse body; keep `throwOnError` semantics) <!-- R2 -->
- [x] T004 [P] Add pure helpers to `app/frontend/src/lib/window-transition.ts`: `postConfirmsSwitch(resp, targetWindowId)` (true iff `ok` and `activeWindow` absent or equal to target) and `resolvePendingSwitchVerdict({ isConnected, tickAtClick, currentTick, postContradiction, activeWindowId, targetWindowId })` → `"confirm" | "bounce" | "rearm"`; unit tests in `window-transition.test.ts` covering: no-fresh-evidence → rearm, disconnected → rearm, fresh contradiction → bounce, evidence-shows-target → confirm, mismatched-POST contradiction counts as fresh evidence, `postConfirmsSwitch` with absent/matching/mismatching `activeWindow` <!-- R4 -->
- [x] T005 [P] Add the per-server receipt tick to `app/frontend/src/contexts/session-context.tsx`: bump a `receiptTicksRef` map in the `onEvent` kind-`server` branch and the `onAck` server-snapshot branch; expose a stable `getServerReceiptTick(server)` on the context (plus the `StandaloneSessionContextProvider` no-op default); unit test in `session-context.test.tsx` <!-- R5 -->

### Phase 3: Integration & Edge Cases

- [x] T006 Wire confirm-on-200 in `app/frontend/src/app.tsx` `beginPendingSwitch`: record `tickAtClick` (via `getServerReceiptTick`) and a `postContradiction` flag on the tracked entry; chain `.then(resp)` off `opts.posted` that — guarded by `pendingSwitchRef.current === tracked` AND `isSamePendingTarget(pendingClickRef.current, target.server, target.windowId)` — cancels the tracked bounce timer when `postConfirmsSwitch(resp, target.windowId)`, else sets `postContradiction` (mismatched 200); rejection path unchanged <!-- R3 -->
- [x] T007 <!-- rework: explicit POST-rejection path routes through the verdict and gets "rearm" (no post-click evidence yet at rejection time), silencing the SF8 immediate bounce — a rejection must count as fresh post-click evidence (or bypass the verdict) so the bounce fires immediately; fix the stale app.tsx:1665-1668 comment too --> Freshness-gate `bouncePendingSwitch` in `app/frontend/src/app.tsx`: after the existing H1/route guards, resolve `resolvePendingSwitchVerdict` with the live facts (`isConnected` from context, `getServerReceiptTick(target.server)` vs the tracked `tickAtClick`, tracked `postContradiction`, `activeWindowRef`); `"confirm"` → existing silent-clear rescue, `"bounce"` → today's bounce body, `"rearm"` → `setTimeout(() => bouncePendingSwitch(target), CONFIRMATION_WINDOW_MS)` replacing the tracked timer (no toast, no navigation); ensure the re-armed timer is cancelled by every existing clear path (`clearPendingSwitchTracking` reads the tracked entry's current timer) <!-- R4 -->

### Phase 4: Polish

- [x] T008 <!-- rework: re-run after the T007 rejection-path fix and the new tests --> Run the verification gates scoped to the change: `cd app/backend && go test ./api/... ./internal/tmux/...`, `cd app/frontend && npx tsc --noEmit`, and the affected Vitest suites (`window-transition`, `session-context`, `client` if covered); fix fallout <!-- R3 -->

## Execution Order

- T001 blocks T002 (interface method must exist)
- T003, T004, T005 are independent [P] after T001/T002 land conceptually (T003 has no dependency on backend landing — the field is optional)
- T006 depends on T003 + T004 + T005; T007 depends on T004 + T005 + T006 (shares the tracked-entry shape)
- T008 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `POST /api/windows/{id}/select` returns `{ok:true, activeWindow:"@N"}` with the post-select active window; the Go handler test asserts the body shape and the read-failure fallback to the requested id
- [x] A-002 R2: `selectWindow` returns the parsed `{ok, activeWindow?}` body and every existing caller compiles (`tsc --noEmit` clean)
- [x] A-003 R3: a matching 200 for the current pending switch cancels its bounce timer — no bounce/toast fires even with the state socket dead — while `pendingClickRef` remains set until the SSE `sseConfirmed` clear
- [x] A-004 R4: `bouncePendingSwitch` routes through `resolvePendingSwitchVerdict`; the timer re-arms (no toast, no navigation) when no post-click evidence exists or the socket is disconnected
- [x] A-005 R5: `getServerReceiptTick` increments on both server events and ack snapshots, is ref-backed (no render subscription), and defaults to 0 / no-op in the standalone provider

### Behavioral Correctness

- [x] A-006 R3: a superseded switch's late 200 does not cancel or confirm the newer switch's tracking (still-points-at-itself + `isSamePendingTarget` guards verified by test) — review verdict: the superseded-late-POST no-op IS unit-tested at the plan-designated decision seam (`resolvePendingSwitchPost` with `isCurrent:false` ⇒ `"none"` for both the late-200 and late-rejection SF8 cases, `intentMatches:false` ⇒ `"none"`; `window-transition.test.ts`); the call-site guards (`app.tsx:1662-1663`) are the pre-existing 38kg identity pattern (`pendingSwitchRef.current === tracked`) plus `isSamePendingTarget`, both carrying their own unit tests; the late settlement closure captures the OLD tracked entry, so the newer entry's timer is structurally unreachable from it. An AppShell-mount test of the wiring was explicitly rejected by the plan's Design Decisions (pure-helper seam exists precisely so no AppShell mount is needed)
- [x] A-007 R3: a 200 with a mismatched `activeWindow` does not confirm; it registers as fresh contradiction evidence consumed by the R4 verdict
- [x] A-008 R4: with fresh post-click evidence showing a different active window, the bounce fires exactly as before (navigate + toast) — no regression to the genuine-failure path

### Scenario Coverage

- [x] A-009 R4: the sleep/wake scenario is unit-tested: frozen pre-click snapshot + no post-click tick + timer expiry ⇒ `"rearm"`; reconnect snapshot showing the target ⇒ intent clears via the existing confirmed path
- [x] A-010 R1: GIVEN/WHEN/THEN for the select handler covered by `windows_test.go` (active-window success + fallback)

### Edge Cases & Error Handling

- [x] A-011 R1: a failing post-select `ActiveWindowID` read never fails the request (200 with fallback id; no 5xx)
- [x] A-012 R4: the re-armed timer is cancelled by every existing clear path — SSE confirm, supersession, route-leave/unmount/server-change teardowns (no straggler re-arm loop after the intent clears)

### Code Quality

- [x] A-013 Pattern consistency: new decision logic lives as pure exported helpers in `window-transition.ts` with colocated tests, matching the module's established pattern; backend read uses `exec.CommandContext` via the existing tmux runner with timeout (Constitution I / Process Execution)
- [x] A-014 No unnecessary duplication: reuses `isSamePendingTarget`, the tracked-object identity pattern, `clearPendingSwitchTracking`, and the existing `tmuxExecServer` runner — no parallel state machines introduced
- [x] A-015 No client polling: no `setInterval`+fetch or GET-based verdict path added (code-quality anti-pattern)
- [x] A-016 Gate/mask invariants preserved: existing `window-transition.test.ts` suites pass unchanged (first-write gate, grace mask, supersession, `inFlightNotifyEpoch`)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality (confirm-on-200, freshness-gated verdict, receipt tick) without making existing code redundant; the old `map[string]bool{"ok": true}` select response was replaced in place, not left behind.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Intake Unresolved #9 resolved as extend-until-evidence with no GET re-verify (see Design Decisions) | Client-polling anti-pattern rules out the fetch path; fix 1 covers the common case; failure asymmetry favors extension; easily revisited (one helper branch) | S:55 R:85 A:75 D:60 |
| 2 | Confident | Backend fallback on a failed post-select read reports the requested windowId rather than omitting the field or erroring | The select itself succeeded, so "tmux executed select-window on @N" is true; omitting would weaken the frontend confirm for a transient read blip; a 5xx would fail a switch that succeeded | S:60 R:85 A:80 D:70 |
| 3 | Confident | Freshness signal is a monotonic per-server tick in a ref (not timestamps, not React state) bumped on server events + ack snapshots | Tick comparison is clock-skew-free and render-free; the bounce callback reads imperatively; matches the codebase's ref-for-imperative-reads pattern (`activeWindowRef` et al.) | S:65 R:80 A:80 D:65 |
| 4 | Confident | `postConfirmsSwitch` treats an absent `activeWindow` field as confirming (older daemon compat) | The 200 alone already proves tmux executed the select (the handler runs it synchronously); the field only adds contradiction detection | S:60 R:80 A:75 D:70 |
| 5 | Certain | Mask/gate machinery untouched; confirmation-on-200 touches only the bounce timer | Intake constraint + the two documented invariants (intent = writeback suppression; slide = confirmed content) force this shape | S:85 R:80 A:90 D:85 |

5 assumptions (1 certain, 4 confident, 0 tentative).
