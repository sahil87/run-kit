# mobile-layout.spec.ts

Responsive-layout guardrails: mobile viewports must not leak horizontal
overflow, must keep theme switching REACHABLE (since 260819-qkow it lives in
the settings dialog's Appearance picker and the palette — the chevron menu
carries no Theme… row), and must expose a drawer-style navigation that sits
*below* (not over) the top bar.

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

### `theme is reachable via the settings dialog on mobile (no chrome theme button anywhere)`

**What it proves:** Theme switching lives in the settings dialog's Appearance
picker and the palette (260819-qkow): the chevron menu carries no `Theme…`
row, the bar carries no theme button, and the sidebar footer carries none
either — even with the drawer open — yet the Settings row still reaches the
Appearance theme picker.

**Steps:**
1. Navigate to `/${TMUX_SERVER}` (viewport is 375px).
2. Assert the `More controls` chevron is visible, and that no `* theme` button
   exists in the bar.
3. Open the chevron menu; assert it has NO `Theme…` menuitem; open Settings
   via the in-bar gear (or the menu's `Settings` row when the gear
   overflowed), switch to the Appearance tab, and assert the
   `theme-picker-trigger` renders; Escape-close the dialog.
4. Click `Toggle navigation` (the hamburger) and assert the sidebar nav still
   contains zero theme buttons.

### `no chrome theme control on desktop either (sidebar footer and top bar both clean)`

**What it proves:** On desktop the sidebar is open by default — its footer is
a passive status row (260812-d1at) and the chevron menu carries no `Theme…`
row (260819-qkow): theme switching is the settings dialog + palette.

**Steps:**
1. Resize viewport to 1024×768.
2. Navigate to `/${TMUX_SERVER}`.
3. Assert zero theme buttons inside `navigation[name='Sessions']` (the
   sidebar) and inside the top-bar right cell (`data-testid="top-bar-right"`).
4. Open the chevron menu and assert it has NO `Theme…` menuitem.

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
