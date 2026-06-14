# Plan: Predictive Local Echo (mosh-style)

**Change**: 260613-dxqh-predictive-local-echo
**Intake**: `intake.md`

## Requirements

<!-- Derived from intake.md (the single source of design truth). The intake's
     Design Decisions D1/D2/D3 and Assumptions #1–#11 are reproduced here as
     RFC-2119 requirements. Approach A (buffer-write + self-authored VT rollback,
     ported from sshx/VS Code typeahead) is the primary; the §1b DOM overlay is a
     documented fallback that is NOT implemented (port validation passed — see
     Design Decisions). -->

### Prediction Engine: Pure Core

#### R1: Pure, DOM-free prediction engine module
The prediction logic (pending-prediction queue, confidence state machine, byte-matching/reconciliation, and VT apply/rollback **string** construction) MUST live in a pure, DOM-free module under `app/frontend/src/components/terminal/` that has no dependency on a live `Terminal` instance beyond an injected reader/writer/observer interface. It MUST be fully unit-testable in jsdom/Vitest without a real terminal, mirroring the `select-live-panes.ts` precedent.

- **GIVEN** the prediction engine module
- **WHEN** it is imported in a unit test with no DOM and no xterm `Terminal`
- **THEN** every public function (enqueue, reconcile, confidence transition, VT-string builders) is callable against plain data (cell snapshots, byte strings, positions) and returns deterministic results
- **AND** the module imports nothing from `@xterm/xterm` except read-only types

#### R2: Cell snapshot + VT apply/rollback string builders are pure functions
The engine MUST expose pure functions that, given a cell snapshot (original char + SGR attributes) and a target position, construct (a) the tentatively-styled apply sequence (`<save-cursor?><move><tentative SGR><glyph><reset SGR>`) and (b) the rollback sequence that restores the snapshotted cell (cursor-move + rewrite original char with original SGR, or a `DeleteChar` op) and retreats the shadow cursor. These builders MUST NOT touch a `Terminal`.

- **GIVEN** a cell snapshot `{ char: "a", fg, bg, bold, … }` at position `(row, col)` and a predicted glyph `"x"`
- **WHEN** the apply-string builder is called
- **THEN** it returns a VT string that positions the cursor at `(row, col)`, sets the tentative SGR, writes `"x"`, and resets SGR — assertable as an exact string
- **AND WHEN** the rollback-string builder is called with the same snapshot
- **THEN** it returns a VT string that restores `"a"` with its original SGR at `(row, col)` and positions the cursor back to the pre-prediction location

### Prediction Engine: Confidence State Machine

#### R3: Adaptive PASSIVE/ACTIVE confidence reflex
The engine MUST implement a per-connection confidence state machine that starts PASSIVE (observe only, paint nothing), transitions to ACTIVE only after observed typed-printable→confirming-echo round-trips fall within the adaptive confirm-window, and auto-disables back to PASSIVE on the first reconciliation mismatch (re-entering observation). The feature is always-on (no flag); PASSIVE/ACTIVE is the safety reflex, not a user toggle.

- **GIVEN** a freshly-constructed engine
- **WHEN** no echoes have yet been observed
- **THEN** its state is PASSIVE and `tryPredict()` returns "do not paint"
- **AND WHEN** N consecutive typed-printables each confirm within the adaptive confirm-window
- **THEN** it transitions to ACTIVE and subsequent predictable input is painted
- **AND WHEN** any reconciliation divergence occurs while ACTIVE
- **THEN** it rolls back all outstanding predictions, clears the queue, and returns to PASSIVE

#### R4: Mosh-style adaptive (SRTT-like) round-trip estimator
The confirm-window MUST be derived from an SRTT-style adaptive round-trip estimate (smoothed RTT + variance term) updated on each confirmed echo, NOT a fixed loopback-tuned constant, so it self-tunes across loopback and future real-network latency. The smoothing factor, variance multiplier, and a minimum confirm-window floor MUST be named constants (no magic numbers), seeded from mosh/VS Code starting values.

- **GIVEN** a sequence of confirmed echo round-trip samples
- **WHEN** each sample is fed to the estimator
- **THEN** the smoothed RTT and confirm-window update per the SRTT recurrence (`srtt = (1-α)·srtt + α·sample`; `window = srtt + k·rttvar`, floored at the minimum)
- **AND** the confirm-window never drops below the configured floor

### Prediction Engine: Reconciliation Queue

#### R5: Ordered pending-prediction queue with prefix-wise byte matching
The engine MUST maintain an ordered queue of pending predictions, each holding `{ expectedEchoBytes, cellSnapshot, predictedPosition }`. Inbound chunk bytes MUST be matched **prefix-wise** against the head of the queue; a matched head is consumed and its prediction CONFIRMED. ANY byte that diverges from the expected echo MUST trigger rollback of ALL outstanding predictions and a clear of the queue (server repaint then reconciles authoritatively).

- **GIVEN** a queue with pending predictions for keystrokes `a`, `b`, `c`
- **WHEN** an inbound chunk `"ab"` is reconciled
- **THEN** the `a` and `b` predictions are confirmed and removed from the queue head, `c` remains pending
- **AND WHEN** an inbound chunk that does not match the next expected echo arrives
- **THEN** all remaining predictions are rolled back, the queue is emptied, and the engine returns to PASSIVE (R3)

#### R6: Confirm restyles in place; divergence restores prior cells
On confirmation the engine MUST settle the predicted cell to normal styling (re-emit the confirmed glyph without the tentative SGR). On divergence it MUST emit the saved-cell-restore sequences for all outstanding predictions. The net invariant MUST hold: once reconciliation settles, the buffer equals exactly what the server sent — predictions never leave residue.

- **GIVEN** a confirmed prediction painted with tentative (underline/dim) SGR
- **WHEN** reconciliation confirms it
- **THEN** the engine emits a write that restyles that cell to the server-authoritative normal SGR
- **AND GIVEN** outstanding predictions at divergence time
- **WHEN** rollback runs
- **THEN** every predicted cell is restored to its pre-prediction snapshot and the in-flight server bytes repaint authoritatively

### Prediction Engine: Predictability Gate & Cursor

