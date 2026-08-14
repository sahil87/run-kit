# right-panel.spec.ts

Proves the terminal route's right **rail** (change
`260811-2r1w-right-panel-shell-web-surface`, retargeted to the surface-layout
model in `260812-ab5v-surface-layout-core`; `docs/specs/surface-layout.md` §
Verbs — "Rail semantics change"): the panel SLOT (surface mount + width drag)
is gone — subsumed by layout tiles — so this spec now covers what remains: a
desktop rail rendered on every terminal route (collapsible from the top bar
since `260812-nm4p`; since `260814-ldbs` it is a floating CARD inside the
Shell stage — `rounded-md` + `rk-card-border` on the shared inset ground,
ending 6px above the full-width status bar, no longer a full-height third
column) whose icon buttons are availability-gated **open-tile toggles** (lit
per open tile; an unlit click appends a tile, a lit click closes it), the
`web` tile rendered by the shared `IframeWindow`, the retired `?panel=` deep
links resolving through the permanent translation shim, value-bearing
per-window persistence, hide-never-unmount across tile close/reopen, the ⇧⌘.
chord toggling the first non-tty tile, and the desktop-only gate. The second
describe covers the `260812-nm4p` top-bar rail toggle under the layout model:
collapse hides the RAIL ONLY — tiles are content-column state and survive it.
Divider-ratio drag coverage lives in `surface-layout.spec.ts` (the divider
moved into the tile grid).

## Shared setup

- **tmux server**: the isolated `rk-test-e2e` socket (`E2E_TMUX_SERVER`),
  started by `scripts/test-e2e.sh` on port 3020. Never run Playwright
  directly — `just test-e2e "right-panel"` / `just pw test right-panel`.
- **`beforeAll`**: create one dedicated session `e2e-rightpanel-<ts>` (80×24) so
  this file never collides with other specs (Playwright `fullyParallel` is off).
- **`afterAll`**: kill the session (best-effort) to keep the shared server clean.
- **`beforeEach`**: set a wide desktop viewport (1440×800) — the rail is
  desktop-only; the mobile test overrides to 375×812. Also register an init
  script that REMOVES the persisted `runkit-rail-open` preference per test —
  the pref otherwise leaks across tests and would silently collapse the rail
  for the next one. The reset is guarded to the TOP FRAME
  (`window !== window.top`): Playwright runs init scripts for EVERY frame, and
  the web tile's same-origin `/proxy/` iframe shares this origin's
  localStorage — an unguarded reset would wipe the pref the moment the tile
  opens.
- **`makeWindow(name, {url?})`**: create a window via `tmux new-window`, then
  stamp `@rk_url` with `tmux set-option -w` (`execFileSync` argument arrays —
  no shell strings). The option surfaces as `rkUrl` in the SSE snapshot, so no
  live HTTP server behind the iframe is needed (assertions are on
  chrome/layout/render, never on iframe content). Returns the stable `@N` id.
- **`gotoWindow(id, search?)`**: navigate to `/<server>/<@N>[?<search>]` and
  wait for the `Connected` SSE indicator.
- **`expectLayoutParam(page, expected)`**: retrying read of the DECODED
  `?layout=` search param (`URL.searchParams` — the router may percent-encode
  `:`/`,`); the `replaceState` mirror lands a beat after the mutation.
- **Locators**: the `right-panel-rail` testid; rail buttons by accessible name
  (`Terminal tile` / `Web tile` — icon glyphs in the render, R10, with the
  former text labels as tooltips/aria); the `Toggle panel` top-bar rail toggle
  (role + accessible name, 260812-nm4p); the `surface-tile-web` tile; its
  `Proxied content` iframe; and the `.xterm` terminal surface. The retired
  `right-panel` / `right-panel-resize-handle` testids and the `Web panel` /
  `Code panel` accessible names are GONE.

## Tests

### the rail renders on every desktop terminal route with the always-available tty toggle; the web toggle only when @rk_url is set
What it proves: the rail renders on every desktop terminal route (spec § The
Model — collapsible from the top bar since `260812-nm4p`) with `tty` always
available and listed (R8) — lit for the default `single:tty` layout — while
the web toggle is availability-gated on the SSE `@rk_url` field (P4's
availability state; Constitution II/X, zero backend change).
Steps:
1. Create a plain window (no `@rk_url`); navigate; assert the terminal, the
   visible rail, the lit `Terminal tile` toggle, and NO `Web tile` button.
2. Create a window WITH `@rk_url`; navigate; assert the terminal and the
   visible (unlit) `Web tile` rail toggle.

### clicking the rail toggle opens a web tile beside a live terminal; clicking again closes it
What it proves: the toggle semantics (R10) — an unlit click APPENDS the tile
(1→2 growth is `split-h`, the visual continuation of the legacy main+panel
split) with the proxied iframe rendering BESIDE the still-mounted terminal;
the URL mirrors the layout and the toggle lights; a lit click CLOSES the tile
(R7 close semantics — the layout collapses 2→1 `single:tty`).
Steps:
1. Create a web-capable window; navigate; assert the terminal.
2. Click the `Web tile` rail toggle; assert the web iframe is visible, the
   terminal is still visible, the URL carries `?layout=split-h:tty,web`, the
   toggle is `aria-pressed`, and the tile keeps its URL textbox.
