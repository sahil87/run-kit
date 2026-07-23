# tooltips.spec.ts

Tier-1 tooltip system guardrails (260722-73al): the styled `Tip` component
replaces native `title=` attributes on interactive chrome controls. The first
three tests prove the approved behaviors native titles could not deliver —
keyboard visibility (Constitution V), the styled quiet-card presentation with
no OS double-bubble, and full suppression on touch devices. The second
describe (260723-fm08) covers the two surfaces the 73al migration left bare:
sidebar PANE register labels and bottom-bar key chips.

## Shared setup

- `Tier-1 tooltips (Tip)` describe — no tmux session fixtures: every test
  navigates to the tmux Server route (`/${TMUX_SERVER}`), whose top bar
  renders the L3 always-block (theme / refresh / help) with tipped controls
  at the default desktop viewport.
- The coarse-pointer test installs an init script that mocks
  `window.matchMedia("(pointer: coarse)")` as matching (the
  `mobile-touch-scroll.spec.ts` precedent) — desktop Chromium cannot flip the
  real pointer media feature.
- `Register-label and chip tips (260723-fm08)` describe — fully mocked (the
  `pane-register-panel.spec.ts` idiom): the state socket is mocked with one
  session/window so the terminal route (`/default/1`) renders the PANE
  registers and the bottom bar; `/ws/terminals` is stubbed and
  `/api/servers` + window-select are fulfilled inline.

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

### `hovering a PANE register label opens its plain-words tip`

**What it proves:** The sidebar PANE register labels (terse 3-char keys like
`out`) carry tier-1 tips naming the register in plain words (260723-fm08).
The label is a non-focusable span, so the tip is hover-only — no new tab
stops were added for a non-actionable element (the 73al connection-dot
precedent).

**Steps:**
1. Navigate to `/default/1` (mocked backend) and wait for the
   `register-output` row to be visible.
2. Hover the exact-text `out` label span inside the row.
3. Assert a `role="tooltip"` element becomes visible reading
   "Output activity".

### `hovering the ⌘K chip shows its tip with the keycap slot`

**What it proves:** The bottom-bar key chips (bare symbol glyphs) carry
tier-1 tips (260723-fm08); the ⌘K chip pairs its "Command palette" label
with the canonical shortcut rendered as a real `<kbd>` keycap chip, and the
migration contract holds (no native `title` on the chip).

**Steps:**
1. Navigate to `/default/1` (mocked backend) and wait for the
   `Open command palette` chip to be visible.
2. Assert the chip has NO `title` attribute.
3. Hover the chip; assert the `role="tooltip"` element becomes visible,
   contains "Command palette", and its `<kbd>` reads "⌘K".
