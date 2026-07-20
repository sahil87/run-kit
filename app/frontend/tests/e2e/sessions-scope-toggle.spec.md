# sessions-scope-toggle.spec.ts

Behavioural contract for the sidebar's explicit sessions-pane scope
(localStorage `runkit-panel-sessions-scope`, `all | current`, default `all`)
and its delink from the SERVER panel's expansion state. The SESSIONS-header
chip (`ALL`/`CUR`) is the toggle affordance; the SERVER panel now defaults
open and its expansion no longer filters the session tree.

Supersedes `sidebar-server-coupling.spec.ts`, which asserted the old
behaviour where opening the SERVER panel narrowed the Sessions tree to the
current server — that coupling was removed in
`260720-rzg7-sessions-scope-toggle-delink`.

## Shared setup

- `beforeAll` creates one session on the default e2e tmux server
  (`E2E_TMUX_SERVER`, default `rk-test-e2e`) and a second tmux server
  (`rk-test-e2e-scope-<pid>-<suffix>`, where `<pid>` is the Playwright
  `process.pid` so the automatic post-sweep can parse it) with its own
  session — two distinct servers are required so scope narrowing is
  observable.
- `afterAll` kills the session on the default server and `kill-server`s the
  second tmux server entirely.
- All tests use the desktop viewport (1024×768) so the sidebar is rendered
  as a docked column, not the mobile overlay.

## Tests

### `toggling scope to current narrows the Sessions tree; toggling back restores it`

**What it proves:** The default scope is `all` (both server groups render
with no stored value) and the SESSIONS-header chip toggles the scope in
both directions: `current` narrows the tree to exactly the current server's
group; toggling back to `all` restores the multi-server tree. The chip
itself reads the active scope at rest (`ALL` ⇄ `CUR`).

**Steps:**
1. Set desktop viewport and navigate to `/${TMUX_SERVER_A}`.
2. Wait for `Connected`.
3. Assert both `[data-server='A']` and `[data-server='B']` group headers
   are visible (default `all` baseline).
4. Locate the chip (`button`, accessible name `Toggle sessions scope`);
   assert it reads `ALL`.
5. Click the chip; assert it reads `CUR`.
6. Assert `[data-server='A']` is still visible (current server's group).
7. Assert `[data-server='B']` count is `0` (narrowed).
8. Click the chip again; assert it reads `ALL`.
9. Assert both groups are visible again.

### `scope persists across reload`

**What it proves:** The scope is persisted state, not per-session UI —
after toggling to `current` and reloading the page, the tree renders
narrowed and the chip reads `CUR` without any user interaction.

**Steps:**
1. Set desktop viewport, navigate to `/${TMUX_SERVER_A}`, wait for
   `Connected`, and wait for the `B` group (baseline `all`).
2. Click the chip; assert `[data-server='B']` count is `0`.
3. Reload the page and wait for `Connected`.
4. Assert the chip reads `CUR`.
5. Assert `[data-server='A']` is visible and `[data-server='B']` count is
   `0` (the persisted scope was applied on a fresh render).

### `SERVER panel expansion does not affect the Sessions tree (delink)`

**What it proves:** The SERVER panel defaults open (tile grid visible on
load) and its expansion state is fully decoupled from the session list —
collapsing and re-expanding the panel leaves the multi-server tree
unchanged. Under the old coupling, an open panel narrowed the tree; this
test fails against that behaviour.

**Steps:**
1. Set desktop viewport and navigate to `/${TMUX_SERVER_A}`.
2. Wait for `Connected`.
3. Assert the SERVER header button has `aria-expanded="true"` and the tile
   grid (`role=listbox`, `name=/Tmux servers/`) is visible without any
   click (default-open) AND both server groups render.
4. Click the SERVER panel header to collapse it; assert
   `aria-expanded="false"` (expansion is asserted via the ARIA state — a
   collapsed panel only clips its content, which Playwright still counts
   as visible).
5. Assert both server groups still render (tree unchanged).
6. Click the header again to re-expand; assert `aria-expanded="true"`.
7. Assert both server groups still render.

## Notes

- Uses the desktop viewport throughout — mobile tests would require
  opening the sidebar drawer first; the scope logic itself is
  layout-independent.
- The `current`-scope-with-no-current-server fallback (board routes render
  all servers; the old "Select a server above…" hint is deleted) is covered
  by unit tests in `src/components/sidebar/index.test.tsx` — the board
  route's sidebar lives at `/board/$name` and needs board fixtures that are
  out of scope here.
- All three tests use the e2e tmux server pattern from
  `multi-server-sidebar.spec.ts` — port 3020, isolated tmux servers,
  best-effort setup/teardown.
