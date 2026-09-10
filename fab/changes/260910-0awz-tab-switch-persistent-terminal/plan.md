# Plan: Tab-switch flicker fix — persistent terminal + byte-gated confirmation

**Change**: 260910-0awz-tab-switch-persistent-terminal
**Intake**: `intake.md`

## Requirements

### Terminal route: the tile grid persists across same-server window switches

#### R1: Grid keyed by server, not by window
The `SurfaceLayout` mount in `app/frontend/src/app.tsx` MUST use `key={server}`. A same-server window switch SHALL re-render the mounted grid with the new `windowId` prop; a server change MAY still remount.

- **GIVEN** the terminal route is showing window `@3` of server `default`
- **WHEN** the user switches to window `@5` of the same server (sidebar, palette, breadcrumb, or tiles)
- **THEN** the same `SurfaceLayout` instance receives `windowId="@5"` and its tty tile's `TerminalClient` (and its xterm DOM node) stays mounted
- **AND** switching to a window on a different server remounts the grid as before

#### R2: Per-window transient state resets by effect
`SurfaceLayout` (`app/frontend/src/components/surface-layout.tsx`) MUST reset its per-window transient state when `server` or `windowId` changes, and MUST NOT run that reset on first mount (the `useState` initializers already seed it). The reset covers: the hide-never-unmount set (`everOpened` → the new window's `layout.order` kinds), zoom (`zoomedIndex` + `zoomedKindRef` re-derived from `readStoredZoom(server, windowId)`), the focused slot (`0`, and `lastReportedKindRef` cleared so the kind re-reports), `webPageTitle` (`null`), tty progress (`IDLE_PROGRESS`, pending rAF cancelled), and the find state (closed, query/results/ran cleared, `searchAddon.clearDecorations()` called, no focus grab). The existing ratios reset effect and the web-override cleanup effect remain the owners of their state.

- **GIVEN** window `@3` has the web tile zoomed, slot 1 focused, an open find bar with 4 matches, and a web page title
- **WHEN** the grid's `windowId` prop changes to `@5` (whose stored zoom key is empty)
- **THEN** zoom is cleared, slot 0 is focused and reported via `onFocusedKindChange`, the find bar is closed with decorations cleared, the page title and progress are cleared, and `everOpened` equals `@5`'s layout kinds
- **AND** on the component's first mount none of these are re-set (no redundant `onFocusedKindChange` double-report)

#### R3: Non-tty tiles keep their per-window remount; the tty tile does not
The React key of every non-tty tile wrapper (web, code, gui) MUST include `windowId`; the tty tile wrapper's key MUST NOT.

- **GIVEN** a `split-h:tty,web` layout on window `@3`
- **WHEN** the grid's `windowId` changes to `@5`
- **THEN** the web tile's wrapper (and its `IframeWindow`) remounts, and the tty tile's wrapper and `TerminalClient` are the same instances as before

### Terminal client: the same-session ride clears the old window's buffer

#### R4: Deferred buffer clear on a same-session ride
`TerminalClient` (`app/frontend/src/components/terminal-client.tsx`) MUST arm a deferred buffer clear when its `windowId` prop changes while a resolved same-session stream is live, and MUST execute it as `terminal.clear()` immediately before the first inbound chunk written after the change — on both the immediate and the coalesced write path — exactly once. It MUST NOT call `terminal.reset()` on a ride. A stream (re)open that arms `pendingReset` MUST drop a pending clear. The existing stream-open effect deps `[terminalReady, server, wsRef, connectionEpoch]` MUST stay unchanged.

- **GIVEN** a live stream serving session `work` showing `@3`, with scrollback from `@3`
- **WHEN** `windowId` changes to `@5` and tmux's redraw arrives as a 4 KB chunk (coalesced path) or a 20-byte chunk (immediate path)
- **THEN** `clear()` runs once, in the same tick as (and before) that chunk's write, `reset()` is never called, no `close`/`open` is issued, and `setWindowId("@5")` is called
- **AND** if a socket drop re-opens the stream before any chunk arrives, `onOpened` arms `pendingReset` and the pending clear is discarded (the deferred reset runs instead)

### Window transition: SSE confirmation is byte-gated

#### R5: Byte counting and the split confirmation entry points
`app/frontend/src/lib/window-transition.ts` MUST track whether a byte has been counted as the incoming window's for the current switch (cleared when `beginWindowSwitchGate` or `armGraceMask` mints a new epoch; set on the `acceptingNotify` release, the `liftAccepting` lift, and the in-flight receipt counted at `openForNotify`/`openForLift`), exposed as a pure `hasCountedIncomingBytes()`. `confirmSwitchArrived()` MUST act (settle a pending gate `"first-write"`, tear down the mask) only when a byte has been counted and MUST be a no-op otherwise. A new `forceSwitchArrived()` MUST settle and tear down unconditionally. `abandonSwitchFeedback()` is unchanged.

- **GIVEN** a gated switch whose POST resolved, no byte received yet
- **WHEN** `confirmSwitchArrived()` is called (SSE reports the target active) and then the 300 ms timer fires
- **THEN** the gate settles `"timeout"` and the mask arms; a later `notifyFirstWrite()` lifts it
- **GIVEN** the same switch after one counted byte
- **WHEN** `confirmSwitchArrived()` is called
- **THEN** the gate settles `"first-write"` and no mask shows
- **GIVEN** any state
- **WHEN** `forceSwitchArrived()` is called
- **THEN** any pending gate settles `"first-write"` and the mask is torn down

#### R6: Call sites in app.tsx
The SSE URL-writeback effect in `app/frontend/src/app.tsx` MUST keep calling `confirmSwitchArrived()`; the confirmation-timer rescue branch in `bouncePendingSwitch` (target already active after `CONFIRMATION_WINDOW_MS`) MUST call `forceSwitchArrived()`. The comments explaining SSE confirmation as the arrival authority MUST be rewritten to state that paint feedback is byte-driven and the 5 s rescue is the unconditional teardown.

- **GIVEN** a switch whose POST hangs and whose SSE confirmation arrives before any byte
- **WHEN** 300 ms elapse
- **THEN** the spinner mask is visible over the terminal surface
- **AND** if 5 s elapse with the target still active and no byte, the mask is torn down by the rescue path

### Verification

#### R7: Tests and gates
Unit tests MUST cover R2–R5 as described in the intake's Tests section; `tests/e2e/window-switch-transition.spec.ts` (or a sibling spec on the same rig) MUST assert that across a same-session sidebar switch the `.xterm` element is the same DOM node, the new window's content paints within ~1 s, and the terminal surface is never empty during the switch. Every touched Playwright `test()` MUST carry the Proves/Steps intent comment. `just test-frontend`, `tsc --noEmit`, and the targeted e2e (`just pw test window-switch`) MUST pass.

- **GIVEN** the change is applied
- **WHEN** `just test-frontend` and `just pw test window-switch-transition` run
- **THEN** all pass, including the new assertions

### Non-Goals
- Relay frame coalescing, held one-frame reveal, attach latency, the double-redraw diagnosis — Change B (plan doc § Change B)
- Boards (`board-pane.tsx`) and the operator console `TerminalClient` mounts — not on the window-switch path
- Any backend change

### Design Decisions

#### Grid key is server-only; per-window state resets by effect
**Decision**: `SurfaceLayout` is keyed by `server`; transient per-window state resets in one `[server, windowId]` effect guarded against first mount.
**Why**: the tty tile must survive a same-session switch so the relay's same-session ride and the deferred-reset design apply; the ratios reset already follows the effect pattern.
**Rejected**: hoisting `TerminalClient` above the keyed boundary (more prop plumbing, two ownership seams for the same tile) — recorded as the fallback if the reset effect proves too entangled.
*Introduced by*: 260910-0awz-tab-switch-persistent-terminal

#### Non-tty tiles keep a per-window remount via their key
**Decision**: web/code/gui tile wrappers carry `windowId` in their React key.
**Why**: their content identity changes with the window and each has mount-once bookkeeping (code first-boot rescue, per-url iframes, RFB session); limiting persistence to the tty tile keeps the review surface small.
**Rejected**: persisting all tiles and re-deriving their content by prop — a much larger change for no user-visible gain.
*Introduced by*: 260910-0awz-tab-switch-persistent-terminal

#### `clear()` not `reset()` on a ride
**Decision**: a same-session windowId change arms a deferred `terminal.clear()` consumed at the first inbound chunk.
**Why**: the old window's rows must leave scrollback (find/export correctness) without touching terminal modes tmux believes it already set on this still-attached client; deferring to the first chunk keeps the no-blank-frame invariant.
**Rejected**: `reset()` (mode desync — a fresh attach re-sends modes, an in-place switch does not); leaving scrollback mixed (find/export read the wrong window).
*Introduced by*: 260910-0awz-tab-switch-persistent-terminal

#### SSE confirmation is byte-gated; the 5 s rescue is not
**Decision**: `confirmSwitchArrived()` acts only after a counted incoming byte; `forceSwitchArrived()` is the unconditional form used by the confirmation-timer rescue.
**Why**: SSE confirms intent (the URL may stand) before any pixel of the new window exists; paint feedback must stay byte-driven or the slide animates into a blank surface and the mask never shows. A mask with no lift path must still clear after the confirmation window.
**Rejected**: dropping the SSE teardown entirely (a stuck mask when bytes never come); keeping it unconditional (today's blank).
*Introduced by*: 260910-0awz-tab-switch-persistent-terminal

## Tasks

### Phase 1: Setup

- [x] T001 In `app/frontend/src/lib/window-transition.ts` add the per-switch `bytesCounted` flag (cleared in `beginWindowSwitchGate` and `armGraceMask` at epoch mint; set on the `acceptingNotify` release and `liftAccepting` lift in `notifyFirstWrite`, and on the in-flight receipt counted in `openForNotify`/`openForLift`), export `hasCountedIncomingBytes()`, make `confirmSwitchArrived()` a no-op unless the flag is set, and add `forceSwitchArrived()`; extend `app/frontend/src/lib/window-transition.test.ts` with the R5 scenarios (confirm-before-bytes → timeout arms mask → later byte lifts; confirm-after-bytes → first-write, no mask; force always tears down; each of the three counting paths) <!-- R5 -->

### Phase 2: Core Implementation

- [x] T002 In `app/frontend/src/app.tsx` switch the `bouncePendingSwitch` "SSE already reports the target ACTIVE" rescue branch to `forceSwitchArrived()`, keep the writeback effect on `confirmSwitchArrived()`, and rewrite the two comment blocks (writeback effect; rescue branch) so they state that SSE confirms intent while paint feedback stays byte-driven, with the 5 s rescue as the unconditional teardown <!-- R6 -->
- [x] T003 [P] In `app/frontend/src/components/terminal-client.tsx` add the deferred buffer clear: a `pendingClearRef` armed in the existing `windowId` effect (the one calling `stream.setWindowId`) only when `streamRef.current` is non-null and `connectedSessionRef.current` is resolved; a `consumePendingClear()` mirroring `consumePendingReset` called at the same two seams (`handleInbound` immediate path, `flushToTerminal`); the flag dropped in `stream.onOpened` when `pendingReset` is armed and in the connect effect's cleanup. Extend the "connection identity" block in `app/frontend/src/components/terminal-client.test.tsx` per R4 (clear once before first chunk on both paths, `reset` never called on a ride, re-open supersedes the clear) <!-- R4 -->
- [x] T004 [P] In `app/frontend/src/components/surface-layout.tsx` add the per-window reset effect on `[server, windowId]` with a `prevWindowRef` first-mount guard covering `everOpened`, `zoomedIndex`/`zoomedKindRef` (re-derived from `readStoredZoom`), `focusedSlot` + `lastReportedKindRef`, `webPageTitle`, `ttyProgress`/`ttyProgressRef` (+ rAF cancel), and the find state (close, clear, `searchAddon?.clearDecorations()`, no focus grab); rewrite every "comes free from the parent's `${server}:${windowId}` key" / "remounts this component" comment (focus key, hide-never-unmount, zoom, page title, progress, focused slot, find, web-override cleanup) to the effect-reset truth <!-- R2 -->
- [x] T005 In `app/frontend/src/components/surface-layout.tsx` make the tile wrapper key `windowId`-scoped for non-tty kinds only (`kind === "tty" ? `${kind}${suffix}` : `${kind}${suffix}:${windowId}``) at the tile-wrapper seam, with a comment stating why the tty key is window-independent <!-- R3 -->
- [x] T006 In `app/frontend/src/app.tsx` change the `SurfaceLayout` mount key to `key={server}` and rewrite its mount comment (grid keyed by server; per-window state resets by effect inside the component; non-tty tiles remount via their own keys). Do this after T004/T005 land so no intermediate state remounts nothing while leaving per-window state stale <!-- R1 -->

### Phase 3: Integration & Edge Cases

- [x] T007 [P] Extend `app/frontend/src/components/surface-layout.test.tsx`: a `windowId` rerender resets zoom (from the new window's stored key), focused slot (re-reported once), `everOpened`, find state (decorations cleared), page title, progress; the tty tile's DOM node is identical before/after; a web tile's DOM node is not; first mount fires no reset side effects <!-- R2 --> <!-- R3 -->
- [x] T008 [P] In `app/frontend/src/app.test.tsx` (or the closest app-level test that renders the terminal route with the state-socket mock) assert that navigating between two same-server windows does not remount `SurfaceLayout` (spy on a mount-once effect or compare the `.xterm`/tty tile DOM node), and that a server change does <!-- R1 -->
- [x] T009 Extend `app/frontend/tests/e2e/window-switch-transition.spec.ts` (or add a sibling same-session spec on the same tmux rig): across a sidebar same-session switch the `.xterm` element handle is the same node, the incoming window's distinctive content is visible within ~1 s, and a short poll (every ~50 ms during the switch) never observes an empty terminal surface; carry the Proves/Steps intent comment and update the file header if shared setup changes <!-- R7 --> <!-- R1 --> <!-- R4 -->
- [x] T010 Run the gates in order — `cd app/frontend && npx tsc --noEmit`, `just test-frontend`, `just pw test window-switch-transition` (plus `just pw test surface-layout` for the layout suites) — and fix any regressions; record apply-time graded decisions in `## Assumptions` <!-- R7 -->

## Execution Order

- T001 blocks T002 (the new export must exist)
- T004 and T005 block T006 (flip the key last)
- T003 is independent of T004–T006 and can run alongside them
- T007–T009 follow their implementation tasks; T010 runs last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `app.tsx` mounts `SurfaceLayout` with `key={server}`; a same-server window switch keeps the same `SurfaceLayout`/`TerminalClient` instances and a server change remounts
- [x] A-002 R2: `SurfaceLayout` resets `everOpened`, zoom, focused slot (re-reported), web page title, tty progress, and find state on a `windowId` change, and not on first mount
- [x] A-003 R3: non-tty tile wrappers carry `windowId` in their React key; the tty tile wrapper does not
- [x] A-004 R4: `TerminalClient` arms a deferred `clear()` on a resolved same-session `windowId` change, executes it once before the first chunk on both write paths, never calls `reset()` on a ride, and drops it on a stream re-open
- [x] A-005 R5: `hasCountedIncomingBytes()`, byte-gated `confirmSwitchArrived()`, and unconditional `forceSwitchArrived()` exist with the specified semantics
- [x] A-006 R6: the writeback effect calls `confirmSwitchArrived()`; the confirmation-timer rescue calls `forceSwitchArrived()`; both comment blocks are rewritten

### Behavioral Correctness

- [x] A-007 R1: the stream-open effect deps in `terminal-client.tsx` are unchanged (`[terminalReady, server, wsRef, connectionEpoch]`) and a same-session switch issues no `close`/`open` op
- [x] A-008 R5: SSE confirmation before any counted byte leaves the gate to its 300 ms timeout (mask arms) and a later byte lifts the mask; after a counted byte it settles `"first-write"` with no mask
- [x] A-009 R4: the deferred clear runs in the same tick as the first chunk's write (no cleared-but-unpainted frame), on both the immediate and coalesced paths

### Scenario Coverage

- [x] A-010 R7: `window-transition.test.ts` covers the three byte-counting paths, confirm-before/after-bytes, and `forceSwitchArrived()`
- [x] A-011 R7: `terminal-client.test.tsx` covers the ride's deferred clear (both paths, once, no reset, re-open supersedes)
- [x] A-012 R7: `surface-layout.test.tsx` covers every per-window reset item plus tty-node identity and web-node remount
- [x] A-013 R7: the e2e spec asserts same `.xterm` node, content within ~1 s, and never-empty surface across a same-session switch, with Proves/Steps intent comments

### Edge Cases & Error Handling

- [x] A-014 R4: a stream re-open (`onOpened`) before the first post-switch chunk discards the pending clear and the deferred reset runs instead
- [x] A-015 R2: the first-mount guard prevents a duplicate `onFocusedKindChange` report and a redundant zoom re-derivation on mount
- [x] A-016 R6: a switch whose POST never resolves and whose SSE confirmation arrives early shows the mask at 300 ms and has it torn down by the 5 s rescue

### Code Quality

- [x] A-017 Pattern consistency: new code follows the surrounding pure-module + ref-flag patterns (`consumePendingReset`, `switchEpoch`) and the existing test-block structure
- [x] A-018 No unnecessary duplication: the clear reuses the reset's seam placement; the byte flag reuses the epoch discipline rather than a parallel state machine
- [x] A-019 Type narrowing over assertions: no new `as` casts in touched frontend code
- [x] A-020 Tests accompany every behavior change (unit for R2–R5, e2e for the user-visible switch)
- [x] A-021 Comment discipline: rewritten comments state constraints and cross-file contracts, never narrate history or cite change IDs / PR numbers
- [x] A-022 No client polling introduced outside the e2e assertion loop; no changes to the SSE/relay transport
- [x] A-023 Every touched Playwright `test()` carries the Proves/Steps JSDoc block per the constitution

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. The `pendingReset`/`consumePendingReset` machinery still owns every (re)open path (the ride's `pendingClearRef`/`consumePendingClear` is additive alongside it, not a replacement); the non-tty tiles keep their per-window remount via their own keys, so no remount bookkeeping became dead; every new export (`hasCountedIncomingBytes`, `forceSwitchArrived`) has call sites in `app.tsx` and the colocated unit tests.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The per-window reset lives in one effect with a `prevWindowRef` first-mount guard rather than N separate effects | One seam is easier to review and keeps ordering explicit; the ratios effect stays separate because it also keys on `layout.shape` | S:75 R:85 A:85 D:70 |
| 2 | Confident | The find-state reset clears decorations but does not grab focus | Focus grab is the user-close affordance; a switch should leave focus where the shell's focus-restore logic puts it | S:70 R:90 A:80 D:75 |
| 3 | Confident | The app-level "no remount" test may spy on the tty tile DOM node rather than an internal mount counter | Avoids adding test-only instrumentation to production code | S:65 R:90 A:80 D:70 |
| 4 | Confident | The per-window reset effect is declared after the focused-kind reporting effect so the reset's slot-A re-report lands last within the switch commit | Effect order within a commit is declaration order; the reporting effect could otherwise fire a transient stale-slot kind after the reset's report | S:70 R:85 A:80 D:65 |
| 5 | Confident | T008's harness renders `ServerShell` under a memory router with a mount-spying `SurfaceLayout` stub, `StandaloneSessionContextProvider`, and `importOriginal`-spread API mocks | No app-level route harness with a state-socket mock existed; stubbing the grid child isolates the `key={server}` seam (tty-DOM survival is covered by T007, the real e2e by T009) | S:70 R:85 A:75 D:65 |
| 6 | Confident | The e2e never-empty assertion samples the xterm buffer via the `window.__rkTerminals` test registry (~50ms poll) with a two-consecutive-blank tolerance, not DOM text | The WebGL renderer paints no DOM text layer to sample, and `clear()` → parse of the first post-switch chunk spans one macrotask in which the buffer can read blank once; two consecutive blank samples is the signal that would be a real flicker frame | S:70 R:80 A:80 D:65 |
| 7 | Certain | The `__rkTerminals` test registry re-keys to the new windowId on a ride (existing `[terminalReady, windowId]` effect), so `markerVisible(page, idB, …)` reads the persisted terminal after the switch | The effect's comment already documents the re-key-on-switch behavior; verified by tsc + the e2e run | S:90 R:85 A:85 D:90 |

7 assumptions (1 certain, 6 confident, 0 tentative).
