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
- **`makeWindow(name, {url?, iframeType?})`**: create a window via
  `tmux new-window`, then stamp `@rk_url` and/or `@rk_type=iframe` directly with
  `tmux set-option -w` — the same window-option seam the backend tmux test uses.
  These options surface as `rkUrl`/`rkType` in the SSE snapshot, so no live HTTP
  server behind the iframe is needed (assertions are on chrome/heading/render,
  never on iframe content). Returns the stable `@N` id.
- **`gotoWindow(id, view?)`**: navigate to `/<server>/<@N>[?view=…]` and wait for
  the `Connected` SSE indicator.
- **Locators**: `Web view` / `Terminal view` chip buttons (the `ViewSwitcher`
  segments), the `Proxied content` iframe, and the `.xterm` terminal surface.

## Tests

### switcher chip appears only on a web-capable window
What it proves: availability is derived (R1) — the chip renders iff the window
offers more than `{tty}`.
Steps:
1. Create a plain window (no `@rk_url`); navigate to it.
2. Assert NO `Web view` / `Terminal view` chip, and the terminal is visible.
3. Create a window WITH `@rk_url`; navigate to it.
4. Assert both chip segments are visible.

### flipping web↔tty preserves the window and never POSTs an option mutation
What it proves: view state is client-side (R2/R7) — a flip changes the URL param
and rendered lens but issues no `@rk_type` mutation and does not destroy the
window.
Steps:
1. Create a window with `@rk_url`; register a `page.on("request")` recorder for
   any `POST /api/windows/*/options`.
2. Navigate (default view = tty for an untyped window); assert the terminal.
3. Click the `Web view` chip; assert the iframe renders and the URL carries
   `?view=web`.
4. Click the `Terminal view` chip; assert the terminal renders and the `?view`
   param is dropped.
5. Re-resolve the window by name; assert the id is unchanged AND zero
   `/options` POSTs were recorded across both flips.

### deep link ?view=web cold-loads the iframe
What it proves: a `?view=web` URL is a first-class deep link (R2).
Steps:
1. Create a window with `@rk_url`.
2. Navigate to `…?view=web`.
3. Assert the iframe renders, the `Web view` segment is `aria-pressed`, and the
   center heading shows the static `Window:` prefix (260714-uco1 — the heading
   no longer follows the lens; the switcher chip is the lens indicator).

### ?view=web on a window with no @rk_url falls back to the terminal
What it proves: an unavailable view degrades to tty, not a broken iframe
(R2/R3 — tty always reachable).
Steps:
1. Create a plain window (no `@rk_url`).
2. Navigate to `…?view=web`.
3. Assert the terminal renders, there is no iframe, and no chip (single view).

### legacy @rk_type=iframe window defaults to web with the chip present
What it proves: `@rk_type=iframe` is demoted to a default-view HINT (R5) — no
data migration, existing iframe windows keep opening in web with the tty still
one click away.
Steps:
1. Create a window with `@rk_url` AND `@rk_type=iframe`.
2. Navigate with no `?view` param and no localStorage.
3. Assert the iframe renders, both chip segments are visible, and `Web view` is
   the active (`aria-pressed`) segment.

### last-view persists across a window switch away and back
What it proves: per-window value-bearing localStorage persistence (R2/R5) —
switching windows drops the URL param (R6) but the last-chosen view sticks. The
A→B switch is a REAL client-side navigation (sidebar row click), so the R6
param-drop is exercised through the router seam (`navigateToWindow`), not a
`page.goto` — guarding against a future `retainSearchParams`/router-upgrade
regression that would silently carry `?view=web` onto B.
Steps:
1. Create window A (with `@rk_url`) and window B (plain).
2. On A, click `Web view`; assert the iframe.
3. Switch to B by clicking B's row button in the `Sessions` sidebar
   (`[data-window-id=<idB>]` → first `button`); assert selection settles on B
   (`aria-current="page"`), the terminal renders, and no `?view` param is
   present (the router dropped the outgoing param — B resolves independently).
4. Navigate back to A WITHOUT a `?view` param; assert the iframe renders and
   `Web view` is active — the persisted last-view resolved.

### 375px mobile: the switcher chip is visible and the web lens renders
What it proves: unlike its `hidden sm:*` L1 siblings, the unified `ViewSwitcher`
is visible at ALL breakpoints (chat/web are primary mobile use cases), and the
lens itself resolves and renders on mobile without horizontal overflow.
Steps:
1. Set the 375×812 viewport; create a window with `@rk_url`.
2. Navigate to `…?view=web` and gate on the **iframe** (not the `Connected`
   dot — that dot is `hidden sm:inline`, so it is `display:none` at 375px and
   never becomes visible; window-heading.spec.ts's mobile test gates on the
   heading for the same reason). Assert the iframe renders and BOTH chip
   segments are visible at 375px.
3. Assert no horizontal page overflow (`body.scrollWidth <= 375`) even with the
   chip shown.
4. Resize to desktop (1280×800); assert the chip is still visible.
