# Plan: Skip Redundant Same-Session Relay Reconnect (Window-Switch Flicker, Part 2)

**Change**: 260610-9umy-skip-same-session-reconnect
**Status**: In Progress
**Intake**: `intake.md`

## Requirements

### Frontend: Relay Connection Identity (terminal-client.tsx)

#### R1: Same-session windowId change rides the existing socket
The WebSocket effect in `app/frontend/src/components/terminal-client.tsx` MUST NOT tear down, reconnect, or reset when only `windowId` changes while the resolved owning session is unchanged. The PTY follows via tmux `select-window`, already issued by the existing paths (REST `selectWindow` from `navigateToWindow` at app.tsx:487 and mount-time alignment at app.tsx:434, or an in-band tmux-status-bar click over the existing socket). xterm scrollback is preserved across same-session switches (accepted consequence — native `tmux attach` behavior).

- **GIVEN** a live relay connection for window `@0` whose owning session is `S`
- **WHEN** the `windowId` prop changes to `@1` and `sessionName` stays `S`
- **THEN** no `ws.close()` is called, no new WebSocket is constructed, and no `terminal.reset()` fires

#### R2: Cross-session change between two resolved values reconnects
When `sessionName` changes between two non-empty values (cross-session navigation, a window moved to another session, and — accepted tradeoff — session rename), the effect MUST tear down the live connection and reconnect exactly as today. Part-1's deferred reset MUST fire before the new connection's first write (no black frame). (Note — corrected in rework cycle 1: `_rk-pin-*` pin-session transitions do NOT arrive in this shape; pin-sessions are filtered from the SSE snapshot, so pinning the viewed window presents as resolved → `""` and is governed by R9.)

- **GIVEN** a live relay connection serving session `S1`
- **WHEN** the `sessionName` prop changes to a different non-empty `S2`
- **THEN** the old socket is closed, exactly one new socket is opened (to the latest `windowIdRef.current`), and the deferred reset fires before the new connection's first chunk write

#### R3: Cold deep-link "" → resolved does not reconnect
While `sessionName` is `""` (SSE not yet resolved — app.tsx passes `sessionName ?? ""` and the render gate keys on `windowParam` alone), the effect MUST connect immediately by windowId as today (the relay resolves the owning session server-side via `ResolveWindowSession`). When `sessionName` transitions `""` → a resolved value, the effect MUST NOT reconnect — it records the resolved value as the live connection's served-session identity (the connection is already attached to that window's owning session by construction).

- **GIVEN** a live relay connection established while `sessionName` was `""`
- **WHEN** `sessionName` resolves to `S`
- **THEN** no teardown/reconnect/reset occurs
- **AND** a later change `S` → different non-empty `S2` DOES reconnect (the resolution was recorded)

#### R4: Transient-drop reconnects use the latest windowId
The `ws.onclose` → `reconnectTimer` → `connect()` path MUST keep building the relay URL from `windowIdRef.current` so a reconnect after a transient drop attaches to the latest window, including a same-session switch performed while disconnected. Unchanged mechanism (terminal-client.tsx windowIdRef + connect()).

- **GIVEN** a live connection for `@0`, then a same-session switch to `@5` (no reconnect per R1)
- **WHEN** the socket drops (close code ≠ 4004) and the reconnect timer fires
- **THEN** the new socket's URL contains `/relay/%405` (encodeURIComponent of `@5`)

#### R5: Server change reconnects exactly once
A `server` prop change MUST tear down and reconnect (as today — `server` stays in the connect-effect deps). The session-identity watcher MUST NOT additionally bump the reconnect epoch in the same commit (no double teardown/reconnect when `server` and `sessionName` change together).

- **GIVEN** a live connection to server `A`
- **WHEN** the `server` prop changes to `B`
- **THEN** the old socket closes and exactly ONE new socket opens with `?server=B`

#### R6: Unchanged surfaces
The following MUST NOT regress: relay URL semantics (`/relay/@N?server=`, URL still built from the latest windowId); focused-terminal registration, upload hook, and aria-label (separate effects/hooks that keep following the `windowId`/`sessionName` props); the `onSessionNotFound`/close-code-4004 redirect path; BoardPane usage (fixed per-pane windowIds, `registerFocus={false}` — behavior-neutral under the new keying); part-1 deferred-reset semantics (per-connect arming, consumed at first write on both paths, empty-flush guard, teardown neutralization); adaptive-flush invariants (`IMMEDIATE_WRITE_MAX_BYTES` 64, `textByteLength`, `wroteImmediatelyThisFrame` guard, once-buffering-always-buffer ordering).

