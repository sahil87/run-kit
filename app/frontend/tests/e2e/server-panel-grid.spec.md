# server-panel-grid.spec.ts

Behavioural contract for the redesigned `ServerPanel` — a swatch-style grid
of tile buttons that replaces the previous vertical list. Validates that
tiles render per server, active-tile state, click-to-switch behaviour, and
the mobile single-row horizontal-swipe layout.

## Shared setup

- `beforeAll` creates two temporary sessions on the e2e tmux server so
  that the session count shown on the active server's tile is non-zero and
  there is enough content to exercise the grid. `afterAll` kills them.
- The spec uses `E2E_TMUX_SERVER` (default `rk-e2e`) and verifies that
  `/api/servers` surfaces at least that server in its `ServerInfo[]`
  response.

## Tests

### `Desktop: tile grid renders with session counts`

**What it proves:** On desktop viewport (1024×768), the Tmux server panel
opens and renders a grid of server tiles, each with the expected name and
`N sess` meta, including a count that reflects the sessions created in
setup.

**Steps:**
1. Navigate to `/${TMUX_SERVER}` and wait for `Connected`.
2. Locate the Tmux header button (`name: /^Tmux/`); assert visible.
3. Click to expand (triggers `/api/servers` refresh).
4. Locate the grid listbox via `getByRole('listbox', { name: /Tmux servers/ })`.
5. Within the grid, assert at least one `option` tile whose name includes
   the e2e server.
6. Assert the meta line `/\d+ sess/` is rendered in the grid.

### `Desktop: active tile has aria-current and switches on click`

**What it proves:** The active server's tile carries `aria-current="true"`
and clicking a different tile navigates to that server's URL.

**Steps:**
1. Navigate to `/${TMUX_SERVER}` and wait for `Connected`.
2. Expand the Tmux panel.
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
4. Within the `Sessions` navigation region, expand the Tmux panel.
5. Locate the grid listbox inside the sidebar.
6. Evaluate the grid element's computed `grid-auto-flow` — assert `column`
   (desktop would be `row`).
7. Evaluate `overflow-x` — assert `auto` or `scroll`.

### `Mobile: drag handle is hidden`

**What it proves:** The resize drag handle (`role="separator"` with name
matching `Resize Tmux panel`) is NOT rendered on mobile viewports — the
single-row layout does not need vertical resize.

**Steps:**
1. Set viewport 375×812.
2. Navigate and open the mobile sidebar drawer via `Toggle navigation`.
3. Expand the Tmux panel.
4. Assert `getByRole('separator', { name: /Resize.*Tmux/ })` is not visible.

### `Desktop: drag handle is visible on resizable panel`

**What it proves:** On a 1024×768 desktop viewport, the Tmux panel is
resizable — the bottom drag handle is rendered and reachable.

**Steps:**
1. Set viewport 1024×768.
2. Navigate, wait for `Connected`, expand the Tmux panel.
3. Assert `getByRole('separator', { name: /Resize.*Tmux/ })` is visible.

## Notes

- These tests use the e2e tmux server (`rk-e2e`) and port 3020, per the
  `just test-e2e` isolation convention.
- Resize drag interaction itself is covered by unit tests in
  `collapsible-panel.test.tsx`; e2e coverage focuses on presence + layout.
