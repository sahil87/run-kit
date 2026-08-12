# code-surface.spec.ts

Proves the code surface end to end (change `260811-k3vp-right-panel-code-lens`,
managed lifecycle + stable route `260811-a2bo`; `docs/specs/right-panel.md` §
The code lens + § Surface Registry), retargeted to the surface-layout model in
`260812-ab5v-surface-layout-core` (`docs/specs/surface-layout.md`): the `code`
lens joins the view registry (`?view=code` → `single:code` via the permanent
shim + the palette's `View: Code` action — the switcher menu rows are retired,
260812-0c6o) AND the tileable code surface
(`Code tile` rail toggle, `?panel=code` → `split-h:tty,code` via the shim),
with availability = gitRoot derived (since a2bo the port resolves by
convention — `RK_CODE_SERVER_PORT` preset, else `RK_PORT+2` — and no longer
gates), and code-server reachability governing only the surface CONTENT (live
iframe vs the not-running empty state). The iframe src is the STABLE
`/code/?folder=<git root>` route — the port never appears in a URL. Also
proves the `/code` → `/code/` redirect and the keyboard-capture spike: a
run-kit registry chord pressed inside the same-origin iframe is reclaimed by
the parent.

## Shared setup

- **tmux server**: the isolated `rk-test-e2e` socket (`E2E_TMUX_SERVER`),
  started by `scripts/test-e2e.sh` on port 3020. Never run Playwright
  directly — `just test-e2e code-surface` / `just pw test code-surface`.
- **code-server stub**: code-server is not installable in the test env, so the
  first describe binds a stub HTTP server (node `http`) on
  `RK_CODE_SERVER_PORT` (default 3939 — the same env the test-e2e script seeds
  the backend with) serving a minimal page with a focusable `#inner` button;
  the second describe runs with the stub DOWN. The backend's reachability
  probe is TTL-cached (~5s), so down-state assertions use a 30s budget. The
  port is validated against the backend's own 1-65535 range before the stub
  binds, so an out-of-range env value fails with a named error instead of
  surfacing as unrelated missing-affordance assertions. The backend resolves
  the same port server-side (the preset wins) and forwards `/code/*` to it.
