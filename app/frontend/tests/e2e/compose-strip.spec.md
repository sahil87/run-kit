# compose-strip.spec.ts

Validates the docked compose strip (260718-dhdj) — the sticky, global text-input
surface that replaces the modal ComposeBuffer. Covers the toggle affordances
(`>_` chip + palette parity), the persisted chrome preference, the on-strip ×
close button (260722-d5q7 — same toggle as the chip, lossless draft), the
per-target draft model (260801-cyth — drafts keyed by the focused window,
text persisted to localStorage: they stay with their addressee across
navigation and survive reloads), the terminal-faithful Enter matrix
(260802-lj98: plain Enter = insert line, sending `text + "\n"` to the focused
pane and clearing the draft, with empty Enter a full no-op; Cmd/Ctrl+Enter is
the ONLY submit chord, sending `text + \r` — and a bare `\r` on an EMPTY
textarea, "press Enter in the pane"; Alt+Enter is the chord-only byte-exact
raw insert; the Insert button follows Enter), `enterkeyhint="send"`
(pointer-independent; the readline editing chords are unit-tested in
`readline-keys.test.ts` / `compose-strip.test.tsx`),
Escape-blurs focus routing, and the target label following board-pane focus
(closing the per-pane STDIN routing gap noted in `shell-rotation.spec.ts:14`).
The chat send form deliberately does NOT follow the strip's Enter policy (it
keeps Enter=newline — the chat lens cannot show the pane's input box); its
coverage lives in `chat-view.spec.ts`.

## Shared setup

- `beforeAll` creates two tmux sessions on the `rk-test-e2e` server:
  - `e2e-compose-<ts>` — a single window running `cat`, so STDIN typed via the
    strip echoes back into the pane (used to verify Cmd/Ctrl+Enter sends
    `text + \r`).
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

### `the on-strip × closes the strip; the draft survives close→reopen (260722-d5q7)`

