# Plan: Hidden-Page Terminal Stream Release

**Change**: 260903-xj0w-hidden-page-stream-release
**Intake**: `intake.md`

## Requirements

### Frontend Relay: Hidden-Page Stream Suspension

#### R1: Grace-timer suspension on page hidden
When `document.visibilityState` becomes `hidden`, `RelayMux` (`app/frontend/src/lib/relay-mux.ts`) SHALL start a grace timer of `HIDDEN_RELEASE_GRACE_MS` (named exported constant, 60 000 ms). If the page is still hidden when the timer fires, the mux SHALL suspend every live stream: send the per-stream `close` control op (the server tears down the tmux attach client and PTY) while KEEPING the stream in the mux map with its current `opts`, marked suspended. A `visible` transition before the timer fires SHALL cancel the timer with no other effect.

- **GIVEN** a tab with live `/ws/terminals` streams
- **WHEN** the page goes hidden and stays hidden for `HIDDEN_RELEASE_GRACE_MS`
- **THEN** a `close` op is sent for every live stream and each stream is marked suspended (retained client-side with current `opts`)
- **AND** the server-side tmux attach clients are gone (no hidden client participates in `window-size latest`)

- **GIVEN** a tab that goes hidden
- **WHEN** it becomes visible again before the grace timer fires (quick app-switch)
- **THEN** the timer is cancelled and no stream is closed, suspended, or re-opened

#### R2: Transparent resume on visible
When the page becomes `visible`, the mux SHALL re-open every suspended stream by re-issuing its `open` op with the stream's current `opts` (server, windowId, cols, rows — kept fresh by `resize`/`setWindowId` even while suspended) and clear the suspended mark. Resume rides the existing per-stream machinery: the server's `opened` re-arms the `TerminalClient` deferred reset and the first data frame repaints flicker-free — no `TerminalClient` change. Within the mux's own `visibilitychange` handling, resume SHALL run before the wake-probe logic (`handleWake`), so a dead socket is detected against the resumed (live) stream set and the reconnect re-opens them.

- **GIVEN** a tab with suspended streams
- **WHEN** the page becomes visible
- **THEN** every suspended stream re-issues `open` with its current `opts`, `onOpened` fires on the server's `opened`, and the pane repaints on the first data frame
- **AND** a same-session windowId ride that happened before suspension re-opens the ridden-to window (current `opts.windowId`), not the stale open-time one

#### R3: Suspension survives socket churn; suspended streams are not live
A suspended stream SHALL NOT be re-opened by any path other than the `visible` transition. Specifically: the `ws.onopen` re-open-all loop skips suspended streams; the "live streams" gates (`scheduleReconnect`'s zero-check, `syncHeartbeat`/`heartbeatTick`, `handleWake`'s zero-check) SHALL count only non-suspended streams, so a fully-suspended tab lets a dropped socket stay closed and stops the heartbeat.

- **GIVEN** a hidden tab whose streams are suspended
- **WHEN** the socket drops and reconnects (or drops and stays down)
- **THEN** no suspended stream is re-opened, and with zero live streams the mux does not schedule a reconnect
- **AND** on the later `visible` transition the resume path re-opens the suspended streams (reconnecting the socket if needed)

#### R4: Suspended streams swallow the server's `closed` echo
The server responds to a client `close` op with a `closed` control event (code 1000, `app/backend/api/terminals_ws.go` `closeStream`/`emitClosed`). Today's client never sees it (the stream is deleted before the echo arrives); a suspended stream remains in the map, so the mux SHALL swallow every `closed` control event addressed to a suspended stream — it MUST NOT retire the stream or fire `onClosed` (which would trigger `TerminalClient`'s non-4004 probe re-open, defeating suspension). A genuinely dead window surfaces on resume instead: the re-`open` yields `closed` 4004 and the existing recovery path runs.

- **GIVEN** a stream just suspended (close op sent)
- **WHEN** the server's `closed` (code 1000) echo arrives
- **THEN** the stream stays in the map, suspended, and `onClosed` does not fire

- **GIVEN** a suspended stream whose window is killed while hidden
- **WHEN** the page becomes visible and the resume re-`open` is answered with `closed` 4004
- **THEN** the stream retires and `onClosed(4004)` fires — the existing session-not-found redirect handles it

