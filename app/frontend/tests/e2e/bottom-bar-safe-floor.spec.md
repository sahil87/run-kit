# bottom-bar-safe-floor.spec.ts

Keyboard-aware safe-area floor on the bottom-bar toolbar (260805-fi9m).
`env(safe-area-inset-bottom)` resolves to 0 in in-browser iOS Safari for this
fixed-position app, so the corner-arc/home-indicator clearance comes from a
raised `--bottom-bar-floor` (1rem) on coarse pointers, applied only while the
on-screen keyboard is collapsed — `useVisualViewport` toggles `html.kb-open`
when the keyboard opens, dropping the floor back to 6px.

Chromium also reports `env()` as 0, so these tests assert exactly what is
honestly measurable: the floor arm of the `max()` expression and the `kb-open`
class flip. The `env()` arm and the real keyboard signal are out of e2e reach
(the signal derivation is unit-tested in `use-visual-viewport.test.ts`).

## Shared setup

- Viewport is iPhone 14-sized (375×812) in both describes via `test.use`.
- The touch describe adds `hasTouch: true`, which flips Chromium's
  `(pointer: coarse)` media query — activating the raised-floor rule in
  `globals.css`.
- Padding is read as the computed `padding-bottom` of the
  `toolbar[name='Terminal keys']` element.
- The keyboard-open state is simulated by adding/removing `kb-open` on
  `<html>` via `page.evaluate` — Playwright cannot summon a real on-screen
  keyboard.

## Tests

### `keyboard collapsed uses the raised floor; kb-open reverts to 6px`

**What it proves:** On a touch device the toolbar's bottom padding is the
raised 16px floor while the keyboard is collapsed (chips clear the phone's
curved corners), and setting the keyboard-open signal reverts it to 6px so no
padding is wasted above the keyboard — in both directions.

**Steps:**
1. Navigate to `/${TMUX_SERVER}` with `hasTouch: true` at 375×812.
2. Assert the toolbar's computed `padding-bottom` is `16px`.
3. Add `kb-open` to `<html>` via `page.evaluate`; assert it becomes `6px`.
4. Remove `kb-open`; assert it returns to `16px`.

### `the bar does not render, kb-open or not`

**What it proves:** On a fine pointer the bar is gated out of existence at any
width (260814-ldbs R3), so there is no floor to measure — and the `kb-open`
signal cannot resurrect it. The safe-floor rules are exercised only in the
touch describe above, where the bar exists.

**Steps:**
1. Navigate to `/${TMUX_SERVER}` at 375×812 (no touch emulation).
2. Assert the `Terminal keys` toolbar has count 0.
3. Add `kb-open` to `<html>`; assert the toolbar still has count 0.
