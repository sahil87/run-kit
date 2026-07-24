# top-bar-refresh.spec.ts

Verifies the top-bar **RefreshButton**: on a terminal route it renders in-bar
followed by the always-present overflow chevron as the right-most element, and
clicking it performs a full `window.location.reload()`. Since 260715-h1ck the
right cluster is registry-driven: controls render directly (no `hidden sm:flex`
wrapper spans) and the chevron lives inside the trailing exempt block, so
ordering is asserted by document position at a wide viewport rather than by
flat wrapper-sibling adjacency. Since 260724-6j1v the theme toggle, help link,
notification bell, and connection dot are GONE from the bar (theme/help/dot
moved to the sidebar footer; the bell folded into the settings dialog) — the
spec also asserts their absence.

## Shared setup

- Fully mocked — no tmux server, no `gh`, no real backend reads. The spec
  injects data via `page.route`:
  - `**/api/servers` → a single server `default` (so the app subscribes to
    exactly one server over the state socket).
  - `/ws/state` (state socket, via `mockStateSocket`) → the subscribe ack +
    `sessions` event carry the mocked payload — a
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
  - the `/ws/terminals` mux WebSocket is stubbed (accepted and held open) so the terminal
    route mounts without a backend.
- `beforeEach` installs the routes, navigates to the percent-encoded terminal
  window route `/default/%401` (`@1`), and waits for the **Close pane** button to
  be visible — the signal the state-socket payload has landed and `currentWindow` is set.
  The Refresh button cannot be this anchor: it rides the L3 always-block
  (260704-9o7k) and is visible at first paint, before the mocked state-socket event is
  processed, so anchoring on it raced the mount-time `/select` POST.

## Tests

### `renders refresh before the right-most chevron, with theme/help/bell/dot gone from the bar, on a terminal route`

**What it proves:** the `/select` mock intercepted the window-selection POST fired
during navigation (so no real backend read/write occurred — proving the "fully
mocked" guarantee holds); and on a terminal route at a wide viewport the Refresh
page button renders in-bar followed by the always-present overflow chevron
("More controls") as the right-most element of the right cell
(`data-testid="top-bar-right"`) — while the moved chrome (theme toggle, help
anchor, notification bell, connection dot) renders NOWHERE in the bar
(260724-6j1v). Ordering is asserted by document position (coordinate-free),
robust to the registry-driven structure where a control may render in-bar or in
the hidden measurement probe.

**Steps:**
1. Poll the `/select` route-mock hit counter until `> 0` — proof the trailing-`*`
   glob intercepts the `?server=default` URL rather than falling through to the
   real :3020 backend (the POST fires in a mount-time effect fractionally after
   the close button renders).
2. Set a wide 1280px viewport so the L3 controls stay in-bar.
3. Assert the `Refresh page` button is visible.
4. In the page, assert the right cell contains NO theme button, help anchor,
   bell, or `role="status"` dot; resolve refresh + chevron and assert the
   document-position chain Refresh → chevron, with the chevron inside the
   cluster's last child (the trailing exempt block).

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
