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
- `afterAll` best-effort kills both sessions, any `-renamed` variant, the
  kill-session scratch, and the instant-create defaults (`session`,
  `session-2`…`session-11`) that may linger on the shared tmux server.
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
2. Wait for `Navigate to ${SESSION_A}` button to exist.
3. Double-click the session name to enter edit mode.
4. Clear and fill the input with `${SESSION_A}-renamed`.
5. Start timer, press Enter.
6. Wait for the new name text to appear; `record`.

### `3. Create window via sidebar + button`

**What it proves:** The session row's `+` (New window) button creates a
new window — at minimum the create operation completes within a reasonable
budget. Tolerant if the button isn't visible (session not expanded).

**Steps:**
1. `setup`.
2. Assert session B is visible.
3. If `New window in ${SESSION_B}` button is visible:
   a. Click it, start timer.
   b. If a dialog appears, click its `Create` button.
   c. `waitForTimeout(3000)` and `record`.
4. Otherwise log SKIP.

### `4. Rename window via UI (double-click)`

**What it proves:** Double-click rename on a window also runs optimistically
(≤500ms).

**Steps:**
1. Create `rename-me` window in session B via `execSync`.
2. `setup`.
3. Assert `rename-me` is visible.
4. Double-click, clear, fill `renamed-win`.
5. Timer, Enter, wait for new name, `record`.

### `5. Kill window via Ctrl+click (instant)`

**What it proves:** Ctrl+click on the window's kill button performs an
instant kill with no confirm dialog; the row disappears in ≤500ms.

**Steps:**
1. Create `kill-me` window via `execSync`.
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
it across sessions. Uses the renamed variant of session A as the target.

**Steps:**
1. Create `cross-mv` in session B.
2. `setup`.
3. Assert both `cross-mv` and `${SESSION_A}-renamed` are visible.
4. Read bounding boxes.
5. Timer, drag-drop source over target.
6. Poll up to 5s for the source row to disappear from under session B.
7. `record` either "moved" or "may not have moved".

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
1. Create `e2e-kill-${SESSION_A}` via `execSync`.
2. `setup`.
3. Assert session row visible.
4. Timer, click `Kill session <name>` button.
5. Wait for `[role='dialog']` to appear.
6. Click `button:has-text('Kill')` inside the dialog (with `{ force: true }`
   to bypass occasional overlay pointer interception).
7. Wait for the row to disappear, `record`.