- **GIVEN** the implemented change
- **WHEN** the full frontend unit suite runs
- **THEN** all existing part-1 deferred-reset, adaptive-flush, scroll-lock, and Unicode-init tests still prove their behaviors (spec-conformant trigger updates only, per R8)

#### R7: WS-effect comment rewritten to the implemented behavior
The comment block above the WebSocket effect (currently terminal-client.tsx:479-495, ending with "A follow-up change will eliminate those reconnects…") MUST be rewritten to describe the implemented design: connection identity is (server, owning session); same-session windowId changes ride the existing socket via tmux `select-window`; cold deep-links connect by windowId and absorb the `""` → resolved transition without reconnecting; session rename reconnects (accepted tradeoff — the SSE snapshot carries no stable session id). The chosen React mechanism MUST be explained in code comments, including the deliberate dependency exclusions behind the existing `eslint-disable react-hooks/exhaustive-deps`.

- **GIVEN** the rewritten comment block
- **WHEN** a reader inspects the WS effect
- **THEN** the comment matches the implemented keying, names the rename tradeoff, and no longer describes a "follow-up change"

#### R8: Tests — new coverage plus spec-conformant trigger updates
`app/frontend/src/components/terminal-client.test.tsx` MUST gain connection-lifecycle tests: (a) same-session windowId switch keeps the socket (no close, no new instance, no reset); (b) cross-session switch closes old + opens new and the deferred reset fires before the new connection's first write; (c) `""` → resolved causes no reconnect (and a later genuine session change does); (d) transient drop reconnects with the LATEST windowId in the URL. Part-1 tests that used a same-session windowId rerender as the teardown trigger ("neutralizes pending write state at effect teardown", currently :433) MUST be re-triggered via a session change (constitution § Test Integrity — the proven behaviors stay proven; only the trigger conforms to the new spec). All tests run via `just test-frontend` only; the full suite MUST end green (579 tests at part-1 completion; net count grows).

- **GIVEN** the implemented keying
- **WHEN** `just test-frontend` runs
- **THEN** the new lifecycle tests pass and every pre-existing test passes (with the teardown-trigger updates applied)

#### R9: Resolved → "" is a loss-of-identity signal — probe reconnect restores 4004 recovery
*(Added in rework cycle 1 — review must-fix M1.)* app.tsx derives `sessionName` by locating the URL's `@N` in the SSE snapshot (app.tsx:188-198), so `sessionName` goes resolved → `""` AND STAYS `""` when the viewed window is killed externally (`exit`, `tmux kill-window`), pinned to a `_rk-pin-*` session (filtered from the snapshot), or the route is a dead deep link. The watcher MUST treat this direction as a loss of identity: record `""` into `connectedSessionRef` AND bump `connectionEpoch` (subject to the same-commit server-change guard), issuing a probe reconnect by `windowIdRef.current`. The probe either re-resolves server-side (window still exists — e.g. an X → `""` → X ghost gap costs one reconnect, flicker-free per part-1's deferred reset) or the relay closes 4004 and the `onSessionNotFound` redirect fires (intake R6: "4004/onSessionNotFound redirect path: unchanged" — the other recovery mechanisms, `computeKillRedirect` at lib/navigation.ts:43 and the URL writeback, are gated on a non-empty `sessionName` and are inert in this state). `""` → resolved stays absorption-only (R3); `""` → `""` stays a no-op (cold mount).

- **GIVEN** a live connection serving resolved session `S`
- **WHEN** the `sessionName` prop transitions to `""` (window killed / pinned away / dead link)
- **THEN** the old socket is closed and exactly one probe socket is opened by windowId
- **AND** if the probe's close arrives with code 4004, `onSessionNotFound` fires (redirect restored)

### Non-Goals

