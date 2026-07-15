# window-switch-transition.spec.ts

Covers the ANIMATED window-switch path (the View Transitions slide, 260703-l4nf)
end-to-end. Every other e2e spec runs under the config-wide reduced-motion
emulation and therefore exercises the instant-switch fallback; this is the
single spec that opts back into motion
(`test.use({ contextOptions: { reducedMotion: "no-preference" } })`) so the
animated path has any coverage at all in the pyramid. It guards against a
regression that
re-introduces a systematic gate-timeout freeze — where the new-state snapshot's
first-inbound-bytes gate never releases (because the release moved off the
message-receipt seam, or a UA group animation holds the transition open) and the
switch hangs instead of completing.

Confirmation-gated motion (260715-38kg) made the slide an EARNED signal: it plays
only when the incoming bytes confirm within the ~300ms budget; a timeout SKIPS the
slide and shows a `LogoSpinner` pending mask; a failed switch bounces the URL back
to tmux truth. Those timing-sensitive branches (mask arm-at-timeout,
lift-on-late-write, failure bounce-back) cannot be forced deterministically against
a live relay on localhost, so they are UNIT-covered in
`src/lib/window-transition.test.ts` (settle reasons, the pure mask-signal state
machine, and the grace-timer parity). What this spec adds for the new behavior is
the deterministic fast-path invariant: a confirmed-fast switch plays the slide and
NEVER flashes the pending mask.

## Shared setup

- `test.use({ contextOptions: { reducedMotion: "no-preference" } })` — opts this
  file's tests into motion, overriding the config-wide reduced-motion emulation.
  `reducedMotion` is not a top-level `use` fixture in this Playwright version; it
  only reaches the browser context via `contextOptions`, so both the config and
  this override set it there. Without it the wrapper short-circuits to an instant
  switch and the transition never runs.
- `beforeAll` creates `e2e-switch-transition-<timestamp>` so the test has its own
  isolated session; `afterAll` kills it.
- `resolveWindowId(page, name)` polls `GET /api/sessions` until a window with the
  given name appears, returning its stable tmux window id (`@N`). The terminal
  route and the dev/e2e-only `window.__rkTerminals` registry are both keyed by
  window id, so the id is the handle for both URL navigation and buffer reads.
- `markerVisible(page, id, marker)` reads the live xterm `Terminal` from
  `window.__rkTerminals[id]` (populated only in dev/e2e builds) and scans its
  buffer for the marker text. The WebGL canvas is not DOM-readable, so the parsed
  buffer is the honest "content painted" signal — the same technique
  `echo-latency.spec.ts` uses.
- `SWITCH_COMPLETE_BUDGET_MS = 1000` — the sane latency bound. Deliberately loose
  (the gate's own budget is ~300ms) so it fails only on a genuine hang, not on
  ordinary localhost jitter.

## Tests

### `a same-session animated switch completes within a sane latency bound`

**What it proves:** A same-session window switch driven through the sidebar (the
`navigateToWindow` seam that wraps the body in `document.startViewTransition`)
completes — the incoming window's content becomes visible and the transition
tears down — well under 1s. A gate that never releases, or a UA group animation
that holds `transition.finished` open past the slide, would freeze the switch and
blow past the bound. It also proves the confirmation-gated-motion anti-stuck-mask
invariant (260715-38kg): the pending `LogoSpinner` mask is never left stuck once
the switch settles — SSE confirmation and any late incoming write lift it.

**Steps:**
1. Create two windows `xa-<ts>` and `xb-<ts>` in the shared session and
   `send-keys "echo <marker>" Enter` a distinct letter-only marker into each, so
   each pane carries unambiguous content that the incoming redraw repaints.
2. Navigate to `/${TMUX_SERVER}` (`gotoServerReady`) so the sidebar is populated;
   `resolveWindowId` both windows to their `@id`s.
3. Deep-link into window A's terminal (`/${TMUX_SERVER}/<idA>`) so there is an
   OUTGOING window in view — the R2 gate requires one (a first switch with no
   outgoing window is an instant switch, not the animated path under test).
4. Wait for `.xterm-screen` visible, A's terminal registered, and A's marker
   painted — the switch must start from a real, populated outgoing terminal.
5. Assert `document.startViewTransition` is a function (View Transitions
   support). Playwright's Desktop Chrome has it; asserting makes a runner that
   silently lacks it fail loudly rather than pass on the instant fallback.
6. Click window B's sidebar row button (the `navigateToWindow` seam) and start a
   wall clock.
7. Assert B's row becomes `aria-current="page"` — the switch was accepted.
8. Assert B's marker becomes visible in `__rkTerminals[idB]`'s buffer within
   `SWITCH_COMPLETE_BUDGET_MS`, and that the measured elapsed time is under the
   budget — the core anti-freeze guard.
9. Assert the `data-window-switch-direction` attribute the wrapper set on
   `<html>` is cleared within the budget — the transition's lifetime (pointer-dead
   window, `transition.finished`) settles on the slide's timeline, guarding the
   T007 group-animation neutralization.
10. Poll `.rk-window-switch-mask` to count 0 within the budget — the pending mask
    is NOT stuck once the switch settles. On a healthy switch the gate releases
    fast and the mask never arms; if localhost timing pushes the first confirmed
    write past the ~300ms budget the mask may briefly arm, but SSE confirmation
    (the `aria-current` in step 7) and any late incoming write MUST lift it. A
    regression that never lifts the mask (the stuck-mask class of bug) leaves it
    present and fails. Confirmation-gated motion (260715-38kg).
