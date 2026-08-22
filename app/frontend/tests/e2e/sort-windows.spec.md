# sort-windows.spec.ts

Verifies the **`Session: Sort windows…`** command-palette action and its
option-picker sub-step — the one-shot session-scoped reorder verb
(`POST /api/sessions/{session}/sort-windows` with an ordered key array).
Exercises the full real-tmux loop: palette → sub-step key pick → API → tmux
move-window batch → SSE derive tick → sidebar order.

## Shared setup

- Real tmux — the `_tmux.ts` fixture creates a detached session
  `e2e-sort-<epoch>` on the isolated e2e server (`rk-test-e2e`) with three
  windows in creation order. Torn down in `afterAll`.
- One random alphanumeric `TAG` per run is embedded in every window name
  (`mid-<tag>`, `zed-<tag>`, `alpha-<tag>`): the sidebar-order readout filters
  rows by it, so rows from other specs on the shared e2e server can never
  pollute the assertion — and alphabetical name order differs from creation
  order, so a name-sorted readout can never pass as created order.
- No route mocks — the app talks to the real dev server and the real isolated
  tmux server; assertions poll tmux-side truth (`list-windows`) AND the
  sidebar row order.
- `openSortPicker(page)` opens the palette (`Meta+k`), selects `Session: Sort
  windows…`, and waits for the picker sub-step (`Pick sort keys — Space toggle
  · Enter apply` placeholder).
- `pickSortKeys(page, labels)` clicks each named option row (toggles it on in
  click order = priority order), then presses Enter to apply.
- `setWaiting(name)` sets a window's pane option `@rk_agent_state` to
  `waiting:<epoch>:<pid>` — the 3-segment form carrying the pane's own live
  pid (a 2-segment value on a shell pane would be reconciled away);
  `clearAgentState(name)` removes it in `finally` so tests stay independent.
- `swapWindows(a, b)` scrambles order with `tmux swap-window` on exact-match
  session-qualified targets (`=session:=name`).
- `waitForSessionVisible(page)` waits until the spec's session renders in the
  sidebar — the palette entry's current-session gate is the snapshot-derived
  `sessionName`, which needs the SSE session list to have landed.

## Tests

### `sort by created restores ascending @N order after a scramble`

**What it proves:** after physically scrambling the window order, picking the
`By created` key in the sort sub-step restores the ascending `@N` (creation)
order — in tmux itself and in the sidebar.

**Steps:**
1. Navigate to the first window's terminal route and wait for the session to
   render in the sidebar (the current-session gate).
2. `swap-window` the first and last windows; assert the tmux-side order reads
   `[alpha, zed, mid]` (the scramble landed).
3. Open the sort picker and apply with only `By created` toggled.
4. Poll `list-windows` until the order returns to creation order
   `[mid, zed, alpha]`.
5. Poll the sidebar's window rows (filtered by `TAG`) until they show the same
   creation order (the reorder arrived via SSE).

### `sort by status puts a waiting window first`

**What it proves:** a window whose pane carries a live `waiting` agent state
outranks plain windows — after applying `By status` it sits at the top of the
session, in tmux and in the sidebar.

**Steps:**
1. Mark the last window's pane waiting (3-segment `@rk_agent_state` carrying
   the pane's own live pid).
2. Navigate to the first window's terminal route and wait for the session to
   render in the sidebar.
3. Open the sort picker and apply with only `By status` toggled.
4. Poll `list-windows` until the waiting window is first:
   `[alpha, mid, zed]` (the two plain windows keep their relative order —
   stable sort).
5. Poll the sidebar's window rows until they show the same order.
6. Clear the agent-state option (`finally` — later tests start plain).

### `composite status+name orders idle ties case-insensitively`

**What it proves:** composite ordering walks the key list — `status` is
primary, `name` breaks the tie within equal ranks — and the `name` key is
case-insensitive (`alpha` precedes `mid`, not ASCII-ordinal).

**Steps:**
1. Mark the middle window's pane waiting (`zed-<tag>`).
2. Navigate to the first window's terminal route and wait for the session to
   render in the sidebar.
3. Open the sort picker and apply with `By status` then `By name` toggled
   (selection order = priority).
4. Poll `list-windows` until the order is `[zed, alpha, mid]` — the waiting
   window first, then the two plain windows ordered by case-insensitive name.
5. Poll the sidebar's window rows until they show the same order.
6. Clear the agent-state option (`finally`).

### `Esc during the picker cancels with no reorder`

**What it proves:** bailing out of the sub-step fires no POST and changes
nothing — the cancel seam of the picker matches the confirm sub-step's.

**Steps:**
1. Navigate to the first window's terminal route, wait for the session in the
   sidebar, and record the current tmux-side window order.
2. Open the sort picker, toggle `By created` on, then press Escape.
3. Assert the palette overlay is gone.
4. Assert the tmux-side order is byte-identical to the recorded order (no
   POST, no mutation).
