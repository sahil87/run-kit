# sidebar-keyboard-nav.spec.ts

Behavioural contract for Wave-3 sidebar keyboard navigation: the session/window
tree is a W3C-APG disclosure tree (`role="tree"` / `treeitem` / `group`) with a
single roving tab stop, and arrow keys move/expand/collapse/activate rows without
hijacking rename inputs or the terminal.

## DOM note

- The scrollable Sessions region carries `role="tree"` with `aria-label="Session tree"`.
- Session rows are `role="treeitem"` `aria-level="1"`, carry a `data-session-row`
  handle equal to `${server}:${session}`, and `aria-expanded` mirrors their
  collapse state.
- Window rows are `role="treeitem"` `aria-level="2"` and carry two handles: the
  existing bare `data-window-id` (`@N`, for tests/automation/pin lookups) and a
  `data-row-key` equal to `${server}:${windowId}`. The latter is the
  globally-unique roving key — bare tmux ids (`@N`) repeat across servers, so the
  roving cursor + Enter/Space activation must key on the namespaced handle.
- The "roving key" is read off whichever treeitem currently has `tabindex="0"`
  (its `data-row-key` for windows, `data-session-row` for sessions — never the
  bare `data-window-id`).

## Shared setup

- `beforeAll` creates `e2e-kbnav-<timestamp>` with two windows (`edit`, `test`)
  so the tree has a session row plus ≥2 window rows; `afterAll` kills it.
- `openTree(page)` navigates to `/${TMUX_SERVER}`, waits for `Connected`, asserts
  the `role="tree"` element and the test session's row are visible, and returns
  the tree locator.
- `rovingKey(page)` returns the globally-unique roving key of the
  `treeitem[tabindex="0"]` — `data-row-key` (windows) or `data-session-row`
  (sessions).
- `resolveWindowId(page, name)` polls `/api/sessions` to map a window's display
  name to its stable tmux id (`@N`).

## Tests

### `tree has role=tree with treeitem rows and exactly one tab stop`

**What it proves:** The tree exposes APG roles and maintains the roving-tabindex
invariant — at least 3 treeitems (1 session + 2 windows) and exactly one with
`tabindex="0"`.

**Steps:**
1. `openTree`.
2. Assert `[role="tree"] [role="treeitem"]` count ≥ 3.
3. Assert `[role="tree"] [role="treeitem"][tabindex="0"]` has count exactly 1.

### `ArrowDown/ArrowUp move the roving cursor and stop at the ends`

**What it proves:** Down/Up move the roving tab stop between visible rows and stop
(no wrap) at the first row.

**Steps:**
1. `openTree`; resolve the `edit` window id; derive its namespaced roving key
   `${server}:${editId}`.
2. Focus the current tab stop; press `Home`; assert roving key is the session row.
3. Press `ArrowDown`; assert roving key is the `edit` window's namespaced key.
4. Press `ArrowUp`; assert roving key is back on the session row.
5. Press `ArrowUp` again; assert roving key is unchanged (stop at start, no wrap).

### `ArrowLeft collapses the session; ArrowRight expands then descends`

**What it proves:** Left collapses an expanded session; Right re-expands it (focus
stays on the session) and a second Right descends to its first window child.

**Steps:**
1. `openTree`; focus the session row; press `Home`.
2. Press `ArrowLeft`; assert the session row's `aria-expanded="false"`.
3. Press `ArrowRight`; assert `aria-expanded="true"` and roving key is still the
   session row.
4. Resolve the `edit` window id; press `ArrowRight`; assert roving key is that
   window's namespaced key (`${server}:${editId}`).

### `Enter on a window row navigates to that window`

**What it proves:** Enter activates the focused window row — it navigates the URL
to that window and marks the row `aria-current="page"`.

**Steps:**
1. `openTree`; resolve the `edit` window id.
2. Focus the tab stop; press `Home` then `ArrowDown` (→ first window); assert
   roving key is the `edit` window's namespaced key (`${server}:${editId}`).
3. Press `Enter`.
4. Assert the URL matches `/${TMUX_SERVER}/.+` and the `[data-window-id=edit]`
   row's button shows `aria-current="page"` within 5s.

### `arrows inside a rename input are not hijacked by the tree`

**What it proves:** When a row's rename `<input>` is focused, ArrowDown moves the
text caret (the tree handler early-returns) and the existing Escape-cancel rename
contract still works.

**Steps:**
1. `openTree`; focus the tab stop; press `Home`; record the roving key.
2. Double-click the session name button to enter rename mode; assert the
   `Rename session` input is visible and focus it.
3. Press `ArrowDown` inside the input; assert the roving key is unchanged.
4. Press `Escape`; assert the rename input is hidden (cancel still works).
