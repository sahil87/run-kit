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
(f) a menu action (fixed-width toggle) works from the menu; (g) the demoted
controls (fixed-width, Aa, close-pane — `menuOnly` since 260731-oiho — plus
the relocated Help / Keyboard / Theme… chrome rows, `menuOnly` since
260812-d1at) render in-bar NOWHERE at any width while their rows are ALWAYS in
the menu; (h) the Settings gear (260812-d1at, relocated from the sidebar
footer) is a real fit candidate — the LAST one (Refresh drops before it) —
rendering in-bar between Refresh and the chevron at desktop widths.
Since 260812-d1at + 260812-ab5v the terminal fit tiers are: L1 = the merged split control
(primary segment `Split horizontally` — the default flipped from vertical in
260806-2x2h) + the ▦ Layout chip (260812-ab5v R9 — a fit candidate right after
`split`; overflowed, it renders one `Layout: …` radio row per arity-valid
shape), L2 = empty, L3 = Refresh + Settings gear — the in-bar end state is
Open · Split(▾) · ▦Layout · Refresh · Gear · chevron · rail-toggle (rail
toggle desktop-only, 260812-nm4p).

## Shared setup

- Real isolated tmux server (`rk-test-e2e`, port 3020 via `just test-e2e`). A
  dedicated session with an extra named window (`overflow-win-<ts>`) so the
  terminal route renders the right cluster (the merged split control + refresh
  in-bar; fixed-width / Aa / close-pane are menuOnly rows). The retired
  ViewSwitcher block adds a SECOND, **web-capable** long-named window
  (`overflow-view-long-worktree-<ts>` with a non-empty `@rk_url` ⇒ `[tty|web]`)
  so the palette's `View: Web` action actually renders (the palette gates on a
  multi-view window; the tty-only window above contributes no lens actions, so
  the pyramid tests are unaffected).
- `resolveWindow`/`gotoWindow` (from `_ready.ts`) resolve the window id and
  navigate to `/${server}/${id}`.
- In-bar control visibility is measured via accessible-name ROLE queries
  (`getByRole`/`getByLabel`), which exclude the always-present off-screen `inert`
  + `aria-hidden` measurement-probe copy — a match means the control is in-bar.
  The ViewSwitcher is RETIRED (260812-0c6o), so its absence is checked two
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
control + the ▦ Layout chip, 260812-ab5v) empties before L3 (Refresh ·
Settings gear) starts dropping (L2 is empty since the 260731-oiho demotions);
each tier's in-bar count is monotonic non-increasing as width shrinks WITHIN
each viewport regime — the desktop-only rail toggle (260812-nm4p) unmounts
below 640px, shrinking the trailing exempt block, so the monotonic baseline
resets once at the desktop→mobile crossing while the per-width pyramid-order
assertions run unconditionally; at 375px the pyramid's front (both L1 members)
has overflowed while the L3 tail survives — the ORDER (not an all-gone cliff)
is the contract.

**Steps:**
1. At 1280px assert at least some L3 controls render in-bar (the direct M1
   regression assertion — pre-fix this is 0).
2. Sweep the widths; at each, count in-bar members of L1 / L2 / L3 (accessible-name
   role queries with EXACT string matching — a substring "Layout" would
   false-positive on sidebar window rows carrying the worktree slug; the probe
   is excluded), re-reading until two consecutive (L1, L2, L3)
   snapshots agree — the three tier reads are not atomic, and the
   ResizeObserver-driven overflow recompute can re-render between them, so
   invariants are asserted on a settled layout, not a transient frame. Assert L1
   and L2 counts are non-increasing (re-baselining once when the sweep crosses
   the 640px mobile boundary, where the desktop-only rail toggle unmounts and
   frees trailing width); assert L2 is full while any L1 is in-bar and
   L3 is full while any L2 is in-bar.
3. At 375px assert the L1 in-bar count is 0 (split AND layout chip overflowed;
   Refresh survives — the ORDER, not an all-gone cliff, is the contract).

### `the chevron menu contains the overflowed + menuOnly rows plus the version row, grouped under section labels`

