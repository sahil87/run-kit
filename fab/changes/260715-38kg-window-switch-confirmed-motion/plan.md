# Plan: Honest Window-Switch Feedback — Confirmation-Gated Motion

**Change**: 260715-38kg-window-switch-confirmed-motion
**Intake**: `intake.md`

## Requirements

<!-- Derived from intake.md What-Changes §1–§7 + the 13 user-approved assumptions.
     Frontend-only (constitution IV). Type-narrowing over `as` casts
     (code-quality). No client polling; a single named setTimeout per pending
     switch is the only timer added (intake §4, §5). -->

### Window-Transition Module: Gate Settle-Reason

#### R1: The first-write gate reports HOW it settled
`waitForFirstWrite()` SHALL resolve with a settle reason rather than `void`:
`"first-write" | "timeout" | "superseded"`. `settleGate` SHALL carry the reason
from each of its three callers — `notifyFirstWrite` → `"first-write"`, the gate
timer → `"timeout"`, supersession by a newer `beginWindowSwitchGate` →
`"superseded"`. `FIRST_WRITE_TIMEOUT_MS = 300` is unchanged (forced by View
Transitions render suppression — MUST NOT be extended). All three existing
concurrency guarantees (supersession fires the prior pending gate immediately;
only the INCOMING window's post-POST bytes release the gate; a stale timer never
clobbers a newer gate) SHALL be preserved verbatim.

- **GIVEN** an open gate that has called `openForNotify()`
- **WHEN** `notifyFirstWrite()` fires before the 300ms timeout
- **THEN** `waitForFirstWrite()` resolves with `"first-write"`
- **AND** **WHEN** instead the 300ms timer elapses first, it resolves with `"timeout"`
- **AND** **WHEN** instead a newer `beginWindowSwitchGate()` supersedes it, it resolves with `"superseded"`

### Window-Transition Module: Pending-Mask Signal

#### R2: A pure, unit-testable mask-signal state machine lives alongside the gate
The pending-switch mask state SHALL be expressed as pure module logic in
`window-transition.ts` (no DOM, no React) with a subscription seam so `app.tsx`
can render it. Semantics: **armed at gate timeout**, **lifted on late first
write**, **torn down on supersession and on failure/bounce**. The SAME
`notifyFirstWrite` receipt that releases the gate SHALL lift the mask on late
arrival ("one signal drives everything" — assumption 3). The mask SHALL be
armed **only** by the 300ms gate-timeout decision — **NEVER at click time** (the
fast path must never flash it; assumption 2). A superseded switch SHALL arm
neither slide nor mask (assumption 13).

- **GIVEN** a gated (tty) switch whose gate settled `"timeout"`
- **WHEN** the wrapper observes the timeout settle reason
- **THEN** the mask signal is armed (state → `masked`) and subscribers are notified
- **AND** **WHEN** the incoming window's first bytes then arrive (`notifyFirstWrite`)
- **THEN** the mask signal lifts (state → `idle`) via that same receipt
- **AND** **WHEN** instead the switch is superseded or fails/bounces
- **THEN** the mask signal tears down (state → `idle`) without a late-write lift

#### R3: Non-VT / reduced-motion parity via a grace timer
Browsers without `startViewTransition` support or with
`prefers-reduced-motion: reduce` take the instant-switch path (no render-freeze
phase). They SHALL get the mask via a **~300ms grace timer** armed at switch
time that shows the mask only if the first write has not arrived by the
threshold — same 300ms threshold as the gate, different mechanism, same
lift-on-late-write and failure/bounce teardown semantics.

- **GIVEN** an instant (non-animated) tty switch (no VT support, or reduced motion)
- **WHEN** ~300ms elapse with no incoming first write
- **THEN** the mask signal is armed
- **AND** **WHEN** the incoming first write arrives (early → grace timer cancelled, no mask; late → mask lifts)
- **THEN** the mask signal ends in `idle`

### App Integration: Confirmation-Gated Slide

#### R4: The slide plays only on confirmed-fast arrival; timeout skips it
Inside the `startViewTransition` callback the wrapper SHALL branch on the gate's
settle reason: `"first-write"` → the slide plays (fast path, byte-identical to
today); `"timeout"` → call `transition.skipTransition()` (no motion, screen cuts
to the masked new state); `"superseded"` → no slide and no mask from the
superseded switch (the newer switch owns all feedback). The existing precondition
ladder (`shouldAnimateWindowSwitch`) and the direction-token cleanup guard are
unchanged.

