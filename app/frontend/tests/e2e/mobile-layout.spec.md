# mobile-layout.spec.ts

Responsive-layout guardrails: mobile viewports must not leak horizontal
overflow, must keep the theme control REACHABLE (since 260812-d1at it lives in
the top bar's overflow chevron menu as the App-section `Theme…` row — on every
viewport, no drawer needed), and must expose a drawer-style navigation
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

### `theme is reachable via the chevron menu's Theme… row on mobile (the footer carries no actions)`

**What it proves:** 260812-d1at relocated the footer actions to the top bar:
theme is a menuOnly `Theme…` row in the chevron menu's App section that opens
the theme selector (click-cycling is retired). The sidebar footer carries no
theme button anymore — even with the drawer open.

**Steps:**
1. Navigate to `/${TMUX_SERVER}` (viewport is 375px).
2. Assert the `More controls` chevron is visible, and that no `* theme` button
   exists in the bar (the row is menuOnly — never in-bar).
3. Open the chevron menu, click the `Theme…` menuitem, and assert the
   `Theme selector` dialog opens; Escape-close it.
4. Click `Toggle navigation` (the hamburger) and assert the sidebar nav still
   contains zero theme buttons.

### `theme lives in the top-bar overflow menu on desktop (never in the sidebar footer)`

**What it proves:** On desktop the sidebar is open by default — its footer is
a passive status row now (260812-d1at), so no theme button renders there; the
`Theme…` row sits in the top bar's chevron menu (menuOnly — never in-bar).

**Steps:**
1. Resize viewport to 1024×768.
2. Navigate to `/${TMUX_SERVER}`.
3. Assert zero theme buttons inside `navigation[name='Sessions']` (the
   sidebar) and inside the top-bar right cell (`data-testid="top-bar-right"`).
4. Open the chevron menu and assert the `Theme…` menuitem is visible.

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
