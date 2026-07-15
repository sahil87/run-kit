# Intake: Honest Window-Switch Feedback — Confirmation-Gated Motion

**Change**: 260715-38kg-window-switch-confirmed-motion
**Created**: 2026-07-15

## Origin

Created via `/fab-proceed` promptless dispatch from a design discussion in which the current
mechanism was verified in code and every key decision was made and user-approved. The user's
reported problem, verbatim intent:

> Clicking a window row in the sidebar always starts the window-switch slide animation, but
> arrival at the destination terminal is not certain — on a slow/bad network the terminal
> content doesn't change, so the animation is misleading.

The approved design: the slide becomes an **earned signal** (plays only when the incoming
window's first bytes confirmed arrival within the 300ms gate budget), gate timeout swaps the
stale terminal content for a **full LogoSpinner waiting mask** (never shown at click time),
the same first-write signal that releases the gate **lifts the mask** on late arrival, and a
silent `selectWindow` failure is **un-stuck** by an explicit-rejection-or-timeout bounce-back
of URL/heading to tmux's actual active window plus a lightweight failure hint. Non-VT and
reduced-motion browsers get the mask via a ~300ms grace timer.

## Why

**The pain point.** The window-switch slide (260703-l4nf) fires at click time,
unconditionally when its preconditions hold: `navigateToWindow` (`app/frontend/src/app.tsx`
~line 776) calls `document.startViewTransition` optimistically, the URL navigates
immediately, and the `selectWindow` POST is fire-and-forget with rejection swallowed by
`.catch(() => {})`. The first-write gate in `app/frontend/src/lib/window-transition.ts`
waits for the incoming window's first WebSocket bytes (`notifyFirstWrite` from
`TerminalClient`'s `ws.onmessage`, terminal-client.tsx ~line 840) but hard-caps at
`FIRST_WRITE_TIMEOUT_MS = 300` because `startViewTransition` suppresses document rendering
during its callback. **On timeout the slide plays anyway into unconfirmed content.**

On a same-session switch the terminal rides the existing WebSocket, so during a slow/failed
switch the pane keeps showing the OLD window's bytes — the slide animates the same content
"shifting", exactly the misleading experience reported. Worse, keystrokes typed during the
pending window go to the OLD window (the socket is still attached to it) — an input hazard
in an ops dashboard where "which window am I typing into" is safety-critical.

**The consequence of not fixing it.** Failure is silent and sticky: `pendingClickRef`
(app.tsx ~line 744) suppresses the SSE URL-writeback for as long as the URL matches the
click — it is event-driven with no timer. If the POST fails, SSE never confirms, leaving an
indefinite limbo: URL and top-bar heading say window B; tmux, terminal bytes, and the
sidebar highlight (SSE-derived) say window A. The animation actively lies, and there is no
recovery affordance.

**Why this approach.** Make each visual state an honest, distinct signal (see the state
vocabulary below) instead of letting one costume (the slide) cover four different outcomes.
Alternatives were considered and rejected in the design discussion:

- **Pessimistic navigation** (wait for confirmation before navigating) — contradicts the
  deliberate optimistic-navigation design; adds lag to every healthy switch.
- **Dimmed overlay over stale content** — still invites reading/typing into the wrong
  window; a full mask was chosen instead.
- **Extending the animation budget beyond 300ms** — impossible without freezing document
  rendering longer (View Transitions suppression).
- **A second animation on late arrival** — dilutes the slide's meaning; the slide stays
  exclusive to confirmed-fast arrival.

**Accepted costs** (explicitly accepted in the discussion): mediocre connections
(~400–600ms switches) show a spinner blink where today nothing unusual appears; switches
completing just over 300ms lose the slide. Accepted for an ops dashboard where input safety
outranks motion polish.

## What Changes

### 1. Gate settle-reason (`app/frontend/src/lib/window-transition.ts`)

The first-write gate reports HOW it settled instead of resolving `void`:

- `waitForFirstWrite()` resolves with a settle reason — `"first-write" | "timeout" |
  "superseded"`. `settleGate` carries the reason from its three callers: `notifyFirstWrite`
  → `first-write`; the gate timer → `timeout`; supersession by a newer
  `beginWindowSwitchGate` → `superseded`.
- `FIRST_WRITE_TIMEOUT_MS = 300` is unchanged — the cap is forced by View Transitions
  render suppression and must not be extended.
- All three existing concurrency guarantees are preserved verbatim: supersession fires the
  prior pending gate immediately; only the INCOMING window's bytes release the gate
  (`openForNotify()` chained off the resolved `selectWindow` POST); a stale timer never
  clobbers a newer gate (still-points-at-itself guard).
- A **mask signal** joins the module: the pending-switch state (mask armed at timeout,
  lifted on late first write, torn down on failure/supersession) is expressed as pure,
  unit-testable module logic alongside the gate — the same `notifyFirstWrite` receipt that
  releases the gate is the one signal that lifts the mask when bytes arrive late
  ("one signal drives everything", user-approved decision 3).

### 2. Confirmation-gated slide (`app/frontend/src/app.tsx`, `navigateToWindow` ~776)

The animation becomes an earned signal:

- Inside the `startViewTransition` callback, the wrapper awaits the gate and now receives
  the settle reason. **Released by bytes within 300ms → the slide plays** (fast path,
  byte-identical to today). **Timed out → call `transition.skipTransition()`** — no motion;
  the screen cuts to the (masked) new state.
- **Superseded → no slide and no mask from the superseded switch**; the newer switch's gate
  owns all feedback (the VT spec already skips the superseded transition's animation — the
  wrapper just must not arm a mask for it).
- The existing precondition ladder (`shouldAnimateWindowSwitch`: VT support, motion not
  reduced, outgoing window in view, direction resolvable) and the direction-token cleanup
  guard are unchanged.

### 3. Pending spinner mask (terminal area)

- **Trigger**: the 300ms gate-timeout decision — **NEVER at click time**. The fast path
  must never flash it (during the VT callback the screen is frozen on the old snapshot
  anyway, so early masking gains nothing).
- **Appearance**: the existing `LogoSpinner` component
  (`app/frontend/src/components/logo-spinner.tsx`) centered on the terminal background,
  fully hiding the stale bytes — a full waiting mask, not a dimmed overlay.
- **Input**: the mask blocks input to the old window — pointer AND keyboard. Keystrokes
  while masked are dropped, not buffered/replayed (the hazard being fixed is typing into
  the OLD window; replay into the new one would be its own surprise).
- **Lift**: the same `notifyFirstWrite` signal — when the incoming window's bytes arrive
  late, the mask lifts as a **cut** (at most a fast fade). No second slide; the slide stays
  exclusive to the fast path so it keeps meaning "arrived instantly".
- **Seam**: `TerminalClient`'s `ws.onmessage` receipt (terminal-client.tsx ~840) is the
  signal source; the exact overlay mount point (TerminalClient wrapper vs. the terminal
  area in app.tsx) is a plan-time implementation choice.
- Cross-session switches remount the terminal (new WS), so their slow path shows a
  blank/connecting pane rather than stale bytes — the mask applies uniformly at gate
  timeout for gated (tty) switches, which improves that blank state too. Non-tty targets
  (web iframe / chat lenses — the `ungatedIds` classification) keep today's ungated,
  mask-less behavior.

### 4. Failure bounce-back (`app.tsx` `pendingClickRef` writeback ~744)

Un-stick the silent-failure limbo:

- **On explicit `selectWindow` POST rejection**, or **no SSE confirmation within a
  confirmation window** (a few seconds — default ~5s as a named tunable constant), clear
  `pendingClickRef` so the existing SSE URL-writeback bounces URL and heading back to
  tmux's actual active window.
- Plus a **lightweight failure hint** (the existing toast system, `addToast`).
- The bounce-back MUST key off an explicit rejection or the timeout — **never** just "SSE
  still reports the old window", which is normal mid-switch.
- The confirmation timer arms wherever `pendingClickRef` is set (the click path ~789, the
  deep-link alignment effect ~727, the waiting-target navigation ~1873 all share the same
  sticky-limbo mechanics), and the mask (if armed) tears down on bounce.

### 5. Non-VT / reduced-motion parity

Browsers without `startViewTransition` support or with `prefers-reduced-motion` take the
instant-switch path today (no render-freeze phase exists for them). They get the mask via a
**~300ms grace timer**: armed at switch time, it shows the mask only if the first write has
not arrived by the threshold — same threshold as the gate, different mechanism, same
lift/failure semantics. This improves those browsers over today's stale-content limbo with
no signal at all.

### 6. Resulting state vocabulary (design intent)

| Signal | Meaning |
|--------|---------|
| slide | confirmed arrival (bytes within 300ms) |
| spinner mask | in transit — don't type |
| spinner → content cut | arrived late |
| spinner → bounce + hint | switch failed |

Heading/URL flip at click stays (= acknowledged intent); sidebar highlight stays
SSE-derived (= confirmation). No state shows another state's costume.

### 7. Tests

- **Unit**: extend `app/frontend/src/lib/window-transition.test.ts` — settle reasons for
  all three settle paths, mask-signal state machine (arm-at-timeout / lift-on-late-write /
  teardown-on-supersession-and-failure), preserved concurrency guarantees.
- **E2E**: update `app/frontend/tests/e2e/window-switch-transition.spec.ts` and its sibling
  `window-switch-transition.spec.md` **in the same commit** (constitution: Test Companion
  Docs). All test runs go through `just` recipes (`just test-frontend`, `just test-e2e` /
  `just pw`) — never direct playwright.
- Known pre-existing flake context (do not re-bisect as caused-by-this-change): the
  "Maximum update depth exceeded" console-error flake and the window-heading "◀ ▶ arrows"
  forward-nav flake both exist on clean main.

## Affected Memory

- `run-kit/ui-patterns`: (modify) extend the window-switch slide transition entry
  (View Transitions wrapper on `navigateToWindow`) with the confirmation-gated motion model
  — gate settle reasons, `skipTransition()` on timeout, the LogoSpinner pending mask +
  one-signal lift, failure bounce-back with confirmation window + toast hint, and the
  non-VT/reduced-motion grace-timer parity.

## Impact

- **Frontend-only** — no backend, API, or route changes (constitution IV holds).
- `app/frontend/src/lib/window-transition.ts` — gate settle-reason + mask signal (pure
  module logic).
- `app/frontend/src/lib/window-transition.test.ts` — unit coverage for the above.
- `app/frontend/src/app.tsx` — `navigateToWindow` (~776) skip-on-timeout + mask arming;
  `pendingClickRef` writeback (~744) confirmation-window un-sticking + failure toast.
- `app/frontend/src/components/terminal-client.tsx` — `notifyFirstWrite` call site (~840)
  / mask rendering seam.
- `app/frontend/src/components/logo-spinner.tsx` — reused as-is for the mask.
- Possibly `app/frontend/src/globals.css` — mask overlay styles (following the existing
  `rk-*` utility-class convention).
- `app/frontend/tests/e2e/window-switch-transition.spec.ts` + `.spec.md` sibling.
- Keyboard-first note (constitution V): dropping keystrokes while masked is deliberate
  input-safety behavior, not a keyboard-reachability regression — all switch affordances
  remain keyboard-driven.

## Open Questions

None — the design discussion resolved every key decision; the remaining latitude
(confirmation-window default value, hint form, mask-lift fade length) was explicitly
delegated and is recorded as Confident assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Slide becomes confirmation-gated: gate reports settle reason (`first-write`/`timeout`/`superseded`); only `first-write` within 300ms plays the slide; timeout → `transition.skipTransition()`, no motion | Discussed — user-approved decision 1; fast path stays byte-identical | S:95 R:85 A:90 D:95 |
| 2 | Certain | Pending mask = existing `LogoSpinner` centered on terminal background at the 300ms gate-timeout decision, never at click time; fully hides stale bytes and blocks input | Discussed — user chose full mask over dimmed overlay; never-at-click justified by VT freeze | S:95 R:80 A:90 D:90 |
| 3 | Certain | One signal drives everything: the same `notifyFirstWrite` that releases the gate lifts the mask on late arrival; lift is a cut (at most fast fade), never a second slide | Discussed — decision 3; second animation explicitly rejected | S:90 R:80 A:90 D:90 |
| 4 | Certain | Failure bounce-back keys off explicit POST rejection or a confirmation-window timeout — never "SSE still reports the old window"; clears `pendingClickRef` so the writeback bounces URL/heading, plus a lightweight failure hint | Discussed — decision 4 verbatim, including the never-mid-switch guard | S:90 R:75 A:85 D:90 |
| 5 | Certain | Non-VT / reduced-motion browsers get the mask via a ~300ms grace timer (no render-freeze phase there); same threshold, different mechanism | Discussed — decision 5 | S:90 R:85 A:85 D:90 |
| 6 | Certain | Optimistic navigation stays: heading/URL flip at click (= acknowledged intent), sidebar highlight stays SSE-derived (= confirmation) | Discussed — pessimistic navigation explicitly rejected | S:95 R:70 A:90 D:95 |
| 7 | Certain | Tests: unit coverage in `window-transition.test.ts`, e2e spec update with sibling `.spec.md` in the same commit, all runs via `just` recipes | Constitution (Test Companion Docs) + project testing rules determine this | S:85 R:90 A:95 D:90 |
| 8 | Confident | Confirmation-window default ~5s, a named tunable constant | User delegated the exact value ("a few seconds, exact value to tune"); trivially adjusted later | S:70 R:90 A:75 D:60 |
| 9 | Confident | Failure hint = existing toast system (`addToast`) | "Lightweight hint" + established project pattern; easily swapped | S:55 R:85 A:80 D:70 |
| 10 | Confident | Keystrokes while masked are dropped, not buffered/replayed into the new window | Design intent is input safety; replay would be its own surprise and adds complexity | S:60 R:80 A:75 D:70 |
| 11 | Confident | Mask applies uniformly to gated (tty) switches including cross-session (improves the blank/connecting slow path too); non-tty targets (web/chat, `ungatedIds`) keep ungated mask-less behavior | Follows "one signal" design; discussion scoped the hazard to tty content | S:60 R:80 A:75 D:65 |
| 12 | Confident | The confirmation timer arms wherever `pendingClickRef` is set (click ~789, deep-link alignment ~727, waiting-target ~1873) — all writers share the sticky-limbo mechanics | Discussion verified the click path; fixing at the shared seam is the root-cause form (per project norms), trivially narrowed if review disagrees | S:45 R:75 A:65 D:50 |
| 13 | Confident | A superseded switch arms neither slide nor mask — the newer switch's gate owns all feedback | Follows from settle-reason design + existing supersession semantics | S:65 R:80 A:80 D:75 |

13 assumptions (7 certain, 6 confident, 0 tentative, 0 unresolved).
