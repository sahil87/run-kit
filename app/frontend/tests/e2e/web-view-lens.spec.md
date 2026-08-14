# web-view-lens.spec.ts

Proves the iframe feature is a per-viewer **web lens** over the window
(change `260714-t97o-web-view-lens`, `docs/specs/window-views.md` R1–R7):
availability is derived from `@rk_url`, view choice is client-side (URL param +
localStorage), the tty is always reachable, and switching lenses NEVER mutates
`@rk_type` (no window-option POST). Since `260812-ab5v-surface-layout-core`
the lens IS a single-tile surface layout: `?view=X` deep links resolve through
the permanent translation shim (`single:X`), the palette's `View: …` actions
set `single:<view>` through the shared mutation path (R12), and the URL mirror
rewrites everything to `?layout=` — so URL assertions key off the decoded
`layout` param, never `view`. Since `260812-0c6o` the ViewSwitcher is RETIRED:
the command palette is the ONLY lens-switch surface (plus the rail's open-tile
toggles) — the chevron menu carries no `View:` rows and the `view-toggle`
testid exists nowhere.

## Shared setup

- **tmux server**: the isolated `rk-test-e2e` socket (`E2E_TMUX_SERVER`), started
  by `scripts/test-e2e.sh` on port 3020.
- **`beforeAll`**: create one dedicated session `e2e-webview-<ts>` (80×24) so this
  file never collides with other specs (Playwright `fullyParallel` is off).
- **`afterAll`**: kill the session (best-effort) to keep the shared server clean.
- **`beforeEach`**: set a wide desktop viewport (1440×800); the mobile test
  overrides to 375px.
- **`makeWindow(name, {url?, iframeType?, cwd?})`**: create a window via
  `tmux new-window`, then stamp `@rk_url` and/or `@rk_type=iframe` directly with
  `tmux set-option -w` — the same window-option seam the backend tmux test uses.
  `cwd: "/tmp"` makes the window NON-repo (no gitRoot → code unavailable) — the
  deterministic single-view case. The stamped options surface as
  `rkUrl`/`rkType` in the SSE snapshot, so no live HTTP server behind the
  iframe is needed (assertions are on chrome/heading/render, never on iframe
  content). Returns the stable `@N` id.
- **`gotoWindow(id, view?)`**: navigate to `/<server>/<@N>[?view=…]` and wait for
  the `Connected` SSE indicator (nav-scoped since 260814-ldbs — the status bar carries its own `Connected` dot).
- **`expectLayoutParam(page, expected)`**: retrying read of the DECODED
  `?layout=` search param (`URL.searchParams` — the router may percent-encode
  `:`/`,`); the `replaceState` mirror lands a beat after the arrival/switch.
- **Locators/helpers**: the `Proxied content` iframe, the `.xterm` terminal
  surface, `controlsMenu` ("More controls" chevron menu — must NEVER carry
  `View:` rows), `inBarSwitcher` (the accessible "Window view" group, which must
  ALWAYS be empty), and the palette helpers — `openPalette(query)` presses
  `Meta+k` and fills the search input; `switchLens(label)` runs the palette's
  `View: {label}` option and waits for the palette to close.

## Tests

### lens switching is palette-only — the palette gates on capability, the menu carries no `View:` rows (260812-0c6o)
What it proves: availability is derived (R1) — the palette's `View: Web` action
renders iff the window offers the web lens — and the retirement contract
(260812-0c6o): even on a capable window there is no in-bar pill, no
`view-toggle` testid anywhere in the DOM (bar or probe), and no `View:` rows in
the chevron menu. The single-view window uses a NON-repo cwd (`/tmp`) so `code`
is unavailable too — a repo-cwd window is code-capable since k3vp, and relying
on the gitRoot probe's timing would be a race.
Steps:
1. Create a plain window (no `@rk_url`, `/tmp` cwd); navigate to it; assert the
   terminal.
2. Open the palette with `View: Web`; assert NO `View: Web` option; Escape.
3. Create a window WITH `@rk_url`; navigate to it.
4. Assert no in-bar "Window view" group and no `view-toggle` testid; open the
   palette and assert the `View: Web` option is visible; Escape.
5. Open the "More controls" menu; assert it carries NO `View:` rows; Escape.