- **`beforeAll`**: create one dedicated session `e2e-codesurface-<ts>` (80×24)
  so this file never collides with other specs (`fullyParallel` off), then
  warm the dev server with a throwaway TERMINAL-route page load (this
  session's first window) — when the file runs standalone, Vite's cold
  transform of the app + xterm graph would otherwise eat the first test's 10s
  budget (beforeAll is outside it; a server-route warm-up would miss the
  xterm chunk).
- **`afterAll`**: kill the session (best-effort); the stub-listening describe
  also closes the stub.
- **`beforeEach`**: set a wide desktop viewport (1440×800) — the rail is
  desktop-only.
- **`makeWindow(name, {cwd?})`**: create a window via `tmux new-window`
  (optionally with `-c /tmp` for a NON-repo cwd — the availability-negative
  case). Returns the stable `@N` id.
- **`GIT_ROOT`**: `git rev-parse --show-toplevel` from the spec process — the
  toplevel every in-repo test window derives (windows inherit the tmux
  server's repo-root cwd).
- **`expectLayoutParam(page, expected)`**: retrying read of the DECODED
  `?layout=` search param (`URL.searchParams` — the router may percent-encode
  `:`/`,`); the `replaceState` mirror lands a beat after the arrival/mutation.
- **Locators**: the `Code tile` / `Web tile` rail toggles (role + accessible
  name — the retired `Code panel` name and the `right-panel` testid are GONE;
  surfaces render as layout tiles now), the `surface-tile-code` tile testid,
  the `Code editor` iframe title, the `code-surface-empty` testid, the
  `.xterm` terminal surface, and the command palette (the only lens-switch
  surface since the ViewSwitcher's retirement, 260812-0c6o).

## Tests

### the code rail button appears only on a git-repo window; the palette's `View: Code` action gates the same way
What it proves: availability derives from the SSE `gitRoot` field alone
(Constitution II/X — no client-side declaration; the port is conventional
since a2bo); a non-repo cwd (`/tmp`) derives no gitRoot, so neither affordance
renders. The `View: Code` lens switch is palette-only (260812-0c6o) — the
chevron menu carries no `View:` rows.
Steps:
1. Create a repo-cwd window; navigate; assert the terminal, then the `Code
   tile` rail toggle (SSE-gated).
2. Open the palette with `View: Code`; assert the option is visible; Escape.
   Open the "More controls" menu; assert it carries NO `View:` rows; Escape.
3. Create a `/tmp`-cwd window; navigate; assert NO `Code tile` button and no
   `View: Code` palette option.

### ?panel=code opens the code tile (shim); the iframe src is the stable /code/?folder=<git root>
What it proves: the retired `?panel=code` deep link resolves through the
permanent shim (a bare panel value maps against the tty default slot A →
`split-h:tty,code`), and the tile's renderer iframes the fully derived
RELATIVE `/code/` URL (never an absolute origin, the port never appears —
a2bo) with the k3vp sandbox set (incl. `allow-downloads`); the terminal stays
mounted beside the tile (the layout is additive).
Steps:
1. Create a repo-cwd window; navigate with `?panel=code`.
2. Assert the `surface-tile-code` tile and the `Code editor` iframe are
   visible, the mirrored URL reads `split-h:tty,code`, the iframe `src`
   attribute is exactly `/code/?folder=<url-encoded git root>`, and its
   sandbox contains `allow-downloads`.
3. Assert the terminal is still visible.

### /code 308-redirects to /code/ (query preserved) before proxying
What it proves: the relative-base rule on the new stable route — code-server
resolves `./x` against the trailing slash, so the backend 308-redirects the
bare `/code` to `/code/` with the query preserved (a2bo R3).
Steps:
1. `GET /code?folder=/repo` through the dev proxy with `maxRedirects: 0`.
2. Assert status 308 and `Location: /code/?folder=/repo`.

### ?view=code renders the code lens as the single slot-A tile
What it proves: `code` is a full view-registry lens (window-views R4) — the
shim maps `?view=code` to `single:code`, the code tile fills the center, and
the rail stays put (tiles are additive).
Steps:
1. Create a repo-cwd window; navigate with `?view=code`.
2. Assert the `Code editor` iframe is visible, the mirrored URL reads
   `single:code`, and the rail still renders.

### unavailable params fall through: ?view=code&panel=code resolves to plain tty on a /tmp window
What it proves: the resolve/degrade fall-throughs — `?view=code&panel=code`
shims to `split-h:code,code`, which the grammar rejects (a repeated non-tty
kind), and `code` is unavailable on a `/tmp` window anyway (no gitRoot); both
paths land on `single:tty`, never a broken iframe.
Steps:
1. Create a `/tmp`-cwd window; navigate with `?view=code&panel=code`.
2. Assert the terminal is visible, neither the code iframe nor the code tile
   exists in the DOM, and the resolved layout is `single:tty` (the default — the mirror DROPS the param, leaving a clean URL).

### tiles coexist and a closed tile hides but never unmounts its iframe (P3 across surfaces)
What it proves: P3 generalized to tiles — with two surfaces available, opening
web then code renders BOTH iframes simultaneously (tiles are additive, R10
growth), and closing the web tile keeps its iframe subtree mounted
(display-level hide); the re-opened web iframe is the identical element
(in-memory state preserved).
Steps:
1. Create a repo-cwd window and stamp `@rk_url` (both surfaces available);
   navigate; assert both rail toggles.
2. Open web; assert the `Proxied content` iframe is visible. Click the code
   rail toggle; assert the code iframe is visible AND the web iframe still is.
3. Close web via its lit toggle; assert the web iframe is hidden but still in
   the DOM (count 1). Capture its element handle, reopen web, and assert the
   visible iframe is the same element.

### keyboard spike: a registry chord pressed INSIDE the iframe reaches the parent (chord reclaim)
What it proves: the intake §5 spike — a capture-phase `keydown` listener on
the same-origin iframe's `contentDocument` intercepts a run-kit registry chord
(⌘K/Ctrl+K) before the embedded app sees it and re-dispatches it to the
parent, so the command palette opens despite iframe focus.
Steps:
1. Create a repo-cwd window; navigate with `?panel=code`; assert the code
   iframe is visible (stub up).
2. Click the stub page's `#inner` button INSIDE the frame (focus is now in the
   iframe).
3. Press `Control+K`; assert the `Command palette` dialog opens.

### the surface renders the not-running empty state when the port is unreachable
What it proves: reachability governs CONTENT, not availability — with the stub
down, the rail toggle still renders (capability signals are stable) but the
code tile shows the terse portless `code-server not running — check rk doctor`
empty state (a2bo) instead of a dead iframe.
Steps:
1. (Stub is closed — this describe never binds the port.)
2. Create a repo-cwd window; navigate with `?panel=code`; assert the `Code
   tile` rail toggle is visible.
3. Assert the `code-surface-empty` state reads `code-server not running —
   check rk doctor` (30s budget — the backend's ~5s probe TTL must expire
   first) and no `Code editor` iframe exists.
