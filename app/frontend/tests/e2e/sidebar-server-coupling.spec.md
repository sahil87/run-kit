# sidebar-server-coupling.spec.ts

Behavioural contract for the coupling between the sidebar's Server Pane open
state and the Sessions Pane's server-scope filter. When the Server Pane is
collapsed, the Sessions tree shows one `ServerGroup` per server; when the
Server Pane is open, the tree narrows to the current server's group.
Validates the headline user flow end to end.

## Shared setup

- `beforeAll` creates one session on the default e2e tmux server
  (`E2E_TMUX_SERVER`, default `rk-test-e2e`) and a second tmux server
  (`rk-test-e2e-coupling-<pid>-<suffix>`, where `<pid>` is the Playwright
  `process.pid` so the automatic post-sweep can parse it) with its own
  session — two distinct servers are required so the Server Pane has a
  non-current tile to click.
- `afterAll` kills the session on the default server and `kill-server`s the
  second tmux server entirely.
- All tests use the desktop viewport (1024×768) so the sidebar is rendered
  as a docked column, not the mobile overlay.

## Tests

### `opening the Server Pane narrows the Sessions tree to the current server`

**What it proves:** With the Server Pane collapsed, both server groups
render in the Sessions tree. When the user opens the Server Pane, the
Sessions tree filters down to exactly the current server's group; the
other server's group disappears from the DOM.

**Steps:**
1. Set desktop viewport and navigate to `/${TMUX_SERVER_A}`.
2. Wait for `Connected`.
3. Assert both `[data-server='A']` and `[data-server='B']` group headers
   are visible (baseline).
4. Click the Server Pane header (button whose accessible name starts with
   `Server`).
5. Assert the tile grid (`role=listbox`, `name=/Tmux servers/`) appears.
6. Assert `[data-server='A']` is still visible (current server's group).
7. Assert `[data-server='B']` count is `0` (filtered out).

### `clicking a non-current tile in the Server Pane switches the filtered group`

**What it proves:** When the Server Pane is open and the Sessions tree is
narrowed, the only way to switch servers is via the Server Pane's tile
grid. Clicking a non-current tile navigates to that server's route and the
Sessions tree updates to show that server's group instead.

**Steps:**
1. Set desktop viewport and navigate to `/${TMUX_SERVER_A}`.
2. Wait for `Connected`.
3. Open the Server Pane.
4. Click the tile option whose accessible name matches `TMUX_SERVER_B`.
5. Assert the page URL now matches `/${TMUX_SERVER_B}`.
6. Assert `[data-server='B']` is visible.
7. Assert `[data-server='A']` count is `0`.

### `closing the Server Pane restores the multi-server tree`

**What it proves:** The filter is reactive in both directions — closing
the Server Pane after opening it restores the full multi-server tree
without losing any server's `ServerGroup`.

**Steps:**
1. Set desktop viewport and navigate to `/${TMUX_SERVER_A}`.
2. Wait for `Connected`.
3. Click the Server Pane header to open it.
4. Assert `[data-server='B']` count is `0` (tree is filtered).
5. Click the Server Pane header again to close it.
6. Assert both `[data-server='A']` and `[data-server='B']` are visible.

> **Note:** the `currentServer === null` empty-state hint (`Select a server
> above to see its sessions.`) is no longer covered here. It previously had
> an e2e case targeting `/`, but `/` now renders `HostOverviewPage` (no
> sidebar) — the `<Sidebar currentServer={null}>` state lives on the
> `/board/$name` route. The hint's render logic remains covered by the unit
> test `src/components/sidebar/index.test.tsx` ("renders the empty-state
> hint when the Server Pane is open and currentServer is null").

## Notes

- Uses the desktop viewport throughout — mobile tests would require
  opening the sidebar drawer first; the coupling logic itself is layout-
  independent.
- The headline user flow is covered by tests 1 and 2 together (narrow on
  open, switch via tile); test 3 verifies the reverse direction.
- All three tests use the e2e tmux server pattern from
  `multi-server-sidebar.spec.ts` — port 3020, isolated tmux servers,
  best-effort setup/teardown.
