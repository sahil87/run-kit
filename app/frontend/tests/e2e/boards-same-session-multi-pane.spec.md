# boards-same-session-multi-pane.spec.ts

Validates that pinning two windows from the **same** tmux session to one board
renders each pane with its own window's content — the central regression
covered by `260508-hdjr-relay-grouped-sessions-board-panes` (PR #186 shipped
the boards feature with a relay-layer bug where every pane mirrored the same
active window).

The bug-fix architecture: each WebSocket relay creates a per-connection
ephemeral grouped tmux session (`rk-relay-<rand>`), `select-window`s on the
ephemeral, and attaches to the ephemeral. Group members share window membership
but maintain independent active-window state, so each pane's terminal sees
only its targeted window's PTY output.

## Shared setup

- `beforeAll` creates an `e2e-board-same-<timestamp>` tmux session on the
  `rk-e2e` server with two named windows (`win-a`, `win-b`). Each window's
  initial command prints a unique marker (`PANE_ALPHA_OK`, `PANE_BRAVO_OK`)
  then sleeps so the marker stays available for the relay to capture.
- A unique board name (`mp<digits>`) is used per run so reruns don't collide.
- `afterAll` kills the test session.

## Tests

### `two windows from one session show distinct pane content`

**What it proves:** Pinning two distinct windows of the same tmux session
into a single board produces two pane terminals that render only their
respective window's PTY output, with no cross-contamination. This is the
multi-pane same-session correctness invariant restored by the grouped-session
relay refactor.

**Steps:**

1. Resolve the `#{window_id}` of `win-a` and `win-b` via `tmux list-windows -F`.
2. POST `/api/boards/<name>/pin` for `win-a`, then for `win-b`.
3. Navigate to `/board/<name>` (waitUntil `domcontentloaded`).
4. Assert both `win-a` and `win-b` pane headers render.
5. Poll the per-pane terminal text (scoped via `getByRole("group", { name:
   /^board pane win-a$/ })` and the matching `win-b` locator — the pane
   container's `aria-label`) until pane A contains `PANE_ALPHA_OK` and NOT
   `PANE_BRAVO_OK`, AND pane B contains `PANE_BRAVO_OK` and NOT
   `PANE_ALPHA_OK`. Per-pane scoping is what proves isolation; a body-level
   check would only confirm both markers appear somewhere on the page.
6. Unpin both windows via the API to clean up (empty boards are removed
   per the boards spec).
