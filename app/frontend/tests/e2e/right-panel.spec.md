# right-panel.spec.ts

Proves the terminal route's top-bar **surface-toggle group** (change
`260815-19me-composed-frame-unification`; the spec was formerly the right
**rail** e2e — `260811-2r1w-right-panel-shell-web-surface`, retargeted to the
surface-layout model in `260812-ab5v-surface-layout-core`). The rail
(`right-panel.tsx`, the `right-panel-rail` testid) is DELETED: its
availability-gated **open-tile toggles** relocated into the top bar's right
cluster as ONE bordered sub-group (`data-testid="surface-toggles"`,
`SurfaceToggleGroup` in `top-bar.tsx`), desktop terminal route only, leftmost
in the cluster and the first overflow fit candidate. The button grammar is the
rail's, unchanged: one Tip-wrapped button per available surface not in
`SURFACE_RAIL_HIDDEN` (chat never gets a toggle), `tty` first, glyphs from
`SURFACE_GLYPH` (`>_` tty / `://` web / `{}` code), `<Label> tile` aria names,
`aria-pressed` lit per open tile, a corner availability dot on every button,
disabled-at-3 with the "Close a tile first" tip. The rail-collapse chrome — the
`Toggle panel` top-bar chip, the persisted `runkit-rail-open` preference, the
`Panel: Toggle rail` palette action — is GONE, and its tests are deleted with
it (collapse semantics have no successor: tiles are content-column state and
the rail no longer exists). What remains covered: capability gating (tty
always; web via `@rk_url`; code via gitRoot), the add/close arity walk (1→2
`split-h`, 2→3 `main-left`), disabled-at-3 with its tooltip,
hide-never-unmount across tile close/reopen, the retired `?panel=`/`?view=`
deep links resolving through the permanent translation shim, value-bearing
per-window persistence, the `code-toggle` chord (⇧Ctrl+J) toggling the code tile, and
the desktop-terminal-only gate (server route + mobile). Divider-ratio drag
coverage lives in `surface-layout.spec.ts`; the overflow menu's Tiles section
(when the group drops out of the bar) is the top-bar-overflow spec's beat.

## Shared setup

- **tmux server**: the isolated `rk-test-e2e` socket (`E2E_TMUX_SERVER`),
  started by `scripts/test-e2e.sh` on port 3020. Never run Playwright
  directly — `just test-e2e "right-panel"` / `just pw test right-panel`.
- **`beforeAll`**: create one dedicated session `e2e-rightpanel-<ts>` (80×24) so
  this file never collides with other specs (Playwright `fullyParallel` is off).
- **`afterAll`**: kill the session (best-effort) to keep the shared server clean.
- **`beforeEach`**: set a wide desktop viewport (1440×800) — the toggle group
  is desktop-only and the first overflow fit candidate, so a wide viewport
  keeps it in-bar; the mobile test overrides to 375×812. (The retired
  `runkit-rail-open` reset init script is gone with the preference.)
- **`makeWindow(name, {url?})`**: create a window via `tmux new-window`, then
  stamp `@rk_url` with `tmux set-option -w` (`execFileSync` argument arrays —
  no shell strings). The option surfaces as `rkUrl` in the SSE snapshot, so no
  live HTTP server behind the iframe is needed (assertions are on
  chrome/layout/render, never on iframe content). Default-cwd windows inherit
  the tmux server's repo-root cwd, so they are code-capable (gitRoot derived).
  Returns the stable `@N` id.
- **`gotoWindow(id, search?)`**: navigate to `/<server>/<@N>[?<search>]` and
  wait for the **status bar's** `Connected` dot — the desktop sidebar renders
  NO footer since 260815-19me (the footer dot is mobile-drawer-only), so the
  old `nav [aria-label='Connected']` gate no longer resolves on desktop.
- **`expectLayoutParam(page, expected)`**: retrying read of the DECODED
  `?layout=` search param (`URL.searchParams` — the router may percent-encode
  `:`/`,`); the `replaceState` mirror lands a beat after the mutation.
- **Locators — the probe rule**: the top bar ALWAYS renders an aria-hidden
  off-screen measurement PROBE duplicating every in-bar control, and
  Playwright treats the probe as visible — testid/CSS queries match BOTH
  copies of the group. Toggle buttons are located ONLY by accessible-name role
  queries scoped to the banner landmark
  (`page.getByRole("banner").getByRole("button", { name: "<Label> tile", exact: true })`),
  which exclude the probe subtree (the `top-bar-overflow.spec.ts` pattern).
  Also used: the `surface-tile-web` / `surface-tile-code` tiles, the
  `Proxied content` iframe, and the `.xterm` terminal surface. The retired
  `right-panel-rail` / `right-panel` testids, the `Toggle panel` chip, and the
  rail-collapse cases are GONE.

## Tests