- **GIVEN** an animated tty switch whose incoming bytes arrive within 300ms
- **WHEN** the gate settles `"first-write"`
- **THEN** the slide plays and no mask is shown (fast path unchanged)
- **AND** **WHEN** the gate settles `"timeout"`
- **THEN** `transition.skipTransition()` is called and the mask (R2) is armed
- **AND** **WHEN** the gate settles `"superseded"`
- **THEN** neither slide nor mask is armed for the superseded switch

### App Integration: Pending Spinner Mask (terminal area)

#### R5: A full LogoSpinner waiting mask overlays the terminal surface while pending
When the mask signal (R2/R3) is armed, `app.tsx` SHALL render the existing
`LogoSpinner` centered on the terminal background over the `terminal-surface`
container, fully hiding the stale bytes (a full mask, not a dimmed overlay). The
mask SHALL block input to the old window — pointer AND keyboard — while shown;
keystrokes typed while masked are dropped, not buffered/replayed (assumption 10).
The mask SHALL lift as a **cut** (at most a fast fade) on late arrival — never a
second slide. Overlay styling follows the existing `rk-*` utility-class
convention in `globals.css` and is neutralized under `prefers-reduced-motion`.

- **GIVEN** the mask signal is armed
- **WHEN** the terminal area renders
- **THEN** a centered LogoSpinner fully covers the terminal surface and intercepts pointer + key events
- **AND** **WHEN** the mask signal lifts
- **THEN** the overlay is removed as a cut/fast-fade (no slide)

#### R6: The mask applies uniformly to gated (tty) switches, incl. cross-session; non-tty targets stay mask-less
The mask SHALL apply to gated tty switches uniformly, including cross-session
switches (which remount the terminal on a new WS — their slow path shows a
blank/connecting pane the mask improves too). Non-tty targets (web iframe / chat
lenses — the `ungatedIds` classification) SHALL keep today's ungated, mask-less
behavior.

- **GIVEN** a switch whose target's effective resolved view is `tty`
- **WHEN** the gate times out (or the grace timer fires)
- **THEN** the mask is eligible to arm
- **AND** **GIVEN** a switch whose target is in `ungatedIds` (web/chat)
- **THEN** the mask never arms (ungated, mask-less as today)

### App Integration: Failure Bounce-Back

#### R7: Silent-failure limbo is un-stuck by explicit rejection or a confirmation-window timeout
`pendingClickRef` writeback (app.tsx) SHALL clear `pendingClickRef` — so the
existing SSE URL-writeback bounces URL and heading back to tmux's actual active
window — on **either** an explicit `selectWindow` POST rejection **or** no SSE
confirmation within a confirmation window (a named tunable constant,
`CONFIRMATION_WINDOW_MS`, default ~5000ms). The bounce-back MUST key off an
explicit rejection or the timeout — **NEVER** just "SSE still reports the old
window" (which is normal mid-switch). A lightweight failure hint SHALL show via
the existing toast system (`addToast`). The confirmation timer SHALL arm wherever
`pendingClickRef` is set (the click path, the deep-link alignment effect, the
waiting-target navigation — all share the sticky-limbo mechanics), and the mask
(if armed) SHALL tear down on bounce.

- **GIVEN** a pending click whose `selectWindow` POST rejects
- **WHEN** the rejection is observed
- **THEN** `pendingClickRef` is cleared, the writeback bounces URL/heading to tmux truth, a failure toast shows, and any armed mask tears down
- **AND** **GIVEN** a pending click with no rejection but no SSE confirmation within `CONFIRMATION_WINDOW_MS`
- **THEN** the same bounce + toast + mask-teardown occurs
- **AND** **GIVEN** a pending click that SSE confirms normally (mid-switch, SSE still stale briefly)
- **THEN** NO bounce occurs merely because SSE still reports the old window

### Resulting State Vocabulary (design intent)

