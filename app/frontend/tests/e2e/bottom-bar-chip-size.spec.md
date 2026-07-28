# bottom-bar-chip-size.spec.ts

Uniform chip sizing in the bottom bar at mobile width: every visible button in
the `Terminal keys` toolbar (Tab, `^`, `⌥`, `F▴`, the ArrowPad trigger, `>_`,
`⌘K`, and the coarse-only `⌨` toggle) must render the exact same box. All chips
share one class (`KBD_CLASS` in `src/components/kbd-chip.ts`); a chip that
hardcodes its own size drifts — the ArrowPad trigger once shipped at 32×32
(`h-8 w-8`) next to 36×36 neighbors and never grew to the touch target.

## Shared setup

- Viewport is iPhone 14-sized (375×812) in both describes via `test.use`.
- The touch describe adds `hasTouch: true`, which flips Chromium's
  `(pointer: coarse)` media query — activating the Tailwind `coarse:` variant
  (the real 36×36 touch-target path) and revealing the coarse-only `⌨` chip.
- Chips are measured by `collectChipSizes`: every button inside
  `toolbar[name='Terminal keys']` via `getByRole` (accessibility-tree match, so
  pointer-hidden chips are excluded automatically), bounding boxes rounded to
  whole px. Popup contents (F▴ menu, arrow popup) stay closed and unmeasured.

## Tests

### `all chips share one size and meet the 36px touch target`

**What it proves:** On a touch device at mobile width the chip row is visually
uniform (one distinct width×height across all chips) and every chip meets the
36px minimum touch target from `coarse:min-h/w-[36px]`.

**Steps:**
1. Navigate to `/${TMUX_SERVER}` with `hasTouch: true` at 375×812.
2. Collect the size of every button in the `Terminal keys` toolbar.
3. Assert the set of distinct `width×height` values has exactly one entry
   (failure message lists every chip's label and size).
4. Assert each chip's width and height is `≥ 36`.

### `all chips share one size at mobile width`

**What it proves:** The fine-pointer branch of the pointer split (33×35 chips)
is just as uniform — a chip that hardcodes its own size diverges here even if
the coarse branch happens to match.

**Steps:**
1. Navigate to `/${TMUX_SERVER}` at 375×812 (no touch emulation).
2. Collect the size of every button in the `Terminal keys` toolbar.
3. Assert the set of distinct `width×height` values has exactly one entry.