The swallow MUST also cover the resume race: the echo of a suspension `close` op can arrive AFTER a fast `visible` transition has cleared the suspended mark and re-issued `open` (realistic within one RTT on a high-latency link). A per-stream close-echo-pending mark — set only when the suspension `close` was actually sent on an OPEN socket — SHALL shield exactly one post-resume `closed` 1000 (the echo precedes the re-open's `opened` by wire FIFO); the server's `opened` clears the mark (covers an echo lost to a socket death), and a `closed` 4004 after resume always retires.

- **GIVEN** a stream suspended and quickly resumed, with the server's `closed` 1000 echo still in flight
- **WHEN** the echo arrives after the resume re-issued `open`
- **THEN** it is swallowed (stream stays live; the following `opened` fires normally), and a LATER genuine `closed` 1000 (PTY EOF) retires the stream normally

#### R5: Streams opened while hidden are subject to suspension
A stream opened while the page is hidden (e.g., a route change in a background tab) opens normally, then falls under the same rule: if the grace timer is not already running, opening a live stream while hidden SHALL start it; when it fires (page still hidden) the stream suspends like any other. Closing a suspended stream (`closeStream` — component unmount while hidden) SHALL remove it from the map without sending a `close` op (the server-side stream is already gone).

- **GIVEN** a hidden tab past its grace expiry (all streams suspended)
- **WHEN** a new stream is opened
- **THEN** it opens normally and a fresh grace timer starts; on expiry (still hidden) it suspends

#### R6: Immediate release on `pagehide`/`freeze`
`pagehide` and (where supported) `freeze` SHALL trigger immediate suspension with no grace — a frozen mobile page's timers stop before a 60 s timer can fire, and a bfcached/navigated-away page must not hold attach clients. Resume stays the `visible` transition (`visibilitychange` fires on bfcache restore; the existing `pageshow` wake probe re-validates the socket).

- **GIVEN** a tab with live streams
- **WHEN** `pagehide` (or `freeze`) fires
- **THEN** every live stream suspends immediately (close ops sent, streams retained suspended)

#### R7: Terminal streams only; no backend change
Only `/ws/terminals` streams are released. `/ws/state` SHALL remain untouched (background desktop-shell views keep reporting dock-badge waiting counts). No file under `app/backend/` changes; the existing `open`/`opened`/`close`/`closed`/`resize` ops fully express suspend/resume.

- **GIVEN** a suspended tab
- **WHEN** streams are released
- **THEN** the `/ws/state` socket and its subscriptions are unaffected, and the diff contains no `app/backend/` change

#### R8: Desktop-shell visibility signal verified (spike)
The change SHALL verify whether a detached Electron `WebContentsView` (`app/desktop/src/main.ts` detach seam — `contentView.removeChildView`) drives `visibilitychange`/`document.visibilityState === "hidden"` in the guest page. If it does: no shell change. If it does not (or the spike cannot be executed in this environment): add a minimal, idempotent shell nudge — on view detach/attach, an IPC event the SPA consumes through the `runkitShell` bridge, feeding the same suspend/resume entry points (state-driven, so a redundant signal alongside a native `visibilitychange` is harmless).

- **GIVEN** the desktop shell with a background window's detached host view
- **WHEN** the view is detached
- **THEN** the guest SPA observes hidden (natively or via the nudge) and the grace timer starts; on attach it observes visible and resumes

### Non-Goals

- No sizing-policy mitigation (`window-size largest`/`smallest`/`manual`) — explicitly rejected in the intake.
- No server-side idle detach — the server cannot know page visibility, and the per-stream self-heal would re-attach anyway.
- No change to the IntersectionObserver board-pane suspension (seam 3) — different visibility granularity, same stream verbs; the page-visibility layer is additive above it.
- No Playwright e2e spec — the 60 s grace timer is a module-scope constant not reachable by Playwright's clock emulation across a real WebSocket rig; unit-level coverage against the mocked socket is the deterministic level (the intake's stated fallback).

### Design Decisions

