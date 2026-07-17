# boards-same-session-multi-pane.spec.ts

Validates that pinning two windows from the **same** tmux session to one board
renders each pane with its own window's content.

The move-based architecture (`260602-qn62-move-based-board-pin-sessions`): each
pinned window is MOVED into its own single-window pin-session (`_rk-pin-<id>`),
and a board pane attaches its relay DIRECTLY to that pin-session (whose sole
window is permanently active). There is no per-connection ephemeral grouped
session anymore — single-window pin-sessions remove window *sharing*, which is
what the old ephemeral isolation layer existed to work around. Under the
terminals mux (`260717-803u`), all panes share ONE `/ws/terminals` socket and
each pane issues its own `open` control op carrying its windowId; two windows
from one source session therefore become two independent pin-sessions, each with
its own muxed stream, so each pane sees only its own window's PTY.

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
real renderer. Per-pane isolation is instead proven at the **terminals-mux
layer**: all panes share ONE `/ws/terminals` socket, each pane issues its own
`open` control op carrying its windowId, and each pane mounts its own live
`.xterm` instance. Two distinct `open` windowIds over the single socket is the
direct connection-level proof that each pane attaches to its own pin-session.

## Tests

### `two windows from one session each open their own relay pane`

**What it proves:** Pinning two distinct windows of the same tmux session into
a single board produces two independent pane terminals — each mounts its own
live xterm instance and issues its own per-window `open` op on the single
terminals mux socket, with no shared/aliased stream. This is the multi-pane
same-session isolation invariant: each window is moved into its own pin-session
and relayed directly, verified at the connection layer (xterm's WebGL canvas
exposes no DOM text to scrape).

**Steps:**

1. Resolve the `#{window_id}` of `win-a` and `win-b` via `tmux list-windows -F`.
2. Register a `page.on("websocket")` listener that, for the `/ws/terminals`
   socket, records the `windowId` of every `open` control op it sends
   (ignoring Vite HMR / state / SSE sockets and binary data frames).
3. POST `/api/boards/<name>/pin` for `win-a`, then for `win-b`.
4. Navigate to `/board/<name>` (waitUntil `domcontentloaded`).
5. Assert both `win-a` and `win-b` pane headers render.
6. Assert exactly two `.xterm` instances mount (both panes' terminals are live).
7. Poll until an `open` op has been sent for BOTH `win-a`'s and `win-b`'s window
   ids, and assert at least two distinct `open` windowIds were seen — each pane
   opens its own muxed stream (isolation proof).
8. Unpin both windows via the API to clean up (empty boards are removed
   per the boards spec).