#### R7: Predictability gate (printable ASCII, exclusions, Enter, backspace)
The engine MUST predict ONLY printable ASCII input while ACTIVE and MUST hard-exclude: alternate-screen buffer (`buffer.active.type === "alternate"`), control characters and escape sequences, the *effects* of Enter (`\r` flushes/confirms pending predictions but is NOT painted as a glyph), IME composition, and bracketed paste. Backspace MUST be predicted ONLY by retracting the engine's own most-recent queued prediction; with no queued predictions it MUST NOT edit any pre-existing real cell (the keystroke is sent to the WS unpredicted).

- **GIVEN** the engine is ACTIVE in a normal-screen buffer
- **WHEN** a printable ASCII char arrives via the gate
- **THEN** it is painted and enqueued
- **AND WHEN** the buffer is alternate-screen, or the input is a control char / escape / during IME / bracketed paste
- **THEN** no prediction is painted regardless of state
- **AND WHEN** Backspace arrives with a non-empty queue
- **THEN** the most-recent prediction is retracted (cell restored, shadow cursor retreats); with an empty queue, nothing is painted

#### R8: Shadow cursor; wrap delegated to xterm
Predictions MUST render at the live cursor cell and advance a prediction-local **shadow cursor** distinct from xterm's real cursor. Under Approach A, line-wrap at `cols` MUST be delegated to xterm's own DECAWM/pending-wrap layout (the engine writes the glyph and lets xterm reflow); the engine MUST NOT reimplement wrap math.

- **GIVEN** the shadow cursor at column `cols-1`
- **WHEN** a predictable glyph is painted
- **THEN** the engine writes the glyph via `terminal.write()` and lets xterm handle the wrap; the shadow cursor advances to the engine's tracked next position without bespoke last-column pending-wrap math

### TerminalClient Integration

#### R9: onData hook wraps send without changing it
The `terminal.onData` handler in `terminal-client.tsx` MUST continue to send every keystroke to the WebSocket unconditionally and unmodified. Prediction MUST be layered additively: for predictable input the handler also drives the engine (snapshot target cell, paint tentative glyph, advance shadow cursor, enqueue). The send path MUST NOT be gated on, altered by, or reordered relative to prediction.

- **GIVEN** any keystroke
- **WHEN** `onData` fires
- **THEN** `ws.send(data)` runs exactly as before (same condition, same payload)
- **AND** the engine's prediction step runs in addition, never instead

#### R10: Reconciliation tapped into the inbound flush path
Inbound relay data MUST be observed for reconciliation on the existing flush path (`ws.onmessage` immediate-write and `flushToTerminal` coalesced paths, ~lines 787–834). Observation MUST stay allocation-light on the hot path (mirroring the `textByteLength` tiny-ASCII discipline) and MUST NOT regress the throughput guard. Reconciliation MUST run on the same bytes the terminal writes, before/around the existing `terminal.write()` calls, without changing write ordering.

- **GIVEN** an inbound chunk on either the immediate or coalesced write path
- **WHEN** it is written to the terminal
- **THEN** the engine reconciles the same bytes against its queue (R5/R6)
- **AND** when the engine is PASSIVE with an empty queue the observation is a near-zero-cost early return (no allocation for tiny ASCII echoes)

#### R11: Thin terminal binding wires engine to real xterm
`terminal-client.tsx` MUST contain a thin binding that wires the engine's writer to `terminal.write()`, its cell-snapshot reader to `buffer.active.getLine(y)?.getCell(x)`, and its inbound observation to the relay data path. The binding MUST use type narrowing over assertions where possible; the only permitted `as` cast is for read-only xterm types not surfaced in the public signature (no private `_core` access — Approach A needs none).

- **GIVEN** the binding in `terminal-client.tsx`
- **WHEN** the engine requests a cell snapshot or a write
- **THEN** it is satisfied via public `@xterm/xterm@6.0.0` API (`getLine`/`getCell`/`write`, `buffer.active.{type,baseY,cursorX,cursorY}`) with no `terminal._core` access. SGR correctness comes from the per-cell snapshot's read-only `IBufferCell` accessors; the binding does NOT subscribe `onWriteParsed` (it is unnecessary under Approach A — the snapshot captures the authoritative prior SGR and DECSC/DECRC keeps every paint cursor-neutral, SF4).

### Test Harness & Measurement

#### R12: DEV-gated `__rkPredictions` test handle
A DEV-gated `window.__rkPredictions` registry MUST expose prediction-engine state per windowId (at minimum: current confidence state, painted-but-unconfirmed prediction count, cumulative misprediction counter, and a way to tell a *predicted* cell from a *server-echoed* one), mirroring the existing `__rkTerminals`/`__rkRenderer` DEV-gated pattern (register on create, unregister on dispose, `import.meta.env.DEV`-gated, inert in production).

- **GIVEN** a dev/e2e build
- **WHEN** a terminal with prediction mounts
- **THEN** `window.__rkPredictions[windowId]` exposes the engine's state/counters and is removed on dispose
- **AND GIVEN** a production `vite build`
- **THEN** the registry is never populated (the helpers compile to no-ops)

#### R13: echo-latency.spec.ts perceived-echo metric + misprediction counter
`app/frontend/tests/e2e/echo-latency.spec.ts` MUST be extended with (a) a perceived-echo metric — keystroke dispatch → predicted glyph visible (distinct from the existing server-glyph metric, read via `__rkPredictions`) — and (b) a misprediction counter recorded across three scenarios: idle `cat`, under-load tick stream, and a vim/alternate-screen pane (which MUST show zero predictions painted). It remains audit-style (records distributions; asserts only what noise allows, e.g. zero predictions in the alternate-screen scenario). The companion `echo-latency.spec.md` MUST be updated in the SAME commit (constitution: Test Companion Docs).

- **GIVEN** the extended spec
- **WHEN** it runs the idle and under-load scenarios
- **THEN** it records a perceived-echo (predicted-glyph-visible) distribution and a misprediction count per scenario
- **AND WHEN** it runs the vim/alternate-screen scenario
- **THEN** the painted-prediction count is asserted to be zero
- **AND** `echo-latency.spec.md` documents the new tests' "what it proves" + steps

