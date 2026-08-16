# compose-strip.spec.ts

Validates the docked compose strip (260718-dhdj) — the sticky, global text-input
surface that replaces the modal ComposeBuffer. Covers the toggle affordances
(`a▏` chip + palette parity), the persisted chrome preference, the on-strip ×
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
Escape-blurs focus routing, the target label following board-pane focus
(closing the per-pane STDIN routing gap noted in `shell-rotation.spec.ts:14`),
and the two-dock mount model (260813-j3jb — the strip renders INSIDE the first
tty tile on the desktop terminal route and at the shell footer everywhere
else; the dock split doubles as the mode signal: in-tile = single-send,
footer = broadcast/board/mobile/no-tty; a broadcast flip moves the strip
between docks without losing the per-target draft; the footer dock never
overflows a 375px mobile viewport). The pane-aligned geometry of 260812-fryz
is retired — both docks are container-aligned, no measurement, no inline
margin/width styles.
The strip's layout is ONE card model on both pointers: with no draft it is a
single compact row (📎 · a| on fine · textarea · Send); the card — a bordered
box holding the full-width transparent textarea with a quiet chip row below
it — morphs in on per-pointer triggers (coarse: focus / multi-line draft /
attachments; fine: draft presence with a hysteresis latch released only by
blur-while-empty). The `a|` closer is dropped on coarse, the ⏎ chip hides
while the composer is empty, the fine header folds at the in-tile dock (the
tile frame names the target; the footer dock and broadcast keep it), and the
`Uploading…` text is replaced by a busy state on the 📎 chip itself. The
coarse-pointer coverage runs via a nested touch-emulated describe
(`hasTouch: true` flips Chromium's `(pointer: coarse)` media query), which
also pins the bottom bar hiding while the textarea owns focus.
The chat send form deliberately does NOT follow the strip's Enter policy (it
keeps Enter=newline — the chat lens cannot show the pane's input box); its
coverage lives in `chat-view.spec.ts`.

## Shared setup

- `beforeAll` creates two tmux sessions on the `rk-test-e2e` server:
  - `e2e-compose-<ts>` — a single window running `cat`, so STDIN typed via the
    strip echoes back into the pane (used to verify Cmd/Ctrl+Enter sends
    `text + \r`). Its window carries a `@rk_url` option (stamped here, not
    mid-test — the backend's window payload refreshes on an interval, and the
    split-layout test's web tile reads rkUrl from it).
  - `e2e-compose-board-<ts>` — two named windows (`cs-alpha`, `cs-bravo`) pinned
    to a fresh board for the target-label test.
- A unique board name (`cs<digits>`) is used per run so reruns don't collide on
  the persistent tmux server.
- `afterAll` breaks out of `cat` (C-c) and kills both sessions.
- Each test resolves the tmux `windowId` via `GET /api/sessions` (by session,
  optionally by window name) with a 5s poll.

## Tests

### `toggle via a▏ chip and via the command palette; persists across reload`

**What it proves:** The `a▏` bottom-bar chip is an `aria-pressed` toggle that
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

### `the on-strip a| closes the strip (the in-tile header is folded); the draft survives close→reopen`

**What it proves:** At the fine-pointer in-tile dock the strip's header row —
and its × — is folded (the tile frame names the target), so the `a|` chip is
the on-strip closer there: clicking it fires the same `toggleComposeStrip`
action as the `a▏` chip, unmounting the strip and returning the chip to
`aria-pressed="false"` — with no confirmation dialog, and the unsent draft
survives the close (the per-target module store outlives the strip's
unmount) so reopening on the same target restores it.

**Steps:**

1. Navigate to the `cat` session's window; wait for `.xterm-screen` and for the
   relay stream to attach (`window.__rkTerminals[windowId]` present) so the
   strip has a live target.
2. Enable the strip via the `a▏` chip; fill the input with a unique draft
   marker.
3. Assert `compose-strip-close` is ABSENT (the in-tile header fold); click the
   `a|` chip (`compose-strip-a-close`); assert the strip
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
2. Navigate to `cs-alpha`'s terminal route; enable the strip via the `a▏` chip;
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
2. Enable the strip via the `a▏` chip; assert the input is visible.
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
2. Enable the strip via the `a▏` chip; assert the input is visible and carries
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
3. Enable the strip via the `a▏` chip; assert the target label is visible and
   the strip textarea took focus (focus-on-open, 260801-sm6g), then press
   Escape to blur it — the pane-cycle chords are suppressed while a real text
   input owns focus.
4. Assert the label reads `cs-alpha` (initial focused pane, index 0).
5. Press `Meta+]`; assert the label updates to `cs-bravo`.
6. Press `Meta+[`; assert the label returns to `cs-alpha`.

### `the strip docks INSIDE the tty tile on a desktop terminal route (260813-j3jb)`

**What it proves:** On a `split-h:tty,web` terminal layout, the compose strip
renders as a DESCENDANT of the tty tile's frame (below the terminal body,
inside the tile), never in the shell footer, and carries no pane-alignment
inline styles — the in-tile dock is container-aligned by construction.
Zooming the tile carries the strip with it (the dock rides the tile).

**Steps:**

1. Set a 1440×800 viewport; resolve the `cat` session's window (its `@rk_url`
   was stamped in `beforeAll` — the backend's window payload refreshes on an
   interval, so a mid-test set raced that propagation; the iframe content is
   never asserted).
