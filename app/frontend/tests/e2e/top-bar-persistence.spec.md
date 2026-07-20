# top-bar-persistence.spec.ts

Regression coverage for change 260707-4vq2: the **TopBar mounts once** in the
persistent root layout (`AppLayout`, above the router `<Outlet>`) instead of the
three separate per-page copies it had before. This verifies the **user-facing**
outcomes of that lift:

1. The bar stays present across **client-side** cross-route navigation — its
   brand crumb is visible immediately after each such hop settles, rather than
   the bar being torn down and rebuilt as a blank between pages (the old "navbar
   reload" flicker). Only genuine in-app router navigation exercises this
   persistence claim (see the hop 2 caveat below).
2. Its center heading is **route-derived** and updates per route — Host →
   `tmux Server <server>` → back to Host → `Board <board>` — including the
   board heading, which renders from the URL param while the lazy board chunk
   loads.
3. On an **unmatched route** (`/board/x/y`), the bar falls back to the minimal
   `host` heading rather than leaking the fuzzy-matched board param as
   `Board x` (the T002 not-found-fallback fix, R10 / A-015).

**Hop 2 is a reload boundary, not a persistence hop.** The brand crumb is a raw
`<a href="/">` (top-bar.tsx) that TanStack Router does **not** intercept, so
clicking it triggers a **full document navigation** — the whole document
reloads. Hop 2 therefore does not (and cannot) prove the bar survived without a
remount; it verifies the persistent-layout chrome mounts correctly on a **cold
load** at `/`. Only hops 1 and 3 (a server tile and a board tile, both
router-driven) test the no-remount persistence claim.

The internal implementation (a single non-remounting `RootTopBar` fed by a
route-derived mode + a page-registered slot context) is unit-tested in
`top-bar-slot-context.test.tsx`; this e2e covers the observable cross-route
behavior a user would see.

## Shared setup

- Fully mocked — no tmux server, no `gh`, no real backend reads. The spec injects
  data via `page.route`:
  - `**/api/servers` → a single server `default` (one clickable server tile; one
    state-socket attach).
  - `**/api/boards` → one board `myboard` (a clickable tile in the Host BOARDS
    zone).
  - `**/api/boards/myboard` → one board entry (server `default`, window `@1`) so
    the board route has content.
  - `/ws/state` (state socket, via `mockStateSocket`) → the subscribe ack + `sessions` event carry the mocked payload: session `dev` with a
    single active window `@1` "feature-work".
  - `**/api/windows/*/select*` → `{ ok: true }` (trailing `*` matches the
    `?server=` query string) so window-selection POSTs during nav don't error.
  - the `/ws/terminals` mux WebSocket is stubbed (accepted, held open) so any terminal pane
    mounts without a backend.
- `beforeEach` installs the routes. Hops 1 and 3 navigate client-side via
  router-driven controls (a server tile, a board tile). Hop 2 clicks the raw
  `<a href="/">` brand crumb, which TanStack Router does not intercept — that
  hop is a full document reload, not client-side nav (see the header caveat).
  The unmatched-route test starts from its own `page.goto("/board/x/y")`.
- **Heading aria-labels** carry no colon (the `PageType: name` colon is
  presentational): `Host`, `tmux Server default`, `Board myboard`. The `Host`
  heading is matched with `exact: true` to disambiguate it from the Host page's
  `Host health` region (`getByLabel` is a substring match by default).

## Tests

### `the persistent bar stays present and its heading updates across / → /$server → /board`

**What it proves:** across Host → tmux Server → Host → Board navigation,
the persistent top bar remains present (its brand crumb visible after every hop)
and its route-derived center heading updates to the correct page each time,
including the board heading rendered from the URL while the lazy chunk loads.

**Steps:**
1. `goto("/")`; assert the solo `Host` heading and the `RunKit home` brand
   crumb are visible.
2. Click the `default` server tile (scoped to the "Tmux servers" region). Assert
   URL `/default`, heading `tmux Server default`, brand crumb visible, and the
   previous `Host` heading is gone (count 0 — the mode is route-derived, not
   stacked).
3. **(Reload boundary)** Click the `RunKit home` brand crumb — a full document
   reload, not client-side nav. Assert URL `/`, the persistent-layout chrome
   remounts with the `Host` heading, brand crumb visible, and the
   `tmux Server default` heading gone.
4. Click the `myboard` board tile (scoped to the "Boards" region). Assert URL
   `/board/myboard`, heading `Board myboard` (from the URL param while the lazy
   board chunk loads), and the brand crumb still visible.

### `an unmatched route falls back to the minimal host heading (not the fuzzy-matched board param)`

**What it proves:** on an unmatched route that fuzzy-matches the board route
(`/board/x/y`, so `NotFoundPage` renders under the persistent bar), the bar
falls back to the minimal `host` heading instead of leaking the
partially-matched `name=x` param as a `Board x` heading. This is the T002
not-found-fallback fix: TanStack Router retains fuzzy-matched params in
`useMatches()`, so `NotFoundPage` signals not-found into the slot context and
`RootTopBar` forces the host fallback.

**Steps:**
1. `goto("/board/x/y")`; assert the `Page not found` body is visible.
2. Assert the persistent bar shows the `Host` fallback heading and its brand
   crumb is visible.
3. Assert there is NO `Board x` heading (count 0 — the fuzzy-matched param did
   not leak into the bar).
