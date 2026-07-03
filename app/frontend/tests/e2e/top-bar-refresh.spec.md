# top-bar-refresh.spec.ts

Verifies the top-bar **RefreshButton**: on a terminal (current-window) route it
renders immediately after the Close pane button, and clicking it performs a full
`window.location.reload()`.

## Shared setup

- Fully mocked — no tmux server, no `gh`, no real backend reads. The RefreshButton
  is gated on a current window, so the spec injects data via `page.route`:
  - `**/api/servers` → a single server `default` (so the app attaches exactly one
    SSE connection).
  - `**/api/sessions/stream*` → one `event: sessions` frame whose payload is a
    session `dev` with two windows: `@1` "feature-work" (the URL target,
    `isActiveWindow: false`) and `@2` "other" (`isActiveWindow: true`). This
    satisfies the `currentWindow` gate the RefreshButton (and the Split/Close
    cluster) render behind, and — because the deep-linked `@1` is NOT the
    tmux-active window — makes app.tsx's mount-time alignment fire exactly one
    `selectWindow(server, "@1")` POST so the `/select` mock is genuinely
    exercised (a same-window payload would take the no-op path and never call
    `/select`). A pending intent holds the URL on `@1`, so `currentWindow`
    resolves to `@1` and the button renders there.
  - `**/api/windows/*/select*` → `{ ok: true }` so window selection during nav
    does not error. The trailing `*` is required: Playwright globs match the full
    URL including the query string, and `client.ts` `withServer` appends
    `?server=default`; without it the POST would fall through to the real :3020
    backend and issue a live tmux `select-window`, breaking the "no real backend
    reads" guarantee.
  - the `/relay/` WebSocket is stubbed (accepted and held open) so the terminal
    route mounts without a backend.
- `beforeEach` installs the routes, navigates to the percent-encoded terminal
  window route `/default/%401` (`@1`), and waits for the Refresh page button to be
  visible (the strongest signal the SSE payload has landed and `currentWindow` is
  set).

## Tests

### `shows the refresh button next to the close button on a terminal route`

**What it proves:** the `/select` mock intercepted the window-selection POST fired
during navigation (so no real backend read/write occurred — proving the "fully
mocked" guarantee holds); and on a terminal route the Close pane button is visible
(the Refresh page button's visibility is already asserted by the shared
`beforeEach`), with the refresh button rendering *immediately* after the close
button — its wrapper `<span>` is the direct next element sibling of the close
button's wrapper `<span>` (the cluster order is split → split → close → refresh).
This is true adjacency, not merely "somewhere after" in document order.

**Steps:**
1. Assert the `/select` route mock fired at least once during nav (its hit counter
   is `> 0`) — proof the trailing-`*` glob intercepts the `?server=default` URL
   rather than falling through to the real :3020 backend.
2. Assert the `Close pane` button is visible.
3. In the page, resolve each button's wrapper `<span>` via `.closest("span")` and
   assert the refresh wrapper is the `nextElementSibling` of the close wrapper
   (coordinate-free true-adjacency check).

### `clicking the refresh button reloads the page`

**What it proves:** clicking the RefreshButton performs a genuine full-page
reload (`window.location.reload()`), not an in-app state change.

**Steps:**
1. Plant a marker `window.__refreshMarker = true` on the current window object and
   confirm it reads back as `true`.
2. Click the `Refresh page` button and wait for the page `load` event (a real
   navigation fires it).
3. After the reload settles, assert the `Refresh page` button is visible again
   (the app re-mounts on the same mocked routes, which persist across the reload).
4. Assert `window.__refreshMarker` is now `undefined` — the fresh window created
   by the reload discarded the pre-reload marker, proving a real reload occurred.
