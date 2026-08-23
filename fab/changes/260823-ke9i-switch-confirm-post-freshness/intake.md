# Intake: Window-Switch Confirmation Survives Sleep/Wake

**Change**: 260823-ke9i-switch-confirm-post-freshness
**Created**: 2026-08-23

## Origin

> Window-switch confirmation must survive sleep/wake — trust the selectWindow POST and freshness-gate the failure bounce. After laptop sleep→wake, the user switches tab A→B and types; ~5s later run-kit bounces the URL back to tab A with the toast "Tab switch didn't confirm — back to the active tab", even though tmux really switched (the typed text is sitting in window B).

Promptless dispatch from `/fab-proceed`. The bug was observed live and root-caused in the dispatching conversation; the user chose **fixes 1 and 2** from a four-option analysis (fix 3 — faster wake probe — and fix 4 — skip relay select-on-open on reconnect re-opens — were explicitly ruled OUT of scope). Both chosen fixes ship in this single change. All root-cause claims below were verified against the code in that session (file/line anchors re-verified at intake time).

## Why

**The pain point.** A window switch performed shortly after laptop wake is *rejected by the UI even though it succeeded in tmux*. The user switches A→B, starts typing into B, and ~5 seconds later the app yanks the URL back to A with an error toast ("Window switch didn't confirm — back to the active window", `app/frontend/src/app.tsx`). Worse than the false alarm: the bounce navigation re-opens the terminal relay stream for A, and the relay runs `select-window` on every stream open (`app/backend/api/terminals_ws.go:445` — `SelectWindowInSession`), so the client's stale belief is **written back into tmux** and the system genuinely settles on A. The user's typed text is stranded in B.

**Root cause (verified).** Confirmation of a window switch rides ONLY the `/ws/state` observation socket (the SSE-derived snapshot reporting the target window `isActiveWindow`). After sleep, both WebSockets are half-open dead; the hub's `%session-window-changed` broadcast for the switch is lost in the dead socket. Client-side recovery — the wake-probe 3s deadline in `state-socket.ts` `handleWake`, plus 1s reconnect backoff, handshake, resubscribe, and the server-side FetchSessions snapshot derivation — routinely exceeds `CONFIRMATION_WINDOW_MS` (5000ms, `app/frontend/src/app.tsx:598`). The bounce timer callback `bouncePendingSwitch` (`app.tsx:1484`) then renders its failure verdict from `activeWindowRef` — the **frozen pre-sleep snapshot** still reporting A active — and navigates back to A with the error toast.

Meanwhile `POST /api/windows/{id}/select` (`handleWindowSelect`, `app/backend/api/windows.go:197`) had ALREADY returned `200 {ok:true}` — a synchronous proof that tmux executed `select-window` — but the frontend discards that proof as confirmation evidence: the resolved POST only opens the byte-lift filters (`openForNotify`/`openForLift` in `app/frontend/src/lib/window-transition.ts`). Note the existing precedent: window-transition.ts already treats POST resolution as "proof tmux switched" for the mask/gate machinery (the `inFlightNotifyEpoch` counting) — the bounce logic refuses the same evidence.

**If we don't fix it.** Every post-wake switch inside the recovery window is a coin-flip: false failure toast, URL yank, and a stale-belief writeback that actively undoes the user's switch in tmux. This is the worst kind of failure — the system contradicts an action that succeeded, and then makes its own wrong belief true.

