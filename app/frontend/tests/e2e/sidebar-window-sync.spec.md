# sidebar-window-sync.spec.ts

Validates that the sidebar stays in sync with tmux state for external
mutations (create, rename, kill-then-create) without page reloads.

## Shared setup

- `beforeAll` creates `e2e-sync-<timestamp>` so every test has its own
  isolated session; `afterAll` kills it.
- Tests within this file run sequentially (`fullyParallel: false`), so
  windows created in one test won't race another.

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
