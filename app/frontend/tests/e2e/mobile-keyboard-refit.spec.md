# mobile-keyboard-refit.spec.ts

Mobile keyboard open/collapse refit guardrails. Simulates the iOS on-screen
keyboard with a width-constant viewport height drop/restore — the exact signal
`useVisualViewport` keys on (`height` delta > `KEYBOARD_DELTA_PX` at constant
width) — with `hasTouch: true` so `pointer: coarse` matches. Guards two
regressions:

1. **Terminal refit** — the surface-layout mobile tile must *size* the
   terminal. A content-sized tile (no `flex-1` on the mobile tile wrapper)
   pins xterm at its 80×24 default: the canvas measures the tile, which
   measures the canvas, so the terminal never expands when the keyboard
   collapses (the "xterm view doesn't expand" iPhone bug).
2. **Bottom-bar safe floor** (260805-fi9m) — `--bottom-bar-floor` must be
   1rem on coarse pointers while the keyboard is collapsed and drop to 6px
   while `html.kb-open` is set.

## Shared setup

- `test.use` pins an iPhone-sized viewport (375×812) with `hasTouch: true`.
- `beforeAll`/`afterAll` create and kill a dedicated session; the test adds
  its own `probe` window (own session — never collides with other specs).
- Navigation is a direct `page.goto` — `_ready`'s `gotoWindow` waits on the
  sidebar's Connected dot, which the closed mobile drawer never shows; the
  terminal-registry rows poll is the mobile-compatible readiness signal.

## Tests

### `keyboard open/collapse: xterm+tmux refit and the bottom-bar floor toggles`

**What it proves:** The terminal grid tracks the viewport through a keyboard
open/collapse cycle end to end (xterm rows AND the tmux pane), and the
bottom-bar safe floor toggles with the keyboard signal.

**Steps:**
1. Create a `probe` window, resolve its windowId, goto the terminal route.
2. Poll `window.__rkTerminals[windowId].rows > 10` (terminal ready).
3. Baseline: assert `pointer: coarse` matches, `kb-open` absent, rows > 30
   (24 is the content-sized-tile fixed point — the regression tripwire), and
   the toolbar's computed `padding-bottom` is `16px` (raised floor).
4. Shrink the viewport to 375×512 (−300px, width constant — "keyboard open").
5. Poll `html.kb-open` present; poll rows < baseline (terminal shrank);
   assert the floor dropped to `6px`.
6. Restore the viewport to 375×812 ("keyboard collapsed").
7. Poll `kb-open` absent; poll rows ≥ baseline (terminal re-expanded); poll
   tmux `pane_height ≥ rows − 2` (tmux was told — 2 status lines); assert the
   floor returned to `16px` and `--app-height` is `812px`.
