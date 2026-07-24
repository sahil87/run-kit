# mobile-layout.spec.ts

Responsive-layout guardrails: mobile viewports must not leak horizontal
overflow, must keep the moved theme control REACHABLE (since 260724-6j1v it
lives in the SIDEBAR FOOTER — on mobile that means via the drawer, no longer
via the top bar or its chevron menu), and must expose a drawer-style navigation
that sits *below* (not over) the top bar.

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

### `theme is reachable via the sidebar drawer footer on mobile (not in the top bar or menu)`

**What it proves:** 260724-6j1v moved the theme toggle out of the top bar into
the sidebar footer. On mobile the sidebar is a drawer: with the drawer closed no
theme button exists anywhere (and the chevron menu carries no `Theme:` row
anymore); opening the drawer via the hamburger surfaces the footer's theme
button.

**Steps:**
1. Navigate to `/${TMUX_SERVER}` (viewport is 375px).
2. Assert the `More controls` chevron is visible.
3. Assert the theme button count is 0 via `getByRole` (drawer closed — the
   accessibility-tree match excludes the `aria-hidden` measurement probe copy).
4. Open the chevron menu and assert it shows NO `Theme:` menuitem; Escape-close.
5. Click `Toggle navigation` (the hamburger) and assert the footer theme button
   is visible inside the drawer.

### `theme renders in the sidebar footer on desktop (never in the top bar)`

**What it proves:** On desktop the sidebar is open by default, so the footer
theme button is directly visible — and the top-bar right cell carries no theme
control at any width (260724-6j1v).

**Steps:**
1. Resize viewport to 1024×768.
2. Navigate to `/${TMUX_SERVER}`.
3. Assert a theme button is visible, scoped inside `navigation[name='Sessions']`
   (the sidebar footer).
4. Assert the top-bar right cell (`data-testid="top-bar-right"`) contains zero
   theme buttons.

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
