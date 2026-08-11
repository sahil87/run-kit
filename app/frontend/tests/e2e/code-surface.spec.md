# code-surface.spec.ts

Proves the right panel's phase 2 (change `260811-k3vp-right-panel-code-lens`,
`docs/specs/right-panel.md` § The code lens + § Surface Registry): the `code`
lens joins the view registry (`?view=code` in the main slot + the `View: Code`
overflow-menu row) AND the panel's CODE surface (rail button, `?panel=code`),
with availability = gitRoot derived ∧ `RK_CODE_SERVER_PORT` configured, and
code-server reachability governing only the surface CONTENT (live iframe vs
the not-running empty state). Also proves the keyboard-capture spike: a
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
  surfacing as unrelated missing-affordance assertions.
- **`beforeAll`**: create one dedicated session `e2e-codesurface-<ts>` (80×24)
  so this file never collides with other specs (`fullyParallel` off), then
  warm the dev server with a throwaway TERMINAL-route page load (this
  session's first window) — when the file runs standalone, Vite's cold
  transform of the app + xterm graph would otherwise eat the first test's 10s
  budget (beforeAll is outside it; a server-route warm-up would miss the
  xterm chunk).
- **`afterAll`**: kill the session (best-effort); the stub-listening describe
  also closes the stub.
- **`beforeEach`**: set a wide desktop viewport (1440×800) — the rail/panel are
  desktop-only.
- **`makeWindow(name, {cwd?})`**: create a window via `tmux new-window`
  (optionally with `-c /tmp` for a NON-repo cwd — the availability-negative
  case). Returns the stable `@N` id.
- **`GIT_ROOT`**: `git rev-parse --show-toplevel` from the spec process — the
  toplevel every in-repo test window derives (windows inherit the tmux
  server's repo-root cwd).
- **Locators**: the `Code panel` rail button (role + accessible name), the
  `right-panel` testid, the `Code editor` iframe title, the
  `code-surface-empty` testid, the `.xterm` terminal surface, and the
  "More controls" chevron menu (the view switcher's menuOnly rendering).

## Tests

### the code rail button + View: Code menu row appear only on a git-repo window
What it proves: availability derives from the SSE `gitRoot` field ∧ the
configured port (Constitution II/X — no client-side declaration); a non-repo
cwd (`/tmp`) derives no gitRoot, so neither affordance renders even with the
port configured.
Steps:
1. Create a repo-cwd window; navigate; assert the terminal, then the `Code
   panel` rail button (SSE-gated).
2. Open the "More controls" menu; assert the `View: Code` menuitemradio row.
3. Create a `/tmp`-cwd window; navigate; assert NO `Code panel` button and no
   `View: Code` row.

### ?panel=code opens the surface; the iframe src is /proxy/{port}/?folder=<git root>
What it proves: the P1 deep link resolves the code surface, and the renderer
iframed the fully derived RELATIVE proxy URL (never an absolute origin) with
the k3vp sandbox set (incl. `allow-downloads`); the terminal stays mounted
beside the panel (P2).
Steps:
1. Create a repo-cwd window; navigate with `?panel=code`.
2. Assert the panel and the `Code editor` iframe are visible; assert its `src`
   attribute is exactly `/proxy/{port}/?folder=<url-encoded git root>` and its
   sandbox contains `allow-downloads`.
3. Assert the terminal is still visible.

### ?view=code renders the code lens in the MAIN slot
What it proves: `code` is a full view-registry lens (window-views R4) — the
main slot renders it while the rail stays put (slots are independent, P2).
Steps:
1. Create a repo-cwd window; navigate with `?view=code`.
2. Assert the `Code editor` iframe is visible and the rail still renders.

### unavailable params fall through: ?view=code → tty and ?panel=code → closed on a /tmp window
What it proves: the resolveView/resolvePanel fall-throughs — an unavailable
`code` value renders the terminal and a closed panel, never a broken iframe.
Steps:
1. Create a `/tmp`-cwd window; navigate with `?view=code&panel=code`.
2. Assert the terminal is visible and neither the code iframe nor the panel
   exists in the DOM.

### switching surfaces hides but never unmounts the web iframe (P3 across surfaces)
What it proves: P3 generalized — with two surfaces available, switching
web → code → web keeps BOTH iframe subtrees mounted (display-level hide), and
the re-shown web iframe is the identical element (in-memory state preserved).
Steps:
1. Create a repo-cwd window and stamp `@rk_url` (both surfaces available);
   navigate; assert both rail buttons.
2. Open web; assert the `Proxied content` iframe is visible. Click the code
   rail button; assert the code iframe is visible and the web iframe is hidden
   but still in the DOM (count 1).
3. Capture the web iframe's element handle, switch back to web, and assert the
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
down, the rail button still renders (capability signals are stable) but the
panel shows the terse `code-server not running on :{port}` empty state instead
of a dead iframe.
Steps:
1. (Stub is closed — this describe never binds the port.)
2. Create a repo-cwd window; navigate with `?panel=code`; assert the `Code
   panel` rail button is visible.
3. Assert the `code-surface-empty` state reads `code-server not running on
   :{port}` (30s budget — the backend's ~5s probe TTL must expire first) and
   no `Code editor` iframe exists.
