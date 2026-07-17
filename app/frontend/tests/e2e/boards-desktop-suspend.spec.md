# boards-desktop-suspend.spec.ts

Validates that, on a plaintext origin, the desktop board row bounds its live
terminal streams by viewport visibility plus a hard live-pane cap — off-screen
panes suspend their muxed stream and resume it when scrolled back into view.
Under the terminals mux (change 260717-803u) suspension is no longer a closed
WebSocket per pane; all panes share ONE `/ws/terminals` socket, and a suspended
pane sends a `close` control op for its stream (its TerminalClient unmounts →
the connect effect's cleanup) while a resumed pane sends a fresh `open` op. This
is the desktop counterpart of the mobile carousel's existing
`paused={idx !== carouselIndex}` suspension.

## Shared setup

- `beforeAll` creates a session on the primary tmux server (`rk-test-e2e`) with
  6 named windows (`win-0` … `win-5`). Each window prints a unique marker then
  idles (`sleep 120`) so its stream always has a live pane to attach to.
- The test runs at a 1280×800 desktop viewport. At the default pane width
  (480px) six panes overflow the row, so the rightmost panes start off-screen —
  the precondition for observing suspension. Six panes also exceeds the
  live-pane cap of 4.
- A module-scoped `pinnedEntries` array tracks every `(server, windowId)` pinned
  during the test.
- `afterAll` POSTs `/api/boards/<name>/unpin` for each tracked entry
  (best-effort) so the persistent `rk-test-e2e` server doesn't carry stale
  `_rk-pin-*` pin-sessions into later runs, then kills the test session.

## Tests

### `off-screen desktop pane suspends its muxed stream and resumes on scroll-back`

**What it proves:** On a plaintext origin (`http://localhost:3020`), an
off-screen desktop board pane does not hold a live muxed terminal stream — its
`close` op has been sent — and scrolling that pane back into the viewport
re-opens its stream (a fresh `open` op) and restores its terminal content. The
focused, on-screen pane stays connected throughout. This is the connection-budget
fix: the live stream count stays bounded instead of growing with the pin count,
all over the single `/ws/terminals` socket.

**Steps:**

1. Resolve all six window ids by name via `tmux list-windows -F
   #{window_id}:#{window_name}` so pin POSTs target real windows.
2. POST `/api/boards/<name>/pin` for each window in left-to-right order (pin
   order matches `DesktopRow` render order); record each entry for cleanup.
3. Register a `page.on("websocket")` listener that, for the `/ws/terminals`
   socket, watches the control ops it sends (`framesent`): an `open` op marks
   that windowId's stream live (recording its stream `id` → windowId), and a
   `close` op (which carries only the stream `id`) marks it suspended. Vite HMR,
   state, and SSE sockets and binary data frames are ignored.
4. Navigate to `/board/<name>` (waitUntil `domcontentloaded` to skip waiting on
   every WS child to settle).
5. Assert `window.location.protocol === "http:"` — the suspension feature is
   gated on a plaintext origin, so this precondition fails loudly with a clear
   message if the test webServer is ever fronted by HTTPS (otherwise the feature
   silently disables and later suspension assertions would time out confusingly).
6. Assert the leftmost pane (`win-0`), which is on-screen and focused on mount,
   has a live stream (an `open` op was sent). The focused pane is always live, so
   it stays open for the whole scroll cycle.
7. Assert the target pane (`win-4`), off-screen at the initial scroll position,
   has no live stream. A mid-row pane (not the very last) is targeted because the
   focused pane permanently occupies one of the 4 live slots, so the single
   rightmost pane can be squeezed out by the cap even when visible — `win-4` is
   reliably within the cap once scrolled into view.
8. Scroll the row fully right (`scrollLeft = scrollWidth`) so `win-4` enters the
   viewport; assert its stream re-opens (an `open` op — pane resumed) and its
   TerminalClient re-mounts a live xterm instance (`.xterm` element visible).
   The DOM signal is asserted rather than scraping the xterm canvas text, which
   is brittle and — on this branch, before the sibling static-xterm-import fix —
   can still be starved by the plaintext chunk-fetch contention this change
   family addresses.
9. Scroll the row fully back left (`scrollLeft = 0`) so `win-4` leaves the
   viewport beyond the pre-warm margin; assert its stream closes again (a `close`
   op — pane suspended) while `win-0` stays open throughout.
