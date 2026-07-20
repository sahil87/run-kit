# Plan: Window Switch Slide Transition

**Change**: 260703-l4nf-window-switch-slide-transition
**Intake**: `intake.md`

## Requirements

### Transition: Slide direction from flattened sidebar order

#### R1: Direction is a pure function of flattened window order
The direction computation SHALL be a pure exported helper over the two windows' positions in the flattened (`sessions.flatMap`) window order, returning `"up"`, `"down"`, or a skip signal (`null`) when either window is absent.

- **GIVEN** a flattened window order and a current + target window id
- **WHEN** the target's index is greater than the current's index (target sits below)
- **THEN** the helper returns `"up"` (new content enters from the bottom)
- **AND** when the target's index is less than the current's index it returns `"down"`
- **AND** when either window id is missing from the order, or the two ids are equal, it returns `null` (skip the transition)

### Transition: View-transition wrapper around navigateToWindow

#### R2: navigateToWindow wraps its body in document.startViewTransition under gate conditions
`navigateToWindow` (`app/frontend/src/app.tsx`) SHALL run its existing body (optimistic `navigate` + `selectWindow` + mobile sidebar close) inside `document.startViewTransition` only when ALL gate conditions hold; otherwise it SHALL call the body directly with byte-identical behavior to today.

- **GIVEN** a same-server window switch via `navigateToWindow`
- **WHEN** `document.startViewTransition` exists, `prefers-reduced-motion: reduce` is not set, an outgoing terminal window is in view (`windowParam` non-empty), and both current + target windows resolve to a direction (R1 returns non-null)
- **THEN** the body runs inside `document.startViewTransition` with the resolved direction set on the document root immediately before the call
- **AND** when any gate condition fails (no VT support, reduced motion, no outgoing window, or missing direction), the body runs directly — the instant switch preserved unchanged
- **AND** the wrapper is fire-and-forget: it never awaits the transition's completion in a way that blocks navigation, and a new `startViewTransition` while one is in flight degrades to the browser's native skip (no queueing / debouncing)

#### R3: Direction is published as a root data attribute
Immediately before `startViewTransition`, the resolved direction SHALL be written to `document.documentElement.dataset.windowSwitchDirection` (`"up"` | `"down"`), following the existing `data-theme` root-attribute pattern, so the View-Transition CSS pseudo-elements can key off it.

- **GIVEN** a gated transition about to run with direction `"up"`
- **WHEN** the wrapper sets the root attribute and calls `startViewTransition`
- **THEN** `:root[data-window-switch-direction="up"]` selectors match during the transition
- **AND** the attribute reflects the last computed direction (down for the inverse case)

### Transition: CSS animation (pure transform, no layout change)

#### R4: Only the terminal surface slides, via pure transforms
A `view-transition-name` SHALL be assigned to the terminal content container (the element wrapping the `TerminalClient` / `IframeWindow` branch in `app.tsx`) so only the terminal region animates; sidebar, top bar, and bottom bar stay static. The `::view-transition-old`/`::view-transition-new` pseudo-elements for that name SHALL animate via pure `transform: translateY(...)` keyframes (~180ms ease-out), with direction variants keyed off `:root[data-window-switch-direction="up"|"down"]`.

- **GIVEN** a gated `"up"` transition
- **WHEN** the browser captures old + new snapshots and runs the animation
- **THEN** the outgoing snapshot translates up and out while the incoming surface translates up and in, over ~180ms with an ease-out timing curve
- **AND** the animation is transform-only — no width/height/layout property is animated, so the terminal container's `ResizeObserver` / `fitAndSync` path never fires and tmux sees no resize churn
- **AND** the `"down"` variant animates the inverse direction
- **AND** the UA's default pseudo-element animations are fully neutralized so the 180ms slide governs the transition's LIFETIME, not just its visuals: `::view-transition-old/new(root)` get `animation: none` (no ~250ms root cross-fade) AND `::view-transition-group(root), ::view-transition-group(terminal-surface)` get `animation: none` — without the group rule, the UA's default ~250ms group animations hold the pseudo-tree (and the pointer-dead window, and `transition.finished`) alive past the slide (probe-measured ~250-290ms; revised after cycle-2 review)

### Transition: First-paint-gated new-state capture (polished variant)

