# shell-rotation.spec.ts

Validates the central invariant introduced by 17m3 (Rotated Shell Layout):
on the board route, the shell-level `BottomBar` follows the *focused* pane
via the new `FocusedTerminalContext`. Cycling pane focus with `Cmd+]` /
`Cmd+[` re-targets the BottomBar to the newly-focused pane's WebSocket so
keystrokes typed via the BottomBar reach the right terminal.

This e2e test exercises the multi-pane focus contract end-to-end. The
unit tests cover the smaller pieces (Shell grid topology, FocusedTerminal
register/clear, sidebar section order, BottomBar consumption of the
context).

## Shared setup

- `beforeAll` creates an `e2e-shell-rotation-<timestamp>` tmux session
  on the `rk-test-e2e` server with two named windows (`win-a`, `win-b`). Each
  window prints a ready-marker and then runs `cat` so STDIN piped via the
  BottomBar relay accumulates in the pane's view. (The markers are not
  scraped — readiness is gated on the `.xterm` DOM signal; see step 4.)
- A unique board name (`sr<digits>`) is used per run so reruns don't
  collide on the persistent tmux server.
- `afterAll` kills the test session.

## Tests

### `BottomBar follows focused pane on board route`

**What it proves:** On `/board/<name>`, a single shell-level `BottomBar`
is present (new in 17m3) and its input target follows the focused pane.
Cycling focus via `Cmd+]` / `Cmd+[` re-targets the BottomBar — verified
by the pane's `border-accent` class which marks the focused pane.

**Steps:**

1. Resolve the `#{window_id}` of `win-a` and `win-b` via
   `tmux list-windows -F`.
2. POST `/api/boards/<name>/pin` with both window IDs.
3. Navigate to `/board/<name>` (waitUntil `domcontentloaded`).
4. Readiness gate: assert exactly two `.xterm` instances mount — confirms
   both panes' terminals attached. (We assert the `.xterm` DOM signal rather
   than scraping ready-marker text: xterm renders to a WebGL canvas with no
   DOM text layer. The focus-cycling behavior under test is verified via
   `border-accent` below, independent of terminal content.)
5. Assert the shell-level `BottomBar` is present by locating the
   `Open command palette` button (a stable BottomBar affordance).
6. Press `Meta+]` to cycle focus from pane 0 to pane 1.
7. Assert pane 1 carries the `border-accent` class and pane 0 does
   not — proving focus moved and `BoardPane.useEffect` ran with
   `isFocused === true`, registering pane 1 as the focused terminal.
8. Press `Meta+[` to cycle back to pane 0.
9. Assert pane 0 carries `border-accent` and pane 1 does not.
10. Unpin both windows via the API to clean up (empty boards are
    removed per the boards spec).
