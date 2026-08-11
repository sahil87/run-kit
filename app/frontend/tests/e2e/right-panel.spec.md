# right-panel.spec.ts

Proves the terminal route's right panel (change
`260811-2r1w-right-panel-shell-web-surface`, `docs/specs/right-panel.md` phase
1, rules P1–P7): an always-visible desktop rail, a collapsible panel BESIDE
the terminal (never instead of it), the `web` surface rendered by the shared
`IframeWindow`, `?panel=` deep links + value-bearing per-window persistence,
drag-resize with a live (never unmounted) terminal, and the desktop-only gate.

## Shared setup

- **tmux server**: the isolated `rk-test-e2e` socket (`E2E_TMUX_SERVER`),
  started by `scripts/test-e2e.sh` on port 3020. Never run Playwright
  directly — `just test-e2e "right-panel"` / `just pw test right-panel`.
- **`beforeAll`**: create one dedicated session `e2e-rightpanel-<ts>` (80×24) so
  this file never collides with other specs (Playwright `fullyParallel` is off).
- **`afterAll`**: kill the session (best-effort) to keep the shared server clean.
- **`beforeEach`**: set a wide desktop viewport (1440×800) — the rail/panel are
  desktop-only in phase 1; the mobile test overrides to 375×812.
- **`makeWindow(name, {url?})`**: create a window via `tmux new-window`, then
  stamp `@rk_url` with `tmux set-option -w` (`execFileSync` argument arrays —
  no shell strings). The option surfaces as `rkUrl` in the SSE snapshot, so no
  live HTTP server behind the iframe is needed (assertions are on
  chrome/layout/render, never on iframe content). Returns the stable `@N` id.
- **`gotoWindow(id, search?)`**: navigate to `/<server>/<@N>[?<search>]` and
  wait for the `Connected` SSE indicator.
- **Locators**: `right-panel-rail` testid, the `Web panel` rail button (role +
  accessible name), the `right-panel` testid, the panel's `Proxied content`
  iframe, the `.xterm` terminal surface, and the `right-panel-resize-handle`
  testid (the panel's left-edge drag handle).

## Tests

### the rail renders on every desktop terminal route; the web button only when @rk_url is set
What it proves: the rail is always visible on desktop (spec § The Model) while
its buttons are availability-gated — derived from the SSE `@rk_url` field
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
