# present-auto-expand.spec.ts

Proves the present auto-expand reaction (change
`260815-wkcw-present-auto-expand-web-tile`, spec `docs/specs/surface-layout.md`
R7/L3 carve-out): a viewer MOUNTED on a window's terminal route that observes
the window's `rkUrl` TRANSITION (the `rk present` default-arm write) sees the
`web` tile open TRANSIENTLY — no `?layout=` mirror, no `rk-layout:`
localStorage write — while cold route entry never auto-opens and a dismissed
value stays dismissed until the value changes.

## Shared setup

- **tmux server**: the isolated `rk-test-e2e` socket (`E2E_TMUX_SERVER`),
  started by `scripts/test-e2e.sh` on port 3020.
- **`beforeAll`**: create one dedicated session `e2e-present-<ts>` (80×24) so
  this file never collides with other specs (Playwright `fullyParallel` is off).
- **`afterAll`**: kill the session (best-effort) to keep the shared server clean.
- **`beforeEach`**: set a wide desktop viewport (1440×800) — the `Connected`
  readiness dot is read from the status bar (`getByTestId("status-bar")`); the
  sidebar footer's own dot is mobile-only since 260815-19me.
- **`setWindowUrl(id, url | null)`**: stamp or clear `@rk_url` via
  `tmux set-option -w` — exactly the write path `rk present`'s default arm
  takes. The write is invisible to the control-mode parser, so every
  post-write assertion budgets `PRESENT_TIMEOUT` (30s) to clear the 12s SSE
  safety ticker on a quiet server.
- **`makeWindow(name)`**: create a window with `cwd: "/tmp"` (NON-repo → code
  unavailable → a deterministic `single:tty` start); returns the `@N` id.
- **`awaitSnapshotReady(page, id)`**: wait for the tty tile's
  `role="application"` aria-label to carry the SSE-derived session name — that
  proves the terminal route's `currentWindow` resolved, so the auto-expand
  effect has initialized before the test writes `@rk_url` (the write is always
  an OBSERVED transition, never a cold first read). The sidebar row is NOT
  sufficient — it renders from an earlier, shallower payload than the route's
  window record.
- **Locators**: the `Proxied content` iframe (the web tile), the `.xterm`
  terminal surface, and the top-bar SurfaceToggleGroup's `Web tile` open-tile
  toggle — its PRESENCE tracks `rkUrl` availability (proof the SSE snapshot
  carrying the value landed on the client), its `aria-pressed` tracks the open
  tile.
- **Connection-pool budget**: every flow peaks at 2 tiles (tty + web).

## Tests

### rkUrl set while viewing auto-opens the web tile with no URL/localStorage write

What it proves: the transition-observed trigger (R1) and the transient
render-time composition (R2) — the web tile appears beside the terminal while
the resolved layout, the URL, and localStorage all stay `single:tty`-clean.

1. Create a window, navigate to its route, assert the terminal renders and the
   URL carries no `?layout=`; wait for the snapshot-readiness gate.
2. `tmux set-option -w @rk_url <URL_A>` (the present-default-arm write).
3. Assert the web iframe becomes visible beside the still-visible terminal.
4. Assert the URL still carries no `?layout=` and localStorage has no
   `rk-layout:` key; assert the top-bar `Web tile` toggle is pressed.

### closing the auto-opened tile latches the value; a different value re-triggers

What it proves: the dismissal latch (R3) — closing the auto-opened tile
suppresses re-opening for THAT EXACT `rkUrl` value (unset + re-set), while a
different value (a re-present's fresh timestamp) re-triggers.

1. Create a window, navigate, wait for the snapshot-readiness gate, set
   `@rk_url` to URL_A; assert the iframe opens.
2. Close the web tile via its ✕ (`Close Web`); assert the iframe is HIDDEN
   (the tile stays mounted-but-hidden via SurfaceLayout's everOpened set).
3. Unset `@rk_url`; assert the top-bar `Web tile` toggle disappears (client
   observed the clear).
4. Re-set the SAME URL_A; assert the toggle reappears UNPRESSED and the iframe
   stays HIDDEN (the empty→URL_A transition matched the latch).
5. Set a DIFFERENT URL_B; assert the iframe re-opens (latch pass-through).

### cold arrival with rkUrl already set never auto-opens

What it proves: cold route entry is ladder-only (R1) — a reload/deep link onto
a window whose `@rk_url` is already set renders `single:tty`, not the web tile.

1. Create a window and stamp `@rk_url` BEFORE navigating.
2. Navigate to its route; assert the terminal renders.
3. Assert the top-bar `Web tile` toggle is visible (the snapshot carrying
   `rkUrl` landed) but UNPRESSED, the iframe is absent, and the URL carries no
   `?layout=`.