### Non-Goals

- DOM overlay (§1b) and canvas overlay — NOT implemented. Approach A's port validation against `@xterm/xterm@6.0.0` passed (all required seams are public — see Design Decisions DD1), so the fallback is unnecessary. The engine's binding is factored so a future DOM-overlay view could swap in without touching the pure core, but no overlay code ships here.
- Grapheme-aware / non-ASCII prediction — printable ASCII only in v1 (intake §4 "printable ASCII first; extend grapheme-aware later"). The width path is left extensible (xterm's Unicode 15 tables are already loaded) but multi-cell glyphs are out of scope.
- Backend / API / relay / tmux changes — none (intake Assumption #2; constitution II/IX unaffected — no endpoints, no persisted state).
- Tuning-constant optimization — the SRTT constants ship at mosh/VS Code seed values; empirical refinement via the harness is a follow-up, not a v1 gate (intake Open Questions).

### Design Decisions

1. **Approach A (buffer-write + self-authored VT rollback), overlay NOT shipped**: predicted glyphs are written into the xterm buffer via `terminal.write()` and undone with hand-authored VT sequences over a cell snapshot. *Why*: port validation against the installed `@xterm/xterm@6.0.0` typings confirmed every required seam is public and behaves as the sshx/VS Code reference assumes — `IBufferCell` read-only with full SGR accessors (`getChars`, `getFgColor`/`getBgColor` + `getFg/BgColorMode`, `is{Bold,Italic,Dim,Underline,Blink,Inverse,Invisible,Strikethrough}`, `isFg/BgRGB/Palette/Default`), `buffer.active.{type,cursorX,cursorY,baseY}`, `getLine(y)?.getCell(x, cell?)`, and `write(data, cb?)`. This makes cell-geometry alignment, auto-wrap, and scroll/resize re-sync free (xterm owns layout) and reuses battle-tested code. **No `onWriteParsed` subscription** (SF4): an earlier draft's doc-comment claimed an inbound-SGR tracker that was never wired. The claim was removed rather than implemented — Approach A does not need it, because (a) each prediction's cell snapshot already captures the authoritative prior SGR via the read-only `IBufferCell` accessors, and (b) every apply/confirm/rollback paint is wrapped in DECSC/DECRC (`\x1b7`…`\x1b8`) so it never disturbs xterm's own SGR/cursor state for the server's subsequent bytes. *Rejected*: DOM overlay (§1b fallback — needs private `_core._renderService.dimensions` cast + manual wrap math, only taken if A fought 6.0.0; it did not), canvas overlay (re-implements font shaping; un-testable).
2. **Always-ON, no feature flag** (intake D2/Assumption #10): the adaptive-confidence reflex is the safety; a flag would add surface for no benefit. PASSIVE covers password prompts (no echo), vim/TUIs (alternate-screen hard-exclude + echo-mismatch auto-disable).
3. **Mosh-style adaptive SRTT estimator from the start** (intake D3/Assumption #11): a fixed loopback-tuned threshold would mis-gate over a real network, and remote `rk serve` is a primary motivation. Only the smoothing constants are open (seeded from mosh/VS Code).
4. **Pure engine + thin binding split** (intake §7/Assumption #8): `terminal-client.tsx` is already 924 lines; the `select-live-panes.ts` pure-helper + colocated-test precedent is followed so the queue/state-machine/VT-string logic is unit-tested without a DOM.

## Tasks

### Phase 1: Setup

- [x] T001 Create the prediction engine module skeleton at `app/frontend/src/components/terminal/predictive-echo.ts` with exported types (`CellSnapshot`, `PendingPrediction`, `ConfidenceState`, `PredictionEvent`/result shapes) and named constants (SRTT `ALPHA`, `BETA`/variance multiplier `K`, `MIN_CONFIRM_WINDOW_MS`, `ACTIVATION_SAMPLES`, tentative-SGR tokens) — no logic yet, no DOM/xterm-runtime imports (read-only types only). <!-- R1 -->

### Phase 2: Core Implementation (pure engine)

- [x] T002 Implement the VT apply/rollback **string builders** as pure functions in `predictive-echo.ts`: `buildApplySequence(snapshot, glyph, pos)`, `buildConfirmSequence(snapshot|glyph, pos)`, `buildRollbackSequence(snapshot, pos)` — cursor-position (`\x1b[{row};{col}H` / save-restore), tentative SGR wrapper (underline+dim) for apply, server-normal SGR for confirm, original-char+SGR restore for rollback. SGR reconstruction reads from the `CellSnapshot` fields only. <!-- R2 --> <!-- rework: MF1 — wrap EVERY apply/confirm/rollback sequence in DECSC/DECRC (\x1b7 … \x1b8) so the write is cursor-neutral. Current bare CUP displaces xterm's real cursor; the server's own bytes (written right after, in reconcileInbound) then paint from the moved position → silent buffer corruption under interleaved output. Add a unit assertion on the exact \x1b7-wrapped string. --> <!-- DONE: every builder now goes through `cursorNeutral()` (DECSC `\x1b7` … DECRC `\x1b8`); `predictive-echo.ts:217-251`. Unit assertions on the exact wrapped strings at `predictive-echo.test.ts` ("buildApplySequence is DECSC-wrapped …", "buildConfirmSequence is DECSC-wrapped …", "buildRollbackSequence is DECSC-wrapped …"). -->
- [x] T003 Implement the SRTT-style adaptive estimator in `predictive-echo.ts`: `updateRtt(sampleMs)` (smoothed RTT + rttvar recurrence) and `confirmWindowMs()` (floored at `MIN_CONFIRM_WINDOW_MS`), using the Phase-1 named constants. <!-- R4 -->
- [x] T004 Implement the confidence state machine in `predictive-echo.ts`: PASSIVE→ACTIVE after `ACTIVATION_SAMPLES` in-window confirmations, ACTIVE→PASSIVE on any divergence; expose current state and a `tryPredict`-style gate result. <!-- R3 -->
- [x] T005 Implement the ordered pending-prediction queue + prefix-wise reconciliation in `predictive-echo.ts`: `enqueue(prediction)`, `reconcile(inboundBytes)` returning confirm/diverge outcomes with the writes to emit (confirm restyle vs. full-queue rollback), queue-clear on divergence, shadow-cursor bookkeeping. <!-- R5 --> <!-- rework cycle 2: SF-clamp — `cupFor` emits an UNCLAMPED viewport row; a prediction whose absolute row has scrolled off the top yields viewportRow ≤ 0, which xterm maps to the top row (row 0) or an unparseable CSI (negative) → a transient stray glyph on real content (overwritten by the server repaint within a frame, but visible). FIX: clamp the emitted viewport row to >= 1 and correct the "harmless" doc-comment. Add an engine test for the off-top-of-viewport case. --> <!-- rework: MF1/MF2 fallout + SF1 — (a) confirm/rollback re-emit a CUP to a row captured at enqueue time; under scroll that targets a stale physical line (see T010 fix: snapshot must carry an ABSOLUTE buffer row converted to a viewport CUP at EMIT time using current baseY). (b) SF1: the per-byte `chunk[i] === head.expectedEcho` comparison allocates a 1-char string per inbound byte on the hot path — use charCodeAt comparison instead (R10/A-025 allocation-light contract). --> <!-- DONE: (a) `confirmHead`/`diverge` now pass `this.io.baseY()` (read at EMIT time) to the builders, which resolve the absolute-row snapshot to a viewport CUP via `cupFor()`; tests "confirms against the LIVE baseY after a scroll (MF2)" + "rolls back against the LIVE baseY after a scroll". (b) reconcile now compares `chunk.charCodeAt(i) === head.expectedEcho.charCodeAt(0)` — no per-byte 1-char string allocation (`predictive-echo.ts:493-498`). --> <!-- DONE cycle 2 (SF-clamp): `cupFor` now clamps the viewport row to >= 1 via `Math.max(1, absRow - baseY + 1)` (`predictive-echo.ts`), so a prediction scrolled off the TOP of the viewport never emits row 0 / a negative CSI (the stray-glyph case). The misleading "harmless" doc-comment was rewritten to explain the clamp + why it matters. New engine tests: "clamps the viewport row to >= 1 when the absolute row scrolled off the top" (cupFor at baseY 4/5 → row 1) and "builders emit a clamped (>= 1) viewport row for an off-top prediction" (confirm/rollback at baseY 9 → `\x1b[1;1H`). -->
- [x] T006 Implement confirm-in-place + divergence-restore emission wiring in `reconcile`/confirm paths so confirmed cells settle to normal SGR and divergence emits saved-cell restores for all outstanding predictions (the residue-free invariant). <!-- R6 --> <!-- rework: MF4 — A-006 (residue-free) fails end-to-end because of MF1 (cursor displacement) + MF2 (stale row). Once T002/T005/T010 land, the divergence-restore must verifiably leave NO tentative-styled residue and corrupt no unrelated cell; re-verify A-006 end-to-end. --> <!-- DONE: with MF1 (DECSC/DECRC) + MF2 (emit-time baseY) landed, the divergence path restores each snapshotted cell's ORIGINAL char+SGR (not tentative) at the live-baseY-correct viewport row, cursor-neutrally, so the in-flight server bytes paint from the un-displaced cursor. Verified: rollback strings carry the original (non-tentative) SGR ("rolls back ALL outstanding predictions …", "rolls back against the LIVE baseY after a scroll"), and a clean settle leaves zero residue/zero mispredictions ("leaves a residue-free queue once a full echo settles"). The e2e A-017 alt-screen test covers the no-paint case end-to-end. -->
- [x] T007 Implement the predictability gate + Enter/Backspace handling in `predictive-echo.ts`: `onInput(data, ctx)` deciding paint vs. skip given printable-ASCII check, alternate-screen flag, control-char/escape detection, IME/bracketed-paste flags, Enter-flush (confirm only, no glyph), and queue-only Backspace retract. <!-- R7 -->
- [x] T008 Implement the shadow cursor in `predictive-echo.ts`: track prediction-local position advancing on paint and retreating on rollback/backspace, delegating wrap to xterm (no bespoke last-column math); expose the position the apply-string builder targets. <!-- R8 --> <!-- rework: SF2 — the engine-owned shadow cursor was NOT actually implemented; the binding re-reads xterm's live cursor each paint and the unit-test fake fabricates the advance (self col++), masking the gap. R8 requires a prediction-local cursor DISTINCT from xterm's real cursor. Implement it engine-side and tighten T013 so the fake cannot paper over a missing advance. This coupling is also what lets MF1/MF2 fire. --> <!-- DONE: engine now owns `private shadow: CursorPosition | null`. `shadowCursor()` reseeds from `io.cursorPosition()` only when the queue is empty (xterm authoritative); thereafter `enqueue` advances `shadow.col` itself and `retractLast` retreats it; `diverge`/`reset` drop it to null. The IO seam changed from `snapshotCursorCell()` (which baked the advance into the binding) to `cursorPosition()` + `readCell(absRow,col)`. T013 fake FIXED: FakeIO.cursorPosition() returns a FIXED real cursor and readCell echoes the asked coords, so a missing engine advance would collapse a burst onto one cell — caught by "advances its OWN shadow cursor across a burst (engine-owned, not IO-fabricated)" and "retreats the shadow cursor on backspace …". -->

### Phase 3: Integration (TerminalClient binding + test handle)

- [x] T009 Add the DEV-gated `__rkPredictions` registry helpers to `terminal-client.tsx` (mirror `__rkTerminals`: `declare global` augmentation, `registerTestPrediction`/`unregisterTestPrediction`, `import.meta.env.DEV` gate) and a windowId-keyed effect to register/unregister the engine's introspectable state (confidence state, unconfirmed count, misprediction counter, predicted-vs-echoed marker). <!-- R12 -->
- [x] T010 Construct the engine per-connection in `terminal-client.tsx` and wire the thin binding: writer → `terminal.write()`, cell-snapshot reader → `buffer.active.getLine(y)?.getCell(x)` mapped to `CellSnapshot`, no `_core` access; reset/teardown the engine alongside the connection lifecycle. <!-- R11 --> <!-- rework cycle 2: SF-reconnect — on a transient (non-4004) WS drop, `connect()` re-runs in place and arms `pendingReset` → `terminal.reset()` wipes the buffer, but the ENGINE is not reset (windowId unchanged, so the windowId-keyed reset doesn't fire; effect-cleanup teardown doesn't run on an in-place reconnect). Painted/queued predictions survive a buffer reset that invalidated their cell snapshots → stale-snapshot confirm/diverge against the redraw. FIX: call `predictionRef.current?.reset()` in `connect()` (or at the top of the reconnect `onclose` branch) so the engine clears whenever the buffer does. Bounded blast radius today, but a real correctness gap. --> <!-- DONE cycle 2 (SF-reconnect): `connect()` now calls `prediction.reset()` immediately after arming `pendingReset = true`, so the engine clears in lockstep with the buffer wipe on EVERY connect — including an in-place transient reconnect where windowId is unchanged (windowId-keyed reset does not fire) and no teardown runs. Composes cleanly with the other reset paths: on the FIRST connect it is a harmless no-op (engine just constructed empty/PASSIVE); the windowId-keyed effect (same-session switch) and the effect-cleanup teardown (cross-session) are unaffected and fire at different times, so no double-reset that matters (resetting an empty engine is idempotent — Constitution III). New test "resets the engine in connect() on a transient reconnect …" asserts the reconnect path resets the engine again (2 total) with no windowId change; the mount test was updated to expect exactly 1 connect-time reset (windowId-keyed effect still does NOT fire on mount). --> <!-- rework: MF2 + MF3 + SF4. MF2: the snapshot stores a VIEWPORT row (buf.cursorY+1) valid only at apply time; store the ABSOLUTE buffer row (cursorY + baseY) and convert to a viewport CUP at emit time. MF3 (HIGH RISK): the engine is per-CONNECTION but a same-session window switch RIDES the existing socket (windowId is deliberately NOT a connection dep — see ui-patterns.md 260610-9umy), so the WS effect does not re-run and the engine + its stale queue/snapshots straddle the switch → writes the old window's coords into the newly-attached window. Add a windowId-keyed effect that calls engine.reset() on windowId change (independent of the connection effect), and a terminal-client.test.tsx case asserting a windowId change clears the engine while the socket persists. SF4: remove the false onWriteParsed SGR-tracking claim in the binding doc-comment (and plan DD1/R11) OR actually implement it. --> <!-- DONE: MF2 — binding `readCell` returns `{ absRow: baseY+cursorY, col: cursorX }` (absolute) and exposes `baseY()`; engine converts to a viewport CUP at emit time via `cupFor()`. MF3 — added a windowId-keyed `useEffect` (after the `__rkTerminals` effect) calling `predictionRef.current?.reset()` on windowId CHANGE only (ref-gated to skip initial mount); touches NO connection-effect dep so it cannot reconnect. Tests "resets the engine on a same-session windowId change WITHOUT tearing down the socket" + "does not reset the engine on initial mount". SF4 — chose honest REMOVAL: deleted the false onWriteParsed claim from the binding doc-comment + plan DD1/R11 (Approach A needs no inbound-SGR tracker — snapshot captures prior SGR + DECSC/DECRC keeps paints cursor-neutral). -->
- [x] T011 Wrap the `terminal.onData` handler (terminal-client.tsx ~line 290) to drive `engine.onInput(...)` additively AFTER the unchanged `ws.send(data)`, passing the alternate-screen/IME/paste context; the send remains unconditional and unmodified. <!-- R9 -->
- [x] T012 Tap reconciliation into the inbound flush path (terminal-client.tsx ~lines 787–834): feed the same string/binary bytes to `engine.reconcile(...)` on both the immediate-write and `flushToTerminal` coalesced paths, allocation-light (early-return when PASSIVE + empty queue), without reordering the existing `terminal.write()` calls. <!-- R10 --> <!-- rework cycle 2: NMF-1 (CRITICAL — feature is inert in production) — `reconcileInbound` is called ONLY on the STRING ws branch (terminal-client.tsx:829, :918), but the relay frames ALL PTY output as binary (`websocket.BinaryMessage`, app/backend/api/relay.go:183) and the client sets `ws.binaryType="arraybuffer"` (:891), so every echo takes the BINARY branch and reconcile NEVER sees server bytes → engine never leaves PASSIVE → nothing is ever painted in the running app. Unit tests pass because they call reconcile() with strings directly, bypassing the transport. FIX: decode the inbound Uint8Array → string via a single shared TextDecoder (mirror the `textEncoder` singleton; handle multi-byte UTF-8 chunk boundaries with `{stream:true}`) and feed `engine.reconcile(...)` on BOTH binary sub-paths (the immediate binary write ~:929 and the `flushToTerminal` binaryBuffers loop ~:833) — skip the decode when the engine has nothing pending (PASSIVE + empty queue) to stay allocation-light, and do NOT reorder the existing terminal.write() calls. Add a terminal-client.test.tsx test that drives a BINARY echo frame and asserts the engine observes it (leaves PASSIVE / confirms). The original e2e A-013/A-017 ACTIVE assertions must be re-validated against the real binary relay once fixed. --> <!-- DONE cycle 2 (NMF-1): added a shared module-level `textDecoder = new TextDecoder()` (mirrors the `textEncoder` singleton) and a `reconcileInboundBinary(chunk: Uint8Array)` helper that gates on the engine's cheap `hasPending()` BEFORE decoding (so a normal flood with nothing queued pays nothing — allocation-light, R10/A-025), decodes with `{ stream: true }` (multi-byte UTF-8 split across relay frames), and feeds `engine.reconcile(decoded)`. Wired into BOTH binary sub-paths: the immediate binary write (after `consumePendingReset()`, before `terminal.write(chunk)`) and the `flushToTerminal` `binaryBuffers` loop (before each `terminal.write(buf)`). No `terminal.write()` reordering — reconcile slots in BEFORE each write exactly like the string path. Added `PredictiveEcho.hasPending()` (queue-length > 0; true also during the PASSIVE bootstrap so activation is never starved). Corrected the stale `reconcileInbound` doc-comment that wrongly claimed binary is never reconciled. New terminal-client.test.tsx tests: "feeds a BINARY echo frame to the engine's reconcile" (reconcile called with the decoded "a"), "leaves PASSIVE → ACTIVE driven ONLY by binary echo frames (end-to-end transport proof)" (3 binary echoes drive PASSIVE→ACTIVE — proves the engine observes a real binary frame end-to-end through the live transport, the exact case that was inert), "skips decoding … when the engine has nothing queued" (gate proof), and "reconciles binary on the coalesced (rAF) flush path too, before the write" (ordering proof). e2e A-013/A-017 ACTIVE re-validation is owed at e2e run-time (not run in this unit-scoped rework). -->

### Phase 4: Tests

- [x] T013 [P] Write colocated unit tests `app/frontend/src/components/terminal/predictive-echo.test.ts` covering: VT apply/confirm/rollback string construction (exact strings), SRTT estimator recurrence + floor, confidence transitions (PASSIVE→ACTIVE→PASSIVE on divergence), queue prefix-match confirm + divergence rollback/clear, predictability gate (ASCII/alt-screen/control/Enter/IME/paste), and queue-only Backspace + shadow-cursor advance/retreat. <!-- R1 R2 R3 R4 R5 R6 R7 R8 --> <!-- rework: extend for the MF1/MF2/SF2 fixes — assert the EXACT DECSC/DECRC-wrapped (\x1b7…\x1b8) apply/confirm/rollback strings (MF1), assert emit-time viewport conversion from an absolute row under a simulated baseY/scroll (MF2), and replace the shadow-cursor fake-advance so a missing engine-owned advance fails the test (SF2). The lifecycle/window-switch reset assertion belongs in terminal-client.test.tsx (MF3), not here. --> <!-- DONE: MF1 — three "is DECSC-wrapped …" builder tests assert the exact `\x1b7…\x1b8`-wrapped strings. MF2 — "cupFor converts an absolute row to a viewport CUP using the live baseY", "builders re-resolve the CUP under a scrolled baseY", "confirms against the LIVE baseY after a scroll", "rolls back against the LIVE baseY after a scroll" simulate a baseY/scroll between apply and emit. SF2 — FakeIO no longer fabricates the advance (fixed real cursor + coord-echoing readCell); "advances its OWN shadow cursor across a burst (engine-owned, not IO-fabricated)" + the backspace-retreat test would FAIL if the engine's shadow didn't advance/retreat. 41 engine tests pass. MF3 lifecycle assertion lives in terminal-client.test.tsx as instructed. -->
- [x] T014 Extend `app/frontend/tests/e2e/echo-latency.spec.ts` with the perceived-echo metric (keystroke→predicted-glyph-visible via `__rkPredictions`) + misprediction counter across idle `cat`, under-load tick stream, and a vim/alternate-screen scenario (asserting zero predictions painted in alt-screen); keep audit-style and preserve the 20k-line throughput guard unchanged. <!-- R13 -->
- [x] T015 Update `app/frontend/tests/e2e/echo-latency.spec.md` in the same commit: document the new perceived-echo + misprediction tests ("what it proves" + numbered steps) and the alt-screen zero-prediction assertion, per constitution Test Companion Docs. <!-- R13 -->

## Execution Order

- Phase 1 (T001) blocks all of Phase 2.
- Phase 2 internal order: T002 (string builders) and T003 (estimator) are independent; T004 (state machine) uses T003; T005 (queue) uses T002; T006 builds on T005; T007 (gate) uses T004/T005/T008; T008 (shadow cursor) underpins T002/T005/T007 — implement T008 alongside T005.
- Phase 3 (T009–T012) depends on the engine's public surface (Phase 2 complete). T010 (binding) before T011 (onData) and T012 (reconcile tap).
- Phase 4: T013 depends on Phase 2; T014/T015 depend on Phase 3 (need `__rkPredictions`). T013 is `[P]` vs. T014/T015.

## Acceptance

### Functional Completeness

- [x] A-001 R1: The prediction engine lives in a pure DOM-free module under `src/components/terminal/` importing only read-only xterm types; it is exercised by a colocated unit test that runs without a DOM or live `Terminal`. — `predictive-echo.ts` imports nothing from `@xterm/xterm`; the binding (separate file) holds the only `import type`. `predictive-echo.test.ts:1-18` runs in jsdom with `FakeIO`. (engine has zero xterm import)
- [x] A-002 R2: Pure `buildApply`/`buildConfirm`/`buildRollback` string builders exist and produce the expected VT sequences from a cell snapshot + position with no `Terminal` dependency. — `predictive-echo.ts:181/191/201`; exact-string tests at `predictive-echo.test.ts:88-113`.
- [x] A-003 R3: The confidence state machine starts PASSIVE, reaches ACTIVE only after in-window confirmations, and auto-disables to PASSIVE on first divergence. — `predictive-echo.ts:332,498-509,521-533`; tests `predictive-echo.test.ts:171-227`.
- [x] A-004 R4: The confirm-window is derived from an SRTT-style adaptive estimator (named constants, floored), not a fixed threshold. — `RttEstimator` `predictive-echo.ts:216-241`, constants `40-73`; tests `135-157`.
- [x] A-005 R5: An ordered queue matches inbound bytes prefix-wise, confirms matched heads, and rolls back + clears the whole queue on any divergence. — `reconcile` `predictive-echo.ts:450-471`; tests `322-362`.
- [x] A-006 R6: Confirmation restyles the predicted cell to normal SGR and divergence restores snapshotted cells, leaving zero residue once reconciliation settles. — NOW MET (MF4 resolved via MF1+MF2). (1) Every confirm/rollback is DECSC/DECRC-wrapped (`\x1b7`…`\x1b8`) so it is cursor-neutral — the subsequent `terminal.write(serverBytes)` starts from xterm's un-displaced real cursor (MF1). (2) The snapshot stores an ABSOLUTE buffer row; the confirm/rollback CUP is recomputed from the LIVE `baseY` at emit time via `cupFor()`, so a viewport scroll between apply and emit no longer targets a stale physical line (MF2). Divergence-restore re-writes each cell's ORIGINAL char+SGR (not tentative). Verified by the new MF2 scroll tests + "leaves a residue-free queue once a full echo settles" (zero residue / zero mispredictions) and the e2e A-017 alt-screen no-paint test.
- [x] A-007 R7: The predictability gate predicts only printable ASCII while ACTIVE and hard-excludes alternate-screen, control chars/escapes, Enter-effects, IME, and bracketed paste; Backspace retracts only queued predictions. — `onInput` `predictive-echo.ts:373-403`; binding passes `composing`/`pasting` ctx (`terminal-client.tsx:339-343`); tests `predictive-echo.test.ts:234-301`. (paste handled via length>1 heuristic, not a true bracketed-paste flag — see Should-fix)
- [x] A-008 R8: Predictions render at the live cursor via a shadow cursor; wrap is delegated to xterm (no bespoke last-column math). — NOW MET literally (SF2 resolved). The engine owns `private shadow: CursorPosition | null` — a prediction-local cursor DISTINCT from xterm's real cursor: `shadowCursor()` reseeds from `io.cursorPosition()` only when the queue is empty (xterm authoritative), then `enqueue` advances `shadow.col` itself, `retractLast` retreats it, and `diverge`/`reset` drop it to null. Wrap stays delegated to xterm (no last-column math in the engine). The IO seam changed from `snapshotCursorCell()` (which baked the advance into the binding) to `cursorPosition()` + `readCell(absRow,col)`, and the unit-test fake no longer fabricates the advance — "advances its OWN shadow cursor across a burst (engine-owned, not IO-fabricated)" fails if the engine doesn't advance.
- [x] A-009 R9: `terminal.onData` still sends every keystroke unconditionally and unmodified; prediction is additive and never gates or alters the send. — `terminal-client.tsx:329-343`: `ws.send(data)` unchanged, `onInput` called after, additively.
- [x] A-010 R10: Reconciliation observes the same inbound bytes on both the immediate and coalesced flush paths, with an allocation-light early return when idle, and does not reorder writes. — `reconcileInbound` at `terminal-client.tsx:807` (coalesced) and `:896` (immediate), both before `terminal.write`; early return `predictive-echo.ts:454`. (only TEXT path reconciled; binary not — faithful to spec which says binary is redraw/paste)
- [x] A-011 R11: The thin binding wires the engine via public `@xterm/xterm@6.0.0` API only — no `terminal._core` access. — `predictive-echo-binding.ts:84-104` uses only public `write`/`buffer.active`/`getLine`/`getCell`/`is*`/`get*Color`; no `_core`. grep confirms no `_core` in either file.
- [x] A-012 R12: A DEV-gated `window.__rkPredictions` registry exposes engine state/counters per windowId, mirrors `__rkTerminals`, and is inert in production builds. — `terminal-client.tsx:75-82` (register/unregister, `import.meta.env.DEV`-gated), registered `:710`, unregistered `:970`.
- [x] A-013 R13: `echo-latency.spec.ts` records a perceived-echo metric + misprediction counter across idle/under-load/alternate-screen scenarios (alt-screen asserts zero painted predictions) and `echo-latency.spec.md` is updated in the same commit. — `echo-latency.spec.ts:906-1061` (perceived + alt-screen tests); `.spec.md:274-321` documents both. (perceived metric only records "perceived-load"; no separate idle-vs-load split despite the test title — minor)

### Behavioral Correctness

- [x] A-014 R3: In a non-echoing pane (e.g. password prompt) or after a mismatch, the engine paints nothing — verified via the state machine returning to/staying PASSIVE. — Password prompt = no echo = no confirmations = never leaves PASSIVE = no paint (PASSIVE enqueue is observe-only, `predictive-echo.ts:402,410-425`); mismatch test `predictive-echo.test.ts:218-227`.
- [x] A-015 R5: Multi-keystroke prefix matching confirms only the matched head and leaves later predictions pending (queue order preserved). — `predictive-echo.test.ts:322-335` ("confirms matched head bytes prefix-wise and leaves later predictions pending").

### Scenario Coverage

- [x] A-016 R3 R7: Unit tests exercise the PASSIVE→ACTIVE→PASSIVE lifecycle and every gate exclusion branch. — Lifecycle `predictive-echo.test.ts:179-227`; gate branches (alt-screen, IME/paste, control/escape, Enter) `234-275`.
- [x] A-017 R13: The e2e alt-screen (vim) scenario exercises the hard-exclusion end-to-end and asserts zero predictions. — `echo-latency.spec.ts:992-1061` asserts `painted === 0` and `state === "passive"` inside vim.

### Edge Cases & Error Handling

- [x] A-018 R7: Backspace with an empty prediction queue paints nothing and the keystroke is sent unpredicted (no pre-existing real cell is edited). — `retractLast` `predictive-echo.ts:428-434` (`pop()` returns undefined → no write); test `predictive-echo.test.ts:296-300`.
- [x] A-019 R8: A prediction at the last column writes the glyph and lets xterm wrap; the shadow cursor advances without bespoke pending-wrap math. — No wrap math in the engine; glyph emitted via `write()`. NOTE: not exercised by any last-column-specific test (FakeIO just increments col unbounded); delegation is by-construction, not test-verified. (met by absence of wrap math; untested edge)
- [x] A-020 R10: The 20k-line throughput guard in `echo-latency.spec.ts` is unchanged and the reconciliation tap is a near-zero-cost early return when PASSIVE with an empty queue. — Throughput test (`echo-latency.spec.ts:1063-1179`) unchanged; early return `predictive-echo.ts:454`. (reconcile only adds one `queue.length === 0` check on the hot path)

### Code Quality

- [x] A-021 Pattern consistency: New code follows the naming and structural patterns of surrounding code (`select-live-panes.ts` pure-helper style, the `__rkTerminals` DEV-registry style, `IMMEDIATE_WRITE_MAX_BYTES`-style named constants). — `__rkPredictions` mirrors `__rkTerminals` (`terminal-client.tsx:62-82`); named constants `predictive-echo.ts:40-77`.
- [x] A-022 No unnecessary duplication: The pure engine is reused by both the binding and its unit tests; no prediction logic is duplicated inline in `terminal-client.tsx`. — `terminal-client.tsx` only wires `onInput`/`reconcile`/`reset`; no inline prediction logic. (one minor exception: `isPrintableAscii` re-imported and re-applied in the onData `pasting` heuristic — `terminal-client.tsx:342` — acceptable reuse, not duplication)
- [x] A-023 Type narrowing over assertions: The binding prefers type guards; the only `as` cast is for read-only xterm types not in the public signature, with no private `_core` access (frontend principle). — `predictive-echo-binding.ts` uses `import type` + the public read-only `IBufferCell` accessors; no `as`, no `_core`.
- [x] A-024 No magic numbers: SRTT smoothing/variance/floor/activation-sample constants and tentative-SGR tokens are named (no inline literals on the hot path). — `SRTT_ALPHA`/`SRTT_BETA`/`CONFIRM_WINDOW_K`/`MIN_CONFIRM_WINDOW_MS`/`INITIAL_SRTT_MS`/`ACTIVATION_SAMPLES`/`PRINTABLE_ASCII_*` all named (`predictive-echo.ts:40-77`). (minor: SGR param numbers 1/2/3/4… in `sgrParams` are inline, but these are the VT spec's fixed attribute codes, not tunable magic numbers)
- [x] A-025 Hot-path allocation discipline: Reconciliation on the inbound path stays allocation-light for tiny ASCII echoes, mirroring `textByteLength`. — `reconcile` early-returns on empty queue before any allocation (`predictive-echo.ts:454`); the binding reuses a `scratch` IBufferCell (`predictive-echo-binding.ts:81,91`).

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Port validation owed by the intake is DISCHARGED: all Approach A seams confirmed public in `@xterm/xterm@6.0.0` typings — overlay fallback not needed.

## Deletion Candidates

- `PredictiveEcho.confirmWindowMs` (`predictive-echo.ts:511-514`) — zero call-sites in production code; duplicates `debugState().confirmWindowMs` (which reads `this.rtt.confirmWindowMs()`). Used only by two unit tests (`predictive-echo.test.ts:367,371`) that could read it via `debugState()`. Dead public surface.
- `PredictiveEcho.getState` (`predictive-echo.ts:347-349`) — no production caller; `debugState().state` already exposes confidence state and is what the binding/`__rkPredictions` uses. Test-only convenience.
- `PredictiveEcho.unconfirmedCount` (`predictive-echo.ts:351-353`) — no production caller; `debugState().unconfirmed` is the production path. Test-only convenience.
- `RttEstimator.smoothedRttMs` (`predictive-echo.ts:237-240`) — no production caller; consumed only by one unit test. Introspection-only.
- (Not deleted — flagged) The three test-only methods above are reasonable as a small introspection API, but they triplicate what `debugState()` already returns; consolidating the tests onto `debugState()` would let all four be removed.

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Engine module path is `app/frontend/src/components/terminal/predictive-echo.ts` (new `terminal/` subfolder), colocated test `predictive-echo.test.ts` | Intake said "names TBD at plan time"; `select-live-panes.ts` lives in a `board/` subfolder, so a sibling `terminal/` subfolder matches the established colocation pattern. Easily renamed (single file). | S:80 R:88 A:82 D:78 |
| 2 | Confident | Tentative styling = underline + dim SGR (mosh "underline-until-confirmed"), reset to server-normal on confirm; no new hardcoded hex (theme tokens / SGR attrs only) | Intake §1 names underline-until-confirmed as the mosh default and the Open Questions leave the exact token (underline vs dim vs both) as a minor apply-time pick; underline+dim is the conservative mosh-faithful choice within existing SGR. | S:78 R:90 A:80 D:75 |
| 3 | Confident | SRTT seed constants: α=1/8, variance k=4, min confirm-window floor ≈ 50ms, ACTIVATION_SAMPLES ≈ 3 (mosh/VS Code-derived starting values) | Intake Open Questions explicitly defer concrete constants to apply, seeded from mosh/VS Code; α=1/8 and k=4 are the canonical TCP/mosh SRTT constants. Tuning is a follow-up, not a v1 gate. All named constants. | S:75 R:85 A:78 D:72 |
| 4 | Confident | `__rkPredictions` exposes `{ state, unconfirmedCount, mispredictions, lastPredictedCell }` (or equivalent) per windowId | Intake §6 requires a handle to "distinguish a predicted cell from the server-echoed one and read the misprediction counter" but does not fix the exact shape; this minimal set satisfies the perceived-echo metric and counter and mirrors the `__rkTerminals` minimalism. | S:80 R:90 A:85 D:80 |
| 5 | Confident | Reconciliation tap calls `engine.reconcile()` on BOTH the immediate-write and coalesced (`flushToTerminal`) paths, before the corresponding `terminal.write()`, with a PASSIVE+empty-queue early return | Intake §3/§Impact require observing every inbound chunk allocation-light without regressing throughput; both write paths carry inbound bytes, so both must be tapped, and the early return preserves the `textByteLength` discipline. | S:82 R:80 A:85 D:80 |
| 6 | Confident | E2E vim/alternate-screen scenario launches `vim` (or `vi`) in a dedicated session to drive `buffer.active.type === "alternate"`, asserting `__rkPredictions` painted-count == 0 | Intake §6 scenario 3 names "vim / alternate-screen pane" and requires zero predictions; vim is the canonical alt-screen app and the spec already creates per-scenario sessions, so this mirrors the existing harness shape. | S:80 R:88 A:82 D:78 |
| 7 | Confident | Confirm uses a re-`write()` of the confirmed glyph at its position with server-normal SGR (per intake §3 Approach A) rather than relying on the in-flight server echo alone to restyle | Intake §3 states "Approach A re-write()s the confirmed glyph without the tentative SGR"; this is the literal design instruction, graded Confident (not Certain) because the precise SGR the server will use is reconstructed and the residue-free invariant is what review verifies. | S:85 R:75 A:80 D:80 |

7 assumptions (0 certain, 7 confident, 0 tentative).
