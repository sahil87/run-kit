# boards-mobile.spec.ts

Validates that the board page renders as a single-pane swipe carousel on
mobile viewports (≤640px), with a pagination indicator showing the current
slot.

## Shared setup

- `beforeAll` creates an `e2e-board-mobile-<timestamp>` tmux session on
  `rk-e2e` with three named windows (`m-a`, `m-b`, `m-c`) so the carousel
  has multiple slots to render. `afterAll` kills the session.
- A unique board name (`mob<digits>`) is used per run.

## Tests

### `at 375x812 the board renders one pane card at a time with pagination dots`

**What it proves:** The mobile breakpoint (`min-width: 640px`) gates the
carousel layout — at 375px width the page renders one pane visible at a
time with a 3-dot pagination indicator, the first dot annotated as
`current`.

**Steps:**

1. Set viewport to 375×812 (iPhone-class).
2. Navigate to `/${TMUX_SERVER}` and wait for `Connected`.
3. Read the three `window_id`s via `tmux list-windows -F #{window_id}`.
4. POST `/api/boards/<name>/pin` for each of the three window ids.
5. Navigate to `/board/<name>`.
6. Locate the pagination strip (`[aria-label^='pane ']`) and assert it
   contains 3 dots. Assert the first dot's label includes `current`.
7. Locate every `role=group` board-pane element and assert exactly 3 are
   rendered (matches the entry count) but only 1 is visible — the others
   are hidden via the carousel's slot-switching CSS.
