# web-view-lens.spec.ts

Proves the iframe feature is a per-viewer **web lens** over the window
(change `260714-t97o-web-view-lens`, `docs/specs/window-views.md` R1–R7):
view choice is client-side (URL param + localStorage), the tty is always
reachable, and switching lenses NEVER mutates `@rk_win_lens` (no window-option
POST). Since `260821-zqlq-web-tile-always-tileable-onboarding` the web lens is
**always tileable** (availability no longer derives from `@rk_win_url` — the
code-surface availability-vs-content split): an empty/whitespace `@rk_win_url`
selects the tile's **onboarding content state** (reduced live URL bar + the
three fill-path instructions) in place of the iframe, and the existing rkUrl
sync seam flips onboarding ↔ live with no user action. Since
`260812-ab5v-surface-layout-core`
the lens IS a single-tile surface layout: `?view=X` deep links resolve through
the permanent translation shim (`single:X`), the palette's `View: …` actions
set `single:<view>` through the shared mutation path (R12), and the URL mirror
rewrites everything to `?layout=` — so URL assertions key off the decoded
`layout` param, never `view`. Since `260812-0c6o` the ViewSwitcher is RETIRED:
the command palette is the ONLY lens-switch surface (plus the top-bar
surface-toggles group) — the chevron menu carries no `View:` rows and the
`view-toggle` testid exists nowhere. On MOBILE the `View:` palette entries are
superseded by `Tile: Switch to <Surface>` (the top-bar switch group's twin —
the group renders pinned in-bar with radio semantics at ≥2 shown surfaces);
desktop keeps `View:` and sees no `Tile: Switch` entries.

## Shared setup

- **`beforeEach`**: `stubProxyPorts(page, …)` (`_web-tile.ts`) route-stubs `/proxy/8080/**` with a static 200 page — the dead-port error state (260819-v6y4 R8) hides the iframe when nothing listens on the stamped `http://localhost:8080/` URL, and these tests assert tile chrome, never frame content.

- **tmux server**: the isolated `rk-test-e2e` socket (`E2E_TMUX_SERVER`), started
  by `scripts/test-e2e.sh` on port 3020.
- **`beforeAll`**: create one dedicated session `e2e-webview-<ts>` (80×24) so this
  file never collides with other specs (Playwright `fullyParallel` is off).
- **`afterAll`**: kill the session (best-effort) to keep the shared server clean.
- **`beforeEach`**: set a wide desktop viewport (1440×800); the mobile test
  overrides to 375px.
- **`makeWindow(name, {url?, iframeType?, cwd?})`**: create a window via
  `tmux new-window`, then stamp `@rk_win_url` and/or `@rk_win_lens=iframe` directly with
  `tmux set-option -w` — the same window-option seam the backend tmux test uses.
  `cwd: "/tmp"` makes the window NON-repo (no gitRoot → code unavailable) — the
  deterministic single-view case. The stamped options surface as
  `rkUrl`/`rkType` in the SSE snapshot, so no live HTTP server behind the
  iframe is needed (assertions are on chrome/heading/render, never on iframe
  content). Returns the stable `@N` id.
