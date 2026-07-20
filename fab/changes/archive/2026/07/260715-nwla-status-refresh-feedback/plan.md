# Plan: Status Refresh Feedback

**Change**: 260715-nwla-status-refresh-feedback
**Intake**: `intake.md`

## Requirements

### Backend: Server-Global Completion Event

#### R1: Broadcast `status-refresh` on refresh completion
The backend SHALL broadcast a server-global SSE `event: status-refresh` when the detached refresh pass completes, following the established `server-order`/`board-order`/`update-available` broadcast pattern in `app/backend/api/sse.go`. The event SHALL fan out to EVERY connected client across every server key, including `?metrics=1` metrics-only streams. The event is broadcast-only — NO replay-on-connect cached slot.

- **GIVEN** a client connected to the SSE stream
- **WHEN** the detached goroutine started by `POST /api/status/refresh` finishes both poller passes (i.e. `finishStatusRefresh()` runs)
- **THEN** every connected client receives `event: status-refresh\ndata: {"completedAt":"<RFC3339 UTC>"}\n\n`
- **AND** a client connecting AFTER completion receives no replayed `status-refresh` event (no cached slot)

#### R2: Completion event is emitted only when a pass actually ran
A `status-refresh` event SHALL be broadcast exactly once per completed refresh pass — i.e. only when `startStatusRefresh()` returned true and the detached goroutine ran to `finishStatusRefresh()`. Coalesced and throttled POSTs (which start no goroutine) SHALL NOT cause an extra broadcast.