- Any backend change (`app/backend/**`) — relay URL semantics and tmux behavior unchanged.
- Any app.tsx change — `selectWindow` paths re-verified at apply time (app.tsx:434, :487; `sessionName ?? ""` at :1224; render gate keys on `windowParam` alone).
- Detecting session renames (entity-continuity tracking) — accepted reconnect-on-rename tradeoff.
- Any change to part-1 deferred-reset mechanics or adaptive-flush thresholds/measurement/ordering.
- New Playwright e2e specs — unit-level coverage only (unit exemption from `.spec.md` policy applies).

### Design Decisions

1. **Connection-identity mechanism**: a `connectedSessionRef` (session the live connection serves; `""` = resolved server-side only) + `connectedServerRef` (server the live connection was established against) + a `connectionEpoch` state bumped by a small watcher effect on `[sessionName, server]`. The connect effect drops `sessionName`/`windowId` from its deps (keeps `terminalReady`, `server`, `wsRef`, adds `connectionEpoch`) and records the full identity at effect-run time. — *Why*: the effect body never read `sessionName`/`windowId` directly (the URL uses `windowIdRef.current`), so deps were pure triggers; a ref-tracked identity plus an epoch is the smallest mechanism that reconnects only on genuine identity changes. — *Rejected*: computed key in deps (cannot absorb `""` → resolved without reconnecting); splitting connect into an imperative manager (larger diff, more lifecycle risk).
2. **Server-change guard in the watcher**: the watcher skips the epoch bump when `server !== connectedServerRef.current` — the connect effect re-runs via its `server` dep in the same commit, and bumping too would cause a double teardown/reconnect. The watcher is declared BEFORE the connect effect so it reads the pre-change server identity. — *Why*: `server` and `sessionName` can change in the same render (cross-server navigation without remount — TerminalClient is not keyed). — *Rejected*: ignoring the case (double reconnect churn).
3. **Identity recorded at connect-effect top, not inside `connect()`**: any identity change re-runs the effect (clearing the reconnect timer), so a timer-driven `connect()` can never observe a changed identity; recording once per effect run is sufficient and keeps `connect()` untouched. — *Rejected*: recording inside `connect()` (reads a closure value that cannot differ; noise).
4. **Watcher direction semantics** *(corrected in rework cycle 1)*: `""` → resolved is absorption-only (record, never bump — the R3 win); resolved → `""` records `""` AND bumps the epoch (probe reconnect); `""` → `""` is a no-op. — *Why*: resolved → `""` is not "no information" — it is how this codebase signals that the viewed window left the snapshot (killed, pinned to a filtered `_rk-pin-*` session, dead deep link), and the probe reconnect is what keeps the relay's 4004 → `onSessionNotFound` redirect reachable (every other recovery path is gated on a non-empty `sessionName`). — *Rejected (the original v1 decision)*: treating `""` as inert in both directions — it wedged the UI on kill-while-viewing (review finding M1).

## Tasks

### Phase 1: Setup

(none — single-file change, no scaffolding)

### Phase 2: Core Implementation

- [x] T001 Add connection-identity tracking to `app/frontend/src/components/terminal-client.tsx`: `connectedSessionRef`, `connectedServerRef`, `connectionEpoch` state, and the session-identity watcher effect (declared before the connect effect; absorbs `""` → resolved by recording only; bumps the epoch for resolved → different resolved AND for resolved → `""` — loss-of-identity probe reconnect; `""` → `""` is a no-op; same-commit server-change guard on every bump) <!-- R1 R2 R3 R5 R9 --> <!-- rework: resolved→"" must bump epoch (4004 recovery regression) -->
- [x] T002 Rewire the connect effect in `app/frontend/src/components/terminal-client.tsx`: record `(server, sessionName)` identity at effect top; change deps from `[terminalReady, sessionName, windowId, server, wsRef]` to `[terminalReady, server, wsRef, connectionEpoch]`; keep the `eslint-disable react-hooks/exhaustive-deps` with an explanatory comment for the deliberate exclusions <!-- R1 R4 R5 R6 -->
- [x] T003 Rewrite the WS-effect comment block (terminal-client.tsx:479-495) to describe the implemented (server, owning session) keying, same-session ride-along, cold-deep-link absorption, the session-rename reconnect tradeoff, and the resolved → `""` loss-of-identity semantics (pin-sessions are filtered from the snapshot, so `_rk-pin-*` transitions present as resolved → `""`, NOT resolved → resolved; probe reconnect → server-side re-resolution or 4004 recovery) <!-- R7 R9 --> <!-- rework: resolved→"" must bump epoch (4004 recovery regression) -->