#### R5: The new-state snapshot is gated on the incoming window's first inbound bytes, released at message-receipt time, with a timeout
`startViewTransition`'s async callback SHALL perform the navigation and then await a one-shot "first inbound terminal bytes after the switch" signal with a ~300ms timeout measured from callback entry. The signal SHALL be fired at message-RECEIPT time — inside `ws.onmessage` in `terminal-client.tsx`, on both the text and binary branches, BEFORE the write/coalesce decision — and SHALL remain identity-filtered by `openForNotify()` (opened only once the `selectWindow` POST resolves, so the outgoing window's in-flight bytes cannot release it). On timeout the capture proceeds ungated.

> **Why receipt-time, not write-time (revised after cycle-2 review, probe-confirmed)**: `startViewTransition` suppresses rendering while the update callback runs, and rAF callbacks DO NOT fire during suppression. The coalesced flush (`flushToTerminal`) is reachable only via `scheduleFlush`'s `requestAnimationFrame`, and a tmux redraw's first chunk (~4KB) always exceeds `IMMEDIATE_WRITE_MAX_BYTES` — so a write-time signal is structurally unreleasable on the common path and every animated switch degenerates to the full 300ms freeze. `ws.onmessage` is a macrotask and runs during suppression. Releasing there is safe for capture correctness: the pending rAF flush runs at the first rendering opportunity after the callback resolves — the same rendering update in which the new state is captured — so the received bytes are painted into the captured frame.

