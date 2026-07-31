# top-bar-overflow.spec.ts

Regression proof for the top-bar **overflow chevron menu** (260715-h1ck) and for
the review **M1** fix (the measured right cell must FILL its `1fr` grid track,
not be content-sized). On the pre-M1 code the right cell measured only the exempt
block, so `computeVisibleCount`'s budget went negative and `visibleCount`
deadlocked at 0 — NOTHING rendered in-bar at any width. The wide-width in-bar
assertions here fail on that code and pass on the fixed code.

Covers the intake §8 width sweep (1280 → 1024 → 800 → 700 → 640 → 500 → 375):
(a) no top-bar bounding-box overlap; (b) L1 drops before L2 before L3; (c) the
chevron menu contains the dropped + menuOnly rows + the version row, grouped
under View / Window / App section labels (260731-oiho); (d) the version row
copies to the clipboard; (e) the exempt chevron is always visible (the
connection dot left the bar in 260724-6j1v — it lives in the sidebar footer);
(f) a menu action (fixed-width toggle) works from the menu; (g) the three
demoted controls (fixed-width, Aa, close-pane — `menuOnly` since 260731-oiho)
render in-bar NOWHERE at any width while their rows are ALWAYS in the menu.
Since 260731-oiho the terminal fit tiers are: L1 = the ONE merged split control
(primary segment `Split vertically`), L2 = empty, L3 = Refresh — the in-bar end
state is Open · Split(▾) · Refresh · chevron.

## Shared setup

- Real isolated tmux server (`rk-test-e2e`, port 3020 via `just test-e2e`). A
  dedicated session with an extra named window (`overflow-win-<ts>`) so the
  terminal route renders the right cluster (the merged split control + refresh
  in-bar; fixed-width / Aa / close-pane are menuOnly rows). The ViewSwitcher
  block adds a SECOND, **web-capable** long-named window
  (`overflow-view-long-worktree-<ts>` with a non-empty `@rk_url` ⇒ `[tty|web]`)
  so the switcher's `View:` menu rows actually render (the entry is
  terminal-only and gated on a multi-view window; the tty-only window above
  contributes no view-switcher rows, so the pyramid tests are unaffected).
- `resolveWindow`/`gotoWindow` (from `_ready.ts`) resolve the window id and
  navigate to `/${server}/${id}`.
- In-bar control visibility is measured via accessible-name ROLE queries
  (`getByRole`/`getByLabel`), which exclude the always-present off-screen `inert`
  + `aria-hidden` measurement-probe copy — a match means the control is in-bar.
  The ViewSwitcher is `menuOnly` as of 260722-n2n4, so its absence is checked two
  ways: no accessible `role="group"` named `Window view` (no in-bar pill) AND no
  `view-toggle` testid anywhere in the DOM (the probe carries no pill copy either
  — fit candidates only). The 260731-oiho demotions ride the same mechanism, so
  their never-in-bar checks reuse the role-query approach (`MENU_ONLY` list).
  `intersects()` is the standard rect-overlap helper (shared shape with
  `top-bar-overlap.spec.ts`).

## Tests

### `the chevron is always visible (no bar dot) and the top bar never overlaps across the width sweep`

**What it proves:** the exempt chevron renders at every width while the bar
carries NO `role="status"` connection dot (260724-6j1v — the dot moved to the
sidebar footer) (e), the right cluster never overlaps the center heading or
the breadcrumb nav with no horizontal page overflow (a), and the three demoted
menuOnly controls render in-bar NOWHERE at any width (g, 260731-oiho).

**Steps:**
1. Navigate to the long-named terminal window.
2. For each width in the sweep: assert the `More controls` chevron is visible
   and the right cell contains zero `role="status"` elements; assert the
   in-bar count of the `MENU_ONLY` trio (fixed-width / Aa / close-pane) is 0;
   assert the right cell's box does not intersect the heading box nor the nav
   box; assert `document.body.scrollWidth ≤ width`.

### `controls overflow in pyramid order (L1 before L2 before L3) as width shrinks`

**What it proves:** the M1 fix (in-bar controls exist at wide widths) AND the
pyramid drop order — overflow consumes from the front, so L1 (the merged split
control) empties before L3 (Refresh) starts dropping (L2 is empty since the
260731-oiho demotions); each tier's in-bar count is monotonic non-increasing as
width shrinks; at 375px the pyramid's front (the L1 split) has overflowed — the
lightened 260731-oiho cluster deliberately keeps the L3 Refresh in-bar at the
mobile leaf, so the ORDER (not an all-gone cliff) is the contract.

**Steps:**
1. At 1280px assert at least some L3 controls render in-bar (the direct M1
   regression assertion — pre-fix this is 0).
2. Sweep the widths; at each, count in-bar members of L1 / L2 / L3 (accessible-name
   role queries, probe excluded), re-reading until two consecutive (L1, L2, L3)
   snapshots agree — the three tier reads are not atomic, and the
   ResizeObserver-driven overflow recompute can re-render between them, so
   invariants are asserted on a settled layout, not a transient frame. Assert L1
   and L2 counts are non-increasing; assert L2 is full while any L1 is in-bar and
   L3 is full while any L2 is in-bar.
3. At 375px assert the L1 in-bar count is 0 (the split has overflowed).

### `the chevron menu contains the overflowed + menuOnly rows plus the version row, grouped under section labels`

