# surface-layout.spec.ts

Proves the terminal route's center is a **layout of surfaces** (change
`260812-ab5v-surface-layout-core`, `docs/specs/surface-layout.md` L1–L4, R5,
R7, R10, R13): the permanent `?view=`/`?panel=` translation shim, the
URL > localStorage > hint > `single:tty` resolution ladder with `replaceState`
mirroring, rail open-tile toggles + tile verbs as the only mouse path to a
3-tile layout, history semantics (layout tweaks replace, window switches
push), divider-ratio persistence keyed per (window, shape), and the mobile
slot-A + sheet-tabs branch. From `260812-wfic`: the focused-tile accent border
(click-to-focus across tiles) and the tty-scoped split-chord gate (the chord
is inert while the code tile owns focus, splits while the tty tile does).

**Perf budget (binding)**: the plaintext e2e origin is HTTP/1.1 with a 6-slot
connection pool (spec § Performance note; the board-route postmortem class).
Only ONE test mounts 3 tiles (the verbs test); every other flow stays at ≤2
tiles.

## Shared setup

- **tmux server**: the isolated `rk-test-e2e` socket (`E2E_TMUX_SERVER`),
  started by `scripts/test-e2e.sh` on port 3020. Never run Playwright
  directly — `just test-e2e "surface-layout"`.
- **`beforeAll`**: create one dedicated session `e2e-surflayout-<ts>` (80×24)
  so this file never collides with other specs (`fullyParallel` off), then
  warm the dev server with a throwaway TERMINAL-route page load — when the
  file runs standalone, Vite's cold transform of the app + xterm graph would
  otherwise eat the first test's 10s budget (the code-surface precedent;
  beforeAll is outside the per-test budget).
- **`afterAll`**: kill the session (best-effort) to keep the shared server clean.
- **`beforeEach`**: set a wide desktop viewport (1440×800) — multi-tile is
  desktop-only (R13); the mobile test overrides to 375×812.
- **`makeWindow(name, {url?})`**: create a window via `tmux new-window`, then
  stamp `@rk_url` with `tmux set-option -w` (`execFileSync` argument arrays —
  no shell strings). Windows inherit the tmux server's repo-root cwd, so every
  window is code-capable (gitRoot derived); `@rk_url` adds web availability.
  Returns the stable `@N` id.
- **`paneCount(id)`**: `tmux display-message -t <id> -p '#{window_panes}'` —
  the split-chord gate's ground truth (a real backend split, not a DOM read).
- **`gotoWindow(id, search?)`**: navigate to `/<server>/<@N>[?<search>]` and
  wait for the `Connected` SSE indicator (desktop-only — the dot lives in the
  sidebar footer; the mobile test gates on the terminal instead).
- **`expectLayoutParam(page, expected)`**: retrying read of the DECODED
  `?layout=` search param (`URL.searchParams` — the router may percent-encode
  `:`/`,`); the `replaceState` mirror lands a beat after the mutation/arrival
  that triggered it.
- **Locators**: the `right-panel-rail` testid with its `<Surface> tile` toggle
  buttons (`aria-pressed` lit per open tile); tiles `surface-tile-<kind>`;
  dividers `surface-divider-<i>` (`role="separator"`, `aria-valuenow` = rounded
  pct); the `.xterm` terminal surface; the `Proxied content` web iframe; the
  mobile `mobile-surfaces-chip` / `mobile-surface-sheet` / `mobile-surface-tab-<kind>`
  testids. Tile verb buttons (`Zoom/Promote/Swap/Close <Surface>`) are boxed
  and visible at rest since 260812-wfic (R4) — tests still `.hover()` the tile
  before clicking to exercise the hover affordance.