### Phase 3: Integration & Edge Cases (tests)

- [x] T004 Update the part-1 teardown test "neutralizes pending write state at effect teardown" in `app/frontend/src/components/terminal-client.test.tsx` (~:433) to trigger teardown via a cross-session change instead of a same-session windowId rerender (spec-conformant per constitution § Test Integrity) <!-- R8 -->
- [x] T005 Add a "TerminalClient connection identity" describe block to `app/frontend/src/components/terminal-client.test.tsx` with tests: (a) same-session windowId switch keeps the socket — no close, no new instance, no reset; (b) cross-session switch closes old + opens exactly one new socket and the deferred reset fires before its first write; (c) `""` → resolved does not reconnect, and a later genuine session change does; (d) transient drop reconnects with the latest windowId in the URL; (e) server change reconnects exactly once (no watcher double-bump); (f) resolved → `""` bumps the epoch — old socket closed, probe socket opened; (g) 4004 recovery after an external kill: resolved → `""` → probe → onclose 4004 → `onSessionNotFound` fires. Hoist the helpers shared with the deferred-reset block (rAF queue, `terminalSpies`, `writeOrderOf`, env stubs) to module scope <!-- R1 R2 R3 R4 R5 R8 R9 --> <!-- rework: resolved→"" must bump epoch (4004 recovery regression) -->

### Phase 4: Polish (gates)

- [x] T006 Run gates in order: `cd app/frontend && npx tsc --noEmit`, then `just test-frontend` — full suite green <!-- R6 R8 -->

## Execution Order

- T001 → T002 → T003 (same file, same effect region — sequential)
- T004/T005 after T002 (tests assert the new keying)
- T006 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: A same-session `windowId` rerender leaves the live socket untouched — no `close()`, no new WebSocket instance, no `terminal.reset()` (proven by unit test)
- [x] A-002 R2: A non-empty → different non-empty `sessionName` change closes the old socket and opens exactly one new one, with the deferred reset firing before the new connection's first chunk write (proven by unit test)
- [x] A-003 R3: A `""` → resolved `sessionName` transition causes no reconnect, and the resolution is recorded (a subsequent genuine session change reconnects) (proven by unit test)
- [x] A-004 R4: After a same-session switch followed by a transient drop, the reconnect URL contains the latest windowId (`windowIdRef` path unchanged) (proven by unit test)
- [x] A-005 R5: A `server` change tears down and opens exactly ONE new connection (no double reconnect from the watcher) (proven by unit test)

### Behavioral Correctness

- [x] A-006 R1: The connect effect's deps no longer include `sessionName` or `windowId`; the relay URL is still built from `windowIdRef.current` with `?server=` from the `server` prop
- [x] A-007 R6: Part-1 deferred-reset semantics are intact: per-connect arming, consumption before first write on both paths, empty-flush guard, teardown neutralization — all pre-existing reset tests pass (with only the R8 trigger update)
- [x] A-008 R6: Adaptive-flush invariants untouched: `IMMEDIATE_WRITE_MAX_BYTES` (64), `textByteLength`, `wroteImmediatelyThisFrame`/`markImmediateWrite`, once-buffering-always-buffer ordering — code unchanged in those regions

### Scenario Coverage

- [x] A-009 R8: New connection-lifecycle tests (a)-(e) exist in `terminal-client.test.tsx` and pass via `just test-frontend`
- [x] A-010 R8: The part-1 "neutralizes pending write state at effect teardown" test triggers teardown via a session change and still proves the neutralization behavior

### Edge Cases & Error Handling

- [x] A-011 R6: The 4004/`onSessionNotFound` redirect path is unchanged (no reconnect on 4004; callback fired) — MET after rework cycle 1 (M1 fixed): the onclose 4004 handler is byte-unchanged (early return, no reconnect timer), and kill-while-viewing reachability is restored — the watcher now records `""` AND bumps `connectionEpoch` on resolved→`""` (terminal-client.tsx:552-564, same-commit server-change guard kept on both bump directions), issuing a probe reconnect by `windowIdRef.current` that either re-resolves server-side (X→`""`→X ghost gap costs one flicker-free reconnect) or closes 4004 → `onSessionNotFound` → app.tsx navigates to `/$server` (app.tsx:1230), unmounting TerminalClient (render gate keys on `windowParam`, app.tsx:1200) — no reconnect loop. Proven by the new tests (f) "bumps the epoch on resolved → ''" and (g) "restores the 4004 redirect after an external kill" in terminal-client.test.tsx.
- [x] A-012 R3: While `sessionName` is `""`, the client connects immediately by windowId (no waiting for resolution)