**What it proves:** at 375px the menu lists the overflowed split rows (the
merged entry's two one-action rows) and the menuOnly trio's rows plus the
always-present version row, grouped under the View / Window / App uppercase
section labels (c, 260731-oiho). Refresh (L3) survives in-bar at the mobile
leaf on the lightened cluster, so its row is deliberately NOT asserted.

**Steps:**
1. At 375px open the `More controls` menu.
2. Assert the Split vertical / Split horizontal / Fixed width (checkbox) /
   Terminal font (stepper group) / Close pane rows are present, plus a `RunKit`
   version row; assert the View / Window / App section labels render; assert
   the Theme: / Help / Documentation / notification rows are ABSENT
   (260724-6j1v — that chrome left the top bar entirely).

### `the menuOnly rows (fixed-width / Aa / close-pane) are in the menu even at a WIDE width`

**What it proves:** the 260731-oiho demotion is menu-ONLY, not space-driven —
at 1280px the bar has room (the split control is in-bar) yet the demoted trio
still renders only as menu rows; and an in-bar entry's rows are NOT duplicated
into the menu.

**Steps:**
1. Navigate to the terminal window; set 1280×800; gate on the in-bar
   `Split vertically` segment.
2. Assert the in-bar count of the `MENU_ONLY` trio is 0.
3. Open the menu; assert the Fixed width checkbox row, the Terminal font stepper
   group, and the Close pane row are present; assert NO `Split vertical` row
   (the split is in-bar, so it contributes no menu rows).

### `the version row copies the version to the clipboard`

**What it proves:** clicking the version row copies the displayed version form (d).

**Steps:**
1. Grant clipboard permissions; open the menu at 375px.
2. Read the version row's text; click it.
3. If the row shows `RunKit v…` (a version was reported), assert the clipboard
   holds the `v…` form; if it is the plain `RunKit` (no version yet), the copy is
   a no-op and the clipboard assertion is skipped.

### `a menu action (fixed-width toggle) works from the menu`

**What it proves:** a menu action mutates app state from within the menu (f).
The theme row left the menu (260724-6j1v), so the fixed-width checkbox row is
the representative stateful menu action.

**Steps:**
1. Open the menu at 375px; read the `Fixed width` row's `aria-checked`.
2. Click the row (the checkbox activation closes the menu).
3. Reopen the menu and assert the `aria-checked` state flipped; click once more
   to restore the default full-width preference for later specs.

## Tests — ViewSwitcher is menu-only (260722-n2n4)

Uses the web-capable long-named window (see Shared setup) so the `[tty|web]`
multi-view gate passes. `@rk_url` is stamped via `tmux set-option -w` before
navigating. The `view-switcher` registry entry carries `menuOnly: true`: the
segmented pill never renders in-bar (the chat lens isn't ready, so the pill must
not advertise itself inline), and the per-view `View:` rows in the "More
controls" chevron menu are the switcher's ONLY rendering at every width.

### `the pill never renders in-bar at any width; the `View:` rows are always in the menu`

**What it proves:** the menu-only contract — the pill has no bar slot and no
measurement-probe copy at ANY width (including 1440px, where the whole cluster
has room and the pre-n2n4 pill rendered in-bar), while the `View:` menuitemradio
rows are present in the chevron menu at both extremes of the sweep.

**Steps:**
1. Navigate to the web-capable window.
2. Sweep 1440 → 1280 → … → 375 (`[1440, ...WIDTHS]`), gating on the renamable
   heading each iteration. At each width assert the accessible `Window view`
   group has count 0 (no in-bar pill) AND `getByTestId("view-toggle")` has count
   0 (no pill copy anywhere in the DOM — bar or probe).
3. At 1440px and 375px open the `More controls` menu and assert the
   `View: Terminal` and `View: Web` rows are visible; Escape-close between
   widths.

### `split-vertical is the first fit candidate to yield — the menuOnly pill costs zero fit pixels`

**What it proves:** with the view-switcher excluded from the fit, the leftmost L1
split is the new FIRST fit candidate — whenever `Split vertically` is still
in-bar, nothing has dropped yet, so every L1/L2/L3 control is also in-bar (the
surviving set is a suffix of the fit order). Retargets the former first-to-drop
coverage (the pre-n2n4 pill) onto the new first candidate.

**Steps:**
1. Navigate to the web-capable window.
2. Sweep `[1440, ...WIDTHS]`, gating on the renamable heading each iteration; at
   1440px gate on a RETRYING `Split vertically` visibility expect (post-resize
   re-fit settle). At each width, if `Split vertically` is in-bar assert the full
   L1+L2+L3 in-bar count.
3. Assert split-vertical was seen in-bar at some wide width; then at 375px assert
   a RETRYING in-bar count of 0 (definitely dropped at the mobile leaf).

### `a `View:` row activation switches the lens and closes the menu — even at a wide width`

**What it proves:** the menu rows are a fully functional lens switcher at a WIDE
width — the distinguishing menu-only case (the bar has room, yet the switcher
lives only in the menu): the active row is marked, activation switches the lens,
and the menu closes.

**Steps:**
1. Navigate to the web-capable window; set 1440×800.
2. Open the `More controls` chevron menu.
3. Assert the `View: Terminal` and `View: Web` rows (each a `role="menuitemradio"`)
   are visible; the default tty lens marks `View: Terminal` `aria-checked="true"`
   and `View: Web` `aria-checked="false"`.
4. Click `View: Web`; assert the URL gains `?view=web` and the proxied iframe
   (`title="Proxied content"`) renders.
5. Assert the chevron menu closed (the `View:` row is a `menuitemradio` activation,
   a single-shot menu action) and no in-bar pill appeared after the switch.