- **GIVEN** a refresh is already in flight (or within the min-interval throttle)
- **WHEN** a second POST arrives and is coalesced/throttled
- **THEN** no additional `status-refresh` broadcast is emitted for that POST (the in-flight pass's single completion event is the only one)

### Backend: Tri-State 202 Body

#### R3: `POST /api/status/refresh` returns a tri-state status body
`startStatusRefresh()` SHALL return the started/coalesced/throttled distinction it already computes internally (in-flight → coalesced; min-interval → throttled; else started) instead of collapsing to a bool. `handleStatusRefresh` SHALL map that distinction onto the 202 body: `{"status":"started"}`, `{"status":"coalesced"}`, or `{"status":"throttled"}`. All responses remain `202 Accepted`; still fire-and-forget; no new endpoint (Constitution §IX — body change on the existing POST).

- **GIVEN** no refresh in flight and past the min-interval
- **WHEN** a POST arrives
- **THEN** the response is `202 {"status":"started"}` and a detached pass begins
- **GIVEN** a refresh already in flight
- **WHEN** a POST arrives
- **THEN** the response is `202 {"status":"coalesced"}` and no new pass begins
- **GIVEN** a POST within `statusRefreshMinInterval` of the last refresh start
- **WHEN** a POST arrives
- **THEN** the response is `202 {"status":"throttled"}` and no pass begins (no completion event will follow)

### Backend: FetchedAt Plumbing

#### R4: `PrFetchedAt` on the window payload
The `Window` struct (`app/backend/internal/tmux/tmux.go`) SHALL carry a new `PrFetchedAt *time.Time` field serialized as `prFetchedAt,omitempty`, alongside the sibling `PrChecks`/`PrReview`/`PrIsDraft` collector-join fields. The SSE hub's collector join (`attachPRStatus`, `app/backend/api/sse.go`) SHALL set it from `PRStatus.FetchedAt` on a URL-keyed snapshot hit, and reset it to `nil` on a miss alongside the other collector-only fields, so a URL-miss window carries no stale timestamp.

- **GIVEN** a window whose `PrURL` matches a collector snapshot entry
- **WHEN** `attachPRStatus` runs
- **THEN** the window's `PrFetchedAt` is set to that entry's `FetchedAt`
- **GIVEN** a window whose `PrURL` misses the snapshot (or is empty/nil)
- **WHEN** `attachPRStatus` runs
- **THEN** the window's `PrFetchedAt` is reset to `nil` (no stale value)

### Frontend: Button Feedback State Machine

#### R5: Button spins from click until the completion event, not the POST
The PANE-header refresh button (`PaneRefreshButton`, `app/frontend/src/components/sidebar/status-panel.tsx`) SHALL spin from click until a server-global `status-refresh` event arrives (routed through the session-context SSE consumer), NOT until the POST settles. A UI timeout fallback of 15s SHALL clear the spinner if no event arrives (the backend pass is bounded by `statusRefreshTimeout` = 60s; a shorter practical fallback is acceptable per intake assumption 8).

- **GIVEN** the button is clicked and the POST returns `{"status":"started"}`
- **WHEN** the click completes but no completion event has arrived
- **THEN** the button shows a spinning state (`animate-spin`)
- **WHEN** a `status-refresh` event arrives
- **THEN** the spinner clears
- **WHEN** neither an event nor the fallback timeout has fired
- **THEN** the button stays spinning; after 15s with no event the fallback clears it

#### R6: Per-status behavior (started/coalesced/throttled)
The button SHALL branch on the tri-state 202 body: `started` and `coalesced` both spin-until-event (the in-flight pass's completion event clears them — no distinct coalesced visual); `throttled` SHALL NOT spin (no event will come) and instead show a brief "already fresh" checkmark flash.

- **GIVEN** a POST returns `{"status":"coalesced"}`
- **WHEN** the response settles
- **THEN** the button spins until the in-flight refresh's completion event arrives
- **GIVEN** a POST returns `{"status":"throttled"}`
- **WHEN** the response settles
- **THEN** the button shows a brief checkmark flash (no spin, no waiting for an event)

#### R7: Post-completion checkmark
After the SSE event (or fallback) clears the spinner for a started/coalesced click, the button SHALL show a brief checkmark ("done — you're current") before returning to idle. This closes the "refresh completed ≠ anything changed" loop honestly, without toasts or dot-flashing.

- **GIVEN** the button was spinning after a started/coalesced click
- **WHEN** the completion event arrives and clears the spinner
- **THEN** the button shows a brief checkmark, then returns to the idle refresh icon

### Frontend: Types + Client + SSE Routing

#### R8: `prFetchedAt` on `WindowInfo`; `refreshStatus()` returns the tri-state
`WindowInfo` (`app/frontend/src/types.ts`) SHALL gain an optional `prFetchedAt?: string` field (ISO timestamp, mirroring the backend `omitempty`). `refreshStatus()` (`app/frontend/src/api/client.ts`) SHALL return the parsed tri-state status so callers can branch on `started`/`coalesced`/`throttled`.

- **GIVEN** a `202 {"status":"throttled"}` response
- **WHEN** `refreshStatus()` resolves
- **THEN** the resolved value carries `status: "throttled"`

#### R9: Route `status-refresh` through the SSE consumer to button subscribers
`session-context.tsx` SHALL listen for the server-global `status-refresh` event on BOTH SSE streams (the per-server pool streams AND the dedicated `?metrics=1` stream, since the event is host-global), exposing a `subscribeStatusRefresh(handler)` subscription mirroring `subscribeBoardOrder`. The button subscribes to it to clear its spinner.

- **GIVEN** the daemon broadcasts `status-refresh`
- **WHEN** the event arrives on either SSE stream
- **THEN** every registered `subscribeStatusRefresh` handler fires

### Frontend: Freshness Line

#### R10: "checked Xs ago" in the StatusDotTip hover card
`StatusDotTip` (`app/frontend/src/components/status-dot-tip.tsx`) SHALL render a relative "checked Xs ago" line on windows that carry a `prFetchedAt`, computed via the existing `formatDuration` (`app/frontend/src/lib/format.ts`) from `(Date.now() - parse(prFetchedAt)) / 1000`. The line SHALL be omitted when `prFetchedAt` is absent. After a manual refresh the timestamp visibly resets.

- **GIVEN** a window with a `prFetchedAt` 30 seconds in the past
- **WHEN** the hover card opens
- **THEN** it shows a "checked 30s ago" line
- **GIVEN** a window with no `prFetchedAt`
- **WHEN** the hover card opens
- **THEN** no "checked ... ago" line is rendered

### Non-Goals

- No minimum-spin-duration hack (rejected as dishonest — intake assumption 5).
- No toasts or StatusDot flash-on-change (rejected as invasive — the checkmark suffices).
- No dedicated palette-action feedback beyond the button's shared state (intake assumption 9 — the palette action fires the same POST; the button is the primary surface).
- No new endpoint or HTTP verb (Constitution §IX — additive body + SSE event only).
- No replay-on-connect cached slot for `status-refresh` (broadcast-only — intake assumption 7).

### Design Decisions

1. **Completion broadcast lives in `finishStatusRefresh()`**: broadcast the event from the existing completion seam (called at the end of the detached goroutine) — *Why*: it is the single point that runs exactly once per completed pass, so R2's once-per-pass guarantee is structural. *Rejected*: broadcasting from the handler (would fire for coalesced/throttled too) or from each poller (would double-fire).
2. **Hub reached via `s.sseHub` with a nil-guard**: `finishStatusRefresh()` calls `s.sseHub.broadcastStatusRefresh()` guarded by `if s.sseHub != nil` — *Why*: the hub is lazy-initialized on first SSE connection (and absent in the direct-`&Server{}` handler tests), so an unconditional call would nil-panic. *Rejected*: forcing `initSSEHub()` at refresh time (couples refresh to hub lifecycle; the tests build no hub).
3. **`subscribeStatusRefresh` mirrors `subscribeBoardOrder`**: a `Set`-of-handlers ref + a `fireStatusRefresh` invoked from both ES blocks + a context method — *Why*: it is the established host-global-event fan-out pattern in this file; a state field would force consumers to diff a monotonically-changing value. *Rejected*: exposing a bare event-count integer (leakier, no cleanup story).
4. **Button state is a discriminated `"idle" | "spinning" | "check"`**: single state variable driving icon/spin/checkmark — *Why*: the three visuals are mutually exclusive; type-narrowing over booleans (code-quality: discriminated unions over `as`). Fallback + checkmark timers are cleared on unmount and on state transitions.

## Tasks

### Phase 1: Backend

- [x] T001 Add `broadcastStatusRefresh(completedAt time.Time)` to `app/backend/api/sse.go` following the `broadcastServerOrder`/`broadcastUpdateAvailable` pattern (marshal `{"completedAt":"<RFC3339 UTC>"}`, `event: status-refresh`, fan out to all clients under `h.mu`, drop-on-full with the `dropped` warn). Broadcast-only — do NOT add a cached slot or an `addClient` replay case. <!-- R1 -->
- [x] T002 Change `startStatusRefresh()` in `app/backend/api/status_refresh.go` to return a tri-state (a small named type/const, e.g. `refreshOutcome` = `refreshStarted`/`refreshCoalesced`/`refreshThrottled`) instead of `bool`: in-flight → coalesced, within-min-interval → throttled, else started (mark in-flight + stamp start time only on started). <!-- R3 -->
- [x] T003 Update `handleStatusRefresh` in `app/backend/api/status_refresh.go` to branch on the tri-state: on `started` launch the detached goroutine (unchanged), and write the matching `202 {"status":"started"|"coalesced"|"throttled"}` body. <!-- R3 -->
- [x] T004 In `finishStatusRefresh()` (`app/backend/api/status_refresh.go`), after clearing the in-flight flag, call `s.sseHub.broadcastStatusRefresh(s.now())` guarded by `if s.sseHub != nil` (hub is lazy/absent in handler tests). Use the server clock seam `s.now()` so the completedAt timestamp is test-controllable. <!-- R1 R2 -->
- [x] T005 Add `PrFetchedAt *time.Time \`json:"prFetchedAt,omitempty"\`` to the `Window` struct in `app/backend/internal/tmux/tmux.go`, adjacent to `PrIsDraft`. <!-- R4 -->
- [x] T006 In `attachPRStatus` (`app/backend/api/sse.go`), reset `w.PrFetchedAt = nil` in the same reset line as `PrChecks`/`PrReview`/`PrIsDraft`, and on a snapshot hit set `w.PrFetchedAt = &st.FetchedAt` (take the address of a copy, not the loop var). <!-- R4 -->

### Phase 2: Backend Tests

- [x] T007 [P] Extend `app/backend/api/status_refresh_test.go`: assert the tri-state body (`started` on first POST, `coalesced` while in flight, `throttled` within min-interval) using the existing recorder/clock seams; assert the existing coalesce/throttle kick-count behavior is unchanged. <!-- R3 -->
- [x] T008 Add a broadcast-on-completion test: wire a real `sseHub` (or the minimal hub the other sse tests use) with a subscribed client, POST, wait for the detached pass, and assert exactly one `event: status-refresh` frame is delivered; assert a coalesced/throttled POST adds no extra frame. <!-- R1 R2 -->
- [x] T009 [P] Extend the sse.go collector-join tests (the `attachPRStatus` test surface) for `PrFetchedAt`: a URL hit sets it to the snapshot's `FetchedAt`; a URL miss (and empty/nil URL) resets it to `nil`. <!-- R4 -->

### Phase 3: Frontend Types + Client + SSE Routing

- [x] T010 Add `prFetchedAt?: string` to `WindowInfo` in `app/frontend/src/types.ts` (documented as the ISO fetch timestamp from the collector join). <!-- R8 -->
- [x] T011 Change `refreshStatus()` in `app/frontend/src/api/client.ts` to parse and return the tri-state: `Promise<{ status: "started" | "coalesced" | "throttled" }>` (tolerate an unknown/missing status by defaulting to `"started"` so an older daemon's `{"status":"refreshing"}` still spins-until-event). <!-- R8 -->
- [x] T012 In `app/frontend/src/contexts/session-context.tsx`: add a `statusRefreshSubscribersRef` + `subscribeStatusRefresh` + `fireStatusRefresh` mirroring `subscribeBoardOrder`/`fireBoardOrder`; add `subscribeStatusRefresh` to the context type, the memoized value + its deps, and the default-fallback block (`(() => () => {})`); add an `es.addEventListener("status-refresh", () => fireStatusRefresh())` in BOTH the per-server pool ES block and the `?metrics=1` metrics-stream ES block (with `fireStatusRefresh` in both effects' dep arrays). <!-- R9 -->

### Phase 4: Frontend Button State Machine

- [x] T013 Rewrite `PaneRefreshButton` in `app/frontend/src/components/sidebar/status-panel.tsx` as a `"idle" | "spinning" | "check"` state machine: on click (when not spinning) POST via `refreshStatus()`; on `throttled` → brief `check` flash (no spin); on `started`/`coalesced` → `spinning` with a 15s fallback timer; subscribe via `useSessionContext().subscribeStatusRefresh` to transition `spinning`→`check`; the `check` state auto-reverts to `idle` after a brief timeout. Render `animate-spin` in `spinning`, a checkmark glyph/SVG in `check`, the rotate-cw icon in `idle`. Clear all timers and unsubscribe on unmount. Keep `rk-glint`, testid `pane-refresh`, aria/title. <!-- R5 R6 R7 -->
- [x] T014 Add the "checked Xs ago" line to `StatusDotTip` (`app/frontend/src/components/status-dot-tip.tsx`): extend `dotTipContent` (or add a small derived value) to compute `checked` via `formatDuration((Date.now() - Date.parse(win.prFetchedAt)) / 1000)` when `win.prFetchedAt` is a valid timestamp, render it as a secondary line (styled like the agent line) with a `data-testid`, and omit it when absent/unparseable. Use a live clock (`useNow`) so the relative time ticks while the card is open. <!-- R10 -->

### Phase 5: Frontend Tests

- [x] T015 [P] Extend `app/frontend/src/api/client.test.ts`: `refreshStatus()` returns `{status:"throttled"}` / `"coalesced"` / `"started"` for the respective 202 bodies, and defaults to `"started"` for a legacy `{"status":"refreshing"}` body. <!-- R8 -->
- [x] T016 Add button-state-machine tests to `app/frontend/src/components/sidebar/status-panel.test.tsx`: (a) started → spins (has `animate-spin`) and does NOT clear on POST settle; (b) a fired `status-refresh` subscription clears the spinner and shows the checkmark; (c) throttled → checkmark flash without ever spinning; (d) fallback timer clears the spinner if no event arrives. Drive the subscription via a `useSessionContext` mock/provider and fake timers. <!-- R5 R6 R7 -->
- [x] T017 [P] Add `app/frontend/src/components/status-dot-tip.test.tsx`: the "checked Xs ago" line renders when `prFetchedAt` is present (assert the formatted relative time) and is omitted when absent. <!-- R10 -->

## Execution Order

- Phase 1 (T001–T006) before Phase 2 tests (T007–T009).
- T001 (broadcast fn) blocks T004 (call site) and T008 (broadcast test).
- T002 blocks T003 (handler consumes the tri-state) and both block T007.
- T005 blocks T006, which blocks T009.
- Phase 3 (T010–T012) before Phase 4 (T013 consumes `subscribeStatusRefresh` + `refreshStatus` return; T014 consumes `prFetchedAt`).
- T011 blocks T013 and T015; T012 blocks T013 and T016; T010 blocks T014 and T017.

## Acceptance

### Functional Completeness

- [x] A-001 R1: A server-global `event: status-refresh` with `{"completedAt":"<RFC3339>"}` is broadcast from `finishStatusRefresh()` to all clients (incl. `?metrics=1`); no cached slot / no replay-on-connect.
- [x] A-002 R3: `POST /api/status/refresh` returns `202 {"status":"started"|"coalesced"|"throttled"}` reflecting the internally-computed distinction; still 202, still fire-and-forget, no new endpoint.
- [x] A-003 R4: `Window.PrFetchedAt *time.Time` (`prFetchedAt,omitempty`) is set from `PRStatus.FetchedAt` on a collector-join hit and reset to `nil` on a miss.
- [x] A-004 R5: The button spins from click until the `status-refresh` event (not the POST settle), with a 15s fallback.
- [x] A-005 R6: `started`/`coalesced` spin-until-event; `throttled` shows a checkmark flash without spinning.
- [x] A-006 R7: A post-completion checkmark shows briefly after the spinner clears for a started/coalesced click.
- [x] A-007 R8: `WindowInfo.prFetchedAt?: string` exists and `refreshStatus()` returns the parsed tri-state status.
- [x] A-008 R9: `session-context.tsx` routes `status-refresh` from both SSE streams to `subscribeStatusRefresh` handlers.
- [x] A-009 R10: `StatusDotTip` renders "checked Xs ago" via `formatDuration` when `prFetchedAt` is present and omits it when absent.

### Behavioral Correctness

- [x] A-010 R2: Coalesced and throttled POSTs cause no extra completion broadcast — exactly one event per completed pass.
- [x] A-011 R6: There is no distinct "coalesced" visual — coalesced is behaviorally indistinguishable from started (both spin).
- [x] A-012 R5: The pre-existing spinner-on-POST behavior is replaced (the button no longer clears on POST settle).

### Scenario Coverage

- [x] A-013 R3: Backend tests assert started vs coalesced vs throttled bodies via the existing recorder/clock seams.
- [x] A-014 R1: A backend test asserts exactly one `status-refresh` frame is delivered on completion (and none for coalesced/throttled).
- [x] A-015 R4: sse.go join tests assert `PrFetchedAt` set-on-hit / reset-on-miss.
- [x] A-016 R8: A client test asserts the tri-state parse (incl. legacy `refreshing` → `started` default).
- [x] A-017 R5/R6/R7: Button tests assert spin-until-subscription, throttled checkmark-without-spin, post-completion checkmark, and fallback clear.
- [x] A-018 R10: A StatusDotTip test asserts the freshness line present/absent branches.

### Edge Cases & Error Handling

- [x] A-019 R1: `broadcastStatusRefresh` is a no-op-safe call when `s.sseHub` is nil (handler tests / pre-first-connection) — guarded, no panic.
- [x] A-020 R4: A URL-miss or empty/nil `PrURL` window carries `PrFetchedAt == nil` (no stale timestamp), reset alongside the sibling fields.
- [x] A-021 R5: The button swallows a `refreshStatus()` rejection (best-effort/fire-and-forget) and does not leave a stuck spinner (fallback still clears).
- [x] A-022 R10: An absent or unparseable `prFetchedAt` renders no freshness line (no "checked NaNs ago").

### Code Quality

- [x] A-023 Pattern consistency: `broadcastStatusRefresh` matches the existing broadcast fns; `subscribeStatusRefresh` matches `subscribeBoardOrder`; the button state uses a discriminated union, not `as` casts.
- [x] A-024 No unnecessary duplication: reuses `formatDuration` (no new relative-time formatter), the existing broadcast/subscribe patterns, and the `s.now()` clock seam.
- [x] A-025 SSE not polling: freshness + completion feedback ride the SSE stream / existing timestamp — no client `setInterval` + fetch (the `useNow` display tick is a local clock, not data polling).
- [x] A-026 No new state store / no new endpoint: completion event is broadcast-from-memory, `FetchedAt` already exists, POST body is additive (Constitution §II, §IX).

### Test Companion Docs

- [x] A-027 N/A: No Playwright `.spec.ts` files are added or modified by this change (unit/Vitest + Go tests only), so no `.spec.md` companion is required.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality (completion broadcast, tri-state body, freshness plumbing) without making existing code redundant. All predecessor code it superseded was rewritten in place (the jykd busy-on-POST button logic, the bool `startStatusRefresh` return, the `{ok: boolean}` client shape); no orphaned symbols, branches, or config remain. (The legacy-body tolerance in `refreshStatus()` — defaulting `{"status":"refreshing"}` to `"started"` — is deliberate back-compat for older daemons, not redundancy; it becomes deletable only once pre-nwla daemons are out of circulation.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | UI spinner timeout fallback = 15s (bottom of the intake's ~15–20s range) | Intake assumption 8 delegated the exact value to apply within 15–20s; 15s is the snappiest honest value well under the 60s backend bound | S:80 R:90 A:85 D:80 |
| 2 | Certain | `refreshStatus()` returns `{status}` tri-state and defaults an unknown/legacy body (`{"status":"refreshing"}`) to `"started"` | Additive + back-compat: an older daemon still returns the opaque body; defaulting to started (spin-until-event) is the safe superset behavior | S:85 R:90 A:90 D:85 |
| 3 | Certain | `status-refresh` routed via a `subscribeStatusRefresh` fan-out mirroring `subscribeBoardOrder`, fired from both SSE streams | The codebase has exactly this host-global-event subscription pattern (board-order); the event is server-global so both streams must carry it | S:90 R:85 A:90 D:90 |
| 4 | Certain | Completion broadcast placed in `finishStatusRefresh()` guarded by `if s.sseHub != nil`, using `s.now()` for `completedAt` | The seam runs once per completed pass (structural R2 guarantee); hub is lazy/absent in handler tests so the nil-guard is required; `s.now()` is the existing clock seam | S:90 R:85 A:90 D:90 |
| 5 | Certain | Button modeled as a `"idle" \| "spinning" \| "check"` discriminated state; `check` auto-reverts after a brief timeout (~1s) | code-quality prefers discriminated unions over booleans; the three visuals are mutually exclusive; 1s matches the existing `COPY_FEEDBACK_MS` feedback cadence in the same file | S:75 R:90 A:85 D:80 |
| 6 | Confident | `PrFetchedAt` set as `&st.FetchedAt` from a per-hit copy of the snapshot value (not the range variable) | `snap[*w.PrURL]` returns a value copy `st` scoped to the loop body, so taking its address is safe; mirrors the sibling-field join semantics | S:70 R:85 A:90 D:80 |
| 7 | Confident | Freshness line uses a live `useNow()` clock so "checked Xs ago" ticks while the card is open | The tip is an ephemeral leaf; `useNow` is the established per-second leaf clock (already used by the PANE panel); avoids a frozen relative time on a long-open card | S:70 R:90 A:85 D:75 |
| 8 | Confident | Palette action (`palette-status-refresh.ts`) is left unchanged — it fires the same POST and gains no dedicated feedback | Intake assumption 9 delegated this to apply with "the button is the primary surface"; the palette builder is a pure POST kick with no shared button state to hook | S:75 R:90 A:85 D:80 |

8 assumptions (5 certain, 3 confident, 0 tentative).
