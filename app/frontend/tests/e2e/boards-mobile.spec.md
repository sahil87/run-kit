# boards-mobile.spec.ts

Validates that the board page renders as a single-pane swipe carousel on
mobile viewports (≤640px), with a pagination indicator showing the current
slot.

## Shared setup

- `beforeAll` creates an `e2e-board-mobile-<timestamp>` tmux session on
  `rk-test-e2e` with three named windows (`m-a`, `m-b`, `m-c`) so the carousel
  has multiple slots to render.
- A unique board name (`mob<digits>`) is used per run.
- A module-scoped `pinnedEntries` array tracks every `(server, windowId)`
  pinned during the test.
- `afterAll` first POSTs `/api/boards/<name>/unpin` for each tracked entry
  (best-effort) so the persistent `rk-test-e2e` server doesn't carry stale
  `@rk_board` entries into later runs, then kills the test session.

## Tests

### `at 375x812 the board renders one pane card at a time with pagination dots`

**What it proves:** The mobile breakpoint (`min-width: 640px`) gates the
carousel layout — at 375px width the page renders one pane visible at a
time with a 3-dot pagination indicator, the first dot annotated as
`current`.

**Steps:**

1. Set viewport to 375×812 (iPhone-class).
2. Reconcile windows: list `(name, id)` pairs via
   `tmux list-windows -F "#{window_name}\t#{window_id}"` and create any of
   `m-a`/`m-b`/`m-c` that are missing — re-runs must not accumulate
   duplicates, otherwise pinning by name becomes non-deterministic.
3. Re-list windows, build a `name → id` map, and POST
   `/api/boards/<name>/pin` for each of `m-a`/`m-b`/`m-c` by *name* (not by
   slicing the first three ids). Record each entry for cleanup.
4. Navigate to `/board/<name>`.
5. Locate the pagination strip (`[aria-label^='pane ']`) and assert it
   contains 3 dots. Assert the first dot's label includes `current`.
6. Locate every `role=group` board-pane element and assert exactly 3 are
   rendered (matches the entry count) but only 1 is visible — the others
   are hidden via the carousel's slot-switching CSS.
