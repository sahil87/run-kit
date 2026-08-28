# web-tile-chrome.spec.ts

Proves the web tile's browser chrome (change `260819-v6y4-web-tile-browser-chrome`,
visual source of truth `web-tile-chrome-design-study.html` in that change folder):
explicit error states replace the silent blank iframe (R8), back/forward drive the
same-origin frame history per-viewer with zero `@rk_win_url` writes (R5 + spec
window-views R7), the address bar splits display form from raw edit form (R7),
and the retired `>_` switch-to-terminal button is gone (R13).

## Shared setup

- **tmux server**: the isolated `rk-test-e2e` socket (`E2E_TMUX_SERVER`), started
  by `scripts/test-e2e.sh` on port 3020.
- **`beforeAll`**: create one dedicated session `e2e-webchrome-<ts>` (80×24), and a
  scratch present dir (`mkdtemp`) holding `page-one.html` (links to
  `page-two.html?server=<e2e-server>` — the `/present/` route reads the tmux server
  from the query, so the in-frame link must carry the plumbing param or it would
  404 against the `default` server) and `page-two.html`.
- **`afterAll`**: kill the session, remove the scratch dir.
- **`beforeEach`**: 1440×800 desktop viewport.
- **`makeWindow(name, {url?, presentRoot?})`**: `tmux new-window` + direct
  `set-option -w` stamps of `@rk_win_url` / `@rk_win_present_root` (execFileSync arg
  arrays — never a shell string). `url` is omittable so `/present/…` addresses can
  embed the resolved `@N` id before navigation.
- **`gotoWebTile(id)`**: deep-link `/<server>/<@N>?view=web` and wait for the
  `Proxied content` iframe to attach.
- **`trackOptionPosts(page)`**: records every `POST /api/windows/…/options` for
  the zero-mutation (substrate/view split) assertions.
- **`stubWindowOpen(page)`**: `addInitScript` replaces `window.open` with a
  recorder on `window.__openedUrls` (no real tabs).
- **Locators**: everything chrome-side is scoped to `surface-tile-web`; frame
  content is reached via `frameLocator('iframe[title="Proxied content"]')`.

## Tests

### (a) a frame-refused external URL renders the error state with the Open-in-browser escape hatch
What it proves: R8 — a probed-blocked external URL renders the design-study
state-05 refusal box ("{host} refuses embedding" + the reason line) instead of a
silent blank iframe, and the in-error "Open in browser ↗" button pops the current
address in a new tab without any `@rk_win_url` write.
Steps:
1. Record `/options` POSTs; stub `window.open`; `page.route` mock
   `/api/frame-check*` (trailing `*` covers the query string) to answer
   `embeddable: false` with `X-Frame-Options: DENY`; abort the external iframe
   navigation so the test is hermetic.
2. Create a window with `@rk_win_url = https://framed-refusal.example/some/page`;
   deep-link `?view=web`.
3. Assert the error box is visible with the refusal copy, and the iframe is hidden.
4. Click the error box's "Open in browser" button; assert `__openedUrls` received
   the address and zero `/options` POSTs fired.

### (b) back/forward drive the same-origin frame history per-viewer — zero option POSTs
What it proves: R5/R7 — ◀/▶ navigate the frame's own history (view state); the
address bar's display form tracks the frame's current location; neither touches
`@rk_win_url` (the R7 substrate/view split).
Steps:
1. Create a window with `@rk_win_present_root` = the scratch dir and `@rk_win_url` =
   `/present/<@N>/page-one.html?server=<e2e-server>`; deep-link `?view=web`.
2. Assert the frame shows page one and the address input's rest value is the
   display form `page-one.html`.
3. Click the in-frame link; assert page two renders and the input tracks
   `page-two.html`.
4. Click the tile's Back button; assert page one returns and the input reads
   `page-one.html`.
5. Click Forward; assert page two again. Assert zero `/options` POSTs throughout.

### (c) the address bar shows the display form at rest and the raw value on focus; Escape reverts
What it proves: R7 — at rest the bar shows the pretty form (basename, plumbing
params hidden); focusing reveals the raw editable value with select-all; Escape
reverts without a POST.
Steps:
1. Same presented rig as (b); wait for page one.
2. Assert the input value is `page-one.html`.
3. Click the input; assert the value becomes the raw
   `/present/<@N>/page-one.html?server=<e2e-server>` and the selection spans all
   of it.
4. Press Escape; assert the value is back to `page-one.html`.

### (d) no switch-to-terminal button renders in the web tile (R13)
What it proves: the `>_` affordance is gone (view switching is owned by the
top-bar surface toggles and the palette); the design-study chrome row (◀ ▶ ↻ ↗)
renders in its place.
Steps:
1. Same presented rig; deep-link `?view=web`.
2. Assert no "Switch to terminal" button exists in the web tile.
3. Assert Back, Forward, Refresh, and Open in browser buttons are visible.
