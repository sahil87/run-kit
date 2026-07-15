# mobile-layout.spec.ts

Responsive-layout guardrails: mobile viewports must not leak horizontal
overflow, must keep top-bar controls REACHABLE (via the overflow chevron menu
rather than vanishing — 260715-h1ck removed the `hidden sm:flex` cliff), and must
expose a drawer-style navigation that sits *below* (not over) the top bar.

## Shared setup

- `beforeEach` sets an iPhone 14-sized viewport (375×812) so every test
  starts from a mobile baseline. Tests that need desktop override with
  `page.setViewportSize` inline.

## Tests

### `page does not overflow horizontally`

**What it proves:** Layout never introduces a horizontal scrollbar at 375px.
A regression here is usually from an absolutely-positioned element or an
xterm.js canvas without `overflow: hidden` on its column.

**Steps:**
1. Navigate to `/${TMUX_SERVER}`.
2. Read `document.body.scrollWidth` via `page.evaluate`.
3. Assert it is `≤ 375` (the viewport width).

### `theme is reachable via the overflow menu on mobile (not a bare in-bar button)`

**What it proves:** 260715-h1ck removed the `hidden sm:flex` cliff — below the sm
breakpoint the theme control no longer VANISHES; it overflows into the
always-visible chevron menu, so mobile gains theme/refresh/help access it used to
lose entirely. There is no visible in-bar theme button at 375px, but opening the
chevron surfaces a `Theme: {current}` menu row.

**Steps:**
1. Navigate to `/${TMUX_SERVER}` (viewport is 375px).
2. Assert the `More controls` chevron is visible.
3. Assert the in-bar theme button count is 0 via `getByRole` — the
   accessibility-tree match excludes the always-present `aria-hidden` measurement
   probe copy (a `:visible` CSS filter would wrongly match the sized off-screen
   probe).
4. Click the chevron and assert the `More controls` menu shows a `Theme:` menuitem.

### `theme renders as an in-bar button on desktop`

**What it proves:** At a wide desktop width the L3 controls fit in-bar
(registry-driven overflow) — the theme toggle renders directly in the bar,
visible without opening the chevron menu.

**Steps:**
1. Resize viewport to 1024×768.
2. Navigate to `/${TMUX_SERVER}`.
3. Assert the in-bar theme button is visible via `getByRole` (the
   accessibility-tree match excludes the `aria-hidden` measurement probe copy).

### `mobile drawer opens below top bar`

**What it proves:** The mobile hamburger opens a drawer that does NOT cover
the top bar — the user must always be able to close it by tapping the same
toggle.

**Steps:**
1. Navigate to `/${TMUX_SERVER}`.
2. Click the `Toggle navigation` button.
3. Assert `navigation[name='Sessions']` is visible.
4. Assert the toggle button is still visible (not covered by drawer overlay).
5. Assert the sidebar's bounding-box `y` is `> 0` — i.e. drawer starts below
   the top bar, not at viewport origin.
6. Click the toggle again and assert the sidebar is no longer visible.
