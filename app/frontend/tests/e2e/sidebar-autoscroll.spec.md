# sidebar-autoscroll.spec.ts

Behavioural contract for the desktop sidebar autoscroll
(`260723-nris-sidebar-autoscroll-active-window-server`): when navigation
selects a window whose sidebar row sits below the fold of the Sessions
tree's scroll container, the row is scrolled into view automatically —
scroll-only, without stealing focus. The deep-link path is the strongest
case: the route resolves before SSE data lands, so the scroll must be
deferred (pending-scroll ref retried on the `rowsVersion` visible-set
counter) until the row actually renders.

## Shared setup

- `beforeAll` creates a dedicated session (`e2e-scroll-{ts}`) on the e2e
  tmux server (`E2E_TMUX_SERVER`, default `rk-test-e2e`) and adds 30 named
  windows (`scroll-w-01` … `scroll-w-30`) so the session tree overflows the
  sidebar scrollport on the default desktop viewport (1280×720). `afterAll`
  kills the session.

## Tests

### `deep link to a below-the-fold window scrolls its sidebar row into view`

**What it proves:** A direct URL load of a window whose row starts far
below the Sessions-tree fold lands with that row visible inside the tree's
scrollport — the desktop selection-keyed autoscroll fired once the SSE
snapshot rendered the rows — and focus was not pulled into the sidebar.

**Steps:**
1. Resolve the last window's stable tmux id (`@N`) from
   `GET /api/sessions` by its display name (`scroll-w-30`).
2. Deep-link to `/${server}/${windowId}` via the shared `gotoWindow`
   helper and wait for `Connected`.
3. Wait for the selected row (`[data-window-id="@N"]
   [aria-current="page"]`) to render inside the `role="tree"` container.
4. Poll a geometry evaluation until it reports: the tree overflows
   (`scrollHeight > clientHeight`), the tree actually scrolled
   (`scrollTop > 0` — the row started below the fold), and the row's
   bounding box lies within the tree's box (1px rounding tolerance).
5. Assert `document.activeElement` is NOT inside the tree — the desktop
   autoscroll is scroll-only (no `focus()`), so terminal typing is never
   interrupted.