2. Navigate to `/<server>/<windowId>?layout=split-h:tty,web`; wait for the
   `Connected` dot and both `surface-tile-tty` and `surface-tile-web`.
3. Enable the strip via the `a▏` chip.
4. Assert `compose-strip` is visible INSIDE `surface-tile-tty` and absent from
   the shell `<footer>`; assert `compose-strip-inner` has no inline
   `margin-left`/`width` style.
5. Click the tty tile's `Zoom Terminal` verb; assert the strip is still inside
   the tile and still absent from the footer.

### `the board route docks the strip at the shell footer, full width (260813-j3jb)`

**What it proves:** The board route has no surface tiles, so the strip docks at
the shell footer — a child of `<footer>`, never inside a board pane — and
spans the full row with no inline alignment styles. The fine footer dock KEEPS
the header row (no tile frame names the target there), so the × close renders
and closes the strip.

**Steps:**

1. Set a 1440×800 viewport; resolve `cs-alpha`/`cs-bravo`; pin both to a fresh
   per-run board (`csa<digits>`).
2. Navigate to the board; assert two `.xterm` instances mount.
3. Enable the strip via the `a▏` chip; assert the inner wrapper is visible.
4. Assert the strip is a descendant of `<footer>` and NOT inside
   `board pane cs-alpha`.
5. Measure the strip's outer row; poll until the inner wrapper spans it (±2px)
   and assert no `margin-left` inline style.
6. Assert the header's target label is visible (the footer dock keeps the
   header); click the × (`compose-strip-close`); assert the strip is gone.

### `selection broadcast flips the strip from the tile to the footer dock (260813-j3jb)`

**What it proves:** On a desktop terminal route the strip starts inside the tty
tile (single-send); activating selection broadcast (`Selection: Send prompt to
N agents` — a frozen multi-window target, a shell-level concern) moves the
strip to the shell footer, where it renders full width with the `2 selected`
target label. The dock split IS the mode signal.

**Steps:**

1. Set a 1440×800 viewport; resolve `cs-alpha`/`cs-bravo` and navigate to
   cs-alpha's terminal route (`/<server>/<windowId>`); wait for the
   `Connected` dot and the tty tile.
2. Enable the strip via the `a▏` chip; assert it renders INSIDE
   `surface-tile-tty`; press Escape to blur the textarea (focus-on-open).
3. Cmd/Ctrl-click both window rows in the sidebar tree to select them.
4. Open the palette (`Meta+k`), run `Selection: Send prompt to 2 agents`;
   assert the strip's target label reads `2 selected`.
5. Assert the strip is gone from the tty tile and visible inside `<footer>`;
   measure the outer row and poll until the inner wrapper spans it (±2px);
   assert no `margin-left` inline style.

### `375px mobile: the strip docks at the shell footer with no horizontal overflow (260813-j3jb)`

