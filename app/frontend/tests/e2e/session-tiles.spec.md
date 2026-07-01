# session-tiles.spec.ts

End-to-end coverage for the session/window tile-grid density view rendered by
the `/$server` index route (`serverIndexRoute`). Verifies the full path:
session tiles render, expanding a session reveals per-window tiles, each window
tile shows a static `tmux capture-pane` TEXT preview delivered over the SSE
`event: preview` (never a live xterm relay per tile), and clicking a window tile
upgrades to the real live terminal by navigating to `/$server/$window`.

## Shared setup

- Spawns one named tmux session on the e2e tmux server (`rk-test-e2e` by
  default, overridable via `E2E_TMUX_SERVER`): `e2e-tiles-{ts}`.
- Sends `echo TILE_PREVIEW_MARKER` into the session's pane so the capture-pane
  preview has recognizable content to assert on.
- `afterAll` kills the session to leave the server clean for the next run.

## Tests

### landing on /$server shows session tiles that expand into window tiles with previews, and clicking a window tile opens the live terminal

**What it proves**: The empty `/$server` index route now renders the density
view; a session tile expands into window tiles; each window tile shows the pane
text snapshot (not an xterm); and clicking a window tile navigates to the live
terminal route. This is the core user-visible behavior of the change, exercising
the preview-scope → SSE `event: preview` → static-text-render → click-to-live
path end to end.

**Steps**:

1. Navigate to `/{TMUX_SERVER}` and wait for the "Connected" indicator.
2. Assert the session tile `session-tile-{TEST_SESSION}` is visible on the index
   route (the tiles view mounted in place of the old empty hint).
3. Resolve the seeded session's first window id (`@N`) and index from the
   `/api/sessions` snapshot (polled — the CLI-created session surfaces
   asynchronously).
4. Assert the window tile `window-tile-{TEST_SESSION}-{index}` has count 0 while
   the session is collapsed (window tiles are gated behind expansion).
5. Click the tile's `Expand {TEST_SESSION}` button; assert the window tile
   becomes visible.
6. Assert the preview element `window-tile-preview-{windowId}` is visible and
   contains `TILE_PREVIEW_MARKER` (the captured pane text arrives over the SSE
   `event: preview` once the expanded scope is declared). Assert `.xterm` has
   count 0 — the tiles view mounts no live terminal.
7. Click the window tile; assert the URL becomes
   `/{TMUX_SERVER}/{encoded @N}` — the tile upgraded to the live terminal route.