### Code Quality

- [x] A-013 Pattern consistency: new refs/effects follow the existing `windowIdRef` ref-tracking idiom and the file's comment-heavy explanatory style
- [x] A-014 No unnecessary duplication: no new utilities duplicating existing helpers in production code; `app/backend/**` and `app.tsx` untouched (the cycle-1 should-fix was addressed in rework cycle 1: the rAF queue, `TerminalSpies`/`terminalSpies`, `writeOrderOf`, and `stubConnectionEnv` helpers are hoisted to module scope and shared by both WS-connection describe blocks)
- [x] A-015 Type narrowing over assertions: no new `as` casts in production code (the test block copies the pre-existing `vi.mocked(...).value as TerminalSpies | undefined` narrowing idiom from the deferred-reset block)
- [x] A-016 Tests run via `just` recipes only — never direct `vitest`/`pnpm test` (context.md testing policy)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change rewires the existing connect effect's trigger conditions (deps + watcher) without making any existing code, branch, or utility redundant; `windowIdRef`, the transient-drop reconnect path, and all part-1 reset machinery remain load-bearing.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Mechanism: served-session ref + server ref + `connectionEpoch` state bumped by a watcher effect on `[sessionName, server]`; connect-effect deps become `[terminalReady, server, wsRef, connectionEpoch]` | Intake assumption #8 leaves the mechanism to the implementor provided semantics 1-6 hold; this is the smallest change that absorbs `""` → resolved without reconnecting; verified the effect body never read `sessionName`/`windowId` directly | S:80 R:85 A:85 D:75 |
| 2 | Confident | Watcher skips the epoch bump when `server !== connectedServerRef.current` and is declared before the connect effect | `server` stays in the connect-effect deps (intake requires server changes to reconnect); without the guard a simultaneous server+session change would tear down/reconnect twice; declaration order makes the watcher read the pre-change server | S:75 R:85 A:85 D:80 |
| 3 | Confident | Identity `(server, sessionName)` recorded once at connect-effect top, not inside `connect()` | Any identity change re-runs the effect (cleanup clears the reconnect timer), so a timer-driven `connect()` can never observe a changed identity; keeps `connect()` and the transient-drop path byte-identical | S:75 R:90 A:85 D:80 |
| 4 | Confident | Part-1 neutralization test re-triggered via a cross-session change (sessionName + windowId both change — realistic cross-session navigation), not unmount | Intake assumption #12 allows "session change or unmount"; the session-change trigger also exercises the successor-effect takeover the original test proved, which unmount would not | S:80 R:90 A:85 D:75 |
| 5 | Certain | *(Revised in rework cycle 1 — the original "watcher ignores `""` entirely" was the documented error behind review must-fix M1.)* Watcher direction semantics: `""` → resolved is absorption-only (record, never bump); resolved → `""` records `""` AND bumps the epoch — loss-of-identity probe reconnect that restores the 4004/`onSessionNotFound` recovery; `""` → `""` is a no-op; X → `""` → X ghost gap costs exactly one reconnect (matching the kill/pin/dead-link recovery the pre-change sessionName dep provided) | Constitution § Test Integrity (spec first): app.tsx resolves `sessionName` by locating `@N` in the SSE snapshot, so resolved → `""` persists on external kill / pin-away / dead link; `computeKillRedirect` (lib/navigation.ts:43) and the URL writeback are gated on non-empty `sessionName`, so without the bump no recovery path remains (intake R6 regression) | S:90 R:85 A:90 D:90 |
| 6 | Certain | Added test (e) for exactly-one reconnect on server change, beyond the intake's four listed tests | Intake lists the four required tests as a floor ("New coverage:"); R5 (server reconnect, no double-bump) is a decided semantic that needs proof; same harness, no scope growth | S:85 R:90 A:90 D:85 |

6 assumptions (2 certain, 4 confident, 0 tentative).