### the toggle group renders on the desktop terminal route with the always-available tty toggle; the web toggle only when @rk_url is set
What it proves: the group renders on the desktop terminal route with `tty`
always available (R8) — lit for the default `single:tty` layout — and `code`
available via the derived gitRoot (a repo-cwd window), while the web toggle is
availability-gated on the SSE `@rk_url` field (Constitution II/X, zero backend
change). Also pins the shared glyph vocabulary (`>_`, `{}`, `://`) and the
corner availability dot.
Steps:
1. Create a plain repo-cwd window (no `@rk_url`); navigate; assert the
   terminal, the lit `Terminal tile` toggle (with the `>_` glyph and one
   corner dot), the unlit `Code tile` toggle (with the `{}` glyph), and NO
   `Web tile` button.
2. Create a window WITH `@rk_url`; navigate; assert the terminal and the
   visible (unlit) `Web tile` toggle with the `://` glyph.

### a window with no git root and no @rk_url shows only the tty toggle
What it proves: the per-surface capability gate — a window offering neither
web nor code (cwd `/tmp`, no `@rk_url`) renders the group with ONLY the
always-available tty toggle. (The rail-era version of this case asserted the
`Toggle panel` chip; that chrome is deleted — only the group remains.)
Steps:
1. Create a window with cwd `/tmp` and no `@rk_url`; navigate.
2. Assert the terminal is visible (proving the SSE window payload landed, so
   the count-0 assertions are settled), the `Terminal tile` toggle renders,
   and neither `Web tile` nor `Code tile` exists.

### clicking a surface toggle opens a web tile beside a live terminal; clicking again closes it
What it proves: the toggle semantics (R10/R7), unchanged from the rail — an
unlit click APPENDS the tile (1→2 growth is `split-h`, the visual continuation
of the legacy main+panel split) with the proxied iframe rendering BESIDE the
still-mounted terminal; the URL mirrors the layout and the toggle lights; a
lit click CLOSES the tile (the layout collapses 2→1 `single:tty`).
Steps:
1. Create a web-capable window; navigate; assert the terminal and wait for the
   `Web tile` toggle.
2. Click it; assert the web iframe is visible, the terminal is still visible,
   the URL carries `?layout=split-h:tty,web`, the toggle is `aria-pressed`,
   and the tile keeps its URL textbox.
3. Click the toggle again; assert the web tile is hidden, the URL is clean
   (the default `single:tty` mirrors with the param DROPPED), the toggle is
   unlit, and the terminal is still visible.

### toggles grow the layout 1→2 split-h then 2→3 main-left; a lit click closes back down (R10/R7)
What it proves: the add/close arity walk through the top-bar group — 1→2
growth is `split-h`, 2→3 growth is `main-left` (the incumbent slot-A tile
stays dominant), and a lit click collapses 3→2 back to `split-h` with order
preserved. One of the file's two 3-tile flows (with disabled-at-3); they run
serially in fresh browser contexts, so the h1 6-slot pool budget is per-page
and never contended.
Steps:
1. Create a web-capable (and repo-cwd, so code-capable) window; navigate;
   wait for both the `Web tile` and `Code tile` toggles.
2. Click `Web tile`; assert `?layout=split-h:tty,web`, the visible web tile,
   and the lit toggle.
3. Click `Code tile`; assert `?layout=main-left:tty,web,code`, the visible
   code tile, and the lit toggle.
4. Click `Code tile` again; assert `?layout=split-h:tty,web`, the hidden code
   tile, and the unlit toggle.

