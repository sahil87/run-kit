# mobile-layout.spec.ts

Responsive-layout guardrails: mobile viewports must not leak horizontal
overflow, must hide second-line controls, and must expose a drawer-style
navigation that sits *below* (not over) the top bar.

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

### `top bar line 2 is hidden on mobile`

**What it proves:** Non-essential second-line controls (currently the theme
toggle) stay offscreen on mobile. The theme toggle uses `hidden sm:flex`, so
it should be absent below the sm breakpoint.

**Steps:**
1. Navigate to `/${TMUX_SERVER}` (viewport is 375px).
2. Assert no button matching `name: /theme/i` is visible.

### `top bar line 2 is visible on desktop`

**What it proves:** The same controls *do* render at ≥640px (`sm:flex`).

**Steps:**
1. Resize viewport to 1024×768.
2. Navigate to `/${TMUX_SERVER}`.
3. Assert a button matching `name: /theme/i` is visible.

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