- **GIVEN** a gated transition to a terminal (non-iframe) window
- **WHEN** the wrapper navigates in the async callback and the incoming window's first bytes are RECEIVED (`ws.onmessage`, gate open) within the ~300ms budget
- **THEN** the gate releases at receipt time — during render suppression, without waiting for any rAF — and the new-state snapshot (captured in the same rendering update as the pending flush's paint) shows the incoming content, so the surface slides in painted, not blank
- **AND** bytes received while the gate is NOT yet open (before the `selectWindow` POST resolves) do not release it
- **AND** when no gated bytes arrive within ~300ms of callback entry, the capture proceeds after the timeout (old content slides in and repaints when redraw bytes arrive — today's behavior plus motion); the callback duration stays hard-capped regardless of the POST's fate
- **AND** an iframe-target switch (no terminal receipt seam) uses the ungated capture (the gate is terminal-only)

### Transition: Scope boundaries

#### R6: Transitions apply only on the same-server terminal-route switch seam, uniformly across input methods
The wrapper SHALL live on `navigateToWindow` alone, so it applies identically to sidebar clicks, command-palette `Window: Switch to …` entries, TopBar breadcrumb navigation, and SessionTiles clicks. Cross-server navigation, board routes, and the Cockpit SHALL be untouched. A SessionTiles → terminal switch with no outgoing window SHALL skip the transition (R2 gate). iframe windows SHALL animate uniformly via the ungated capture (R5).

- **GIVEN** the four same-server switch entry points (sidebar, palette, breadcrumb, tiles)
- **WHEN** any of them triggers a same-server switch with an outgoing window in view
- **THEN** the gated transition runs (keyboard-driven palette switches animate identically to mouse clicks, satisfying constitution V structurally)
- **AND** a cross-server switch (which takes the separate `navigate` branch, not `navigateToWindow`) runs with no transition
- **AND** a first switch from SessionTiles (`windowParam` empty) is an instant switch

### Transition: Progressive-enhancement fallbacks

#### R7: No View Transitions support or reduced motion yields today's instant switch
Browsers without `document.startViewTransition` and users with `prefers-reduced-motion: reduce` SHALL get the unwrapped instant switch with zero functional change. Any `Document.startViewTransition` typing gap SHALL be closed with a narrow type guard, not an `as` cast.

- **GIVEN** a browser without View Transitions support OR a user with reduced motion enabled
- **WHEN** `navigateToWindow` is called
- **THEN** the body runs directly (no `startViewTransition`), identical to pre-change behavior
- **AND** the feature detection uses type narrowing (a guard), not a type assertion

### Testing

#### R8: E2E flake control via reduced-motion emulation
`app/frontend/playwright.config.ts` SHALL set `reducedMotion: "reduce"` in the shared `use` block so existing window-switch e2e specs run against instant switches (the product's own reduced-motion fallback), unchanged.

- **GIVEN** the Playwright config `use` block (currently `baseURL` + `trace`)
- **WHEN** `reducedMotion: "reduce"` is added
- **THEN** all e2e specs emulate reduced motion, disabling the transition via the same media-query fallback the product honors
- **AND** existing window-switch specs assert against instant switches with no animation-induced flake
- **AND** exactly ONE dedicated spec opts back in via `test.use({ reducedMotion: "no-preference" })` and exercises the ANIMATED path end-to-end: it performs a same-session window switch and asserts the switch completes (new window's content visible / transition finished) within a sane latency bound (e.g. well under 1s), so a regression that re-introduces a systematic gate-timeout freeze is caught by the suite (revised after cycle-2 review: previously zero coverage of the animated path existed anywhere in the pyramid)

#### R9: Unit coverage for direction computation and wrapper skip conditions
Colocated Vitest unit tests SHALL cover the direction pure function (up / down / missing-index / equal-index cases) and the wrapper's gate/skip decision (no VT support, reduced motion, no outgoing window, missing direction).

- **GIVEN** the direction helper and the gate-decision logic
- **WHEN** the unit tests run
- **THEN** each up/down/skip case for direction is asserted
- **AND** each gate-failure branch (falls through to instant switch) is asserted

### Non-Goals

- A true macOS-Spaces clone (two live terminal surfaces sliding past each other) — architecturally blocked by (server, owning session) relay identity.
- A gesture-scrubbed interactive swipe — out of scope; requires both surfaces live.
- Queueing or debouncing rapid switches — a new transition natively skips the in-flight one (accepted degradation to instant switch).
- Any backend / Go change, new route, or persistent state.

### Design Decisions

1. **Direct `document.startViewTransition` over TanStack Router's `viewTransition` option**: wrap the `navigateToWindow` body directly — *Why*: the polished variant (R5) needs `startViewTransition`'s async-callback seam to await a custom first-paint signal, which the router option does not expose — *Rejected*: `navigate({ viewTransition: true })` (no async-await seam).
2. **Snapshot-based slide over live two-terminal slide**: capture the outgoing terminal as a static compositor snapshot — *Why*: the WebGL canvas is not readable via `toDataURL` without `preserveDrawingBuffer`, and the relay's (server, owning session) identity forbids two live views of one session's windows — *Rejected*: two-live-terminal macOS clone, per-window pin-session churn.
3. **Direction from raw SSE `flatWindows` order**: compute direction from `flatWindows` indices — *Why*: matches the sidebar's vertical arrangement; the sidebar's local drag-reorder override (`orderOverrideRef`) is component-local, so a transient reorder window may briefly disagree until SSE confirms — *Accepted*: rare and self-healing (per intake §2).
4. **First-paint signal at the three write seams, not `consumePendingReset` alone**: arm a one-shot fired from the coalesced flush (`terminal-client.tsx` ~:751), immediate text write (~:840), and immediate binary write (~:850) — *Why*: same-session switches ride the existing WebSocket with no reconnect, so `pendingReset` (armed only in `connect()`) never fires on the common path — *Rejected*: keying the signal off `consumePendingReset`/reconnect alone (misses the common same-session case).

## Tasks

### Phase 1: Setup

- [x] T001 Add `reducedMotion: "reduce"` to the shared `use` block in `app/frontend/playwright.config.ts`, alongside `baseURL` and `trace`. <!-- R8 -->

### Phase 2: Core Implementation

- [x] T002 Create a pure direction helper `windowSwitchDirection(order, currentId, targetId): "up" | "down" | null` in `app/frontend/src/lib/window-transition.ts` (new file): `null` on missing/equal index; `"up"` when target index > current; `"down"` when target index < current. Duration kept CSS-only (globals.css owns 180ms). <!-- R1 -->
- [x] T003 Added `viewTransitionSupported()` narrow type guard in `window-transition.ts` (`typeof document.startViewTransition === "function"`, no `as` cast). Ambient augmentation NOT needed — the installed TS `dom` lib (5.7+) already declares `ViewTransition` + `Document.startViewTransition`. <!-- R7 -->
- [x] T004 Added pure `shouldAnimateWindowSwitch(opts)` in `window-transition.ts` returning true only when all gate conditions pass (VT support, not reduced motion, outgoing window present, direction non-null). <!-- R2 R7 -->
- [x] T005 Reworked the first-write gate in `window-transition.ts` to a per-transition `SwitchGate` token behind `beginWindowSwitchGate()` (opens a gate, FIRES any prior pending gate on supersession so a queued VT callback runs immediately), `notifyFirstWrite()` (releases the current gate only when it is `acceptingNotify`), and a `settleGate()` with a still-points-at-itself stale-timer guard. Window identity via `openForNotify()` — the wrapper opens the gate to writes only after the selectWindow POST resolves, so a busy outgoing window's bytes can't release it early; total wait stays timeout-bounded. Dropped the inert `armFirstWrite`, un-exported `WindowSwitchDirection`/`FIRST_WRITE_TIMEOUT_MS` (zero external importers), and replaced the `intake §5` comment ref with self-contained wording. <!-- R5 --> <!-- rework(c3, REVISED REQUIREMENTS — see R5): must-fix M1 (probe-confirmed): the write-time release seams are structurally unreleasable during VT render suppression (rAF does not fire; coalesced flush is rAF-only; redraw chunks ~4KB >> IMMEDIATE_WRITE_MAX_BYTES=64; wroteImmediatelyThisFrame's rAF reset locks out even small chunks), so every animated switch ate the full 300ms freeze. MOVE the release to message-RECEIPT time: call notifyFirstWrite() inside ws.onmessage on BOTH the text and binary branches, BEFORE the write/coalesce decision (terminal-client.tsx); remove the notify calls from the three write seams. openForNotify/post-POST filtering transfers unchanged. Also: un-export WindowSwitchGate (zero external importers — same criterion as WindowSwitchDirection); make the provenance comment reader-directed (describe behavior, not review history); fix the 'type guard' comment on viewTransitionSupported (it returns plain boolean, no type predicate) --> <!-- done(c3): moved notifyFirstWrite() to ws.onmessage (top of handler, before the write/coalesce branch, fires on both text+binary) and removed all three write-seam calls (flushToTerminal + both immediate branches) in terminal-client.tsx; un-exported WindowSwitchGate (confirmed zero external importers — app.tsx imports beginWindowSwitchGate, not the type); rewrote the SwitchGate JSDoc reader-directed + receipt-time; fixed viewTransitionSupported wording to "plain boolean, not a type predicate". just check clean; 876/876 frontend tests pass. -->
- [x] T006 Assigned `view-transition-name: terminal-surface` to the terminal content container `<div>` in `app/frontend/src/app.tsx` (the shared wrapper around the TerminalClient/IframeWindow branch), merged with the fixed-width style. <!-- R4 -->
- [x] T007 Added `::view-transition-old/new(terminal-surface)` keyframes to `app/frontend/src/globals.css`: pure `translateY` slide, 180ms ease-out, up/down variants keyed off `:root[data-window-switch-direction]`; default cross-fade disabled. Added the probe-verified containment `::view-transition-image-pair(terminal-surface) { overflow: clip; }` so the sliding snapshots stay inside the terminal region instead of escaping over the top bar/bottom bar/sidebar. Rework(c2): disabled the ROOT snapshot pair's UA default cross-fade too (`::view-transition-old(root), ::view-transition-new(root) { animation: none; }`) so the root swaps instantly — only the 180ms terminal slide animates, and the chrome that changes across the nav (sidebar highlight, breadcrumb) swaps instantly instead of cross-fading. <!-- R4 --> <!-- rework(c3, REVISED REQUIREMENTS — see R4): must-fix M2 (probe-confirmed): old/new animation:none does NOT shorten the transition — the UA's default ~250ms ::view-transition-group(*) animations keep the pseudo-tree, the pointer-dead window, and transition.finished alive ~250-290ms. Add the probe-verified line: ::view-transition-group(root), ::view-transition-group(terminal-surface) { animation: none; } and correct the comment's false duration claim --> <!-- done(c3): added `::view-transition-group(root), ::view-transition-group(terminal-surface) { animation: none; }` with a comment explaining group animations govern the transition's LIFETIME (pointer-dead window + transition.finished) past the slide; removed the false "governs the pointer-dead window at ~250ms rather than the 180ms slide" claim from the root old/new comment (that pair's animation:none is visual-only). -->

### Phase 3: Integration & Edge Cases

- [x] T008 Wrapped the body of `navigateToWindow` in `app.tsx`: direction via `windowSwitchDirection` over a render-synced `switchTransitionRef`; gate via `shouldAnimateWindowSwitch`. Gated true → `beginWindowSwitchGate()` (fires any prior in-flight gate so a rapid second switch doesn't serialize behind the first's timeout), set `data-window-switch-direction`, `document.startViewTransition(...)`; gated false → `runSwitch()` directly. `runSwitch` returns the `selectWindow` POST so the gate opens to writes only after tmux is told to switch. Guarded `typeof window.matchMedia === "function"`; documented the pointer-input dead-window trade-off. Body byte-identical on the fallback path. Rework(c2): (1) MUST-FIX bounded callback — race-at-entry: no longer `await posted`; the callback now `void posted.then(() => gate.openForNotify()).catch(() => {})` then `await gate.waitForFirstWrite()`, so the ~300ms budget clock starts at callback entry and the callback is hard-capped regardless of a stalled `selectWindow` POST (no client fetch timeout); rewrote the false bounded-wait invariant comment in window-transition.ts. (2) SHOULD-FIX direction-attribute clobber — `transition.finished` FULFILLS on skip (not rejects); added a monotonic latest-wins token guard (`nextDirectionToken`/`isLatestDirectionToken` in window-transition.ts, mirroring the gate's still-points-at-itself pattern) so only the LATEST switch's `finally()` deletes `data-window-switch-direction`; fixed the comment. (3) NICE-TO-HAVE — commented that `beginWindowSwitchGate()` is load-bearing on the iframe path (fires a prior pending terminal gate) and clarified the single narrowed `!animate || !direction` guard. <!-- R2 R3 R5 R6 -->
- [x] T009 First-write gate is terminal-only: iframe targets (tracked in `switchTransitionRef.iframeIds`) skip the gate and don't await — ungated capture. Aligned the `iframeIds` predicate with the render branch (`rkType === "iframe" && rkUrl`, app.tsx:1354) so an iframe-typed window with no `rkUrl` — which renders a TerminalClient — stays on the gated first-write path instead of silently skipping the gate. Confirmed cross-server switches take the `navigate` branch in `handleSidebarSelectWindow`, never `navigateToWindow` — no transition there, no code change. <!-- R6 R5 -->

### Phase 3.5: Animated-Path Coverage

- [x] T012 New e2e spec `app/frontend/tests/e2e/window-switch-transition.spec.ts` (+ companion `.spec.md` per constitution Test Companion Docs): `test.use({ reducedMotion: "no-preference" })` to opt back into the animated path; perform a same-session window switch and assert the new window's content is visible / the switch completes within a sane latency bound (well under 1s), guarding against a regression that re-introduces a systematic gate-timeout freeze (cycle-2 review S1: the animated path previously had zero coverage anywhere in the pyramid). Run via `just test-e2e "window-switch-transition"`. <!-- R8 --> <!-- done(c3): spec creates a 2-window session (distinct echo markers per window), deep-links into window A (outgoing window present → R2 gate satisfied), asserts VT support, clicks window B's sidebar row (the navigateToWindow seam), and asserts B's marker paints in __rkTerminals[idB].buffer AND the data-window-switch-direction attribute clears — both within a 1s bound. Companion .spec.md written per constitution Test Companion Docs. NOTE: `reducedMotion` is NOT a top-level `use` fixture in Playwright 1.59.1 (confirmed via lib/index.js _combinedContextOptions destructure — reducedMotion only reaches the context via contextOptions); used `contextOptions: { reducedMotion: "no-preference" }` and corrected the config's T001 top-level `reducedMotion: "reduce"` to `contextOptions: { reducedMotion: "reduce" }` so the reduced-motion emulation R8 mandates actually takes effect (the top-level form was silently ignored + tsc-unchecked since the config is outside the tsconfig include). Spec passes: 1 passed, ~4.9s, exit 0. -->

### Phase 4: Polish

- [x] T010 [P] Colocated unit tests `app/frontend/src/lib/window-transition.test.ts`: `windowSwitchDirection` (up/down/missing-current/missing-target/equal/empty → null), `shouldAnimateWindowSwitch` (all-pass → true; each gate failure → false), and `viewTransitionSupported`. First-write gate covers the API: write-after-openForNotify resolves, timeout resolves, pre-openForNotify writes ignored (post-selectWindow gating), no-op when no gate open, supersession fires the pending gate immediately (synchronous, no serialization, no timers pending), a superseded gate's stale timer can't clobber a newer gate's wait, waitForFirstWrite on an already-superseded gate resolves immediately, and a stray post-settle notify doesn't resolve a fresh gate early. Rework(c2): added the bounded-wait regression (waitForFirstWrite resolves within its budget even when the chained POST NEVER settles — the stalled-selectWindow case), a chained-`.then` openForNotify test (writes before the POST resolves are still ignored; a write after the chained openForNotify runs releases the gate), and a `direction-attribute latest-wins guard` block covering `nextDirectionToken`/`isLatestDirectionToken` (fresh token is latest; a superseded earlier token is not; monotonic). No existing test encoded the old await-posted-first shape (that shape lived in app.tsx, not this pure module). 26 tests. <!-- R9 R1 R2 R7 --> <!-- rework(c3): adjust tests to the receipt-time semantics (the gate module API is unchanged — openForNotify/notify/wait — so most tests carry over; rename/adjust any wording that assumes write-time release; keep the stalled-POST and latest-wins regressions) --> <!-- done(c3): module API unchanged, so all gate tests carry over; added a describe-block note that the release is now receipt-time (notify fired from ws.onmessage) and the tests drive notifyFirstWrite() directly so they are caller-agnostic; renamed write-time-implying test names/comments to "notify"/"receipt". Kept the stalled-POST bounded-wait regression and the latest-wins direction-token block verbatim. All tests pass in the 876/876 run. -->
- [x] T011 Re-ran verification gates after the cycle-2 rework edits: `just check` (tsc --noEmit) clean; `just test-frontend` 858/858 pass (incl. the 26 window-transition tests — 21 prior + 5 new: the stalled-POST bounded-wait regression, the chained-`.then` openForNotify filter, and 3 direction-token latest-wins tests — plus untouched terminal-client/app tests). A-004 region containment addressed by the `::view-transition-image-pair` clip (T007); root cross-fade now also disabled (T007). A-014 (bounded callback) resolved by the T008 race-at-entry rework. The reduced-motion e2e fallback keeps existing window-switch specs animation-free. `just build`'s trailing Go step remains gated on the pre-existing missing untracked `VERSION` file (worktree infra gap, out of scope for this frontend-only change). <!-- R8 R9 --> <!-- rework(c3): re-run just check + just test-frontend after the receipt-time move; run the new animated-path spec via just test-e2e "window-switch-transition" --> <!-- done(c3): all three gates green after the c3 edits — `just check` (tsc --noEmit) clean; `just test-frontend` 876/876 pass (50 files); `just test-e2e "window-switch-transition"` → 1 passed (~4.9s), recipe exit 0 (trailing pnpm ELIFECYCLE is cosmetic teardown noise from the cleanup trap, not a test failure). -->

## Execution Order

- T002, T003, T004 are all in `window-transition.ts` — implement together (T002/T003 independent, T004 depends on the `"up"|"down"|null` type from T002).
- T005 (terminal-client signal), T006 (view-transition-name), T007 (CSS) are independent of the `lib` work and of each other — parallelizable after Phase 1.
- T008 depends on T002/T003/T004 (helpers) and T005 (first-write signal) and T006 (named element).
- T009 depends on T008.
- T010 depends on T002/T004. T011 runs last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `windowSwitchDirection` is a pure exported helper returning `"up"`/`"down"`/`null` from flattened-order indices, with unit coverage.
- [x] A-002 R2: `navigateToWindow` wraps its body in `document.startViewTransition` when all gate conditions hold and runs it directly otherwise, with byte-identical instant-switch behavior on the fallback path.
- [x] A-003 R3: The resolved direction is written to `document.documentElement.dataset.windowSwitchDirection` immediately before `startViewTransition`.
- [x] A-004 R4: A `view-transition-name` is on the terminal content container and `::view-transition-old/new` animate via pure `translateY` transforms, ~180ms ease-out, with up/down variants. — **Verified (re-review, cycle 1)**: the `::view-transition-image-pair(terminal-surface) { overflow: clip; }` rule in globals.css contains the slide. Independently re-verified with a fresh headless-Chromium probe (shell layout, animations frozen mid-slide at 25% via `Animation.currentTime`, screenshot pixel-sampled): without the clip the old/new snapshots paint over the top bar and bottom bar; with it, top bar / sidebar / bottom bar pixels are intact and the slide seam stays inside the terminal region. Spec semantics agree: the image-pair wraps both snapshot images at the named element's captured geometry (UA `inset: 0` within the group), so `overflow: clip` confines their painting to the terminal region.
- [x] A-005 R5 (revised c3): The new-state capture awaits a one-shot first-inbound-bytes signal fired at message-RECEIPT time (ws.onmessage, both branches, before the write/coalesce decision), identity-filtered by openForNotify, with a ~300ms budget from callback entry; iframe targets use the ungated capture. The gate is releasable DURING VT render suppression (no rAF dependency). — **Met (c3)**: `notifyFirstWrite()` moved to the top of `ws.onmessage` in terminal-client.tsx (fires on both text+binary before the write/coalesce branch); the three write-seam calls removed. openForNotify post-POST filtering unchanged. The animated e2e spec (T012) confirms the switch completes well under 1s — no systematic freeze.
- [x] A-006 R6: The wrapper lives only on `navigateToWindow`; cross-server / board / Cockpit paths are untouched; SessionTiles-with-no-outgoing-window skips the transition.
- [x] A-007 R7: Without VT support or with reduced motion, the switch runs instantly with zero functional change; feature detection uses a type guard, not an `as` cast.
- [x] A-008 R8: `playwright.config.ts` emulates reduced motion in the shared `use` block. — **Corrected (c3)**: set via `contextOptions: { reducedMotion: "reduce" }` — `reducedMotion` is not a top-level `use` fixture in Playwright 1.59.1 (it only reaches the browser context through `contextOptions`), so the original top-level form was silently ignored at runtime and tsc-unchecked (config is outside the tsconfig include). The `contextOptions` form actually takes effect.

### Behavioral Correctness

- [x] A-009 R4: A window switch produces no resize churn — no layout-affecting CSS property is animated (transforms only), so `ResizeObserver`/`fitAndSync` do not fire during the slide.
- [x] A-010 R2: A new `startViewTransition` during an in-flight one degrades to an instant switch (native skip) — no queueing/debouncing introduced.

### Scenario Coverage

- [x] A-011 R9: Unit tests exercise up/down/skip direction cases and each gate-failure branch of the wrapper decision.
- [x] A-012 R8: Existing window-switch e2e specs (e.g. `sidebar-window-sync`, `sidebar-keyboard-nav`) pass under reduced-motion emulation.

### Edge Cases & Error Handling

- [x] A-013 R1: A just-created window not yet in `flatWindows` (missing index) yields a `null` direction → instant switch, no crash.
- [x] A-014 R5: A same-session switch (rides the existing WebSocket, no reconnect) still fires the first-inbound-bytes signal at message-receipt time (`ws.onmessage`, revised c3 from the write seams) and gates correctly; a timeout after 300ms proceeds to an ungated capture. — **Met (cycle 2)**: T008 rework applies the race-at-entry shape — the callback no longer `await`s the `selectWindow` POST; it CHAINS `openForNotify` off the POST (`void posted.then(() => gate.openForNotify()).catch(() => {})`) and awaits only `gate.waitForFirstWrite()`, whose ~300ms timeout clock starts at callback entry. The callback duration is therefore hard-capped at the budget regardless of the POST's fate (a stalled `selectWindow` — no client fetch timeout — can no longer freeze the document past ~300ms, and a rapid second switch never queues behind a stalled POST). Post-POST `openForNotify` still filters the outgoing window's in-flight bytes. Regression covered by the new `waitForFirstWrite` stalled-POST unit test.

- [x] A-019 R4 (added c3): UA default group animations are neutralized (`::view-transition-group(root/terminal-surface) { animation: none; }`) — the transition's lifetime (pointer-dead window, `transition.finished`) is governed by the ~180ms slide, not the UA's ~250ms group default. — **Met (c3)**: T007 added the group `animation: none` rule to globals.css; the T012 spec's direction-attribute-cleared assertion (cleared within the 1s bound) guards the lifetime collapse.
- [x] A-020 R8 (added c3): One dedicated e2e spec opts into the animated path (`reducedMotion: "no-preference"`) and asserts a same-session animated switch completes within a sane latency bound. — **Met (c3)**: `window-switch-transition.spec.ts` (+ companion `.spec.md`) opts in via `test.use({ contextOptions: { reducedMotion: "no-preference" } })` and asserts the switch completes (incoming marker painted + direction attribute cleared) under 1s. Passes.

### Code Quality

- [x] A-015 Pattern consistency: New code follows the surrounding naming/structural patterns (pure exported helper like `resolveServerView`/`computeKillRedirect` in `lib`; root data attribute like `data-theme`).
- [x] A-016 No unnecessary duplication: Existing utilities and patterns (`flatWindows`, the `navigateToWindow` seam, `FocusedTerminalContext` if used for signal plumbing) are reused rather than reimplemented.
- [x] A-017 Type narrowing over assertions: `Document.startViewTransition` feature detection uses a type guard, not an `as` cast (code-quality principle).
- [x] A-018 Tests included: New behavior (direction computation, gate decision) is covered by colocated unit tests per code-quality; UI transition covered structurally by the reduced-motion e2e fallback.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Direction is a pure exported helper `windowSwitchDirection` in a new `src/lib/window-transition.ts`, tested colocated | Matches the established `resolveServerView`/`computeKillRedirect` pure-fn + colocated-test pattern; intake specifies the flattened-order heuristic exactly | S:90 R:90 A:90 D:90 |
| 2 | Certain | Root data attribute `data-window-switch-direction` set before `startViewTransition`, CSS keys off `:root[data-window-switch-direction=...]` | Intake §2/§3 specify this; mirrors the existing `data-theme` root-attribute pattern | S:90 R:90 A:90 D:90 |
| 3 | Certain | 180ms ease-out pure `translateY` transforms; CSS owns the duration (no shared JS constant unless needed) | Intake §3 + assumption 7; transform-only guarantees no ResizeObserver/fitAndSync churn | S:85 R:95 A:90 D:85 |
| 4 | Certain | E2E flake control via `reducedMotion: "reduce"` in the shared `use` block of `playwright.config.ts` | Intake §8 + assumption 6; config verified to have only `baseURL`+`trace` today | S:85 R:95 A:90 D:90 |
| 5 | Certain | Progressive enhancement: no VT support or reduced motion → unwrapped instant switch; feature detect via a narrow type guard, not `as` | Intake §7 + assumption 5; code-quality mandates type narrowing over assertions | S:90 R:95 A:95 D:90 |
| 6 | Confident | First-paint signal is a one-shot armed by the wrapper and fired from the three terminal write seams (`terminal-client.tsx` ~751/840/850), plumbed via an optional prop or `FocusedTerminalContext` registration | Intake §4 + assumption 8 verified against code (same-session switch rides the WS, `pendingReset` never fires on the common path); exact plumbing left a plan-time decision — a ref-based one-shot armed by the wrapper is the minimal seam | S:70 R:80 A:80 D:70 |
| 7 | Confident | `startViewTransition` is called with an async callback that navigates then awaits `firstWriteOrTimeout(300)`; iframe targets resolve ungated | Intake §4/§6 + assumption 12 (ship the polished variant, which subsumes basic); the async seam is the stated reason for the direct-call choice | S:75 R:85 A:75 D:75 |
| 8 | Confident | The gate decision is extracted as a pure `shouldAnimateWindowSwitch` so the four gate conditions are unit-testable in isolation from `document`/`matchMedia` | Intake §8 requires unit coverage of "wrapper skip conditions"; extracting the decision keeps the test DOM-free, matching the pure-fn testing pattern | S:70 R:90 A:80 D:70 |
| 9 | Confident | `view-transition-name: terminal-surface` goes on the shared terminal content container `<div>` (app.tsx:1273-1318 branch wrapper), covering both TerminalClient and IframeWindow uniformly | Intake §3/§6 assumption 10 (iframe animates uniformly, wrapper targets the shared container not xterm) | S:70 R:85 A:80 D:70 |

9 assumptions (5 certain, 4 confident, 0 tentative).
