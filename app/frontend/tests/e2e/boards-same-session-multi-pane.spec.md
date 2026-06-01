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
  `rk-test-e2e` server with two named windows (`win-a`, `win-b`). Each window's
  initial command prints a marker then sleeps so the pane has a live PTY for
  the relay to attach to. (The markers are NOT scraped — see the note on
  rendering below.)
- A unique board name (`mp<digits>`) is used per run so reruns don't collide.
- `afterAll` kills the test session.

## Note on terminal-content verification

xterm.js renders glyphs to a **WebGL canvas** with no DOM text layer
(`.xterm-rows` is absent; `body.innerText()` never contains terminal output).
So the original "scrape the marker text" assertion was unverifiable against the
real renderer. Per-pane isolation is instead proven at the **relay layer**:
each pinned window opens its own `/relay/<windowId>` WebSocket and each pane
mounts its own live `.xterm` instance. Two distinct relay sockets for the two
distinct window ids is the direct connection-level proof that the
grouped-ephemeral relay isolates each pane. This matches the assertion style of
`boards-desktop-suspend.spec.ts`.

## Tests

### `two windows from one session each open their own relay pane`

**What it proves:** Pinning two distinct windows of the same tmux session into
a single board produces two independent pane terminals — each mounts its own
live xterm instance and opens its own per-window relay WebSocket, with no
shared/aliased socket. This is the multi-pane same-session relay-isolation
invariant restored by the grouped-session refactor, verified at the connection
layer (xterm's WebGL canvas exposes no DOM text to scrape).

**Steps:**

1. Resolve the `#{window_id}` of `win-a` and `win-b` via `tmux list-windows -F`.
2. Register a `page.on("websocket")` listener that records the percent-decoded
   window id of every `/relay/<id>` socket (ignoring Vite HMR / SSE sockets).
3. POST `/api/boards/<name>/pin` for `win-a`, then for `win-b`.
4. Navigate to `/board/<name>` (waitUntil `domcontentloaded`).
5. Assert both `win-a` and `win-b` pane headers render.
6. Assert exactly two `.xterm` instances mount (both panes' terminals are live).
7. Poll until a relay WebSocket has opened for BOTH `win-a`'s and `win-b`'s
   window ids, and assert at least two distinct relay sockets were seen — each
   pane gets its own relay (isolation proof).
8. Unpin both windows via the API to clean up (empty boards are removed
   per the boards spec).
