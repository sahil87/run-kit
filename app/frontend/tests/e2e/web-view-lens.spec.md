# web-view-lens.spec.ts

Proves the iframe feature is a per-viewer **web lens** over the window
(change `260714-t97o-web-view-lens`, `docs/specs/window-views.md` R1–R7):
availability is derived from `@rk_url`, view choice is client-side (URL param +
localStorage), the tty is always reachable, and switching lenses NEVER mutates
`@rk_type` (no window-option POST).

## Shared setup

- **tmux server**: the isolated `rk-test-e2e` socket (`E2E_TMUX_SERVER`), started
  by `scripts/test-e2e.sh` on port 3020.
- **`beforeAll`**: create one dedicated session `e2e-webview-<ts>` (80×24) so this
  file never collides with other specs (Playwright `fullyParallel` is off).
- **`afterAll`**: kill the session (best-effort) to keep the shared server clean.
- **`beforeEach`**: set a wide desktop viewport (1440×800). Since `260722-n2n4`
  the `view-switcher` registry entry is MENU-ONLY: the pill never renders in-bar
  at any width, and the per-view `View:` `menuitemradio` rows in the "More
  controls" chevron menu are the switcher's only rendering. A wide width is the
  distinguishing case (the bar has room, yet the switcher lives only in the
  menu); the mobile test overrides to 375px.
- **`makeWindow(name, {url?, iframeType?})`**: create a window via
  `tmux new-window`, then stamp `@rk_url` and/or `@rk_type=iframe` directly with
  `tmux set-option -w` — the same window-option seam the backend tmux test uses.
  These options surface as `rkUrl`/`rkType` in the SSE snapshot, so no live HTTP
  server behind the iframe is needed (assertions are on chrome/heading/render,
  never on iframe content). Returns the stable `@N` id.
- **`gotoWindow(id, view?)`**: navigate to `/<server>/<@N>[?view=…]` and wait for
  the `Connected` SSE indicator.
- **Locators/helpers**: the `Proxied content` iframe, the `.xterm` terminal
  surface, and the menu-only switcher surface — `menuButton` ("More controls"
  chevron), `controlsMenu`, `viewRow(label)` (`View: Terminal` / `View: Web`
  `menuitemradio` rows), `inBarSwitcher` (the accessible "Window view" group,
  which must ALWAYS be empty now). `switchLens(label)` opens the menu, clicks the
  row, and waits for the menu to close; `expectLensMarked(label, checked)` opens
  the menu, asserts the row's `aria-checked`, and Escape-closes it.

## Tests

### the `View:` menu rows appear only on a web-capable window (no in-bar pill ever)
What it proves: availability is derived (R1) — the switcher's `View:` menu rows
render iff the window offers more than `{tty}` — and the menu-only contract
(260722-n2n4): even on a capable window there is no in-bar pill and no
`view-toggle` testid anywhere in the DOM (bar or probe).
Steps:
1. Create a plain window (no `@rk_url`); navigate to it; assert the terminal.
2. Open the "More controls" menu; assert it carries NO `View:` rows; Escape.
3. Create a window WITH `@rk_url`; navigate to it.
4. Assert no in-bar "Window view" group and no `view-toggle` testid; open the
   menu and assert the `View: Terminal` and `View: Web` rows are visible; Escape.

### flipping web↔tty preserves the window and never POSTs an option mutation
What it proves: view state is client-side (R2/R7) — a flip changes the URL param
and rendered lens but issues no `@rk_type` mutation and does not destroy the
window.
Steps:
1. Create a window with `@rk_url`; register a `page.on("request")` recorder for
   any `POST /api/windows/*/options`.
2. Navigate (default view = tty for an untyped window); assert the terminal.
3. `switchLens("Web")` — open the menu, click the `View: Web` row; assert the
   iframe renders and the URL carries `?view=web`.
4. `switchLens("Terminal")`; assert the terminal renders and the `?view` param
   is dropped.
5. Re-resolve the window by name; assert the id is unchanged AND zero
   `/options` POSTs were recorded across both flips.