**Why this approach.** Two independent defects compose here: (a) the frontend ignores the strongest confirmation evidence it has (the POST 200), and (b) the bounce declares failure from evidence older than the click. Fixing (a) makes the common case confirm instantly and socket-independently; fixing (b) makes the backstop honest — it can only bounce on evidence that post-dates the click. The rejected alternatives (speeding the wake probe, skipping the relay's select-on-open) treat symptoms: they shrink the race window or blunt the writeback damage but leave the verdict logic trusting stale evidence.

## What Changes

### 1. Backend: `handleWindowSelect` returns the post-select active window

`handleWindowSelect` (`app/backend/api/windows.go:197`) currently ends with `writeJSON(w, http.StatusOK, map[string]bool{"ok": true})`. It will return the post-select active window id in the 200 body:

```json
{ "ok": true, "activeWindow": "@N" }
```

- Stays a POST per Constitution IX — this is a **response-body extension**, no new endpoint, no verb change.
- The value is derived from tmux at response time (Constitution II) — after the `select-window` executes, report which window is now active in the resolved session/server.
- Go handler test (`app/backend/api/windows_test.go`) covers the new body shape.

### 2. Frontend: trust the POST — confirm on 200

- `selectWindow` (`app/frontend/src/api/client.ts:477`) surfaces the response body to callers (today the callers only await resolution/rejection).
- In `app.tsx`: when the POST for the **current pending switch** resolves successfully with the target window active, treat it as confirmation — clear `pendingClickRef`, cancel the 5s bounce timer (`clearPendingSwitchTracking`), and call the existing `confirmSwitchArrived()` (the same out-of-band-confirm primitive the SSE path uses, so the gate settles `"first-write"` and the earned slide/mask semantics are preserved).
- SSE remains the authority for **external** switches — the URL writeback effect is unchanged. The bounce then fires only on explicit POST rejection or a genuinely fresh contradiction.
- **Identity rules are load-bearing.** Confirmation-on-200 must respect the pending-switch identity machinery already in place:
  - Match on `{server, windowId}` via `isSamePendingTarget` — tmux `@N` ids are unique only per server, and cross-server `@N` collisions are the documented false-positive hazard.
  - A **superseded** switch's late POST resolution must not confirm a newer pending switch — mirror the existing epoch/tracked-object identity guards (`pendingSwitchRef.current === tracked` still-points-at-itself pattern in `beginPendingSwitch`; `inFlightNotifyEpoch` in window-transition.ts).
- A 200 whose `activeWindow` is NOT the pending target is fresh, post-click evidence of a contradiction (an external switch won the race) — it does not confirm; the existing resolution paths handle it (see Assumptions #4).

### 3. Frontend: freshness-gate the bounce verdict

- Track **receive-freshness** for session state: e.g. a per-server last-received timestamp/monotonic tick for snapshots + events in the session-context seam fed by `state-socket.ts` — or an equivalent "evidence is newer than the click" discriminator.
- `bouncePendingSwitch` (`app.tsx:1484`) must never declare failure from evidence **older than the click**:
  - On timer expiry, bounce only when **post-click** evidence shows a DIFFERENT window active.
  - When there is no fresh evidence (socket disconnected, or no snapshot received since the click), do **not** bounce — extend/re-arm the confirmation window and/or re-verify with a one-shot GET of sessions (exact policy: see Open Questions / Assumptions #9).
  - Hold while the state socket reports disconnected — `isConnected` already flows from `onConnectionChange`.

### Constraints / invariants to preserve

- Do NOT regress the gate/mask machinery in `window-transition.ts`: first-write gate, grace mask, `inFlightNotifyEpoch`, supersession semantics — and its existing unit tests.
- Preserve `PendingSwitchTarget` server-scoped identity, the `isRedundantSwitch` early-out, dialog suppression (`dialogOpenRef`), and the route-leave/unmount/server-change teardowns.
- Relay select-on-open (`terminals_ws.go:445`) and wake-probe timing (`state-socket.ts` / `relay-mux.ts`) are untouched in this change (fixes 3 and 4 rejected).
- Constitution: POST-only mutations (IX); state derived from tmux at request time (II).
- Code-quality: new behavior MUST be covered by tests — Go handler test for the response body; frontend unit tests for confirm-on-200 (including the superseded-late-POST non-confirm case) and the freshness-gated bounce (including the sleep/wake stale-snapshot scenario: frozen pre-click snapshot + disconnected socket ⇒ no bounce).

## Affected Memory

- `run-kit/ui/terminal`: (modify) § Window-Switch Slide Transition → Confirmation-gated motion / failure bounce-back — POST 200 becomes a confirmation source alongside SSE; the bounce verdict is freshness-gated (never fires on pre-click evidence; holds while disconnected).
- `run-kit/ui/routes-and-shell`: (modify) § Sidebar clicks navigate optimistically AND mutate — "SSE confirm is the PRIMARY, event-driven clear" contract gains the POST-200 confirmation path; pending-click suppression clear rules updated.
- `run-kit/architecture`: (modify) REST API surface — `POST /api/windows/{id}/select` response body extended with `activeWindow`; session-state receive-freshness seam noted if it lands in the state-socket/session-context contract.

## Impact

- **Backend**: `app/backend/api/windows.go` (`handleWindowSelect` response body), `app/backend/api/windows_test.go`. Possibly a small `internal/tmux` read to report the active window post-select if not already available from the resolution the handler performs.
- **Frontend**: `app/frontend/src/api/client.ts` (`selectWindow` return type), `app/frontend/src/app.tsx` (confirm-on-200 wiring in `runSwitch`/`beginPendingSwitch` POST handling; freshness-gated `bouncePendingSwitch`), `app/frontend/src/lib/window-transition.ts` (likely consumption only — `confirmSwitchArrived` already exists), `app/frontend/src/contexts/session-context.tsx` and/or `app/frontend/src/lib/state-socket.ts` (per-server receive-freshness signal), matching unit tests.
- **Behavior contract change**: the failure bounce becomes strictly evidence-based; a dead-socket window switch that succeeded no longer produces a false bounce + toast + tmux writeback.
- **Risk surface**: the pending-switch state machine is dense with documented invariants (supersession, cross-server identity, gate settle reasons); the change threads new confirmation evidence through existing primitives rather than adding parallel state.

## Open Questions

- No-fresh-evidence policy when the socket is CONNECTED but no snapshot has arrived since the click: is the re-armed confirmation window bounded (e.g., one re-arm then bounce anyway) or does it extend until fresh evidence arrives? And is the one-shot GET-of-sessions re-verify included in this change, or does the re-arm + next SSE snapshot suffice (the client-polling anti-pattern makes a fetch-based verdict path worth deliberate scoping)?

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fixes 1 (trust the POST) and 2 (freshness-gate the bounce) ship together in this single change; fix 3 (faster wake probe) and fix 4 (skip relay select-on-open on reconnect) are out of scope | Discussed — user explicitly chose fixes 1+2 from a four-option analysis and ruled 3+4 out | S:95 R:85 A:90 D:95 |
| 2 | Certain | Confirm-on-200 reuses the existing primitives: `confirmSwitchArrived()` for the confirm, `isSamePendingTarget` for `{server, windowId}` identity, tracked-object/epoch guards for supersession | Discussed — description names the exact primitives; window-transition.ts precedent already treats POST resolution as proof tmux switched | S:90 R:80 A:90 D:90 |
| 3 | Certain | Backend change is a response-body extension on the existing POST (`{ok:true, activeWindow:"@N"}`) — no new endpoint, no verb change | Discussed + Constitution IX (POST-only) and II (derive from tmux at request time) | S:90 R:85 A:95 D:90 |
| 4 | Confident | A 200 whose `activeWindow` differs from the pending target does NOT confirm — it is fresh post-click evidence of an external switch winning the race; clear/resolve via the existing contradiction paths rather than an error-toast bounce against tmux truth | Derived — description's "bounce only on explicit rejection or a genuinely fresh contradiction" + documented invariant "the confirmation timer does not contest a genuine external switch" | S:60 R:75 A:75 D:65 |
| 5 | Confident | Freshness signal lands as a per-server monotonic receive tick/timestamp (snapshots + events both count) in the session-context seam fed by state-socket.ts | Discussed with latitude — description proposes this shape but allows "an equivalent evidence-is-newer-than-the-click discriminator" | S:65 R:80 A:75 D:60 |
| 6 | Confident | While the state socket reports disconnected, a pending switch holds — no bounce; the confirmation window re-arms | Discussed — "hold while the state socket reports disconnected (`isConnected` already flows from `onConnectionChange`)" | S:80 R:75 A:80 D:75 |
| 7 | Confident | Toast copy and bounce navigation mechanics are unchanged; only the verdict's evidence rules change | No signal requesting copy changes; smallest-diff reading of the agreed fixes | S:70 R:90 A:80 D:75 |
| 8 | Confident | Test scope: Go handler test for the response body; frontend unit tests for confirm-on-200, superseded-late-POST non-confirm, and the freshness-gated bounce (sleep/wake stale-snapshot scenario). No new Playwright e2e — sleep/wake socket death isn't reproducible in the e2e rig; the seams are unit-testable | Discussed test list verbatim; code-quality's "e2e where possible" read against the non-simulable trigger | S:70 R:85 A:75 D:70 |
| 9 | Unresolved | No-fresh-evidence re-arm policy while CONNECTED: bounded re-arm (eventually bounce) vs extend-until-evidence, and whether the one-shot GET-of-sessions re-verify ships in this change | Deferred — promptless dispatch. Description says "extend/re-arm ... and/or re-verify with a one-shot GET"; the and/or leaves a UX-visible fork (never-bounce vs eventually-bounce) and a scope call on the fetch path | S:45 R:70 A:35 D:30 |

9 assumptions (3 certain, 5 confident, 0 tentative, 1 unresolved).
