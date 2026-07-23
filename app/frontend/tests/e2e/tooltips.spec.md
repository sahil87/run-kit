# tooltips.spec.ts

Tier-1 tooltip system guardrails (260722-73al): the styled `Tip` component
replaces native `title=` attributes on interactive chrome controls. The three
tests prove the approved behaviors native titles could not deliver — keyboard
visibility (Constitution V), the styled quiet-card presentation with no OS
double-bubble, and full suppression on touch devices.

## Shared setup

- No tmux session fixtures: every test navigates to the tmux Server route
  (`/${TMUX_SERVER}`), whose top bar renders the L3 always-block
  (theme / refresh / help) with tipped controls at the default desktop
  viewport.
- The coarse-pointer test installs an init script that mocks
  `window.matchMedia("(pointer: coarse)")` as matching (the
  `mobile-touch-scroll.spec.ts` precedent) — desktop Chromium cannot flip the
  real pointer media feature.

## Tests

### `keyboard focus opens the styled tip immediately`

**What it proves:** Tooltips are visible to keyboard users — `Tip` opens on
`:focus-visible` with no delay and wires the ARIA tooltip pattern
(`role="tooltip"` + `aria-describedby` on the anchored control). Native
titles were mouse-only; this is the Constitution V fix.

**Steps:**
1. Navigate to `/${TMUX_SERVER}` and wait for the Refresh page button
   (top-bar chrome rendered).
2. Press Tab (bounded loop, ≤12 presses, keyboard modality from a fresh page)
   until the brand crumb (`RunKit home` link) is `document.activeElement`.
3. Assert a `role="tooltip"` element is visible and reads "Host" (the crumb's
   level name).
4. Assert the brand link carries `aria-describedby`.

### `hover opens the styled tip (label + dim note), no native title bubble`

**What it proves:** Hover shows the styled quiet-card tip after the open
delay, the old parenthesized shortcut text ("(Shift+click: force reload)")
now renders as the dim modifier note ("⇧click: force"), the native `title`
attribute is gone wherever `Tip` landed (no OS bubble doubling the styled
tip), and Escape dismisses.

**Steps:**
1. Navigate to `/${TMUX_SERVER}` and wait for the Refresh page button.
2. Assert the button has NO `title` attribute.
3. Hover the button; assert the `role="tooltip"` element becomes visible and
   contains both "Refresh page" and "⇧click: force".
4. Press Escape; assert the tooltip is gone.

### `coarse pointers get no tooltip layer at all`

**What it proves:** Under `pointer: coarse` the `Tip` layer is fully
suppressed — no tooltip on hover or focus, and no `aria-describedby` wiring —
the control's `aria-label` alone carries the name (there is no long-press
tooltip on touch).

**Steps:**
1. Install the coarse-pointer matchMedia mock (init script), then navigate to
   `/${TMUX_SERVER}`.
2. Hover AND focus the Refresh page button.
3. Wait past the 300ms open delay (600ms), assert zero `role="tooltip"`
   elements.
4. Assert the button has no `aria-describedby` attribute.