3. Click the toggle again; assert the web tile is hidden, the URL mirrors
   a clean URL (the default `single:tty` mirrors with the param DROPPED), the toggle is unlit, and the terminal is still visible.

### closing a tile hides but never unmounts the iframe (P3 carried into tiles)
What it proves: closing is a display-level hide — the iframe element survives
in the DOM and re-opening restores THE SAME element (in-memory iframe state
preserved; the panel's P3 rule holds per tile, surface-layout R6).
Steps:
1. Create a web-capable window; navigate; open the web tile via the rail.
2. Close via the rail toggle; assert the tile is hidden but the iframe still
   exists in the DOM (count 1).
3. Capture the iframe element handle, re-open, and assert the visible iframe
   is the identical element.

### ?panel=web and ?layout=split-h:tty,web deep links open the web tile on load; unavailable/invalid values degrade
What it proves: L1 URL-addressability plus the shim + degradation — the
retired `?panel=web` maps to `split-h:tty,web` (a bare panel value against
the tty default slot A) and opens the tile cold; the native `?layout=` form
resolves identically; an unavailable surface (window without `@rk_url`) drops
tile-by-tile to `single:tty` (R4); an unknown value (`bogus`, dropped by
`validateTerminalSearch`) resolves `single:tty`. Never a broken iframe.
The test carries a 30s budget (`test.setTimeout`, the sidebar-panels
precedent): three full page loads plus two window creations exceed the 10s
default on a loaded box.
Steps:
1. Create a web-capable window; navigate with `?panel=web`; assert the web
   iframe and the terminal are both visible and the URL mirrors
   `split-h:tty,web`.
2. Create a second web-capable window; navigate with
   `?layout=split-h:tty,web`; assert the same render.
3. Create a plain window; navigate with `?panel=web`; assert the terminal, the
   rail with no web toggle, and no web tile in the DOM.
4. Navigate the first window with `?panel=bogus`; assert the terminal and no
   web tile.

### an open tile persists across reload
What it proves: persistence (open direction) — a rail toggle writes the
value-bearing `rk-layout:{server}:{@N}` localStorage key, and a bare
re-arrival resolves the open layout from it (ladder rung 2).
Steps:
1. Create a web-capable window; navigate; open the web tile via the rail.
2. Full-load the BARE window route (no carried `?layout=`); wait for
   `Connected`; assert the web iframe is visible again and the URL mirrors
   `split-h:tty,web`.

### a closed tile stays closed across reload
What it proves: persistence (close direction) — closing writes `single:tty`
as the window's layout, and a bare re-arrival renders it with no web tile
subtree.
Steps:
1. Create a web-capable window; navigate; open the web tile via the rail,
   then close it; assert the tile is hidden.
2. Full-load the bare route; wait for `Connected`; assert the terminal is
   visible, no web tile exists in the DOM, and the URL is clean (the default `single:tty` mirrors with the param dropped).

### ?view=web&panel=web (a repeated non-tty kind after the shim) never renders a broken tile (R4/A-019)
What it proves: the layout grammar's duplicate-kind rejection — the shim maps
`?view=web&panel=web` to `split-h:web,web`, which is INVALID (one tile per
surface kind, tty excepted); the fully-invalid value falls through the ladder
to the hint/default rung and renders a valid single-tile layout. The retired
two-independent-web-slots arrangement (main lens + panel) has no layout-model
successor — the intent it served (two surfaces at once) is covered by the
split-h tests above.
Steps:
1. Create a web-capable window; navigate with `?view=web&panel=web`.
2. Assert the terminal renders, exactly one `surface-layout` grid exists, and
   no web tile mounts.

### ⇧⌘. / Shift+Ctrl+. toggles the first non-tty tile (P7, retargeted)
What it proves: the keyboard path (Constitution V) — the registry's
`panel-toggle` chord (shifted tier of `Period`, leaving `view-cycle`'s ⌘.
untouched) now toggles the first non-tty available surface's TILE via the
shared mutation path, firing even while xterm owns focus.
Steps:
1. Create a web-capable window; navigate; assert the terminal, then wait for
   the `Web tile` rail button (the chord's handler is gated on the SSE
   `@rk_url` push — firing earlier would hit a handler-less chord).
2. Press `Shift+Control+Period`; assert the web iframe appears and the URL
   mirrors `split-h:tty,web`.
3. Press `Shift+Control+Period` again; assert the web tile is hidden and the
   URL is clean — the default `single:tty` mirrors with the param dropped.

### 375px mobile: no rail; a 2-tile deep link renders slot A with the surfaces chip
What it proves: the desktop-only gate (P5 → surface-layout R13) — below
`isMobileViewport()` the rail does not render and a multi-tile `?layout=`
deep link shows ONLY slot A full-width, with the remaining surface
mounted-hidden and reachable via the ▦ Surfaces chip. The nested describe
runs `test.use({ hasTouch: true })` so `(pointer: coarse)` matches — a real
phone is coarse AND narrow, and since 260814-ldbs the bottom bar (the chip's
home) is pointer-gated: a fine-pointer narrow window gets no chip bar by
design.
Steps:
1. Set a 375×812 viewport (context already has `hasTouch`); create a
   web-capable window.
2. Navigate with `?layout=split-h:tty,web` (gating on the terminal, not the
   sidebar-footed `Connected` dot — the mobile drawer leaves it unmounted).
3. Assert the terminal is visible, the rail is absent from the DOM, the web
   tile is hidden (mounted), and the `mobile-surfaces-chip` renders.

## Tests — Top-bar rail toggle & stage layout (260812-nm4p + 260814-ldbs, under the layout model)

### the toggle renders on a PLAIN window too (zero available surfaces)
What it proves: the rail toggle's gate is `windowParam && !isMobile` ONLY —
it renders even when neither web nor code is available (no `@rk_url`, no git
root), because the rail is landing-pad chrome, not surface-gated.
Steps:
1. Create a window with cwd `/tmp` (no git root) and no `@rk_url`; navigate.
2. Assert the terminal, the visible rail with NO `Web tile` button, and the
   visible `Toggle panel` top-bar chip.

### collapse hides the rail and the terminal grows; restore brings the rail back
What it proves: the toggle collapses the rail column at display level, so the
terminal runs edge-to-edge; the preference persists to `runkit-rail-open`;
restoring brings the rail back.
Steps:
1. Create a web-capable window; navigate; assert the terminal, toggle, and
   rail are visible; record the terminal's bounding-box width.
2. Click `Toggle panel`; assert the rail is hidden and (polling) the
   terminal's width GROWS.
3. Assert `runkit-rail-open` persisted as `"false"`.
4. Click the toggle again; assert the rail is visible again.

### collapse with an open web TILE hides only the rail; the tile and its ?layout= survive
What it proves: the 260812-ab5v reinterpretation of the rail collapse — tiles
are content-column state, so collapsing the rail never closes a tile, never
drops the `?layout=` param, and strands nothing (each tile carries its own ✕
verb). Restoring shows the rail lit for the still-open tile.
Steps:
1. Create a web-capable window; navigate; open the web tile via the rail
   button; assert `?layout=split-h:tty,web`.
2. Click `Toggle panel`; assert the rail is hidden while the web tile and its
   iframe stay VISIBLE and the layout param is unchanged.
3. Click the toggle again; assert the rail returns with the `Web tile` button
   `aria-pressed`.

### ⇧⌘. works while the rail is collapsed — the tile opens in the content column, the rail stays hidden
What it proves: the surface chord is never dead behind a collapsed rail —
the tile opens in the CONTENT column; the rail's own visibility and the
persisted `runkit-rail-open` preference are untouched (the pre-layout derived
`railOpen || panel open` rule is retired with the panel slot).
Steps:
1. Create a web-capable window; navigate; wait for the `Web tile` rail
   button (the chord's handler is gated on the SSE availability push).
2. Click `Toggle panel`; assert the rail is hidden.
3. Press `Shift+Control+Period`; assert the web iframe becomes visible and
   the URL mirrors `?layout=split-h:tty,web` while the rail STAYS hidden.
4. Assert `runkit-rail-open` is still `"false"`.

### stage layout: the rail card ends above the status bar; no bottom bar exists on a fine-pointer desktop
What it proves: the `260814-ldbs` composed frame — the rail is a floating
CARD inside the Shell stage (not a full-height shell column): the full-width
status bar sits at the `.app-shell` bottom edge and the rail's bottom edge is
the stage's 6px padding above it; and the desktop bottom bar is deleted on
fine pointers (R3) — no `Terminal keys` toolbar exists in the DOM. (The rail
stops being a full-height column here — the earlier full-height assertion
from `260812-nm4p` is inverted by design.)
Steps:
1. Create a web-capable window; navigate; open the web tile.
2. Measure the `.app-shell`, rail, and `status-bar` bounding boxes.
3. Assert the status bar's bottom edge equals the shell's bottom edge and the
   rail's bottom edge sits 6px above the status bar's top edge.
4. Assert no `Terminal keys` toolbar exists in the DOM.

### a legacy ?panel= deep link on a collapsed rail still renders its tile (never a dead link); the rail stays hidden
What it proves: deep links are never dead behind a rail collapse — the tile
renders in the content column regardless of rail visibility; the rail is NOT
forced open (derived visibility is retired).
Steps:
1. Register an init script pinning `runkit-rail-open` to `"false"` (it runs
   after the suite's reset script, so it wins on every navigation).
2. Create a web-capable window; navigate with `?panel=web`.
3. Assert the terminal and the web iframe are visible, the URL mirrors
   `?layout=split-h:tty,web`, and the rail stays hidden.
