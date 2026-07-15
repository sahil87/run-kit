# board-autofit.spec.ts

End-to-end contract for the per-board desktop **autofit toggle** (738w): the
top-bar board-mode toggle button, the `Board: Toggle Autofit` palette action
(Constitution V parity), the `DesktopRow` flex-fill layout branch (equal-share
panes ≤4, ~25% floor + horizontal scroll >4), the hidden resize handles while
on, the non-destructive round-trip (stored per-pane widths untouched), and the
per-board localStorage persistence across reload.

## Why these slices

Autofit is a pure-CSS desktop layout change driven by a persisted per-board
flag. Unlike the reorder specs (which avoid DnD simulation), autofit's
observable behavior IS the rendered layout, so the spec asserts real DOM
geometry — pane bounding-box widths and the scroll-row's `scrollWidth` vs
`clientWidth` — against a live desktop board built by pinning real idle tmux
windows via the API (the same deterministic setup as
`boards-desktop-suspend.spec.ts`). The button/palette parity and the
reload-persistence are asserted via the button's `aria-pressed`, which reflects
the same state both controls flip.

## Shared setup

- Viewport is fixed at **1920×900** so (a) fixed 480px panes leave an obvious
  dead strip on the row (the pain point) and (b) 25% of the scrollport (~480px)
  clears the 280px `BOARD_PANE_MIN_WIDTH` floor — the arithmetic under test is
  the percentage arm, not the 280px arm.
- `beforeAll` creates a fresh tmux session `e2e-board-autofit-<ts>` on
  `E2E_TMUX_SERVER` (default `rk-test-e2e`) with **6 windows** `win-0..win-5`,
  each running `sleep 300` so panes are stable and long-lived.
- `afterAll` unpins every tracked pin and kills the home session (best-effort;
  any surviving `_rk-pin-*` is reaped by the isolated-server global teardown).
- `windowIds()` resolves `win-0..win-5`'s tmux `window_id`s in index order.
- Helpers: `pin()` pins a window via `POST /api/boards/{board}/pin` (tracked for
  cleanup); `panes()` locates the desktop pane roots
  (`[role="group"][aria-label^="board pane"]`); `row()` locates the
  `.overflow-x-auto` scroll row; `autofitButton()` locates the top-bar
  `Toggle board autofit` button via `getByRole` — the accessibility-tree match
  excludes the always-present `aria-hidden` measurement probe copy
  (registry-driven overflow, 260715-h1ck; the 1920px viewport keeps the L2
  control in-bar).
- Each test uses fresh board names (`afa<ts>` / `afb<ts>`) and resets autofit to
  off + unpins at the end so a persisted localStorage key never leaks between
  tests.

## Tests

### `autofit ON with 2 panes fills the row equally with no horizontal scroll; OFF restores fixed widths`

**What it proves:** With 2 panes, autofit OFF leaves a large dead strip (fixed
480px panes don't fill a 1920px row) and shows resize handles; toggling ON via
the top-bar button makes the 2 panes equal-share flex items that fill the row
(total pane width jumps up) with no horizontal scroll and no resize handles;
toggling OFF restores the exact prior fixed-width layout (the stored per-pane
widths were never mutated).

**Steps:**
1. Pin `win-0..win-1` to board A; `goto /board/A`; assert 2 panes.
2. OFF baseline: read pane widths + row box; assert total pane width is well
   under the row width (dead strip); assert a `resize pane` handle is attached.
3. Assert the `Toggle board autofit` button is visible with
   `aria-pressed="false"`; click it; assert `aria-pressed="true"`.
4. ON: read pane widths; assert they are equal within 3px (flex 1 1 0); assert
   the total pane width jumped by >200px vs OFF (now fills); assert the row's
   `scrollWidth ≤ clientWidth + 2` (no scroll); assert 0 `resize pane` handles.
5. Click the button again; assert `aria-pressed="false"`; assert restored total
   pane width equals the OFF baseline within 3px; assert a handle is attached.
6. Unpin `win-0..win-1`.

### `autofit ON with 5 panes floors each at ~25% and the row scrolls horizontally`

**What it proves:** With 5 panes and autofit ON, each pane floors at ~25% of the
scrollport (the percentage arm resolves against the row's client/content box,
not the scrolled content width) and the row overflows horizontally — the
"max 4 visible, scroll past 4" behavior.

**Steps:**
1. Pin `win-0..win-4` to board A; `goto /board/A`; assert 5 panes.
2. Click the autofit button; assert `aria-pressed="true"`.
3. Read the row's `clientWidth`; read each pane width; assert each is within
   ~10px of `clientWidth × 0.25` (gap-adjusted `calc(25% - 3px)`).
4. Assert the row's `scrollWidth > clientWidth` (horizontal scroll present).
5. Toggle off; unpin `win-0..win-4`.

### `autofit preference persists per board across reload, and the palette action flips it`

**What it proves:** The `Board: Toggle Autofit` palette action flips the same
state the button reflects (Constitution V parity); the preference persists
per-board across a full page reload; and board B has its own independent key
(still off when board A is on).

**Steps:**
1. Pin 2 panes to board A and 2 panes to board B.
2. `goto /board/A`; assert 2 panes and `aria-pressed="false"`.
3. Open the palette (`Control+k`), filter `Toggle Autofit`, click the
   `Board: Toggle Autofit` option; assert the button now reads
   `aria-pressed="true"`.
4. `page.reload()`; assert board A's button is still `aria-pressed="true"`
   (persisted).
5. `goto /board/B`; assert `aria-pressed="false"` (per-board isolation).
6. Return to board A, reset it to off via the button, and unpin all panes.