- **Focus clicks**: the focused-tile seam is pointerdown-capture anywhere in
  the tile, so tests click the tile HEADER at `position: {x: 6, y: 15}` (the
  30px header's padding — never a verb button).

## Tests

### legacy ?view=code&panel=web deep link resolves to split-h:code,web (shim, A-016)
What it proves: the permanent translation shim (R2/L1) — a legacy deep link
maps to `split-h:code,web` (view in slot A), the URL is rewritten via
`replaceState` to the mirrored `?layout=` form with the legacy params gone,
and both tiles render (code iframe + proxied web iframe), never a broken tile.
Steps:
1. Create a web-capable window (`@rk_url`; repo cwd ⇒ code-capable).
2. Navigate with `?view=code&panel=web`.
3. Assert the `layout` param reads `split-h:code,web` and `view` is absent.
4. Assert the `surface-tile-code` and `surface-tile-web` tiles are visible and
   the `Proxied content` iframe renders.

### build a 3-tile layout via rail toggles; promote/swap/close verbs mutate (shape, order) in the URL (A-017)
What it proves: R7 + R10 — the rail's open-tile toggles grow the layout
(1→2 `split-h`, 2→3 `main-left`) and every tile verb mutates (shape, order)
exactly as specified, each outcome persisted + mirrored into the URL (R3 write
discipline). This is the file's ONE bounded 3-tile test.
Steps:
1. Create a web-capable window; navigate; assert the terminal.
2. Click the `Web tile` rail button; assert `?layout=split-h:tty,web`, the web
   tile visible, and the button lit (`aria-pressed`).
3. Click the `Code tile` rail button; assert `?layout=main-left:tty,web,code`
   and the code tile visible.
4. Hover the code tile, click `Promote Code`; assert
   `?layout=main-left:code,tty,web` (slot A permuted, shape unchanged).
5. Hover the tty tile, click `Swap Terminal`; assert
   `?layout=main-left:code,web,tty` (swapped with the next neighbor).
6. Hover the web tile, click `Close Web`; assert `?layout=split-h:code,tty`,
   the web tile hidden, the code tile and terminal still visible, and the web
   rail button unlit.

### a user-built layout restores from localStorage on a bare re-arrival (ladder rung 2)
What it proves: R3 — a rail toggle writes the value-bearing
`rk-layout:{server}:{@N}` key, and a FULL load of the bare route (no carried
`?layout=`, so the URL rung is empty) resolves the stored layout and mirrors
it back into the URL.
Steps:
1. Create a web-capable window; navigate; open the web tile via the rail.
2. Assert `?layout=split-h:tty,web` and the web tile visible.
3. `page.goto` the BARE window route (a real reload, no search string).
4. Assert the web tile and terminal render again and the URL mirrors
   `split-h:tty,web`.

### window switch A→B→A restores each window's own layout (A-012)
What it proves: R3/L4 — internal navigation (sidebar) targets the bare route,
so each window resolves its own layout: B (never customized) falls to
`single:tty` (the default — mirrored as a CLEAN URL, param dropped), A
restores its stored `split-h:tty,web` (mirrored into the URL). The A→B hop is a REAL client-side navigation (sidebar row click),
not a `page.goto`.
Steps:
1. Create window A (web-capable) and window B (plain).
2. On A, open the web tile via the rail; assert `?layout=split-h:tty,web`.
3. Click B's row in the `Sessions` sidebar; assert selection settles on B
   (`aria-current="page"`), no web tile exists, and the URL is clean (the
   default drops the param).
4. Click A's row; assert the web tile renders again and the URL mirrors
   `split-h:tty,web`.

### back/forward restore historical layouts; layout tweaks add NO history entries (L4)
What it proves: L4 — layout mutations use `replaceState` (no history entry
per tweak) while window switches push; back/forward therefore restore the
arrangement each history entry carried (rung 1 honors the entry's URL), and
backing past the window lands on the pre-window route with no stale
pre-mutation entry in between.
Steps:
1. Create windows A (web-capable) and B (plain).
2. Navigate to the server route (history entry E0), then to A (E1).
3. Open the web tile on A via the rail (replaceState — E1 updated in place);
   assert `?layout=split-h:tty,web`.
4. Sidebar-click B (push E2); assert B resolves `single:tty` (bare URL — the default drops the param).
5. `goBack` → A renders `split-h:tty,web` again (the layout E1 carried).
6. `goForward` → B's default (bare URL) restores.
7. `goBack` twice → the SECOND back lands on the bare server route
   (`/<server>`, E0) — a pushed layout entry would have stranded a stale A URL
   in between.

### a divider drag persists the ratio across reload and never touches the URL (R5)
What it proves: divider drags mutate RATIOS only — clamped, persisted per
(window, shape) on release, and never encoded in the URL; tiles stay mounted
and live mid-drag (the board pane-resize bug class: no suspension/unmount).
Steps:
1. Create a web-capable window; navigate; open the web tile via the rail.
2. Assert the `surface-divider-0` separator reads `aria-valuenow=50` (equal
   split) and capture the xterm element handle.
3. Drag the divider 150px right (mouse down/move/up in steps).
4. Assert `aria-valuenow` grew past 50, the terminal is the SAME element
   (still mounted, still visible), and the URL layout string is unchanged.
5. Re-arrive via a full load of the bare route; assert the web tile renders
   and the divider reads exactly the dragged value (ratio persisted per
   window+shape).

### 375px mobile: a 3-tile ?layout= URL renders slot A + sheet tabs for the rest (R13, A-018)
What it proves: below `isMobileViewport()` the layout manager renders only
slot A — no grid, no dividers, no rail — and the remaining resolved surfaces
are reachable as sheet tabs whose selection is TRANSIENT (the URL/desktop
arrangement never changes).
Steps:
1. Set the 375×812 viewport; create a web-capable window.
2. Navigate to `?layout=main-left:tty,code,web`, gating on the terminal (not
   the `Connected` dot — the sidebar is an unmounted drawer at 375px).
3. Assert the tty tile is visible, the code/web tiles are mounted-hidden, no
   divider exists, no rail renders, and the `mobile-surfaces-chip` appears
   (>1 open surface).
4. Click the chip; assert the `mobile-surface-sheet` dialog opens with
   Terminal/Code/Web tabs, Terminal marked `aria-pressed`.
5. Click the Code tab; assert the sheet closes, the code tile becomes visible
   (tty hidden), and the URL still reads `?layout=main-left:tty,code,web`.

### the focused-tile accent border follows clicks across tiles (260812-wfic R2, A-013)
What it proves: the focused-tile state — the framed tile border turns
`border-accent-green` on the tile that last received pointer interaction
(the tmux active-pane metaphor), defaults to slot A, and moves with each
click. Steps:
1. Create a web-capable window; navigate; open the web tile via the rail.
2. Assert the tty tile (slot A) carries `border-accent-green` and the web
   tile the default `border-border`.
3. Click the web tile's header (`{x: 6, y: 15}`); assert the accent border
   moved to the web tile and left the tty tile.
4. Click the tty tile's header; assert the border returned.

### the split chord is tty-scoped: inert with the code tile focused, splits with tty focused (260812-wfic R8, A-014)
What it proves: the `ttyOnly` dispatcher gate — a `ttyOnly` binding's handler
is absent unless the tty tile owns focus, so the split chord (⇧Ctrl+\ on this
Linux host) falls through untouched (no `preventDefault`, no split POST) while
the code tile is focused, and splits exactly as before while the tty tile is
focused (the tty-focused path is byte-equivalent to the pre-gate behavior,
A-012). Ground truth is the live tmux pane count, not the DOM. Steps:
1. Create a plain (code-capable) window; navigate; assert the terminal.
2. Open the code tile via the rail; assert the tile renders. Pane count = 1.
3. Click the code tile's header; assert its `border-accent-green` (the gate's
   input is visibly engaged).
4. Press `Shift+Control+Backslash`; wait a beat; assert the pane count is
   UNCHANGED (the chord fell through — code-server would own it on a real
   reachable code-server).
5. Click the tty tile's header; assert its `border-accent-green`.
6. Press `Shift+Control+Backslash` again; assert the pane count grows to 2
   (retrying — the split POST + tmux mutation land asynchronously).
