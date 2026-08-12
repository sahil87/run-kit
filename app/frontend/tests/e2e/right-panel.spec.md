# right-panel.spec.ts

Proves the terminal route's right panel (change
`260811-2r1w-right-panel-shell-web-surface`, `docs/specs/right-panel.md` phase
1, rules P1–P7): a desktop rail rendered on every terminal route (collapsible
from the top bar since `260812-nm4p`), a collapsible panel BESIDE the terminal
(never instead of it), the `web` surface rendered by the shared
`IframeWindow`, `?panel=` deep links + value-bearing per-window persistence,
drag-resize with a live (never unmounted) terminal, and the desktop-only gate.
The second describe covers `260812-nm4p`: the top-bar rail toggle (the sidebar
toggle's far-right mirror), the full-height Shell grid column, and the derived
`rightAreaVisible = railOpen || panel open` visibility model.

## Shared setup

- **tmux server**: the isolated `rk-test-e2e` socket (`E2E_TMUX_SERVER`),
  started by `scripts/test-e2e.sh` on port 3020. Never run Playwright
  directly — `just test-e2e "right-panel"` / `just pw test right-panel`.
- **`beforeAll`**: create one dedicated session `e2e-rightpanel-<ts>` (80×24) so
  this file never collides with other specs (Playwright `fullyParallel` is off).
- **`afterAll`**: kill the session (best-effort) to keep the shared server clean.
- **`beforeEach`**: set a wide desktop viewport (1440×800) — the rail/panel are
  desktop-only in phase 1; the mobile test overrides to 375×812. Also register
  an init script that REMOVES the persisted `runkit-rail-open` preference per
  test — the pref otherwise leaks across tests and would silently collapse the
  rail for the next one. The reset is guarded to the TOP FRAME
  (`window !== window.top`): Playwright runs init scripts for EVERY frame, and
  the panel's same-origin `/proxy/` iframe shares this origin's localStorage —
  an unguarded reset would wipe the pref the moment a panel opens.
- **`makeWindow(name, {url?})`**: create a window via `tmux new-window`, then
  stamp `@rk_url` with `tmux set-option -w` (`execFileSync` argument arrays —
  no shell strings). The option surfaces as `rkUrl` in the SSE snapshot, so no
  live HTTP server behind the iframe is needed (assertions are on
  chrome/layout/render, never on iframe content). Returns the stable `@N` id.
- **`gotoWindow(id, search?)`**: navigate to `/<server>/<@N>[?<search>]` and
  wait for the `Connected` SSE indicator.
- **Locators**: `right-panel-rail` testid, the `Web panel` rail button (role +
  accessible name), the `Toggle panel` top-bar rail toggle (role + accessible
  name), the `right-panel` testid, the panel's `Proxied content` iframe, the
  `.xterm` terminal surface, and the `right-panel-resize-handle` testid (the
  panel's left-edge drag handle).

## Tests

### the rail renders on every desktop terminal route; the web button only when @rk_url is set
What it proves: the rail renders on every desktop terminal route (spec § The
Model — collapsible from the top bar since `260812-nm4p`) while its buttons
are availability-gated — derived from the SSE `@rk_url` field
(P4's availability state; Constitution II/X, zero backend change).
Steps:
1. Create a plain window (no `@rk_url`); navigate; assert the terminal, the
   visible rail, and NO `Web panel` button.
2. Create a window WITH `@rk_url`; navigate; assert the terminal and the
   visible `Web panel` rail button.

### clicking the rail button opens the panel beside a live terminal; clicking again closes it
What it proves: the panel is additive (P2) — it opens between terminal and
rail with the proxied iframe while the tty stays mounted and visible; the URL
gains `?panel=web`; the panel-context iframe drops the `>_` switch-to-terminal
affordance but keeps the URL bar.
Steps:
1. Create a web-capable window; navigate; assert the terminal.
2. Click the `Web panel` rail button; assert the panel iframe is visible, the
   terminal is still visible, the URL carries `?panel=web`, the panel has no
   `Switch to terminal` button, and its URL textbox is present.
3. Click the rail button again; assert the panel is hidden, the `panel` param
   is gone, and the terminal is still visible.

### collapse hides but never unmounts the iframe (P3)
What it proves: collapsing is a display-level hide — the iframe element
survives in the DOM and re-opening restores THE SAME element (in-memory iframe
state preserved).
Steps:
1. Create a web-capable window; navigate; open the panel via the rail button.
2. Close via the rail button; assert the panel is hidden but the iframe still
   exists in the DOM (count 1).
3. Capture the iframe element handle, re-open, and assert the visible iframe
   is the identical element.

### ?panel=web deep link opens the panel on load; unavailable/unknown values resolve closed
What it proves: P1 URL-addressability plus the resolvePanel fall-through — a
valid deep link on a capable window opens the panel cold; an unavailable value
(window without `@rk_url`) or an unknown value (`bogus`, dropped by
`validateTerminalSearch`) renders closed, never a broken iframe.
The test carries a 30s budget (`test.setTimeout`, the sidebar-panels
precedent): three full page loads plus two window creations exceed the 10s
default on a loaded box.
Steps:
1. Create a web-capable window; navigate with `?panel=web`; assert the panel
   iframe and the terminal are both visible.
2. Create a plain window; navigate with `?panel=web`; assert the terminal, the
   rail with no buttons, and no panel in the DOM.
3. Navigate the web-capable window with `?panel=bogus`; assert the terminal and
   no panel.

### an open panel persists across reload
What it proves: P1 persistence (open direction) — opening writes the
value-bearing `runkit-window-panel:{server}:{@N}` localStorage key, and a
reload resolves the panel open from it. (Split from the close direction so
each test fits the suite's 10s per-test budget.)
Steps:
1. Create a web-capable window; navigate; open the panel via the rail button.
2. Reload; wait for `Connected`; assert the panel iframe is visible again and
   the URL carries `?panel=web`.

### a closed panel stays closed across reload
What it proves: P1 persistence (close direction) — closing REMOVES the key
(absent = closed), and a reload renders closed with no panel subtree.
Steps:
1. Create a web-capable window; navigate; open the panel via the rail button,
   then close it; assert the panel is hidden.
2. Reload; wait for `Connected`; assert the terminal is visible and no panel
   exists in the DOM.

### ?view=web and ?panel=web render two independent iframe slots simultaneously (P2)
What it proves: the two slots are independent — the main slot's `web` lens and
the panel's `web` surface coexist as two `IframeWindow` instances, and only
the MAIN slot carries the `>_` switch-to-terminal button.
Steps:
1. Create a web-capable window; navigate with `?view=web&panel=web`.
2. Assert two `Proxied content` iframes, the panel's iframe visible, and
   exactly one `Switch to terminal` button (the main slot's).

### drag-resize changes the panel width and the terminal survives (refit, no unmount)
What it proves: the left-edge drag handle resizes the panel while the terminal
stays mounted (same xterm element) and visible — refit rides the existing
ResizeObserver; no suspension/unmount (the board-page pane-resize bug class).
Steps:
1. Create a web-capable window; navigate; open the panel; assert the terminal.
2. Measure the panel and the resize handle; capture the xterm element handle.
3. Drag the handle 120px left (mouse down/move/up).
4. Assert the panel is measurably wider and the terminal is the SAME element,
   still visible.

### ⇧⌘. / Shift+Ctrl+. toggles the web panel (P7)
What it proves: the keyboard path (Constitution V) — the registry's
`panel-toggle` chord (shifted tier of `Period`, leaving `view-cycle`'s ⌘.
untouched) opens and closes the panel, firing even while xterm owns focus.
Steps:
1. Create a web-capable window; navigate; assert the terminal, then wait for
   the `Web panel` rail button (the chord's handler is gated on the SSE
   `@rk_url` push — firing earlier would hit a handler-less chord).
2. Press `Shift+Control+Period`; assert the panel iframe appears.
3. Press `Shift+Control+Period` again; assert the panel is hidden.

### 375px mobile: neither rail nor panel renders and ?panel= is ignored
What it proves: the desktop-only phase-1 gate (P5, Open Question 3) — below
`isMobileViewport()` the rail and panel do not render and a `?panel=web` deep
link resolves closed.
Steps:
1. Set a 375×812 viewport; create a web-capable window.
2. Navigate with `?panel=web` (gating on the terminal, not the sidebar-footed
   `Connected` dot — the mobile drawer leaves it unmounted).
3. Assert the terminal is visible and neither the rail nor the panel exists in
   the DOM.

## Tests — Top-bar rail toggle & full-height column (260812-nm4p)

### the toggle renders on a PLAIN window too (zero available surfaces)
What it proves: the rail toggle's gate is `windowParam && !isMobile` ONLY —
it renders even when neither surface is available (no `@rk_url`, no git root),
because the rail is landing-pad chrome, not surface-gated (plan A2).
Steps:
1. Create a window with cwd `/tmp` (no git root) and no `@rk_url`; navigate.
2. Assert the terminal, the visible rail with NO `Web panel` button, and the
   visible `Toggle panel` top-bar chip.

### collapse hides the rail and the terminal grows; restore brings the rail back
What it proves: the toggle collapses the whole right column at display level
(never unmounting it), so the terminal runs edge-to-edge; the preference
persists to `runkit-rail-open`; restoring brings back only the rail.
Steps:
1. Create a web-capable window; navigate; assert the terminal, toggle, and
   rail are visible; record the terminal's bounding-box width.
2. Click `Toggle panel`; assert the rail is hidden and (polling) the
   terminal's width GROWS.
3. Assert `runkit-rail-open` persisted as `"false"`.
4. Click the toggle again; assert the rail is visible again.

### collapse with an open panel hides BOTH and drops ?panel=; restore brings back only the rail
What it proves: R6 collapse-closes-panel — collapsing with an open panel runs
the same close path as `togglePanel`'s close branch (`removeStoredPanel` +
dropping `?panel=`), because a hidden-but-open panel would contradict its own
URL. The collapse is still display-level: the iframe element is never
unmounted (the SAME element survives). Restoring returns only the rail — a
panel closed by a collapse stays closed.
Steps:
1. Create a web-capable window; navigate; open the panel via the rail button;
   assert `?panel=web` in the URL.
2. Capture the iframe element handle; click `Toggle panel`.
3. Assert the rail and panel are both hidden, the `panel` param is gone, and
   the `runkit-window-panel:{server}:{@N}` localStorage key is removed.
4. Assert the iframe still exists in the DOM (count 1) and is the identical
   element (no reload/remount).
5. Click the toggle again; assert the rail is visible, the panel stays
   hidden, and the URL stays clean.

### ⇧⌘. after a collapse re-shows the rail WITH the panel (derived visibility)
What it proves: R5 — opening a panel while the rail is collapsed forces the
right area visible (derived `rightAreaVisible`, no synchronizing effect), so
the panel chord is never dead; the persisted `railOpen` preference is NOT
flipped by it.
Steps:
1. Create a web-capable window; navigate; wait for the `Web panel` rail
   button (the chord's handler is gated on the SSE availability push).
2. Click `Toggle panel`; assert the rail is hidden.
3. Press `Shift+Control+Period`; assert the rail AND the panel iframe become
   visible and the URL carries `?panel=web`.
4. Assert `runkit-rail-open` is still `"false"` (derivation, not sync).

### full-height layout: the rail+panel column reaches the shell bottom; the bottom bar spans only the terminal column
What it proves: R1 — the right panel is a full-height Shell grid column
beside the content column (not inside it): with a panel open, the rail and
panel bounding boxes reach the `.app-shell` bottom edge (below the bottom
bar's top), and the bottom bar's width equals the terminal column's width,
not the full viewport.
Steps:
1. Create a web-capable window; navigate; open the panel.
2. Measure the `.app-shell`, rail, panel, `footer`, and `main` bounding
   boxes.
3. Assert the rail's and panel's bottom edges equal the shell's bottom edge
   and extend below the footer's top edge.
4. Assert the footer's width equals `main`'s width and is less than the
   viewport width.

### a ?panel= deep link on a collapsed rail renders rail+panel (never a dead link)
What it proves: R5 deep-link arm — a `?panel=web` URL loaded with the rail
preference collapsed still shows the rail + panel (an open panel always
forces the right area visible).
Steps:
1. Register an init script pinning `runkit-rail-open` to `"false"` (it runs
   after the suite's reset script, so it wins on every navigation).
2. Create a web-capable window; navigate with `?panel=web`.
3. Assert the terminal, the rail, and the panel iframe are all visible.
