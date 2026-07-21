# server-panel-grid.spec.ts

Behavioural contract for the redesigned `ServerPanel` — a swatch-style grid
of tile buttons that replaces the previous vertical list. Validates that
tiles render per server (bare window-count meta + tooltip wording since
`260721-bylc-server-tile-diet-window-counts`), active-tile state,
click-to-switch behaviour, and the mobile single-row horizontal-swipe
layout. The panel defaults **open** (`defaultOpen={true}` since
`260720-rzg7-sessions-scope-toggle-delink`), so tests assert the grid
directly without an expand click.

## Shared setup

- `beforeAll` creates two temporary sessions on the e2e tmux server so
  that the window count shown on the active server's tile is non-zero and
  there is enough content to exercise the grid. `afterAll` kills them.
- The spec uses `E2E_TMUX_SERVER` (default `rk-test-e2e`) and verifies that
  `/api/servers` surfaces at least that server in its `ServerInfo[]`
  response.

## Tests

### `Desktop: tile grid renders with session counts`

**What it proves:** On desktop viewport (1024×768), the Server panel is
open by default and renders a grid of server tiles. The e2e server's tile
carries the singular-aware full wording (`N windows across M sessions`) in
its button `title` tooltip — the tile's visible count line is a bare
window-count number — and the old `N sess` meta line no longer renders.

**Steps:**
1. Navigate to `/${TMUX_SERVER}` and wait for `Connected`.
2. Locate the Server header button (`name: /^Server/`); assert visible and
   `aria-expanded="true"` (default-open, no click).
3. Locate the grid listbox via `getByRole('listbox', { name: /Tmux servers/ })`.
4. Within the grid, assert at least one `option` tile whose name includes
   the e2e server.
5. Assert that tile's `title` attribute matches
   `/\d+ windows? across \d+ sessions?/` (the tooltip is the stable text
   seam for the count — the visible line is a bare number).
6. Assert the old meta line `/\d+ sess/` has zero matches in the grid.

### `Desktop: active tile has aria-current`

**What it proves:** The active server's tile carries `aria-current="true"`
in the default-open grid.

**Steps:**
1. Navigate to `/${TMUX_SERVER}` and wait for `Connected`.
2. Locate the grid listbox directly (panel defaults open — no click).
3. Find the tile option matching the current server; assert
   `aria-current="true"`.
4. (Skipped unless a second server exists) — the click path is covered by
   unit tests; this e2e path verifies only that the grid is keyboard- /
   click-reachable.

### `Mobile: grid renders as a single horizontal row`

**What it proves:** On a 375×812 viewport, the tile grid does not wrap into
multiple rows — it lays out as a single horizontal strip with
`overflow-x: auto`.

**Steps:**
1. Set viewport 375×812.
2. Navigate to `/${TMUX_SERVER}`.
3. Click the `Toggle navigation` button to open the mobile sidebar drawer.
4. Within the `Sessions` navigation region, locate the grid listbox (panel
   defaults open — no expand click).
5. Evaluate the grid element's computed `grid-auto-flow` — assert `column`
   (desktop would be `row`).
6. Evaluate `overflow-x` — assert `auto` or `scroll`.

### `Mobile: drag handle is hidden`

**What it proves:** The resize drag handle (`role="separator"` with name
matching `Resize Server panel`) is NOT rendered on mobile viewports — the
single-row layout does not need vertical resize — even with the panel open
by default.

**Steps:**
1. Set viewport 375×812.
2. Navigate and open the mobile sidebar drawer via `Toggle navigation`.
3. Assert the grid listbox is visible (default-open).
4. Assert `getByRole('separator', { name: /Resize.*Server/ })` is not visible.

### `Desktop: drag handle is visible on resizable panel`

**What it proves:** On a 1024×768 desktop viewport, the Server panel is
resizable — the bottom drag handle is rendered and reachable from the
default-open state.

**Steps:**
1. Set viewport 1024×768.
2. Navigate, wait for `Connected`.
3. Assert `getByRole('separator', { name: /Resize.*Server/ })` is visible
   (no expand click — the panel defaults open).

## Notes

- These tests use the e2e tmux server (`rk-test-e2e`) and port 3020, per the
  `just test-e2e` isolation convention.
- Resize drag interaction itself is covered by unit tests in
  `collapsible-panel.test.tsx`; e2e coverage focuses on presence + layout.
- The collapsed → open transition (and its `/api/servers` refresh-on-open)
  is covered by unit tests in `server-panel.test.tsx` from a seeded-collapsed
  state.
