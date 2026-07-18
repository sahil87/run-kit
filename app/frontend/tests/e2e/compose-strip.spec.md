# compose-strip.spec.ts

Validates the docked compose strip (260718-dhdj) — the sticky, global text-input
surface that replaces the modal ComposeBuffer. Covers the toggle affordances
(`>_` chip + palette parity), the persisted chrome preference, the live-target
send semantics (Enter + trailing `\r` to the focused pane), Escape-blurs focus
routing, and the target label following board-pane focus (closing the per-pane
STDIN routing gap noted in `shell-rotation.spec.ts:14`).

## Shared setup

- `beforeAll` creates two tmux sessions on the `rk-test-e2e` server:
  - `e2e-compose-<ts>` — a single window running `cat`, so STDIN typed via the
    strip echoes back into the pane (used to verify Enter sends `text + \r`).
  - `e2e-compose-board-<ts>` — two named windows (`cs-alpha`, `cs-bravo`) pinned
    to a fresh board for the target-label test.
- A unique board name (`cs<digits>`) is used per run so reruns don't collide on
  the persistent tmux server.
- `afterAll` breaks out of `cat` (C-c) and kills both sessions.
- Each test resolves the tmux `windowId` via `GET /api/sessions` (by session,
  optionally by window name) with a 5s poll.

## Tests

### `toggle via >_ chip and via the command palette; persists across reload`

**What it proves:** The `>_` bottom-bar chip is an `aria-pressed` toggle that
shows/hides the strip; the toggle state persists across a page reload; and the
`View: Text Input` palette action toggles the same preference (Constitution V
palette parity).

**Steps:**

1. Resolve the first window of the `cat` session; navigate to
   `/<server>/<windowId>`.
2. Wait for `.xterm-screen` to render.
3. Assert the `Compose text` chip has `aria-pressed="false"` and the strip
   (`[data-testid=compose-strip]`) is absent (off by default).
4. Click the chip; assert `aria-pressed="true"` and the strip is visible.
5. Reload the page; assert the chip is still pressed and the strip still visible
   (the `runkit-compose-strip` preference was persisted and rehydrated).
6. Open the palette (`Meta+k`), click `View: Text Input`; assert the chip
   returns to `aria-pressed="false"` and the strip is gone.

### `Enter sends text + carriage return to the focused pane; Escape blurs`

**What it proves:** Enter in the strip textarea sends the content plus a trailing
`\r` over the focused pane's relay stream (verified by the `cat` pane echoing the
marker), the textarea clears while the strip stays open, and Escape blurs the
textarea without closing the strip.

**Steps:**

1. Navigate to the `cat` session's window; wait for `.xterm-screen` and for the
   relay stream to attach (`window.__rkTerminals[windowId]` present).
2. Enable the strip via the `>_` chip; assert the input is visible.
3. Fill the input with a unique marker and press Enter.
4. Assert the input clears to `""` and the strip stays visible.
5. Poll `capture-pane` for the `cat` session and assert it contains the marker
   (proves `text + \r` reached the pane and was echoed).
6. Focus the input, press Escape, assert the input is no longer focused and the
   strip is still visible.

### `target label follows the focused board pane`

**What it proves:** On the board route, the strip's `→ {window}` target label
tracks the focused pane. Cycling focus with `Cmd+]` / `Cmd+[` updates the label
to the newly-focused pane's window name — the live-target signal (reverses DD-6).

**Steps:**

1. Resolve `cs-alpha` and `cs-bravo` window IDs; POST
   `/api/boards/<name>/pin` for both.
2. Navigate to `/board/<name>`; assert two `.xterm` instances mount.
3. Enable the strip via the `>_` chip; assert the target label is visible.
4. Assert the label reads `cs-alpha` (initial focused pane, index 0).
5. Press `Meta+]`; assert the label updates to `cs-bravo`.
6. Press `Meta+[`; assert the label returns to `cs-alpha`.
