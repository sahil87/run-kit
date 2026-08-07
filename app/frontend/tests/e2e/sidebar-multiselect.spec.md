# sidebar-multiselect.spec.ts

Behavioural contract for the sidebar's window-row multi-select and the palette's
bulk move-to-session (260807-nf9f): the session/window tree is a W3C-APG
**multiselect** tree whose window rows can be gathered into a set by
Cmd/Ctrl-click, Shift-click range, and the `x` key, cleared by Escape, and then
moved to another existing tmux session in one palette command.

## DOM note

- The scrollable Sessions region (`role="tree"`, `aria-label="Session tree"`)
  carries **`aria-multiselectable="true"`**.
- A **selected** window row is its `role="treeitem"` element with
  `aria-selected="true"`. Selection membership is keyed by the row's globally
  unique `data-row-key` (`${server}:${windowId}`) — the same handle the roving
  cursor uses, since bare tmux ids (`@N`) repeat across servers.
- Session rows and server headers are **never** selectable and never carry
  `aria-selected`.
- The selection count indicator is `data-testid="selection-indicator"`. It is a
  non-interactive `role="status"` strip that exists in the DOM **only while the
  selection is non-empty**, so an empty selection asserts `toHaveCount(0)`.
- A row's clickable select target is the first `<button>` inside the treeitem
  (the left-edge label zone and the right-hand icon cluster are separate
  targets).

## Shared setup

- `beforeAll` creates two per-run sessions on the isolated e2e tmux server:
  `e2e-msel-<timestamp>` with three windows (`alpha`, `beta`, `gamma`) as the
  move source, and `e2e-mseldst-<timestamp>` with one window (`keep`) as the move
  target. `afterAll` kills both. Per-run names keep the shared e2e server's other
  sessions out of the way.
- `openTree(page)` navigates to `/${TMUX_SERVER}`, waits for `Connected`, and
  asserts both session rows are rendered before any gesture is driven.
- `windowIds(page)` resolves `alpha`/`beta`/`gamma` to their stable tmux ids
  (`@N`) from the `/api/sessions` snapshot.
- `rowKey(windowId)` composes the `${server}:${windowId}` selection key.
- `selectedKeys(page)` reads the `data-row-key` of every
  `treeitem[aria-selected="true"]` currently in the tree.

## Tests

### `the tree declares aria-multiselectable and starts with nothing selected`

**What it proves:** The tree advertises the multiselect model to assistive tech,
and the resting state carries no selection and no indicator chrome.

**Steps:**
1. `openTree`.
2. Assert the tree element has `aria-multiselectable="true"`.
3. Assert no treeitem carries `aria-selected="true"`.
4. Assert `[data-testid="selection-indicator"]` has count 0.

### `Cmd-click toggles a window row's selection without navigating`

**What it proves:** A modifier-click is a selection gesture, not a navigation
one — the row joins the selection, the URL does not change, the count indicator
appears, and a second modifier-click removes the row again.

**Steps:**
1. `openTree`; resolve the `alpha` window id; record the current URL.
2. Click `alpha`'s row button with the `ControlOrMeta` modifier.
3. Assert the row has `aria-selected="true"` and the URL is unchanged.
4. Assert the selection indicator reads `1 selected`.
5. Modifier-click the same row again; assert `aria-selected="false"` and that
   the indicator is gone.

### `Shift-click extends a contiguous range from the anchor`

**What it proves:** Shift-click selects the whole inclusive run between the
anchor and the clicked row in visible-row order — including the middle row the
user never clicked.

**Steps:**
1. `openTree`; resolve `alpha`, `beta`, `gamma`.
2. Modifier-click `alpha` (this sets the range anchor).
3. Shift-click `gamma`.
4. Assert all three rows carry `aria-selected="true"`.
5. Assert the indicator reads `3 selected`.

### `` `x` toggles the focused row and Escape clears the selection ``

**What it proves:** The keyboard path works without a pointer — `x` on a focused
**window** row toggles it, `x` on a **session** row is a no-op (sessions are not
selectable), and Escape inside the tree clears the whole selection.

**Steps:**
1. `openTree`; resolve `alpha` and `beta`.
2. Focus `alpha`'s treeitem; press `x`; assert `aria-selected="true"`.
3. Focus the source **session** row; press `x`; assert the selected set is still
   exactly `[alpha]` — the session row was not selected.
4. Focus `alpha`; press `x` (deselects), then `x` again (reselects).
5. Focus `beta`; press `x`; assert the indicator reads `2 selected`.
6. Press `Escape` from `beta`; assert no row is `aria-selected` and the
   indicator is gone.

### `collapsing a session does not clear the selection of its still-live windows`

**What it proves:** Selection liveness derives from the session **data**, not
from which rows happen to be rendered. Folding a session away hides its rows but
kills no window, so the selection and the count indicator survive a collapse of
the selected windows' own session, a collapse of an unrelated session, and the
subsequent re-expand. (Deriving liveness from the visible-row walk instead made
a collapse silently destroy the selection — and cost `Select all merged`, which
deliberately selects windows inside collapsed sessions, part of its result
before the user reached the palette.)

**Steps:**
1. `openTree`; resolve `alpha` and `beta`.
2. Modifier-click both rows; assert the indicator reads `2 selected`.
3. Click `Collapse <src-session>`; assert `alpha`'s row has left the DOM and the
   indicator still reads `2 selected`.
4. Click `Collapse <dst-session>` (an unrelated signature change); assert the
   indicator still reads `2 selected`.
5. Click `Expand <src-session>`; assert both `alpha` and `beta` are rendered
   again with `aria-selected="true"`.
6. Re-expand the target session so the persisted collapse state does not leak
   into the next test.

### `palette 'Selection: Move N windows to <session>' bulk-moves the selection`

**What it proves:** The end-to-end sweep — select several windows, run the
per-target-session palette entry, and the windows actually move in tmux, the
success toast reports the count, the selection clears, and the rows repaint
under the target session via SSE.

**Steps:**
1. `openTree`; resolve `alpha` and `beta`.
2. Modifier-click both rows; assert the indicator reads `2 selected`.
3. Press `Meta+k`, fill the palette with
   `Selection: Move 2 windows to <dst-session>`, wait for the option to render,
   and press `Enter`.
4. Assert the toast `Moved 2 windows to <dst-session>` appears.
5. Assert the selection indicator is gone (a fully successful batch clears the
   selection).
6. Poll tmux (`list-windows` on the target session) until both window ids are
   present; assert neither remains in the source session.
7. Assert both rows are now rendered inside the target session's
   `[data-session-group]` — the SSE repaint.