**What it proves:** At a 375px viewport the tile chrome does not render, so the
strip docks at the shell footer (never inside the chromeless tile) and causes
no page-level horizontal overflow — its visible box stays fully inside the
viewport. With a fine pointer (viewport-only emulation), focus-on-open does
NOT morph the strip (the fine trigger is draft presence, never focus), and
the first character morphs it to the card — still without overflow.

**Steps:**

1. Set a 375×812 viewport; navigate to the `cat` session's window; wait for the
   terminal (no `Connected` dot on mobile — the sidebar is an unmounted drawer).
2. Enable the strip via the palette (`⌘K` → `View: Text Input`) — at 375px
   with a fine pointer (viewport-only emulation) neither bar renders
   (260814-ldbs: the bottom bar is pointer-gated to coarse, the status bar
   width-gated to desktop), so the keyboard-first path is the opener; assert
   the inner wrapper is visible and the strip is a descendant of `<footer>`.
3. Assert `compose-strip-card` is ABSENT (fine focus never morphs — the strip
   stays a compact single row).
4. Poll `document.documentElement.scrollWidth` until ≤ 375 (no horizontal page
   overflow); assert the inner box's `x ≥ 0` and `x + width ≤ 375`.
5. Fill the input with a two-line draft; assert `compose-strip-card` renders
   (draft presence morphs to the card) and `scrollWidth` stays ≤ 375.

### `compose focus hides the bottom bar and morphs to the card; blur-while-empty returns compact` (coarse pointer card model)

**What it proves:** On a coarse pointer (`hasTouch: true` flips Chromium's
`(pointer: coarse)` media query) at 375px: focusing the compose textarea hides
the bottom-bar key row AND morphs the strip to the card — a full-width
transparent textarea (`rows=1`) above a quiet chip row (no Insert, no `a|`
closer on coarse; the ⏎ chip hidden while the composer is empty). With text,
the ⏎ chip appears on the chip row BELOW the textarea, level with Send, and
inserts a local newline at the caret without sending or dropping focus. The
`→ {target}` header row folds away and the target name moves into the textarea
placeholder. Escape blurs: the bottom bar returns, and a multi-line draft
HOLDS the card. The on-device no-dead-space regression stays pinned (the bar
owns its 48px frame, so its early-return removes the reserved height).

**Steps:**

1. Set a 375×812 touch viewport; navigate to the `cat` session's window; wait
   for `.xterm` and for the relay stream to attach
   (`window.__rkTerminals[windowId]` present).
2. Assert the bottom bar (`role=toolbar` "Terminal keys") is visible.
3. Enable the strip via the `a▏` chip; assert the input is visible and focused
   (focus-on-open), and the bottom bar is now absent.
4. Assert zero dead space: the footer's bottom edge equals the strip's bottom
   edge while the bar is hidden (gap regression).
5. Assert the card (`compose-strip-card`) renders with `rows="1"`, no Insert,
   no `compose-strip-a-close`, and no `compose-strip-newline` (hidden while
   empty); assert `compose-strip-target` is absent (header folded) and the
   input's placeholder matches `→ ……`.
6. Fill `"hello"`; assert the ⏎ chip appears on the card's chip row — its top
   level with Send's, at or below the textarea's bottom edge — and that both
   chips keep the 36px coarse touch-target floor.
7. Click the ⏎ chip; assert the input value is `"hello\n"` and the input is
   still focused.
8. Press Escape; assert the input is blurred, the bottom bar is visible again,
   and the card persists (the multi-line draft holds it).

### `coarse compact is a single 36px-flush row — 📎 · textarea · Send` (coarse pointer card model)

**What it proves:** On a coarse pointer, blurring the strip while the draft is
EMPTY returns it to the compact single row (the card morph's release), and the
compact row keeps the pinned 36px alignment: the textarea and Send share one
height with flush tops and bottoms (260814 alignment regression).

**Steps:**

1. Set a 375×812 touch viewport; navigate to the `cat` session's window; wait
   for `.xterm` and the relay stream.
2. Enable the strip via the `a▏` chip; assert the input took focus
   (focus-on-open → card form on coarse).
3. Press Escape (blur while empty); assert `compose-strip-card` is ABSENT —
   the strip is back to the compact row.
4. Measure the textarea and Send chip boxes: textarea height is exactly 36px
   and both chips share its top and bottom edges.