### flipping web↔tty preserves the window and never POSTs an option mutation
What it proves: view state is client-side (R2/R7) — a flip changes the layout
(`View: Web` ⇒ `single:web`, R12's shim) and rendered lens but issues no
`@rk_type` mutation and does not destroy the window.
Steps:
1. Create a window with `@rk_url`; register a `page.on("request")` recorder for
   any `POST /api/windows/*/options`.
2. Navigate (default view = tty for an untyped window); assert the terminal.
3. `switchLens("Web")` — run the palette's `View: Web` action; assert the
   iframe renders and the mirrored URL carries `?layout=single:web`.
4. `switchLens("Terminal")`; assert the terminal renders and the URL mirrors
   a clean URL — the default `single:tty` mirrors with the param dropped.
5. Re-resolve the window by name; assert the id is unchanged AND zero
   `/options` POSTs were recorded across both flips.

### deep link ?view=web cold-loads the iframe
What it proves: a `?view=web` URL is a first-class deep link (R2) — the shim
maps it to `single:web` and the `replaceState` mirror rewrites the URL.
Steps:
1. Create a window with `@rk_url`.
2. Navigate to `…?view=web`.
3. Assert the iframe renders, the mirrored URL reads `?layout=single:web`, and
   the center heading shows the static `Window:` prefix (260714-uco1 — the
   heading does not follow the lens).

### ?view=web on a window with no @rk_url falls back to the terminal
What it proves: an unavailable view degrades to tty, not a broken iframe
(R2/R3 — tty always reachable; the layout ladder's tile-by-tile degradation).
The window is created in `/tmp` (non-repo) so `code` is unavailable too and
the single-view gate is deterministic (no gitRoot-probe race).
Steps:
1. Create a plain window (no `@rk_url`, `/tmp` cwd).
2. Navigate to `…?view=web`.
3. Assert the terminal renders, there is no iframe, the URL is clean (the
   default drops the param), and the palette offers no `View: Web` action
   (single view).

### legacy @rk_type=iframe window defaults to web (ladder hint rung)
What it proves: `@rk_type=iframe` is demoted to a default-view HINT (R5 —
ladder rung 3) — no data migration, existing iframe windows keep opening in
web (`single:web`) with the tty one palette action away.
Steps:
1. Create a window with `@rk_url` AND `@rk_type=iframe`.
2. Navigate with no `?view` param and no localStorage.
3. Assert the iframe renders with a CLEAN URL — `single:web` is this
   window's default (the hint), and the default mirrors with the param
   dropped, matching the retired `@rk_type` bare-URL behavior.
4. Open the palette with `View: Terminal`; assert the option is visible (web is
   current, so the palette offers the way back); Escape.

### last-view persists across a window switch away and back
What it proves: per-window value-bearing localStorage persistence (R2/R5 —
the `rk-layout:{server}:{@N}` key in the layout model) — switching windows
drops the layout param (R6 — internal nav targets the bare route) but the
last-chosen layout sticks. The A→B switch is a REAL client-side navigation
(sidebar row click), so the R6 param-drop is exercised through the router
seam (`navigateToWindow`), not a `page.goto` — guarding against a future
`retainSearchParams`/router-upgrade regression that would silently carry A's
layout onto B.
Steps:
1. Create window A (with `@rk_url`) and window B (plain).
2. On A, `switchLens("Web")` (the palette's `View: Web` action); assert the iframe.
3. Switch to B by clicking B's row button in the `Sessions` sidebar
   (`[data-window-id=<idB>]` → first `button`); assert selection settles on B
   (`aria-current="page"`), the terminal renders, and the URL mirrors
   `?layout=single:tty` (the router dropped the outgoing param — B resolves
   independently).
4. Navigate back to A WITHOUT a layout param; assert the iframe renders and the
   URL mirrors `?layout=single:web` — the persisted last-layout resolved
   (localStorage rung).

### 375px mobile: the palette is the lens switcher; no switcher chrome at any width
What it proves: since `260812-0c6o` the ViewSwitcher is retired — at 375px with
a realistically long window name the center heading keeps its room, lens
switching routes through the command palette at every width, and no switcher
chrome (`view-toggle` testid, "Window view" group) exists anywhere. The lens
itself still resolves and renders on mobile without horizontal overflow.
Steps:
1. Set the 375×812 viewport; create a window with `@rk_url` and a long
   worktree-style name.
2. Navigate to `…?view=web` and gate on the **iframe** (not the `Connected`
   dot — it lives in the sidebar footer (260724-6j1v), and at 375px the
   sidebar is an unmounted drawer, so the dot never becomes visible;
   window-heading.spec.ts's mobile test gates on the heading for the same
   reason). Assert the iframe renders.
3. Assert no in-bar switcher group ("Window view") AND no `view-toggle` testid
   anywhere in the DOM.
4. `switchLens("Terminal")` via the palette at phone width; assert the terminal
   renders and the URL mirrors a clean URL (the default drops the param).
5. Assert no horizontal page overflow (`body.scrollWidth <= 375`).
6. Resize to the desktop viewport (1440×800); assert there is STILL no in-bar
   pill and no `view-toggle` testid.
