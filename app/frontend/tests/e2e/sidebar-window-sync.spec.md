# sidebar-window-sync.spec.ts

Validates that the sidebar stays in sync with tmux state for external
mutations (create, rename, kill-then-create) without page reloads, and that
clicking a window in the UI renders its terminal (the user-driven direction).

## Shared setup

- `beforeAll` creates `e2e-sync-<timestamp>` so every test has its own
  isolated session; `afterAll` kills it.
- Tests within this file run sequentially (`fullyParallel: false`), so
  windows created in one test won't race another.
- `resolveWindow(page, name)` polls `GET /api/sessions` until a window with
  the given name appears, returning its stable tmux window id (`@N`) and
  index. Tests select rows by `data-window-id="@N"` rather than the display
  name — `@N` is unique for the window's lifetime, whereas names collide and
  indices are reused. The window id is now ALSO the router URL segment
  (`/$server/$session/$windowId`). The router percent-encodes the `@` in the
  path segment (`@2` → `%402`), so URL assertions match
  `encodeURIComponent(windowId)` (then regex-escaped via `escapeRegExp`); the
  index is retained only for diagnostics.

## Tests

### `external window creation appears without page reload`

**What it proves:** When a window is created via the tmux CLI (outside the
UI), SSE polling surfaces it in the sidebar within ≤5s (≥2 poll cycles at
the 2.5s interval).

**Steps:**
1. Navigate to `/${TMUX_SERVER}` and wait for `Connected`.
2. Run `tmux new-window -t ${TEST_SESSION} -n ext-win-<ts>` via `execSync`.
3. Assert `text=ext-win-<ts>` is visible inside `nav[aria-label='Sessions']`
   within 5s.

### `external window rename reflects without page reload`

**What it proves:** Renaming a tmux window outside the UI updates the
sidebar — the new name appears and the old name disappears.

**Steps:**
1. Create a window `rename-src-<ts>` via `execSync` before navigating.
2. Navigate to `/${TMUX_SERVER}` and wait for `Connected`.
3. Assert `rename-src-<ts>` is visible in the sidebar.
4. Run `tmux rename-window -t "${TEST_SESSION}:rename-src-<ts>"
   rename-dst-<ts>`.
5. Assert `rename-dst-<ts>` appears within 5s.
6. Assert `rename-src-<ts>` is no longer visible within 5s — by this point
   SSE has replaced the old entry.

### `clicking a window from the dashboard selects it and updates the URL`

**What it proves:** Clicking a window in the sidebar while on the server
dashboard (no session/window in the URL) puts that session+window into the URL
and marks the row selected — so the terminal route mounts at all. This is the
regression guard for PR #198, which made clicks pure `selectWindow` mutations
whose URL writeback could only re-point the window *within the URL's existing
session* — so a first click from the dashboard left the dashboard showing
forever. The assertion targets the URL + selection (the direct fix signal),
not the xterm canvas, whose lazy init + WebSocket connect is a separate,
slower concern.

**Steps:**
1. Create a second window `click-win-<ts>` via `execSync`.
2. Navigate to `/${TMUX_SERVER}` (dashboard — no window segment) and wait for
   `Connected`.
3. `resolveWindow` the created window to get its `@id` and index.
4. Assert the row (`data-window-id="@id"`) button is visible and the URL does
   not yet contain `/${TEST_SESSION}/`.
5. Click the window button.
6. Assert the URL now matches `/${TEST_SESSION}/<@id>` (the stable window id,
   regex-escaped) and the clicked button has `aria-current="page"`.

### `clicking a different window switches selection without bounce-back`

**What it proves:** After selecting window A, clicking window B switches to B
and *stays* on B — the optimistic navigate plus the `pendingClickRef` intent
guard prevent a stale SSE snapshot (still reporting A active) from bouncing
the selection back to A before tmux confirms the switch.

**Steps:**
1. Create two windows `switch-a-<ts>` and `switch-b-<ts>` via `execSync`.
2. Navigate to `/${TMUX_SERVER}` and wait for `Connected`.
3. `resolveWindow` both to get their `@id`s; locate rows by `data-window-id`.
4. Click A; assert A's button is `aria-current="page"`.
5. Click B; assert B's button is `aria-current="page"`.
6. Wait 1.5s (a window in which a stale-snapshot bounce would manifest), then
   re-assert B is still current, A is not, and the URL still carries a window
   segment.

### `kill-then-create at same index does not suppress new window`

**What it proves:** After killing a window, creating a replacement that
tmux may assign the same slot to is shown correctly. The store's
reconciliation (`syncWindows`) must not let a stale killed marker suppress
the new window.

**Note:** An earlier version of this test held the kill response open via
`page.route` and navigated away to simulate "initiator unmounted mid-kill".
That dance was flaky because `page.goto` interacts badly with a held-open
route handler, and the narrower unmount guarantee (`onAlwaysSettled` fires
after unmount) is already covered by
`use-optimistic-action.test.ts`. This e2e test now covers the
higher-level, user-visible contract.

**Steps:**
1. Create `kill-win-<ts>` via `execSync`.
2. Navigate to `/${TMUX_SERVER}` and wait for `Connected`.
3. Assert `kill-win-<ts>` is visible in the sidebar.
4. Ctrl+click the sidebar's `Kill window kill-win-<ts>` button — performs
   an instant optimistic kill, bypassing the confirm dialog (the dialog
   path relies on a `killTargetRef` that is cleared synchronously, which
   makes this edge harder to exercise deterministically via the UI).
5. Assert `kill-win-<ts>` disappears within 5s.
6. Create `win-new-<ts>` externally via `execSync`.
7. Assert `win-new-<ts>` appears within 5s.
8. Assert `kill-win-<ts>` is still gone.
