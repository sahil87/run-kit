# terminal-tile-find.spec.ts

Proves find-in-terminal on the tty tile (change `260819-zqf9-terminal-tile-find`,
plan R3/R4/R5/R6/R8): the chord, the ⌕ header button, and the palette action
all open the shared `FindBar` over the primary tty tile; `@xterm/addon-search`
searches the live xterm client buffer with decorations (buffer highlights +
overview-ruler ticks); Enter/⇧Enter navigate with wrap; Escape closes and
clears; the terminal-native Aa/`.*` toggles and the muted buffer-scope hint
behave per contract.

## Shared setup

- **tmux server**: the isolated `rk-test-e2e` socket (`E2E_TMUX_SERVER`),
  started by `scripts/test-e2e.sh` on port 3020.
- **`beforeAll`**: create one dedicated session `e2e-ttyfind-<ts>` (80×24)
  whose single window runs `printf` of exactly three `FAIL` lines followed by
  `sleep 300` — a fixed, countable client-buffer payload.
- **`afterAll`**: kill the session (best-effort).
- **`beforeEach`**: wide desktop viewport (1440×800).
- **`gotoTtyWindow(id)`**: deep-links the window's terminal route (default
  `single:tty` — ONE tile) and waits for the `.xterm-screen` element.
- **`awaitPaneOutput(id)`**: polls the registered terminal's
  (`window.__rkTerminals`) active buffer until all three `FAIL` lines have
  streamed in — no fixed sleeps.
- **`focusTerminal(page)`**: clicks the xterm area and focuses the helper
  textarea so keydowns arrive through the genuine input path.

## Tests

### (a) the chord opens the bar over real pane output; query counts + decorates; Enter navigates with wrap; Escape clears
What it proves: the full find flow on a tty tile (R3/R5/R6/R8) — the
shifted-tier chord the Linux rig resolves (⇧Ctrl+F; ⌘F on mac) opens the bar
under terminal focus via the terminal seam's refusal rule, the counter tracks
the addon's `onDidChangeResults`, navigation wraps, decorations render (and
the overview ruler exists at all — the constructor `overviewRuler` option),
the buffer-scope note appears once a search has run, and Escape closes the
bar, clears every decoration, and returns focus to the pane.
Steps:
1. Resolve the window, open its terminal route, wait for the pane payload.
2. Focus the terminal; press `Shift+Control+f`; assert the find bar is
   visible, its input focused, and the ⌕ button `aria-pressed="true"`.
3. Fill `FAIL`; assert the counter reads `1/3`.
4. Assert find decorations exist in the DOM decoration layer (a count poll —
    the elements size with the render loop) and the
   `.xterm-decoration-overview-ruler` element renders.
5. Assert the `Search scope` note reads `… since attach`.
6. Press Enter three times: counter reads `2/3`, `3/3`, then wraps to `1/3`;
   press `Shift+Enter`: reads `3/3`.
7. Press Escape: the bar is gone, no find decorations remain, and the xterm
   helper textarea holds focus again.

### (b) the ⌕ header button toggles the bar with the pressed/active state
What it proves: the pointer entry point (R4) — the header button opens and
closes the bar and carries the active vocabulary (`aria-pressed` +
accent-green) while open.
Steps:
1. Open the terminal route; wait for the pane payload.
2. Assert the ⌕ button starts `aria-pressed="false"`; click it; assert the
   bar is visible, the button is `aria-pressed="true"` and accent-green.
3. Click again; assert the bar is gone and the button is unpressed.

### (c) the `Terminal: Find` palette entry opens the bar (registry id-join hint)
What it proves: the palette discovery surface (R6) — the action exists while
the rendered layout includes a tty tile and opens the bar through the same
`terminal-find:open` seam as the chord.
Steps:
1. Open the terminal route; wait for the pane payload.
2. Press `Meta+k`; fill `Terminal: Find`; assert the `Terminal: Find` option
   is visible; click it.
3. Assert the find bar is visible.

### (d) zero-match reads 0/0; an invalid regex does not throw and the bar recovers
What it proves: the edge contracts (R3, plan A-013) — a no-match query floors
the counter at `0/0` with navigation a no-op, and a malformed pattern under
the `.*` regex toggle is caught (addon throw → `false`) without breaking the
bar, which then recovers on a plain query.
Steps:
1. Open the terminal route; open the bar via the ⌕ button.
2. Fill `ZZZZZ`; assert `0/0`; press Enter; assert still `0/0`.
3. Click the `Match regex` toggle; fill `([`; assert the bar stays visible
   and the counter reads `0/0`.
4. Toggle regex off; fill `FAIL`; assert the counter reads `1/3`.