#### R8: Each visual state is a distinct, honest signal
The four outcomes SHALL map to four distinct signals: slide = confirmed arrival
(bytes within 300ms); spinner mask = in transit (don't type); spinner → content
cut = arrived late; spinner → bounce + hint = switch failed. Optimistic
navigation stays: heading/URL flip at click (acknowledged intent), sidebar
highlight stays SSE-derived (confirmation) — no state shows another state's
costume (assumption 6).

- **GIVEN** any of the four switch outcomes
- **WHEN** it occurs
- **THEN** exactly the corresponding signal is shown, and no other

### Tests

#### R9: Unit + e2e coverage with companion doc parity
Unit coverage in `window-transition.test.ts` SHALL cover the settle reasons for
all three settle paths and the mask-signal state machine (arm-at-timeout /
lift-on-late-write / teardown-on-supersession-and-failure / grace-timer parity),
and SHALL preserve the existing concurrency-guarantee assertions. The e2e spec
`window-switch-transition.spec.ts` SHALL be updated, and its sibling
`.spec.md` updated **in the same commit** (constitution: Test Companion Docs).
All test runs go through `just` recipes.

- **GIVEN** the added behavior
- **WHEN** `just test-frontend` runs
- **THEN** the new unit tests pass and the existing gate/direction-token tests still pass
- **AND** **WHEN** the e2e spec runs via `just test-e2e`, the animated-path guard still passes and `.spec.md` reflects any test changes

### Non-Goals

- Pessimistic navigation (waiting for confirmation before navigating) — explicitly rejected in the design.
- Dimmed overlay instead of a full mask — rejected; full mask chosen.
- Extending the 300ms budget — impossible without freezing rendering longer.
- A second animation on late arrival — rejected; the slide stays exclusive to the fast path.
- Backend / API / route changes — none (constitution IV holds).
- Buffering/replaying masked keystrokes into the new window — dropped, not replayed (assumption 10).

### Design Decisions

1. **Mask signal is pure module state with a subscriber seam, not React state.**
   `window-transition.ts` owns a `maskState` (`"idle" | "masked"`) plus a
   `subscribeMaskState(listener)` + `getMaskState()` pair (the `useSyncExternalStore`
   contract). `app.tsx` reads it via `useSyncExternalStore` and renders the overlay.
   — *Why*: the intake mandates "pure, unit-testable module logic alongside the gate"
   and "one signal drives everything"; keeping arm/lift/teardown in the module (driven
   by the same `settleGate`/`notifyFirstWrite`/supersession seams as the gate) makes it
   testable without a DOM and guarantees the mask and gate can never drift.
   — *Rejected*: a React `useState` mask driven from the wrapper — would duplicate the
   arm/lift/teardown decision logic in a component and re-introduce gate↔mask drift.

2. **`waitForFirstWrite()` resolves a settle reason; the mask arms as a side effect of `settleGate`.**
   `settleGate(gate, reason)` sets the mask state when `reason === "timeout"` (and the
   gate's target is gated/tty), and clears it on `"first-write"`/`"superseded"`. The
   wrapper additionally consults the resolved reason to call `skipTransition()`.
   — *Why*: the timeout decision is the single place the intake names as the mask
   trigger; arming there (not at click time) satisfies "NEVER at click time" structurally.
   — *Rejected*: arming in the wrapper after the await — works, but splits the
   arm/lift ownership; centralizing in `settleGate` keeps one signal source.

3. **Non-tty / cross-session gating uses the existing `ungatedIds` classification.**
   The mask only ever concerns gated (tty) targets; `ungatedIds.has(windowId)` already
   marks web/chat targets, and the wrapper already skips the gate wait for them, so they
   never reach a timeout settle and never arm the mask — no new classification needed.

4. **Mask target must be known to the module.** Because the grace-timer path (R3)
   is not inside a VT callback, the module needs to know whether a switch is gated
   (tty) to arm the mask. The wrapper passes `gated: boolean` into
   `beginWindowSwitchGate({ gated })` (or an `armGraceMask`/`disarm` pair for the
   non-VT path) so the module owns the arm decision uniformly.
   — *Why*: keeps "one signal" ownership in the module for BOTH the VT-timeout and
   the grace-timer paths.

## Tasks

### Phase 1: Gate settle-reason + mask signal (pure module)

- [x] T001 In `app/frontend/src/lib/window-transition.ts`, change the gate's settle type to a `GateSettleReason = "first-write" | "timeout" | "superseded"` and make `waitForFirstWrite()` resolve `Promise<GateSettleReason>`. Thread the reason through `settleGate` from its three callers (`notifyFirstWrite` → `"first-write"`, timer → `"timeout"`, supersession in `beginWindowSwitchGate` → `"superseded"`). Preserve `FIRST_WRITE_TIMEOUT_MS = 300` and all three concurrency guarantees verbatim. <!-- R1 -->
- [x] T002 <!-- rework c2: G2 — add exported abandonSwitchFeedback(): settle a still-pending gate as "superseded" AND tearDownMask(), so a bounce/teardown can never be re-masked by the gate timer firing up to 300ms later. SF6 — metaKey exemption in isMaskExemptKey must NOT exempt Cmd+V (default paste reaches the old pty via xterm textarea). NTH9 — require !altKey in the Ctrl branch (AltGr reports ctrlKey:true) --> In `window-transition.ts`, add the pure mask-signal state machine: module state `maskState: "idle" | "masked"`, `getMaskState()`, `subscribeMaskState(listener): () => void` (useSyncExternalStore-compatible: stable snapshot, notify on change only). Arm (`→ masked`) inside `settleGate` when `reason === "timeout"` AND the gate was created gated (tty); clear (`→ idle`) on `"first-write"` and `"superseded"`, and expose an explicit `tearDownMask()` for the failure/bounce path. Extend `beginWindowSwitchGate` to accept `{ gated: boolean }` so the module owns the arm decision; a superseded prior gate clears the mask (assumption 13). <!-- R2 -->
- [x] T003 <!-- rework: F3 — armGraceMask has no openForNotify-equivalent, so outgoing bytes cancel the grace timer / lift the mask; add the same post-POST acceptance filter --> In `window-transition.ts`, add the non-VT/reduced-motion grace-timer path as pure logic: `armGraceMask(): () => void` (returns a cancel fn) that arms `maskState → masked` after `FIRST_WRITE_TIMEOUT_MS` unless cancelled or a `notifyFirstWrite` lift arrives first; the same `notifyFirstWrite` receipt lifts it late, and the failure/bounce `tearDownMask()` applies. Ensure the grace path and the gate share ONE mask signal (never two masks at once; supersession-safe). <!-- R3 -->

### Phase 2: App integration — slide gating, mask render, bounce-back

- [x] T004 In `app/frontend/src/app.tsx` `navigateToWindow` (~876), consume the settle reason from `await gate.waitForFirstWrite()`: on `"timeout"` call `transition.skipTransition()`; on `"first-write"` let the slide play (unchanged); on `"superseded"` no-op (VT already skips it). Pass `{ gated: !targetUngated }` into `beginWindowSwitchGate`. Keep the direction-token latest-wins cleanup and the chained `openForNotify` shape unchanged. <!-- R4 --> <!-- R6 -->
- [x] T005 <!-- rework c2: G1 (must-fix) — the mount-alignment effect re-fires on the optimistic navigate (SSE still stale ⇒ activeId !== windowParam) and its beginPendingSwitch WITHOUT graceMask cancels the just-armed grace timer via clearPendingSwitchTracking, so the instant-path mask NEVER functions in the live app; skip the alignment re-track when pendingClickRef.current?.windowId === windowParam (also removes the duplicate selectWindow POST per click). G3 (must-fix) — clicking the already-active window row (mobile drawer tap, palette "(current)") arms un-confirmable machinery (no tmux change ⇒ no SSE confirm, no bytes) ⇒ spurious mask at 300ms + false error toast at 5s; early-out when target is both the URL window and tmux-active --> (the `if (!animate || !direction)` path at ~836), arm the grace-timer mask via `armGraceMask()` only when the target is gated (`!ungatedIds.has(windowId)`), and wire its cancel/lift to the same `pendingClickRef` lifecycle so a failure/bounce tears it down. Non-tty fallbacks stay mask-less. <!-- R3 --> <!-- R6 -->
- [x] T006 <!-- rework: F2 — the masked keyboard swallow (preventDefault+stopPropagation on EVERY key) kills global chords (Cmd/Ctrl+K palette, Ctrl+` chat, Escape) for up to 5s, violating constitution V; exempt non-terminal-input chords from the swallow --> In `app.tsx`, render the pending spinner mask over the `terminal-surface` container (~2224): subscribe to the module mask state via `useSyncExternalStore(subscribeMaskState, getMaskState)`; when `masked`, render an absolutely-positioned full-cover overlay containing a centered `LogoSpinner`, using a new `rk-window-switch-mask` utility class. The overlay MUST intercept pointer events and block keyboard input to the terminal while shown (drop, do not buffer). Lift as a cut/fast-fade. <!-- R5 --> <!-- R2 -->
- [x] T007 <!-- rework c2: G4 (must-fix) — the reduced-motion `animation: none` override for .rk-window-switch-mask PRECEDES the base rule declaring the fade-in; equal specificity ⇒ later source order wins ⇒ the fade still runs under reduced motion. Move the mask base rule + keyframes above the prefers-reduced-motion block (match the .rk-waiting-halo ordering) --> In `app/frontend/src/globals.css`, add the `.rk-window-switch-mask` overlay styles (absolute inset-0 fill over the terminal surface, terminal-background color, centered content, above the terminal but below toasts) and a fast fade-out for the lift; neutralize any motion under `@media (prefers-reduced-motion: reduce)` (mask still shows — attention/safety is never motion-only — but without the fade). Follow the existing `rk-*` convention and the window-switch CSS block. <!-- R5 -->
- [x] T008 <!-- rework c2: G2 (must-fix) — a fast selectWindow rejection (<300ms) bounces, then the STILL-PENDING gate's timer re-arms the mask over the bounced-back window with no lift path (liftAccepting stays false; confirmSwitchArrived unreachable once pendingClickRef cleared) ⇒ permanently stuck input-blocking mask; the route-leave/unmount teardowns have the same gap (tearDownMask without settling the pending gate). Fix: call the new abandonSwitchFeedback() from the bounce AND both teardown effects. SF5 — the writeback's !urlMatchesPending branch (Back/Forward away from a pending target) must tear down an armed mask when clearing an unconfirmed intent. SF7 — bouncePendingSwitch must treat activeWindowRef.current?.windowId === windowId as confirmation (clear silently, no toast/nav) so dialog-suppressed confirms don't false-bounce. SF8 — the posted.catch(() => bouncePendingSwitch(windowId)) handler is keyed on windowId alone and outlives supersession (late rejection of a superseded POST bounces a newer healthy switch); guard on tracked-switch identity (epoch/token). NTH10 — update the stale "event-driven, not a timer" comment at ~640 --> In `app.tsx`, add `CONFIRMATION_WINDOW_MS` (named constant, ~5000) and arm a single `setTimeout` confirmation timer wherever `pendingClickRef` is set (the click path ~789, the deep-link alignment effect ~727, the waiting-target navigation ~1873). On explicit `selectWindow` POST rejection OR confirmation-window timeout, clear `pendingClickRef` (so the SSE writeback bounces URL/heading to tmux truth), call `tearDownMask()`, and `addToast(...)` a lightweight failure hint. The bounce MUST NOT fire merely because SSE still reports the old window mid-switch. Clear the timer when SSE confirms or a newer navigation supersedes. <!-- R7 --> <!-- R8 -->

### Phase 3: Tests + companion docs

- [x] T009 <!-- rework c2: cover the cycle-2 behaviors — abandonSwitchFeedback settles pending gate + clears mask (no re-mask from a late gate timer), Cmd+V not exempt / AltGr not exempt, same-window early-out arms nothing, alignment skip-when-already-pending, bounce-treats-active-as-confirmed, stale-rejection identity guard. Keep all existing tests green --> In `app/frontend/src/lib/window-transition.test.ts`, add tests: (a) `waitForFirstWrite` resolves `"first-write"` / `"timeout"` / `"superseded"` for the three settle paths (update the existing gate tests that assert `resolves.toBeUndefined()` to assert the reason); (b) mask state machine — arm-at-timeout (gated only), lift-on-late-write via `notifyFirstWrite`, teardown-on-supersession, teardown via `tearDownMask()`, and that a gated-`false` timeout does NOT arm; (c) `subscribeMaskState` notifies on change and the unsubscribe stops notifications; (d) grace-timer parity — arms after threshold without a write, cancels on early write, lifts on late write. Preserve/adapt all existing concurrency-guarantee tests. <!-- R9 --> <!-- R1 --> <!-- R2 --> <!-- R3 -->
- [x] T010 Update `app/frontend/tests/e2e/window-switch-transition.spec.ts` and its sibling `app/frontend/tests/e2e/window-switch-transition.spec.md` **in the same commit**: keep the existing fast-path animated-completion guard (bytes within budget → slide + attribute clears). Add coverage that the pending mask is not left STUCK once the switch settles (SSE confirm / late write lift it). Given e2e cannot deterministically force a >300ms first-write on localhost, document the mask/bounce paths as unit-covered in the `.spec.md` and assert only what is deterministic in e2e (fast-path completion + mask-not-stuck). Reduced-motion default still exercises the instant fallback. <!-- R9 --> <!-- R5 -->

### Phase 4: Cycle-3 plan revision — cross-server switch identity (review escalation)

<!-- Added by the fab-fff auto-rework loop, cycle 3 (revise-plan escalation after two
     fix-code cycles). Root cause of review finding H1: the plan treated the pending-switch
     intent as window-id-keyed, but @N window ids are only unique PER SERVER and AppShell
     persists across $server changes — so every intent comparison (alignment skip, writeback
     suppression, bounce guard) can false-positive on an id-string collision across servers. -->

- [x] T011 Server-scope the pending-switch identity (H1, must-fix). In `app.tsx`: carry `server` in the pending intent — `pendingClickRef` becomes `{ server, windowId }` and the tracked pending-switch entry (`beginPendingSwitch`, its timer closure, and the SF8 identity guard) records the server it was armed for. Compare BOTH fields at every consumer: the G1 alignment-skip (`pendingClickRef.current?.windowId === windowParam` must also require `.server === server`), the writeback's `urlMatchesPending`/`sseConfirmed` checks, and `bouncePendingSwitch`'s guards (a bounce whose recorded server no longer matches the current `server` route param clears silently — no toast, no navigation). ADDITIONALLY add a server-change teardown effect (mirroring the route-leave one, declared BEFORE the alignment effect so the skip sees a cleared intent): on `server` param change, clear pending tracking + `abandonSwitchFeedback()`. Scenario that must heal (was broken): pending unconfirmed switch on serverA/@5 → sidebar click to serverB's non-active @5 → serverB alignment POST still fires, no stale serverA bounce/toast ever, `hasAlignedToUrlRef` not falsely latched. Unit-test the module-level analogs + pure predicates; e2e only if deterministic. <!-- R7 --> <!-- R8 -->
- [x] T012 Skip motion for any non-confirmed settle (H2, should-fix) + stale-doc cleanup (N1). In `navigateToWindow`'s VT callback, call `transition.skipTransition()` whenever the gate settles with `reason !== "first-write"` (an explicit skip on a genuinely VT-superseded transition is a harmless no-op) — a failed/abandoned switch must never animate (R8: slide = confirmed arrival). In `window-transition.ts`, refresh the stale `tearDownMask` docstring (its app.tsx callers were replaced by `abandonSwitchFeedback()`); narrow or annotate its export per the Deletion Candidates note. <!-- R4 --> <!-- R8 -->

## Execution Order

- T001 → T002 → T003 (module changes build on each other; settle-reason first, mask signal second, grace timer third).
- Phase 2 (T004–T008) depends on Phase 1; within Phase 2, T004/T005 (arm sites) and T006/T007 (render) and T008 (bounce) touch overlapping app.tsx regions — execute sequentially to keep edits coherent.
- T009 after Phase 1 (unit tests target the module). T010 after Phase 2.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `waitForFirstWrite()` resolves `"first-write" | "timeout" | "superseded"` from the correct settle path; `FIRST_WRITE_TIMEOUT_MS` stays 300; the three concurrency guarantees still hold.
- [x] A-002 R2: A pure mask-signal state machine (`getMaskState`/`subscribeMaskState`, arm-at-timeout / lift-on-late-write / teardown-on-supersession+failure) exists in `window-transition.ts` with no DOM/React deps.
- [x] A-003 R3: The non-VT/reduced-motion grace-timer path arms the same mask signal at ~300ms and lifts/cancels on the incoming first write. *(Cycle-2 G1 VERIFIED FIXED: the alignment effect now skips re-tracking when `pendingClickRef.current?.windowId === windowParam` (app.tsx:893), so a click's just-armed grace timer survives the post-navigate effect re-fire and the duplicate `selectWindow` POST is gone; module lift/cancel semantics unit-covered.)*
- [x] A-004 R4: The wrapper plays the slide only on `"first-write"`, calls `skipTransition()` on `"timeout"`, and arms nothing on `"superseded"`.
- [x] A-005 R5: A full centered `LogoSpinner` mask renders over `terminal-surface` when armed, blocks pointer+keyboard, and lifts as a cut/fast-fade.
- [x] A-006 R6: The mask arms for gated (tty) targets incl. cross-session; `ungatedIds` (web/chat) targets never arm it.
- [x] A-007 R7: `pendingClickRef` bounces URL/heading on explicit POST rejection OR `CONFIRMATION_WINDOW_MS` timeout only — never on a merely-stale SSE report; a failure toast shows and the mask tears down. *(Cycle-2 G2/G3 VERIFIED FIXED: the bounce and both teardown effects call `abandonSwitchFeedback()` (settles a still-pending gate as `"superseded"` + tearDownMask, window-transition.ts:426), so a <300ms POST rejection can no longer be re-masked by the gate timer — unit-covered ("settles a still-pending gate ... so its timer can never re-mask"); same-window no-op clicks early-out via `isRedundantSwitch` (app.tsx:983) and arm nothing — unit-covered. Cross-server residue tracked under A-015.)*
- [x] A-008 R8: The four outcomes map to four distinct signals; heading/URL flip at click and SSE-derived sidebar highlight are unchanged.

### Behavioral Correctness

- [x] A-009 R4: On the fast path (bytes < 300ms) the slide is byte-identical to today and NO mask flashes.
- [x] A-010 R7: A normal mid-switch (SSE briefly stale) does NOT trigger a bounce.

### Scenario Coverage

- [x] A-011 R9: `window-transition.test.ts` covers all three settle reasons, the mask state machine, the subscription seam, and grace-timer parity; existing gate/direction-token tests still pass.
- [x] A-012 R9: The e2e spec's fast-path guard passes and asserts no-mask-on-fast-path; `.spec.md` updated in the same commit. *(Review note: implemented as the deterministic mask-not-stuck poll (`toHaveCount(0)` within budget) per T010 — a strict never-flashes assert is not deterministic on localhost; the split is documented in the `.spec.md`.)*

### Edge Cases & Error Handling

- [x] A-013 R2: A superseded switch arms neither slide nor mask; a stale gate's timeout cannot arm a mask for a newer gate.
- [x] A-014 R5: Keystrokes typed while masked are dropped (not buffered/replayed); the mask fully hides stale bytes (not a dimmed overlay).
- [x] A-022 R7: Cross-server supersession — a pending unconfirmed switch on server A is fully superseded by a navigation to server B even when the target window-id STRING matches (`@N` ids are only unique per server): server B's tmux alignment still fires, no suppression false-positive, and no stale wrong-server bounce or toast can ever fire from server A's abandoned intent. <!-- added cycle 3 (H1) --> *(Cycle-3 re-review VERIFIED: (a) server-change teardown effect (app.tsx:907–914, prev-ref keyed, declared BEFORE the alignment effect) clears intent + tracking + `abandonSwitchFeedback()` on `$server` change, so serverB's alignment sees a cleared intent and fires; (b) even without the teardown, the alignment skip (:949), writeback `urlMatchesPending`/`sseConfirmed` (:986–987), and bounce guard (:769) all compare via server-scoped `isSamePendingTarget` — a serverA/@5 intent cannot suppress serverB/@5; (c) `bouncePendingSwitch`'s recorded-server-mismatch branch (:777–781) clears a straggler timer silently — no toast, no navigation — and the bounce navigate uses `target.server` only after verifying it equals the live route server (:812–815), so a stale-server navigation is structurally inexpressible; (d) `isSamePendingTarget` unit-covered incl. the cross-server collision case (window-transition.test.ts:707–733). No deterministic e2e — two tmux servers, per T011's "e2e only if deterministic".)*
- [x] A-023 R4 R8: No motion for a non-confirmed switch — the VT wrapper skips the transition for every settle reason other than `"first-write"` (timeout, superseded, abandoned-by-bounce), so a failed switch never plays the slide alongside its failure feedback. <!-- added cycle 3 (H2) --> *(Cycle-3 re-review VERIFIED: the VT callback awaits the settle reason and calls `transition.skipTransition()` whenever `reason !== "first-write"` (app.tsx:1190–1193) — covering `"timeout"` AND `"superseded"`, the latter reached both by a rapid-successor VT (native skip, explicit call a harmless no-op) and by `abandonSwitchFeedback()` from the bounce/teardowns (which settles a still-pending gate `"superseded"`, window-transition.ts:434–439 — the case with NO successor VT where the explicit skip is load-bearing). SSE-confirm via `confirmSwitchArrived` deliberately settles `"first-write"` (authoritative arrival → slide plays, consistent with R8's slide=confirmed-arrival).)*
- [x] A-015 R7: The confirmation timer is cleared when SSE confirms or a newer navigation supersedes (no leaked timers, no spurious late bounce). *(Cycle-3 re-review: MET — all grounds now verified fixed. Prior grounds: (a) dialog-gated confirm → SF7 silent-confirm branch in `bouncePendingSwitch` (app.tsx:796–801) clears with no toast/nav; (b) no-op same-window switch → G3 `isRedundantSwitch` early-out (:1042–1047); (c) gate-timer re-mask → G2 `abandonSwitchFeedback`. The cycle-2 H1 ground (cross-server "newer navigation" failing to supersede on an id-string collision) is healed by T011: BOTH remedies were implemented — the pending intent is server-scoped (`PendingSwitchTarget {server, windowId}`, compared via `isSamePendingTarget` at the alignment skip :949, writeback :986–987, and bounce :769) AND the server-change teardown effect (:907–914) clears tracking on `$server` change before the alignment effect runs. Timer-clear inventory: SSE confirm → writeback `clearPendingSwitchTracking` (:993); newer same-server nav → `beginPendingSwitch` supersession (:839); cross-server nav → server-change teardown (:912); route-leave → :878; unmount → :891; Back/Forward away → writeback `!urlMatchesPending` clear (:988); stale POST rejection → tracked-identity guard (:859–861); straggler timer after all teardowns → bounce's own identity + recorded-server guards no-op silently.)*

### Code Quality

- [x] A-016 Pattern consistency: New code follows surrounding patterns — pure helpers in `lib/` with colocated `.test.ts`, `rk-*` utility classes in `globals.css`, `useSyncExternalStore` for the module→React seam, named constants (no magic numbers).
- [x] A-017 No unnecessary duplication: Reuses the existing `LogoSpinner`, `addToast`/`useToast`, `notifyFirstWrite`, `ungatedIds`, `pendingClickRef`, and the `terminal-surface` wrapper — no reimplementation.
- [x] A-018 Type narrowing over `as` casts: settle-reason union and mask-state union use discriminated types / narrowing, not `as` casts (code-quality principle).
- [x] A-019 No client polling: only a single `setTimeout` (confirmation window) + the existing gate/grace timers; no `setInterval`+fetch loop (SSE-driven).
- [x] A-020 Frontend-only: no backend, API, or route changes (constitution IV).
- [x] A-021 Reduced-motion: mask motion is neutralized under `prefers-reduced-motion` while the mask itself still shows (safety is not motion-only). *(Cycle-2 G4 VERIFIED FIXED: the base rule + keyframes now sit at globals.css:312–329, BEFORE the `@media (prefers-reduced-motion: reduce)` block at :333 whose `animation: none` override is at :349 — later source order at equal specificity, so the override wins and only the fade is dropped; the mask itself still renders.)*

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant (re-verified at the cycle-3 re-review). Specifically checked: the event-driven `pendingClickRef` SSE-confirm clearing in the URL-writeback effect remains the primary (and still necessary) confirm path — the confirmation timer complements it rather than replacing it; the fire-and-forget `.catch(() => {})` markers on `selectWindow` POSTs are still load-bearing (unhandled-rejection suppression, gate `openForNotify` chaining); the existing gate concurrency machinery (supersession, still-points-at-itself, `openForNotify` filtering) is extended verbatim, not superseded; the route-leave and unmount teardown effects are NOT subsumed by the new server-change teardown (each covers a distinct route topology: windowless leaf, full unmount, same-leaf `$server` swap). The prior narrowing candidate is RESOLVED per T012/N1: the `tearDownMask` export (`app/frontend/src/lib/window-transition.ts:390`) now carries an explicit docstring annotation (":382–388") stating it is effectively module-internal, kept exported for unit tests only, with production callers directed to `abandonSwitchFeedback`/`confirmSwitchArrived` — no further action pending.

## Assumptions

<!-- Apply-time graded decisions. The intake already recorded 13 Certain/Confident
     assumptions; these are the additional inline decisions made while co-generating
     ## Requirements — chiefly the module architecture for the mask signal, which the
     intake explicitly left as "a plan-time implementation choice". -->

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Mask signal is pure module state exposed via a `useSyncExternalStore` seam (`getMaskState`/`subscribeMaskState`), rendered by app.tsx — not React `useState` in the wrapper | Intake mandates "pure, unit-testable module logic alongside the gate" + "one signal drives everything"; useSyncExternalStore is the idiomatic module→React seam and keeps gate/mask from drifting | S:70 R:70 A:80 D:65 |
| 2 | Confident | The mask arms as a side effect of `settleGate(reason)` (on `"timeout"` + gated), so arm/lift ownership stays in one module seam; the wrapper additionally reads the reason to call `skipTransition()` | Centralizes the "NEVER at click time" invariant structurally; the timeout decision is the single named trigger in the intake | S:70 R:75 A:75 D:70 |
| 3 | Confident | The mask overlay mounts on the existing `terminal-surface` wrapper `<div>` (app.tsx ~2224), which wraps all three render branches (terminal/iframe/chat) — but only arms for gated tty targets | Intake §3 left the exact mount point as a plan choice; this wrapper is the natural single seam and already scopes the VT slide | S:65 R:80 A:75 D:70 |
| 4 | Confident | `beginWindowSwitchGate({ gated })` gains a `gated` flag so the module knows whether to arm the mask on timeout; the grace-timer path gets a parallel `armGraceMask()`/cancel API sharing the one mask signal | Needed because the grace-timer path is outside the VT callback yet must obey the same one-signal ownership; smallest API surface that keeps the decision in the module | S:60 R:75 A:75 D:65 |
| 5 | Confident | `CONFIRMATION_WINDOW_MS = 5000` as the named tunable (intake assumption 8's "~5s"); a single `setTimeout` per pending switch, cleared on SSE-confirm/supersede/bounce | Intake delegated the exact value; 5s matches its stated default; single timer honors the no-polling constraint | S:70 R:90 A:80 D:75 |
| 6 | Confident | e2e cannot deterministically force a >300ms first write on localhost, so the mask/bounce paths are unit-covered; the e2e spec keeps the fast-path guard and adds a no-mask-on-fast-path assertion; `.spec.md` documents the split | Forcing network latency deterministically in Playwright against a live relay is flaky; unit tests own the timing-sensitive branches per the existing test pyramid | S:65 R:85 A:80 D:70 |

6 assumptions (0 certain, 6 confident, 0 tentative).
