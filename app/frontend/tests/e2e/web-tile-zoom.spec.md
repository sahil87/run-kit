# web-tile-zoom.spec.ts

Content zoom on the web tile (260823-cwvv R2–R5): the URL-bar zoom control, per-bucket localStorage persistence, palette parity, onboarding absence, and the same-origin ctrl-wheel gesture trigger.

## Shared setup

- Own tmux session (`e2e-webzoom-<ts>`); desktop viewport 1440×800.
- A stub HTTP server on an ephemeral port serves a static page; windows get `@rk_url = http://localhost:<port>/` stamped directly via tmux, so the tile rides the same-origin `/proxy/<port>/` path.
- Each test starts from a fresh browser context, so `runkit-web-zoom` begins empty without any `addInitScript` (deliberate — an init script would also wipe the key on the persistence test's re-navigation).
- Navigation goes straight to the web lens (`?view=web` → single:web) and waits for the iframe + zoom control.

## Tests

### (a) the control steps the frame 100 → 110 → 125, − steps down, reset returns to 100%

**Proves**: the browser-chrome zoom control steps the discrete ladder and the scale wrapper actually transforms the iframe (R2/R4).

1. Open a proxied web tile; assert the readout is `100%`.
2. Click `Zoom in` twice; assert the readout steps `110%` → `125%` and the iframe's CSS transform is a 1.25 scale matrix.
3. Click `Zoom out` once; assert `110%`.
4. Click the readout (the reset affordance); assert `100%` and the wrapper's `data-zoom` is back at `1`.

### (b) the zoom level persists across reload, per bucket

**Proves**: per-viewer localStorage persistence keyed by proxy port — a fresh visit restores the tile's level (R3).

1. Open a proxied web tile and zoom to `125%`.
2. Re-navigate to the same window's web lens (a fresh mount re-reads the per-viewer storage — the reload path races iframe-src resolution on the rig).
3. Assert the readout restores `125%` once the tile re-renders.

### (c) the `Web: Zoom in` palette entry steps the tile

**Proves**: palette parity (Constitution V) — the `web-zoom` CustomEvent seam drives the mounted tile (R5).

1. Open a proxied web tile.
2. Open the command palette (⌘K) and type `Web: Zoom`.
3. Click the `Web: Zoom in` option.
4. Assert the readout steps to `110%`.

### (d) an onboarding tile renders no zoom control and no Web: Zoom palette entries

**Proves**: the onboarding state (empty `@rk_url`) hides the zoom control and the palette registers nothing for a contentless tile (R4/R5 gating).

1. Open a window with an empty `@rk_url` in the web lens; assert the onboarding panel renders.
2. Assert the `web-zoom-control` testid is absent.
3. Open the palette, type `Web: Zoom`, and assert no `Web: Zoom` options exist.

### (e) ctrl-wheel inside the same-origin frame zooms CONTINUOUSLY; a + click lands back on the ladder

**Proves**: the contentWindow gesture attach with continuous semantics (260824-iafo) — a ctrl-wheel dispatched inside the framed document scales the tile smoothly to off-ladder values (the Chrome/macOS pinch behavior), every event compounds with no threshold, and click zoom stays quantized (snap-then-step onto the ladder). The event never reaches browser page zoom.

1. Open a proxied web tile.
2. Inside the framed document, dispatch a `wheel` event with `deltaY: -60, ctrlKey: true`.
3. Assert the readout shows the continuous value `182%` (`exp(0.6)`) and the iframe's transform is a ~1.82 scale matrix — an off-ladder value.
4. Dispatch a small `deltaY: -10` ctrl-wheel; assert the readout compounds to `201%` (no threshold swallowed it).
5. Click the `+` (Zoom in) button; assert `250%` — the continuous value snapped to the nearest ladder level (2) and stepped (2.5).