### deep link ?view=web cold-loads the iframe
What it proves: a `?view=web` URL is a first-class deep link (R2).
Steps:
1. Create a window with `@rk_url`.
2. Navigate to `…?view=web`.
3. Assert the iframe renders, the menu's `View: Web` row is `aria-checked`
   (`expectLensMarked` — the menu row is the lens indicator now), and the center
   heading shows the static `Window:` prefix (260714-uco1 — the heading does not
   follow the lens).

### ?view=web on a window with no @rk_url falls back to the terminal
What it proves: an unavailable view degrades to tty, not a broken iframe
(R2/R3 — tty always reachable).
Steps:
1. Create a plain window (no `@rk_url`).
2. Navigate to `…?view=web`.
3. Assert the terminal renders, there is no iframe, and the menu carries no
   `View:` rows (single view).

### legacy @rk_type=iframe window defaults to web with the `View: Web` row marked
What it proves: `@rk_type=iframe` is demoted to a default-view HINT (R5) — no
data migration, existing iframe windows keep opening in web with the tty still
one menu row away.
Steps:
1. Create a window with `@rk_url` AND `@rk_type=iframe`.
2. Navigate with no `?view` param and no localStorage.
3. Assert the iframe renders; open the menu and assert both `View:` rows are
   visible with `View: Web` the active (`aria-checked`) row; Escape-close.

### last-view persists across a window switch away and back
What it proves: per-window value-bearing localStorage persistence (R2/R5) —
switching windows drops the URL param (R6) but the last-chosen view sticks. The
A→B switch is a REAL client-side navigation (sidebar row click), so the R6
param-drop is exercised through the router seam (`navigateToWindow`), not a
`page.goto` — guarding against a future `retainSearchParams`/router-upgrade
regression that would silently carry `?view=web` onto B.
Steps:
1. Create window A (with `@rk_url`) and window B (plain).
2. On A, `switchLens("Web")` (the `View: Web` menu row); assert the iframe.
3. Switch to B by clicking B's row button in the `Sessions` sidebar
   (`[data-window-id=<idB>]` → first `button`); assert selection settles on B
   (`aria-current="page"`), the terminal renders, and no `?view` param is
   present (the router dropped the outgoing param — B resolves independently).
4. Navigate back to A WITHOUT a `?view` param; assert the iframe renders and
   the menu's `View: Web` row is `aria-checked` — the persisted last-view
   resolved.

### 375px mobile: the switcher is reachable via the menu rows; menu-only at desktop too
What it proves: since `260722-n2n4` the switcher is menu-only at EVERY width —
at 375px with a realistically long window name the `View:` rows in the "More
controls" chevron menu are its rendering (the center heading keeps its room),
and unlike the former space-driven contract (`260717-6anu`) the pill does NOT
return to the bar at desktop width. The lens itself still resolves and renders
on mobile without horizontal overflow.
Steps:
1. Set the 375×812 viewport; create a window with `@rk_url` and a long
   worktree-style name.
2. Navigate to `…?view=web` and gate on the **iframe** (not the `Connected`
   dot — it lives in the sidebar footer (260724-6j1v), and at 375px the
   sidebar is an unmounted drawer, so the dot never becomes visible;
   window-heading.spec.ts's mobile test gates on the heading for the same
   reason). Assert the iframe renders.
3. Assert no in-bar switcher group ("Window view") AND no `view-toggle` testid
   anywhere in the DOM (menuOnly — no bar slot, no probe copy).
4. Open the "More controls" chevron; assert the menu carries `View: Terminal`
   and `View: Web` rows (each a `role="menuitemradio"`), and the active
   `View: Web` row has `aria-checked="true"`; close the menu (Escape).
5. Assert no horizontal page overflow (`body.scrollWidth <= 375`).
6. Resize to the desktop viewport (1440×800); assert there is STILL no in-bar
   pill and no `view-toggle` testid, and the menu's `View: Web` row remains the
   marked lens indicator (`expectLensMarked`).
