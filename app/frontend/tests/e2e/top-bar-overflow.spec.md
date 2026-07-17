# top-bar-overflow.spec.ts

Regression proof for the top-bar **overflow chevron menu** (260715-h1ck) and for
the review **M1** fix (the measured right cell must FILL its `1fr` grid track,
not be content-sized). On the pre-M1 code the right cell measured only the exempt
block, so `computeVisibleCount`'s budget went negative and `visibleCount`
deadlocked at 0 — NOTHING rendered in-bar at any width. The wide-width in-bar
assertions here fail on that code and pass on the fixed code.

Covers the intake §8 width sweep (1280 → 1024 → 800 → 700 → 640 → 500 → 375):
(a) no top-bar bounding-box overlap; (b) L1 drops before L2 before L3; (c) the
chevron menu contains exactly the dropped controls + the version row; (d) the
version row copies to the clipboard; (e) exempt items (chevron, dot) always
visible; (f) a menu action (theme cycle) works from the menu.

## Shared setup

- Real isolated tmux server (`rk-test-e2e`, port 3020 via `just test-e2e`). A
  dedicated session with an extra named window (`overflow-win-<ts>`) so the
  terminal route renders the control-rich right cluster (L1 splits + fixed-width,
  L2 Aa + close, L3 theme/refresh/help). The ViewSwitcher block adds a SECOND,
  **web-capable** long-named window (`overflow-view-long-worktree-<ts>` with a
  non-empty `@rk_url` ⇒ `[tty|web]`) so the lens pill actually renders (it is
  terminal-only and gated on a multi-view window; the tty-only window above has
  no view-switcher candidate, so the pyramid tests are unaffected by this change).
- `resolveWindow`/`gotoWindow` (from `_ready.ts`) resolve the window id and
  navigate to `/${server}/${id}`.
- In-bar control visibility is measured via accessible-name ROLE queries
  (`getByRole`/`getByLabel`), which exclude the always-present off-screen `inert`
  + `aria-hidden` measurement-probe copy — a match means the control is in-bar.
  The ViewSwitcher's in-bar presence is likewise checked via its
  `role="group"` name `Window view` (the probe copy is aria-hidden, so
  `getByRole` never matches it — unlike `getByTestId("view-toggle")`, which
  would). `intersects()` is the standard rect-overlap helper (shared shape with
  `top-bar-overlap.spec.ts`).

## Tests

### `the chevron + dot are always visible and the top bar never overlaps across the width sweep`

**What it proves:** the exempt chevron and connection dot render at every width
(e), and the right cluster never overlaps the center heading or the breadcrumb
nav, with no horizontal page overflow (a).

**Steps:**
1. Navigate to the long-named terminal window.
2. For each width in the sweep: assert the `More controls` chevron and the
   `role="status"` dot are visible; assert the right cell's box does not intersect
   the heading box nor the nav box; assert `document.body.scrollWidth ≤ width`.

### `controls overflow in pyramid order (L1 before L2 before L3) as width shrinks`

**What it proves:** the M1 fix (in-bar controls exist at wide widths) AND the
pyramid drop order — overflow consumes from the front, so L1 empties before L2
starts dropping and L2 empties before L3 starts dropping; each tier's in-bar count
is monotonic non-increasing as width shrinks; at 375px everything has overflowed.

**Steps:**
1. At 1280px assert at least some L3 controls render in-bar (the direct M1
   regression assertion — pre-fix this is 0).
2. Sweep the widths; at each, count in-bar members of L1 / L2 / L3 (`:visible`,
   probe excluded). Assert L1 and L2 counts are non-increasing; assert L2 is full
   while any L1 is in-bar and L3 is full while any L2 is in-bar.
3. At 375px assert the total in-bar control count is 0.

### `the chevron menu contains exactly the overflowed controls plus the version row`

**What it proves:** at 375px (everything overflowed) the menu lists every mapped
control row plus the always-present version row (c).

**Steps:**
1. At 375px open the `More controls` menu.
2. Assert the Split vertical / Split horizontal / Fixed width (checkbox) / Close
   pane / Theme: / Refresh page / Help / Documentation rows are present, plus a
   `Run Kit` version row.

### `the version row copies the version to the clipboard`

**What it proves:** clicking the version row copies the displayed version form (d).

**Steps:**
1. Grant clipboard permissions; open the menu at 375px.
2. Read the version row's text; click it.
3. If the row shows `Run Kit v…` (a version was reported), assert the clipboard
   holds the `v…` form; if it is the plain `Run Kit` (no version yet), the copy is
   a no-op and the clipboard assertion is skipped.

### `a menu action (theme cycle) works from the menu`

**What it proves:** a menu action mutates app state from within the menu (f).

**Steps:**
1. Open the menu at 375px; read the `Theme: {current}` row label.
2. Click the theme row (cycles system → light → dark → …).
3. Reopen the menu and assert the theme row label changed.

## Tests — ViewSwitcher is the first-to-drop candidate (260717-6anu)

Uses the web-capable long-named window (see Shared setup) so the `[tty|web]` lens
pill renders. `@rk_url` is stamped via `tmux set-option -w` before navigating.

### `the ViewSwitcher pill is present in-bar at a wide width`

**What it proves:** the pill is the widest control and the first registry
candidate, so it fits in-bar only when the WHOLE terminal cluster fits — a
generous desktop width (1440px) clears it, so the lens pill renders in-bar (the
`Window view` group is in the accessibility tree). At the 1280px "Desktop Chrome"
default the pill has already correctly yielded.

**Steps:**
1. Navigate to the web-capable window; set 1440×800.
2. Assert the renamable heading is visible, then assert the `Window view` group
   (accessibility-tree query) is visible.

### `the ViewSwitcher drops FIRST — before any L1 split — as width shrinks`

**What it proves:** the pill is the first registry candidate, so it yields before
any L1 split — whenever the pill is still in-bar, EVERY L1 split must also be
in-bar (equivalently, the pill leaves before L1 does).

**Steps:**
1. Navigate to the web-capable window.
2. Sweep 1440 → 1280 → … → 375 (`[1440, ...WIDTHS]`), gating on the renamable
   heading each iteration. At each width, if the in-bar `Window view` group is
   present assert every L1 split is also in-bar (in-bar L1 count == `L1.length`);
   record whether the pill was seen both in-bar and dropped across the sweep.
3. Assert the sweep exercised both sides of the threshold (pill seen in-bar at
   some wide width AND dropped at some narrow width).
4. At 375px assert the in-bar `Window view` group has count 0 (definitely dropped).

### `the collapsed switcher renders per-view rows and a row activation switches the lens`

**What it proves:** when collapsed, the pill is represented as per-view `View:`
menu rows (active row marked), and clicking a row switches the lens.

**Steps:**
1. Navigate to the web-capable window; set 375×800 (the pill is overflowed).
2. Open the `More controls` chevron menu.
3. Assert the `View: Terminal` and `View: Web` rows are visible; the default tty
   lens marks `View: Terminal` `aria-pressed="true"` and `View: Web`
   `aria-pressed="false"`.
4. Click `View: Web`; assert the URL gains `?view=web` and the proxied iframe
   (`title="Proxied content"`) renders.
5. Assert the chevron menu closed (the `View:` row is a `menuitem` activation, a
   single-shot menu action).