- **`gotoWindow(id, view?)`**: navigate to `/<server>/<@N>[?view=…]` and wait for
  the `Connected` SSE indicator (the status bar's `Connected` dot — the desktop sidebar footer is gone).
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

### lens switching is palette-only — web is always offered, the menu carries no `View:` rows (260812-0c6o, 260821-zqlq)
What it proves: web availability is unconditional (260821-zqlq — the palette's
`View: Web` action renders even on a window with NO `@rk_win_url`; it opens the
onboarding tile) — and the retirement contract (260812-0c6o): there is no
in-bar pill, no `view-toggle` testid anywhere in the DOM (bar or probe), and
no `View:` rows in the chevron menu. The plain window uses a NON-repo cwd
(`/tmp`) so `code` is unavailable too — a repo-cwd window is code-capable
since k3vp, and relying on the gitRoot probe's timing would be a race.
Steps:
1. Create a plain window (no `@rk_win_url`, `/tmp` cwd); navigate to it; assert the
   terminal.
2. Open the palette with `View: Web`; assert the `View: Web` option IS visible
   (web is always offered — 260821-zqlq); Escape.
3. Create a window WITH `@rk_win_url`; navigate to it.
4. Assert no in-bar "Window view" group and no `view-toggle` testid; open the
   palette and assert the `View: Web` option is visible; Escape.
5. Open the "More controls" menu; assert it carries NO `View:` rows; Escape.

### flipping web↔tty preserves the window and never POSTs an option mutation
What it proves: view state is client-side (R2/R7) — a flip changes the layout
(`View: Web` ⇒ `single:web`, R12's shim) and rendered lens but issues no
`@rk_win_lens` mutation and does not destroy the window.
Steps:
1. Create a window with `@rk_win_url`; register a `page.on("request")` recorder for
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
1. Create a window with `@rk_win_url`.
2. Navigate to `…?view=web`.
3. Assert the iframe renders, the mirrored URL reads `?layout=single:web`, and
   the center heading shows the static `Tab:` prefix (260714-uco1 — the
   heading does not follow the lens).

### ?view=web on a window with no @rk_win_url resolves to the onboarding web tile (260821-zqlq)
What it proves: web is always tileable — the deep link keeps its tile instead
of degrading to tty, and with no `@rk_win_url` the tile renders the ONBOARDING
content state in place of the iframe (the availability-vs-content split; the
window uses a NON-repo cwd so `code` stays out of the layout).
Steps:
1. Create a plain window (no `@rk_win_url`, `/tmp` cwd).
2. Navigate to `…?view=web`.
3. Assert the `web-tile-onboarding` panel renders, there is no iframe and no
   terminal tile, and the URL mirrors `?layout=single:web` (the deep link
   keeps its tile).
4. Open the palette with `View: Terminal`; assert the option is visible (web
   is current, so the palette offers the way back); Escape.

### ⌘3 on a URL-less window opens the web tile's onboarding state (260821-zqlq)
What it proves: the web-toggle chord is availability-driven, so it now mounts
on every desktop window route — on a URL-less window ⇧Ctrl+3 (the non-mac
default; mac is ⌘3) opens the web tile beside the terminal, and the tile
renders onboarding with the REDUCED URL bar (refresh + the fully-live address
input; back/forward, find ⌕, and ↗ hidden until content exists).
Steps:
1. Create a plain window (no `@rk_win_url`, `/tmp` cwd); navigate; assert the
   terminal.
2. Press `Shift+Control+Digit3`.
3. Assert `web-tile-onboarding` renders with the "Nothing to show yet" heading
   and the `rk present ./report.html` instruction row; no iframe.
4. Assert the address input is visible with the
   `localhost:3000 · /present/… · https://…` placeholder, Refresh renders, and
   Back/Forward/Find in page/Open in browser render nowhere.
5. Assert the URL mirrors `?layout=split-h:tty,web` (the chord added the tile
   — 1→2 growth).

### the onboarding address bar boots the tile for real (Enter → @rk_win_url POST)
What it proves: the onboarding address input is fully live — Enter runs the
existing submit pipeline (`normalizeAddressInput` → `isAllowedUrl` →
`updateWindowUrl` → `POST /options` on `@rk_win_url`), SSE delivers the new value,
and the tile flips onboarding → live iframe with no further action.
Steps:
1. Create a plain window (no `@rk_win_url`, `/tmp` cwd); navigate to `…?view=web`;
   assert `web-tile-onboarding`.
2. Fill the `URL` input with `localhost:8080`; press Enter.
3. Assert the iframe renders (the stubbed `/proxy/8080/` page), the onboarding
   panel is gone, and the URL still mirrors `?layout=single:web`.

### tmux set-option @rk_win_url flips the open onboarding tile live; unsetting returns to onboarding
What it proves: the live flip rides the existing rkUrl sync seam — an
agent-side `rk present` (here: an external `tmux set-option -w @rk_win_url`)
transitions the open tile onboarding → iframe in place, and clearing the
option returns it to onboarding.
Steps:
1. Create a plain window (no `@rk_win_url`, `/tmp` cwd); navigate to `…?view=web`;
   assert `web-tile-onboarding`.
2. `tmux set-option -w -t <id> @rk_win_url "http://localhost:8080/"`; assert the
   iframe renders and onboarding is gone.
3. `tmux set-option -w -u -t <id> @rk_win_url`; assert onboarding returns and the
   iframe is gone.

### legacy @rk_win_lens=iframe window defaults to web (ladder hint rung)
What it proves: `@rk_win_lens=iframe` is demoted to a default-view HINT (R5 —
ladder rung 3) — no data migration, existing iframe windows keep opening in
web (`single:web`) with the tty one palette action away.
Steps:
1. Create a window with `@rk_win_url` AND `@rk_win_lens=iframe`.
2. Navigate with no `?view` param and no localStorage.
3. Assert the iframe renders with a CLEAN URL — `single:web` is this
   window's default (the hint), and the default mirrors with the param
   dropped, matching the retired `@rk_win_lens` bare-URL behavior.
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
1. Create window A (with `@rk_win_url`) and window B (plain).
2. On A, `switchLens("Web")` (the palette's `View: Web` action); assert the iframe.
3. Switch to B by clicking B's row button in the `Sessions` sidebar
   (`[data-window-id=<idB>]` → first `button`); assert selection settles on B
   (`aria-current="page"`), the terminal renders, and the URL mirrors
   `?layout=single:tty` (the router dropped the outgoing param — B resolves
   independently).
4. Navigate back to A WITHOUT a layout param; assert the iframe renders and the
   URL mirrors `?layout=single:web` — the persisted last-layout resolved
   (localStorage rung).

### 375px mobile: the switch group + `Tile: Switch` palette entries are the lens switchers; no switcher chrome at any width
What it proves: at 375px with a realistically long window name the center
heading keeps its room WITH the pinned switch group present (the retained
single-line / no-horizontal-overflow contract), the mobile palette supersedes
the `View:` lens entries with `Tile: Switch to <Surface>`, the top-bar Web
button performs the one-tap tty→web switch through the PERSISTING arm
(`single:web` mirrored into the URL), and no switcher chrome (`view-toggle`
testid, "Window view" group) exists anywhere. The lens itself still resolves
and renders on mobile.
Steps:
1. Set the 375×812 viewport; create a window with `@rk_win_url` and a long
   worktree-style name.
2. Navigate to `…?view=web` and gate on the **iframe** (not the `Connected`
   dot — it lives in the desktop status bar now (the sidebar footer is
   mobile-only), and at 375px the status bar never renders, so the dot never
   becomes visible;
   window-heading.spec.ts's mobile test gates on the heading for the same
   reason). Assert the iframe renders.
3. Assert no in-bar switcher group ("Window view") AND no `view-toggle` testid
   anywhere in the DOM.
4. Assert the banner's `Web tile` button reads `aria-pressed=true` and
   `Terminal tile` reads `false` (radio semantics — the visible tile pressed).
5. Open the palette with `View: Web`; assert NO `View: Web` option (mobile
   supersession). Refill with `Switch`; click `Tile: Switch to Terminal`;
   assert the terminal renders and the URL mirrors a clean URL (the default
   drops the param — the persisting arm, tty not previously open).
6. Click the banner's `Web tile` button; assert the iframe renders and the URL
   mirrors `?layout=single:web` — the one-tap tty→web phone flow persists.
7. Assert no horizontal page overflow (`body.scrollWidth <= 375`).
8. Resize to the desktop viewport (1440×800); assert there is STILL no in-bar
   pill and no `view-toggle` testid; open the palette with `View: Terminal`,
   assert the option renders; refill with `Switch` and assert NO
   `Tile: Switch to …` options (desktop keeps `View:`).
