# top-bar-refresh.spec.ts

Verifies the top-bar **RefreshButton**: on a terminal route it renders in the L3
always-block at its pyramid position (Notification → Theme → **Refresh** → Help,
dot right-most), and clicking it performs a full `window.location.reload()`.

## Shared setup

- Fully mocked — no tmux server, no `gh`, no real backend reads. The spec
  injects data via `page.route`:
  - `**/api/servers` → a single server `default` (so the app attaches exactly one
    SSE connection).
  - `**/api/sessions/stream*` → one `event: sessions` frame whose payload is a
    session `dev` with two windows: `@1` "feature-work" (the URL target,
    `isActiveWindow: false`) and `@2` "other" (`isActiveWindow: true`). This
    satisfies the `currentWindow` gate the Split/Close cluster renders behind,
    and — because the deep-linked `@1` is NOT the
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
  window route `/default/%401` (`@1`), and waits for the **Close pane** button to
  be visible — the signal the SSE payload has landed and `currentWindow` is set.
  The Refresh button cannot be this anchor: it rides the L3 always-block
  (260704-9o7k) and is visible at first paint, before the mocked SSE event is
  processed, so anchoring on it raced the mount-time `/select` POST.

## Tests

### `renders refresh in the always block between theme and help on a terminal route`

**What it proves:** the `/select` mock intercepted the window-selection POST fired
during navigation (so no real backend read/write occurred — proving the "fully
mocked" guarantee holds); and on a terminal route the Refresh page button renders
at its pyramid position in the L3 always-block — its wrapper `<span>` sits
directly between the Theme toggle's and the Help link's wrappers, and the
connection dot (`role="status"`) is the cluster's last element. This is true
sibling adjacency, not merely "somewhere after" in document order.

**Steps:**
1. Poll the `/select` route-mock hit counter until `> 0` — proof the trailing-`*`
   glob intercepts the `?server=default` URL rather than falling through to the
   real :3020 backend (the POST fires in a mount-time effect fractionally after
   the close button renders).
2. Assert the `Refresh page` button is visible.
3. In the page, resolve the theme/refresh/help wrappers via `.closest("span")` and
   assert theme's wrapper's `nextElementSibling` is the refresh wrapper, whose
   `nextElementSibling` is the help wrapper; then assert the cluster's
   `lastElementChild` is the `role="status"` dot wrapper (coordinate-free
   true-adjacency checks).

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
