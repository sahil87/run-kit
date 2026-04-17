# mobile-touch-scroll.spec.ts

Exercises the touch-input path for the embedded xterm.js terminal on mobile:
swipe-to-scroll, tap-to-focus, and wrapper measurability. Chromium doesn't
ship with `pointer:coarse` by default, so each test shims
`window.matchMedia('(pointer: coarse)')` via `page.addInitScript` before
navigation.

## Shared setup

- Per-file timeout bumped to 30s because terminal mounts and tmux scrollback
  generation can each take several seconds.
- `beforeAll` creates `e2e-scroll-<timestamp>` and pins it at 80×24 so the
  tmux PTY is large enough to receive typed input; `afterAll` kills it.
- Each test sets a 375×812 viewport and calls `mockTouchDevice(page)` before
  navigating.
- Touch events are dispatched via CDP (`Input.dispatchTouchEvent`) rather
  than `page.touchscreen` — the raw CDP path mirrors iOS input most closely.

## Tests

### `touch swipe sends SGR scroll sequences via WebSocket`

**What it proves:** A vertical swipe on the terminal wrapper produces SGR
mouse-scroll escape sequences (`\x1b[<64;col;rowM`) sent to the tmux PTY
via the WebSocket relay.

**Steps:**
1. Navigate to `/${TMUX_SERVER}/${TEST_SESSION}/0` and wait for
   `.xterm-screen` (xterm mount complete) plus a 2s settle.
2. Type `seq 1 200\n` into the terminal to guarantee scrollback content.
3. Monkey-patch `WebSocket.prototype.send` to append any data containing
   `\x1b[<6` into `window.__scrollSeqs`.
4. Dispatch `touchStart` at the wrapper center, then 15 small downward
   `touchMove` events (simulating finger drag down), then `touchEnd`.
5. Read back `window.__scrollSeqs` and assert:
   - At least one sequence was captured.
   - The first sequence matches `\x1b[<64;\d+;\d+M` (button 64 = scroll up
     in SGR encoding — finger down = see older content).
   - The sequence does NOT contain the degenerate `;1;1M` coordinates, which
     would indicate the terminal bounding box wasn't measured correctly.

### `role=application wrapper has measurable bounding box at 375x812`

**What it proves:** The xterm wrapper stays mounted and has positive
dimensions at mobile size. A navigation-driven unmount would leave the
locator present but un-measurable, which has caused past flakes.

**Steps:**
1. Navigate to the terminal route.
2. Wait for `.xterm-screen` to be visible.
3. Assert `[role='application']` has exactly one match within 3s.
4. Read its `boundingBox()` with a 3s timeout.
5. Assert `box.width > 0` and `box.height > 0`.

### `tap on terminal focuses textarea for keyboard`

**What it proves:** A bare tap (touchStart + touchEnd without movement)
focuses `.xterm-helper-textarea`. On iOS, this is what triggers the virtual
keyboard — regressions here break mobile typing.

**Steps:**
1. Navigate to the terminal route and wait for `.xterm-screen` + a 2s settle.
2. Blur any active element via `page.evaluate`.
3. Dispatch `touchStart` + `touchEnd` at the wrapper center with a 100ms gap
   between them; wait 500ms for focus handlers to run.
4. Assert `document.activeElement` has the class `xterm-helper-textarea`.