#### Suspended streams swallow ALL `closed` echoes
**Decision**: While a stream is suspended, every inbound `closed` control for it is swallowed (no retire, no `onClosed`), regardless of code — and a per-stream close-echo-pending mark extends the shield across a fast resume for exactly one `closed` 1000 (the suspension close's echo), cleared by the next `opened`.
**Why**: The client-initiated `close` op is echoed by the server as `closed` 1000; letting it retire the suspended stream would fire `TerminalClient`'s non-4004 probe re-open and defeat the suspension. A racing 4004 (window killed as the tab hides) is safely deferred: the resume re-`open` gets a fresh 4004 and the existing recovery runs.
**Rejected**: Swallowing only code 1000 — adds a code-discrimination branch whose only effect is firing 4004 into a hidden page nobody is looking at, where the redirect churns for nothing.
*Introduced by*: 260903-xj0w-hidden-page-stream-release

#### One mux-level grace timer, not per-stream timers
**Decision**: Page visibility is a tab-global fact, so the mux keeps a single grace timer; expiry suspends all live streams at once, and a stream opened while hidden starts the timer only if it is not already running.
**Why**: Per-stream timers would multiply state for zero behavioral difference (all streams share the page's visibility), and the single timer matches the mux's existing tab-singleton posture.
**Rejected**: Per-stream timers keyed on open-time — more state, same outcome, harder invariants.
*Introduced by*: 260903-xj0w-hidden-page-stream-release

## Tasks

### Phase 1: Spike

- [x] T001 Spike: verify the detached-`WebContentsView` visibility signal — write a throwaway Electron script (scratch, not committed) that creates a window, attaches/detaches a `WebContentsView`, and reads the guest's `document.visibilityState` via `executeJavaScript`; run under `xvfb-run` if headless. Record the outcome (fires / does not fire / unrunnable) in `## Notes` and select the R8 branch for T004. <!-- R8 -->

### Phase 2: Core Implementation

- [x] T002 <!-- rework: cycle 1 must-fix — late closed-1000 echo of a suspension close racing a fast resume retires the resumed stream and orphans a server-side attach client; add a per-stream close-echo-pending mark (set when the suspension close is actually sent on an OPEN socket) that swallows exactly one post-resume closed 1000; `opened` clears it; 4004 still retires post-resume --> Implement the hidden-page suspension state machine in `app/frontend/src/lib/relay-mux.ts`: exported `HIDDEN_RELEASE_GRACE_MS = 60000`; `suspended` mark on `StreamState`; extend the existing `visibilitychange` listener to handle `hidden` (start grace timer) and `visible` (cancel timer, resume suspended streams BEFORE the wake-probe logic); `pagehide`/`freeze` immediate-suspend listeners; suspend = send `close` op + mark suspended (keep `opts` current via existing `resize`/`setWindowId`); resume = clear mark + re-issue `open` via `connect()`+`sendOpen`; gate `ws.onopen` re-open loop, `scheduleReconnect`, `syncHeartbeat`/`heartbeatTick`, and `handleWake` on the non-suspended live count; swallow `closed` controls for suspended streams in `handleControl`; `closeStream` on a suspended stream removes it without a `close` op; tear down the new listeners/timer in `close()`. <!-- R1 R2 R3 R4 R5 R6 -->
- [x] T003 <!-- rework: cycle 1 — cover the echo-vs-resume race: late 1000 echo after resume swallowed (stream stays live), a SECOND 1000 after the echo retires, 4004 after resume retires immediately --> Unit tests in `app/frontend/src/lib/relay-mux.test.ts` (existing MockWebSocket harness + vi fake timers, driving `visibilitychange` on the stubbed `document`): close ops on grace expiry; cancel on quick return; resume re-`open` on visible with current opts (including a ridden `setWindowId`); socket reconnect while hidden does NOT re-open suspended streams; zero-live socket stays closed when all streams suspended; heartbeat stops while fully suspended; `closed` echo swallowed while suspended (no `onClosed`); stream opened while hidden starts the timer and suspends on expiry; `closeStream` of a suspended stream sends no `close` op; `pagehide`/`freeze` immediate suspension. <!-- R1 R2 R3 R4 R5 R6 -->

### Phase 3: Integration & Edge Cases

- [x] T004 Per the T001 outcome: either record "no shell change needed" in `## Notes` (signal fires natively), or add the minimal shell nudge — emit a visibility IPC event from the attach/detach seams in `app/desktop/src/main.ts` (`attachHostView` detach + attach, `showWelcome` detach), expose it on the `runkitShell` bridge (`app/desktop/src/preload.ts`), and subscribe in the SPA feeding the same suspend/resume entry points idempotently. <!-- R8 -->
- [x] T005 Verify the untouched seams and run the gates: confirm `app/frontend/src/components/terminal-client.tsx` needs no change (deferred reset re-arms in `onOpened`; suspension never fires `onClosed`); confirm zero `app/backend/` diff; run `cd app/frontend && npx tsc --noEmit` and the frontend unit suite via `just test-frontend`. <!-- R2 R7 -->

## Execution Order

- T001 blocks T004 (branch selection); T002 blocks T003 and T005. T001 and T002 are independent and may run in either order.

## Acceptance

### Functional Completeness

- [x] A-001 R1: Hidden page past `HIDDEN_RELEASE_GRACE_MS` has sent a `close` op for every live stream; streams remain in the mux map marked suspended with current `opts`; a visible transition inside the grace window cancels with no ops sent
- [x] A-002 R2: Visible transition re-issues `open` for every suspended stream with current `opts` and clears the mark; resume runs before the wake-probe path; no `TerminalClient` change was needed
- [x] A-003 R3: The `ws.onopen` re-open loop, `scheduleReconnect`, heartbeat gating, and `handleWake` all key on the non-suspended live count; a reconnect while hidden re-opens nothing suspended
- [x] A-004 R4: A `closed` control for a suspended stream is swallowed — stream retained, `onClosed` not fired — for every close code
- [x] A-005 R5: A stream opened while hidden starts the grace timer when none is running and suspends on expiry; `closeStream` of a suspended stream removes it without sending `close`
- [x] A-006 R6: `pagehide` and `freeze` suspend immediately (no grace)
- [x] A-007 R7: `git diff` contains no `app/backend/` change; `state-socket.ts` and the `/ws/state` path are untouched
- [x] A-008 R8: The spike outcome is recorded in `## Notes` and the matching branch was taken (no shell change, or the idempotent IPC nudge wired through `main.ts` + `runkitShell` bridge + SPA subscription)

### Scenario Coverage

- [x] A-009 R1: Unit tests cover every enumerated T003 scenario against the mocked socket with fake timers, and the pre-existing relay-mux suite still passes unmodified in behavior (existing assertions may only be extended, not weakened)

### Edge Cases & Error Handling

- [x] A-010 R4: A window killed while its stream is suspended surfaces as `closed` 4004 on the resume re-`open`, retiring the stream and firing `onClosed` (the existing redirect path) — verified by unit test or explicit trace through `handleControl`

### Code Quality

- [x] A-011 Pattern consistency: The suspension layer follows the mux's existing idioms (stream-gated `sync*` reconciliation, instance-owned guarded listeners, named exported ms constants mirroring `HEARTBEAT_INTERVAL_MS`)
- [x] A-012 No unnecessary duplication: Resume reuses `sendOpen`/`connect`; no parallel re-open path is introduced
- [x] A-013 No magic numbers: The grace period exists only as `HIDDEN_RELEASE_GRACE_MS`; no inline 60000 elsewhere
- [x] A-014 Tests included: The changed behavior lands with unit coverage in the same change (code-quality principle: bug fixes MUST include tests)

## Notes

- **T001 spike outcome (2026-09-03): detach/attach DRIVES `visibilitychange`.** Empirically verified with Electron 43.2.0 under Xvfb (throwaway script mirroring `main.ts`'s `contentView.addChildView`/`removeChildView` seam): attached → `visible`; detached → `visibilityState === "hidden"` with a `visibilitychange` event; re-attached → `visible` with the event. The SPA-side listener therefore covers browser tabs, minimized windows, AND detached desktop-shell views uniformly — **T004 branch taken: no shell change** (`app/desktop/` untouched).
- **T005 gates**: `npx tsc --noEmit` clean; `relay-mux.test.ts` 25/25 passing; `terminal-client.tsx` unchanged (suspension never fires `onClosed`, and resume rides the existing `onOpened` → deferred-reset → first-frame repaint machinery); zero `app/backend/` diff. The full `just test-frontend` run has widespread PRE-EXISTING failures (46 files / 960 tests, `localStorage` undefined in jsdom) reproduced on a clean HEAD tree with this change stashed — environmental, unrelated to this change (the 5 `terminal-client.test.tsx` failures are in scrollback/font-zoom blocks and fail identically at HEAD).
- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. The only replaced code is the four `streams.size === 0` liveness gates, now routed through `liveCount()` in place with no leftover dead paths.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Swallow ALL `closed` echoes (any code) while suspended; dead windows surface on resume as a fresh 4004 | Server echo verified in `terminals_ws.go` (`closeStream` → `emitClosed` 1000); resume-time 4004 rides the existing recovery path | S:80 R:85 A:85 D:75 |
| 2 | Confident | Single mux-level grace timer; a stream opened while hidden starts it only when not already running | Page visibility is tab-global; per-stream timers add state with no behavioral difference | S:75 R:90 A:85 D:80 |
| 3 | Tentative | No Playwright e2e — unit-level coverage only <!-- assumed: e2e omitted — the 60s module constant is not reachable by Playwright clock emulation over a real WS rig; intake explicitly allows the unit-level fallback --> | Intake names unit coverage as the fallback when not deterministically testable | S:65 R:85 A:60 D:55 |
| 4 | Tentative | If the T001 spike is unrunnable in this environment, implement the idempotent shell nudge anyway <!-- assumed: nudge-on-unrunnable — a redundant signal is harmless by design (state-driven), whereas a missing signal silently reintroduces the bug for the primary desktop-shell case --> | Fails safe toward the driving use case; nudge is small and additive | S:55 R:75 A:60 D:55 |
| 5 | Certain | `pagehide` releases immediately even though it also fires on tab close/navigation | On real unload the socket dies anyway; sending `close` ops merely speeds server teardown | S:80 R:95 A:90 D:85 |

5 assumptions (1 certain, 2 confident, 2 tentative).