**What it proves:** The × close button in the strip's header row fires the same
`toggleComposeStrip` action as the `>_` chip — clicking it unmounts the strip
and returns the chip to `aria-pressed="false"` — with no confirmation dialog,
and the unsent draft survives the close (the per-target module store outlives
the strip's unmount) so reopening on the same target restores it.

**Steps:**

1. Navigate to the `cat` session's window; wait for `.xterm-screen` and for the
   relay stream to attach (`window.__rkTerminals[windowId]` present) so the
   strip has a live target.
2. Enable the strip via the `>_` chip; fill the input with a unique draft
   marker.
3. Click the × (`compose-strip-close`); assert the strip
   (`[data-testid=compose-strip]`) is gone and the chip reads
   `aria-pressed="false"` (same preference the chip toggles).
4. Click the chip to reopen; assert the input still holds the draft marker
   (closing was lossless — no confirmation needed).

### `drafts are per-target and survive a reload (260801-cyth)`

**What it proves:** Drafts are keyed by the send target (the focused window),
not shared globally: a draft typed for window A never shows while window B is
targeted (the draft does not "travel"), navigating back to A recalls A's draft,
and a page reload preserves the draft text (persisted to localStorage under
`runkit-compose-drafts`). This intentionally reverses 260718-dhdj's
single-traveling-draft model.

**Steps:**

1. Resolve the `cs-alpha` and `cs-bravo` window IDs from the board session.
2. Navigate to `cs-alpha`'s terminal route; enable the strip via the `>_` chip;
   fill the input with a unique draft-A marker.
3. Navigate to `cs-bravo`'s terminal route; wait for the strip input to be
   enabled (B is the focused target); assert the input is EMPTY (A's draft did
   not travel); fill a unique draft-B marker.
4. Navigate back to `cs-alpha`; assert the input shows the draft-A marker
   (per-target recall).
5. Reload the page; assert the input still shows the draft-A marker (text
   persistence survives a refresh).
6. Navigate to `cs-bravo` again; assert the input shows the draft-B marker
   (B's draft stayed with B through the reload).

### `Enter sends the line (text + newline); empty Enter is a no-op; Cmd/Ctrl+Enter submits; Escape blurs`

**What it proves:** Plain Enter in the strip is a send (260802-lj98,
insert-line): it transmits `text + "\n"` over the focused pane's relay stream
and clears the draft — on the `cat` pane the `\n` commits the line
(terminal-conventional Enter), so the marker appears twice (tty input echo +
`cat`'s output line). An EMPTY textarea + Enter is a FULL no-op (the keydown is
consumed — no local newline appears, nothing is sent). Cmd/Ctrl+Enter (the only
submit chord) still sends `text + \r`, and Escape blurs the textarea without
closing the strip.

**Steps:**

1. Navigate to the `cat` session's window; wait for `.xterm-screen` and for the
   relay stream to attach (`window.__rkTerminals[windowId]` present).
2. Enable the strip via the `>_` chip; assert the input is visible.
3. With the input empty, press Enter; assert the value stays `""` (no local
   newline — the keydown was consumed and nothing was sent).
4. Fill the input with a unique marker and press Enter; assert the input clears
   to `""` and the strip stays visible.
5. Poll `capture-pane` until the marker appears at least TWICE — the tty input
   echo plus `cat`'s echoed output line, proving `text + "\n"` reached the pane
   and committed.
6. Fill a second marker and press `ControlOrMeta+Enter`; assert the input
   clears; poll `capture-pane` until it contains the marker (proves
   `text + \r` still submits).
7. Focus the input, press Escape, assert the input is no longer focused and the
   strip is still visible.

### `Alt+Enter stages raw text; empty Cmd/Ctrl+Enter presses Enter in the pane; Insert button inserts the line (260802-lj98)`

**What it proves:** Alt+Enter — now the chord-only raw insert — delivers the
byte-exact text WITHOUT any trailing byte (staged on the pane's input line,
appearing exactly once), with the same clear-on-delivery as a submit. An empty
Cmd/Ctrl+Enter then sends a bare `\r` ("press Enter in the pane"), committing
the staged line — the keyboard-complete stage-then-submit loop. The Insert
button follows Enter (insert-line): `text + "\n"` commits on the `cat` pane
directly. Also asserts `enterkeyhint="send"` (the truthful keyboard hint —
Enter transmits the line).

**Steps:**

1. Navigate to the `cat` session's window; wait for `.xterm-screen` and the
   relay stream to attach.
2. Enable the strip via the `>_` chip; assert the input is visible and carries
   `enterkeyhint="send"`.
3. Fill a unique staged marker and press `Alt+Enter`.
4. Assert the input clears (same clear-on-delivery as submit).
5. Poll `capture-pane` until it contains the staged marker; assert it appears
   EXACTLY once — the tty echo of the input line. A committed line would appear
   twice (input echo + `cat`'s output line).
6. With the input now EMPTY, press `ControlOrMeta+Enter` (bare `\r`); poll
   `capture-pane` until the staged marker appears at least twice — proving the
   raw insert was truly staged and the empty chord truly pressed Enter.
7. Fill a second marker and click the `Insert` button (`compose-strip-insert`);
   assert the input clears; poll `capture-pane` until that marker appears at
   least twice (the button's `text + "\n"` committed the line on its own).

### `target label follows the focused board pane`

**What it proves:** On the board route, the strip's `→ {window}` target label
tracks the focused pane. Cycling focus with `Cmd+]` / `Cmd+[` updates the label
to the newly-focused pane's window name — the live-target signal (reverses DD-6).

**Steps:**

1. Resolve `cs-alpha` and `cs-bravo` window IDs; POST
   `/api/boards/<name>/pin` for both.
2. Navigate to `/board/<name>`; assert two `.xterm` instances mount.
3. Enable the strip via the `>_` chip; assert the target label is visible and
   the strip textarea took focus (focus-on-open, 260801-sm6g), then press
   Escape to blur it — the pane-cycle chords are suppressed while a real text
   input owns focus.
4. Assert the label reads `cs-alpha` (initial focused pane, index 0).
5. Press `Meta+]`; assert the label updates to `cs-bravo`.
6. Press `Meta+[`; assert the label returns to `cs-alpha`.