**What it proves:** at 375px the menu lists the overflowed split rows (the
merged entry's two one-action rows), the overflowed ▦ Layout chip's
`Layout: Single` radio row (260812-ab5v — one row per arity-valid shape; this
1-tile window has just the one), the menuOnly trio's rows, and the relocated
App-section chrome rows (260812-d1at: Help — run-kit docs, Keyboard shortcuts,
Theme…), plus the always-present version row — grouped under the View /
Window / App uppercase section labels (c, 260731-oiho). Whichever L3 controls
still fit at 375px stay in-bar (the suffix rule), so no Refresh / Settings row
is asserted either way.

**Steps:**
1. At 375px open the `More controls` menu.
2. Assert the Split horizontal / Split vertical (the merged entry emits
   horizontal first — the 260806-2x2h default) / `Layout: Single` (radio) /
   Fixed width (checkbox) / Terminal font (stepper group) / Close pane rows
   are present, plus a `RunKit` version row; assert the View / Window / App
   section labels render; assert the Help / Keyboard shortcuts / Theme… rows
   are PRESENT (260812-d1at) and the notification row is ABSENT (260724-6j1v —
   the bell lives in the settings dialog).

### `the menuOnly rows (fixed-width / Aa / close-pane / Help / Keyboard / Theme…) are in the menu even at a WIDE width`

**What it proves:** the 260731-oiho demotion is menu-ONLY, not space-driven —
at 1280px the bar has room (the split control is in-bar) yet the demoted trio
AND the menuOnly chrome rows render only as menu rows; the Settings gear is a
real fit candidate, rendering in-bar between Refresh and the chevron; and an
in-bar entry's rows are NOT duplicated into the menu.

**Steps:**
1. Navigate to the terminal window; set 1280×800; gate on the in-bar
   `Split horizontally` segment.
2. Assert the in-bar count of the `MENU_ONLY` trio and of the Help / Keyboard
   shortcuts / Theme… rows is 0; assert the `Open settings` gear is visible
   in-bar with a bounding box between Refresh's and the chevron's.
3. Open the menu; assert the Fixed width checkbox row, the Terminal font
   stepper group, the Close pane row, and the three chrome rows are present;
   assert NO `Split horizontal` row and NO `Settings` row (both are in-bar,
   so they contribute no menu rows).

### `the App-section chrome rows work: Help links out, Keyboard opens the overlay, Theme… opens the selector`

**What it proves:** the relocated rows (260812-d1at) are functional, not just
present — Help is a safe external link, Keyboard shortcuts opens the
ShortcutsOverlay, and Theme… opens the theme selector (the retired footer
button's click-cycling is gone).

**Steps:**
1. Navigate to the terminal window; set 375×800; open the `More controls` menu.
2. Assert the Help row's `href` / `target="_blank"` / `rel="noopener…"`.
3. Click `Keyboard shortcuts`; assert the `shortcuts-overlay` testid is
   visible; Escape-close it.
4. Reopen the menu; click `Theme…`; assert the `Theme selector` dialog is
   visible; Escape-close it.

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
The fixed-width checkbox row is the representative stateful menu action (the
one-shot chrome rows — Keyboard / Theme… — have their own coverage above).

**Steps:**
1. Open the menu at 375px; read the `Fixed width` row's `aria-checked`.
2. Click the row (the checkbox activation closes the menu).
3. Reopen the menu and assert the `aria-checked` state flipped; click once more
   to restore the default full-width preference for later specs.

## Tests — the view-switcher is retired (260812-0c6o)

Uses the web-capable long-named window (see Shared setup) so the `[tty|web]`
multi-view gate passes. `@rk_url` is stamped via `tmux set-option -w` before
navigating. The ViewSwitcher is RETIRED: the palette's `View: …` actions are the
ONLY lens-switch surface — no pill in-bar, no `View:` rows in the chevron menu,
no `view-toggle` testid anywhere — and the VIEW menu section survives via the
sticky device-preference rows (Fixed width, Terminal font).

### `no `view-toggle` anywhere at any width; the menu carries no `View:` rows but keeps Fixed width + Terminal font`

**What it proves:** the removal contract — the retired switcher has no bar slot,
no menu rows, and no measurement-probe copy at ANY width (including 1440px,
where the whole cluster has room), while the VIEW section still carries the
Fixed width / Terminal font rows.

**Steps:**
1. Navigate to the web-capable window.
2. Sweep 1440 → 1280 → … → 375 (`[1440, ...WIDTHS]`), gating on the renamable
   heading each iteration. At each width assert the accessible `Window view`
   group has count 0 AND `getByTestId("view-toggle")` has count 0.
3. At 1440px and 375px open the `More controls` menu and assert NO `View:`
   menuitemradio rows, plus the Fixed width checkbox row and the Terminal font
   stepper group visible; Escape-close between widths.

### `the split control is the first fit candidate to yield`

**What it proves:** with the view-switcher gone, the leftmost L1
split (primary segment `Split horizontally` since 260806-2x2h) is the FIRST
fit candidate — whenever `Split horizontally` is still in-bar, nothing has
dropped yet, so every L1/L2/L3 control is also in-bar (the surviving set is a
suffix of the fit order).

**Steps:**
1. Navigate to the web-capable window.
2. Sweep `[1440, ...WIDTHS]`, gating on the renamable heading each iteration; at
   1440px gate on a RETRYING `Split horizontally` visibility expect (post-resize
   re-fit settle). At each width, if `Split horizontally` is in-bar assert the
   full L1+L2+L3 in-bar count.
3. Assert the split control was seen in-bar at some wide width; then at 375px
   assert a RETRYING in-bar count of 0 (definitely dropped at the mobile leaf).

### `a palette `View:` action switches the lens — even at a wide width`

**What it proves:** the palette is a fully functional lens switcher at a WIDE
width — the distinguishing case (the bar has room, yet the menu holds no `View:`
rows): running the palette's `View: Web` action switches the lens (R12's shim:
the selection becomes a `single:web` layout through the shared mutation path,
mirrored into the URL as `?layout=single:web`).

**Steps:**
1. Navigate to the web-capable window; set 1440×800; gate on the renamable
   heading.
2. Press `Meta+k`; fill `View: Web`; click the `View: Web` option.
3. Assert the decoded `layout` param reads `single:web` and the proxied iframe
   (`title="Proxied content"`) renders.
