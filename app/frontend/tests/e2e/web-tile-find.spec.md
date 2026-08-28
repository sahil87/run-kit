# web-tile-find.spec.ts

Proves the web tile's keyboard reclaim + find-in-page (change
`260819-ie2i-web-tile-keyboard-find`, plan R1/R4/R5/R7): registry chords are
reclaimed from inside a same-origin web-tile frame (the `CodeSurface` seam
generalized), ⌘F opens a find bar that searches the framed page parent-side
(CSS Custom Highlight API against the frame window — no script injection),
and a cross-origin tile degrades to a disabled bar with an inline hint.

## Shared setup

- **tmux server**: the isolated `rk-test-e2e` socket (`E2E_TMUX_SERVER`), started
  by `scripts/test-e2e.sh` on port 3020.
- **`beforeAll`**: create one dedicated session `e2e-webfind-<ts>` (80×24) so
  this file never collides with other specs (Playwright `fullyParallel` is
  off); a nested `beforeAll` starts the stub HTTP server.
- **`afterAll`**: kill the session and close the stub server (best-effort).
- **Stub server**: `startStub()` binds an ephemeral port on `0.0.0.0` serving a
  fixed HTML page — a focusable `#inner` button (the click-into-frame target)
  and exactly three case-varied occurrences of `version`. The dual binding
  serves both origin cases: `http://localhost:<port>/` converts to the
  same-origin `/proxy/<port>/` path via `toProxySrc`, while
  `http://0.0.0.0:<port>/` bypasses it and stays a cross-origin absolute URL.
- **`beforeEach`**: wide desktop viewport (1440×800).
- **`makeWindow(name, url)`**: `tmux new-window` + `tmux set-option -w @rk_win_url`
  (argument-array `execFileSync`, no shell strings). Returns the `@N` id.
- **`gotoWebWindow(id)`**: deep-links `?view=web` (the shim resolves
  `single:web` — ONE tile, inside the h1 connection-pool budget) and waits for
  the `Proxied content` iframe.
- **`focusFrame(page)`**: clicks `#inner` inside the frame so keydowns go to the
  framed document.
- **`frameEvaluate(page, fn)`**: evaluates in the framed document via the iframe
  element's `contentFrame()` — the highlight-registry / style-element probes
  (same-origin only).

## Tests

### (a) a registry chord pressed INSIDE the same-origin frame is reclaimed — ⌘K opens the palette
What it proves: the web tile's attach seam reclaims registry chords from
in-frame keydowns (R1) — the command palette opens while focus is inside the
frame — and non-claimed keys pass through to the framed page untouched (R1's
passthrough half).
Steps:
1. Create a window with `@rk_win_url = http://localhost:<port>/`; open `?view=web`;
   wait for the iframe and the frame's `#inner` button.
2. Click `#inner` (focus enters the frame); press `Meta+k`; assert the palette
   input is visible; close it with Escape.
3. Click `#inner` again; press `a`; assert the palette never appeared (the
   frame swallowed the plain key, nothing in the parent reacted).

### (b) ⌘F opens the find bar; a query highlights + counts; Enter advances n/N with wrap; Escape closes
What it proves: the full find flow on same-origin content (R4/R5/R6) — the
chord reclaims from inside the frame, the counter tracks TreeWalker matches,
navigation wraps, the highlight styling lands as one inert `<style>` element
plus the frame window's Highlight registry (never a `<script>`), and Escape
closes + clears.
Steps:
1. Create a window on the same-origin stub URL; open `?view=web`; wait for the
   frame.
2. Click into the frame; press `Meta+f`; assert the find bar is visible and
   its input focused.
3. Fill `version`; assert the counter reads `1/3`.
4. Poll the framed document: `#rk-find-highlight-style` exists AND
   `CSS.highlights` holds `rk-find`/`rk-find-active`; assert the frame
   contains no `<script>`.
5. Press Enter three times: counter reads `2/3`, `3/3`, then wraps to `1/3`;
   press `Shift+Enter`: reads `3/3`.
6. Press Escape: the bar is gone and the frame's highlight style element is
   removed.

### (b′) the `Web: Find in page` palette entry opens the bar (registry id-join hint)
What it proves: the palette discovery surface (R4) — the action exists when
the layout includes an open web tile and opens the bar through the same
`web-find:open` seam as the chord.
Steps:
1. Create a window on the same-origin stub URL; open `?view=web`.
2. Press `Meta+k`; fill `Web: Find`; assert the `Web: Find in page` option is
   visible; click it.
3. Assert the find bar is visible.

### (c) a cross-origin tile renders the find bar disabled with the hint
What it proves: the cross-origin degradation (R7) — no search is attempted,
the input and navigation buttons are disabled, and the inline hint renders;
the ⌕ button is the reachable entry point.
Steps:
1. Create a window with `@rk_win_url = http://0.0.0.0:<port>/` (bypasses
   `toProxySrc` → cross-origin); open `?view=web`; wait for the iframe.
2. Click the ⌕ `Find in page` button.
3. Assert the bar is visible with the text `page is cross-origin — find
   unavailable`, the find input and Next button are disabled, and no match
   counter renders.
