# sync-latency.spec.ts

Audit file that times the user-action-to-UI-reflection latency for the
sidebar's mutating actions. Every action is expected to have an optimistic
update that lands in under 500ms; anything slower is either missing an
optimistic path or waiting on the 2.5s SSE poll.

The `afterAll` prints a summary table of all timings and flags any action
that exceeded the 500ms threshold.

## Shared setup

- Per-file timeout bumped to 20s via `test.setTimeout(20_000)` — some drag
  interactions legitimately exceed Playwright's default 10s.
- `beforeAll` creates sessions `e2e-lat-a-<ts>` and `e2e-lat-b-<ts>` so the
  tests have distinct targets for rename, drag, and cross-session move.
- `setup(page)` navigates to `/${TMUX_SERVER}`, waits for `Connected`, then
  gates on **any** session row being rendered (`aria-label^='Navigate to '`)
  before returning the sidebar locator. The gate is name-agnostic on purpose:
  test 2 renames the shared SESSION_A via the UI, so a gate hard-wired to a
  specific name (e.g. `Navigate to ${SESSION_A}`) would strand every later
  `setup()` once the rename lands, time out, and trigger a Playwright worker
  restart (which re-seeds a fresh, un-renamed SESSION_A and breaks tests
  assuming the rename).
- `afterAll` best-effort kills both sessions, any `-renamed` variant, the
  kill-session scratch, the instant-create defaults (`session`,
  `session-2`…`session-11`), and any live `e2e-lat-xtgt-<ts>` cross-drag
  target sessions (enumerated by prefix) that may linger on the shared tmux
  server.
- A shared `results` array collects `{ action, ms, optimistic }` rows that
  the `afterAll` prints at the end of the file.

## Tests

### `1. Create session via UI`

**What it proves:** Clicking the Dashboard's `+ New Session` card creates a
session instantly via `handleCreateSessionInstant` (no dialog, auto-derived
name) and a ghost entry renders in the sidebar in ≤500ms.

**Steps:**
1. `setup(page)` — navigate to `/${TMUX_SERVER}`, wait for `Connected`,
   return the sidebar locator.
2. Count existing `button[aria-label^='Navigate to ']` rows.
3. Start the timer.
4. Click `button:has-text('+ New Session')`.
5. Poll until the count increases (timeout 8s).
6. `record("Create session (UI)", elapsed)`.

### `2. Rename session via UI (double-click)`

**What it proves:** Double-clicking a session name opens an inline input;
pressing Enter commits an optimistic rename and the new name renders in
≤500ms.

**Steps:**
1. `setup`.
2. Wait for the `Navigate to ${SESSION_A}` button to exist (this test runs
   before any rename, so SESSION_A's original name is still present).
3. Double-click the session name to enter edit mode.
4. Clear and fill the input with `${SESSION_A}-renamed`.
5. Start timer, press Enter.
6. Wait for the new name text to appear; `record`.

### `3. Create window via sidebar + button`

**What it proves:** The session row's `+` (New window) button creates a
window optimistically — a ghost window row appears under SESSION_B in
≤500ms, without waiting for the SSE poll. The test fails (records SLOW) if
the create path ever regresses to SSE-dependent. Tolerant if the button
isn't visible (session not expanded).

**Steps:**
1. `setup`.
2. Assert session B is visible.
3. If `New window in ${SESSION_B}` button is visible:
   a. Scope to SESSION_B's window rows — the per-session `div.mb-2` wrapper
      (unique to the session wrapper in `sidebar/index.tsx`) that `has`
      SESSION_B's `Navigate to ` button — and count its `[data-window-id]`
      rows (the stable window-row handle; real `@N` ids and `ghost-<id>`
      rows alike). Anchoring on `div.mb-2` resolves to exactly SESSION_B's
      wrapper, so no `.first()` is needed (a bare `div` filter would match
      the whole-server container and over-count every session's rows).
   b. Start the timer, then click the `+` button. If a dialog appears (it
      doesn't for the current-server sidebar `+`, which is instant), click
      its `Create` button.
   c. Poll (bounded 8s) until the window-row count under SESSION_B exceeds
      the pre-click count — i.e. a new (ghost) window row appears — and
      `record` that elapsed latency. The name is auto-derived/unpredictable,
      so detection is by count increase (mirroring test 1), not by name.
4. Otherwise log SKIP.

### `4. Rename window via UI (double-click)`

**What it proves:** Double-click rename on a window also runs optimistically
(≤500ms).

**Steps:**
1. Create `rename-me` window in session B via the `tmux()` helper.
2. `setup`.
3. Assert `rename-me` is visible.
4. Double-click, clear, fill `renamed-win`.
5. Timer, Enter, wait for new name, `record`.

### `5. Kill window via Ctrl+click (instant)`

**What it proves:** Ctrl+click on the window's kill button performs an
instant kill with no confirm dialog; the row disappears in ≤500ms.

**Steps:**
1. Create `kill-me` window via the `tmux()` helper.
2. `setup`.
3. Assert `kill-me` visible.
4. Timer, `click({ modifiers: ['Control'] })` on the kill button.
5. Wait for `kill-me` to disappear, `record`.

### `6. Move window within session (drag-drop reorder)`

**What it proves:** Dragging a window over another within the same session
reorders them optimistically.

**Steps:**
1. Create `dnd-first` and `dnd-second` in session B.
2. `setup`.
3. Read bounding boxes of both rows.
4. Timer, perform mouse `move → down → move → up` from second onto first.
5. Poll up to 5s (50 × 100ms) for the order to flip (second above first
   by `y`).
6. `record` either success or "order did not change".

### `7. Move window to another session (cross-session drag)`

**What it proves:** Dragging a window onto a different session row moves
it across sessions. Self-contained: the test creates its own dedicated
target session `e2e-lat-xtgt-<ts>` rather than relying on test 2 having
renamed the shared SESSION_A — that coupling broke on any Playwright worker
restart (the re-seeded SESSION_A is never renamed).

**Steps:**
1. Create a dedicated target session `e2e-lat-xtgt-<ts>` via the `tmux()` helper.
2. Create `cross-mv` window in session B via the `tmux()` helper.
3. `setup`.
4. Assert both `cross-mv` and `e2e-lat-xtgt-<ts>` are visible.
5. Read bounding boxes.
6. Timer, drag-drop source over target.
7. Poll up to 5s for the source row to disappear from under session B.
8. `record` either "moved" or "may not have moved".

### `8. External tmux change (SSE baseline)`

**What it proves:** Baseline — external tmux mutations (no optimistic
path) must take at least one SSE poll interval (~2.5s) to show up. A
faster time here would imply an unintended optimistic path.

**Steps:**
1. `setup`.
2. Timer, run `tmux new-window -t ${SESSION_B} -n ext-<ts>`.
3. Wait for the window to appear, `record`. Expected to be [SLOW].

### `9. Kill session via UI (with dialog)`

**What it proves:** The kill-session confirm dialog is dismissed and the
session row disappears in ≤500ms after confirming.

**Steps:**
1. Create `e2e-kill-${SESSION_A}` via the `tmux()` helper.
2. `setup`.
3. Assert session row visible.
4. Timer, click `Kill session <name>` button.
5. Wait for `[role='dialog']` to appear.
6. Click `button:has-text('Kill')` inside the dialog (with `{ force: true }`
   to bypass occasional overlay pointer interception).
7. Wait for the row to disappear, `record`.