### at 3 open tiles the unlit toggle is disabled and tips 'Close a tile first'
What it proves: the max-3-tiles gate (Constitution IV) — at 3 open tiles the
UNLIT toggles render disabled instead of no-oping silently, and the disabled
button still tips "Close a tile first" (the Tip wraps a span so the tooltip
survives the disabled control's swallowed pointer events). Since chat is
hidden from the group (`SURFACE_RAIL_HIDDEN`), the only way to hold an unlit
shown toggle at 3 open tiles is an open CHAT tile — the window is made
chat-capable by stamping the pane `@rk_chat` option on a NON-shell pane (the
backend reconciler zeroes chat on plain-shell panes). Closing one tile
re-enables the unlit toggle.
Steps:
1. Create a window running `exec sleep 600` (a non-shell pane command); stamp
   `@rk_url` (window option) and `@rk_chat claude:e2e-disabled-at-3` (pane
   option, resolved via `#{pane_id}`).
2. Navigate with `?layout=main-left:tty,web,chat`; assert the terminal and
   that the URL mirrors the 3-tile layout unchanged (nothing degraded).
3. Assert `Terminal tile` and `Web tile` are lit while `Code tile` is unlit
   and disabled.
4. Hover the Code toggle's PARENT SPAN; assert a `role="tooltip"` element
   reads "Close a tile first" (expect's retry absorbs the open delay); move
   the mouse away.
5. Click the lit `Web tile` toggle; assert `?layout=split-h:tty,chat` and the
   Code toggle enabled again.

### closing a tile hides but never unmounts the iframe (P3 carried into tiles)
What it proves: closing is a display-level hide — the iframe element survives
in the DOM and re-opening restores THE SAME element (in-memory iframe state
preserved; the panel's P3 rule holds per tile, surface-layout R6).
Steps:
1. Create a web-capable window; navigate; open the web tile via the top-bar
   toggle.
2. Close via the same toggle; assert the tile is hidden but the iframe still
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
precedent): three full page loads plus three window creations exceed the 10s
default on a loaded box.
Steps:
1. Create a web-capable window; navigate with `?panel=web`; assert the web
   iframe and the terminal are both visible and the URL mirrors
   `split-h:tty,web`.
2. Create a second web-capable window; navigate with
   `?layout=split-h:tty,web`; assert the same render.
3. Create a plain window; navigate with `?panel=web`; assert the terminal, the
   `Terminal tile` toggle with NO `Web tile` button, and no web tile in the
   DOM.
4. Navigate the first window with `?panel=bogus`; assert the terminal and no
   web tile.

### an open tile persists across reload
What it proves: persistence (open direction) — a toggle click writes the
value-bearing `rk-layout:{server}:{@N}` localStorage key, and a bare
re-arrival resolves the open layout from it (ladder rung 2).
Steps:
1. Create a web-capable window; navigate; open the web tile via the toggle.
2. Full-load the BARE window route (no carried `?layout=`); wait for the
   status-bar `Connected` dot; assert the web iframe is visible again and the
   URL mirrors `split-h:tty,web`.

### a closed tile stays closed across reload
What it proves: persistence (close direction) — closing writes `single:tty`
as the window's layout, and a bare re-arrival renders it with no web tile
subtree.
Steps:
1. Create a web-capable window; navigate; open the web tile via the toggle,
   then close it; assert the tile is hidden.
2. Full-load the bare route; wait for the status-bar `Connected` dot; assert
   the terminal is visible, no web tile exists in the DOM, and the URL is
   clean (the default `single:tty` mirrors with the param dropped).

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

### ⇧Ctrl+J / ⌘J toggles the code tile (the code-toggle chord)
What it proves: the keyboard path (Constitution V) — the registry's
`code-toggle` chord (⌘J on mac, ⇧Ctrl+J on Win/Linux; VS Code's panel-toggle
keycap) toggles the code surface's TILE via the shared mutation path, firing
even while xterm owns focus. The web tile's keyboard path is the palette
(`Layout: Add Web` / `Layout: Close Web`).
Steps:
1. Create a web-capable window (repo-root cwd ⇒ also code-capable); navigate;
   assert the terminal, then wait for the `Code tile` toggle (the chord's
   handler is gated on the derived gitRoot arriving via the SSE window
   payload — firing earlier would hit a handler-less chord).
2. Press `Shift+Control+KeyJ`; assert the code tile appears and the URL
   mirrors `split-h:tty,code`.
3. Press `Shift+Control+KeyJ` again; assert the code tile is hidden and the
   URL is clean — the default `single:tty` mirrors with the param dropped.

### the toggle group does not render off the terminal route (the server route's banner carries no tile toggles)
What it proves: the route gate — the top-bar registry entry is hidden unless
`mode === "terminal" && currentWindow && surfaceToggles`, so the server route
(mode `server`, no current window) renders no group anywhere (bar, probe, or
menu).
Steps:
1. Navigate to `/<server>`; wait for the status-bar `Connected` dot.
2. Assert the banner carries no `Terminal tile`, `Web tile`, or `Code tile`
   button.

### 375px mobile: no top-bar toggle group; a 2-tile deep link renders slot A with the surfaces chip
What it proves: the desktop-only gate — `surfaceToggles` is registered only
when `windowParam && !isMobile`, so at 375px the banner carries no tile
toggles, and a multi-tile `?layout=` deep link shows ONLY slot A full-width
with the remaining surface mounted-hidden and reachable via the ▦ Surfaces
chip. The nested describe runs `test.use({ hasTouch: true })` so
`(pointer: coarse)` matches — a real phone is coarse AND narrow, and since
260814-ldbs the bottom bar (the chip's home) is pointer-gated: a fine-pointer
narrow window gets no chip bar by design.
Steps:
1. Set a 375×812 viewport (context already has `hasTouch`); create a
   web-capable window.
2. Navigate with `?layout=split-h:tty,web` (gating on the terminal, not the
   `Connected` dot — on mobile the dot lives in the drawer's footer, which is
   unmounted until the drawer opens).
3. Assert the terminal is visible, the banner carries no `Terminal tile` /
   `Web tile` button, the web tile is hidden (mounted), and the
   `mobile-surfaces-chip` renders.
