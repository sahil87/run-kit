# sort-windows.spec.ts

Verifies the **`Session: Sort windows by created`** and **`Session: Sort windows
by status`** command-palette actions — the one-shot session-scoped reorder verb
(`POST /api/sessions/{session}/sort-windows`). Exercises the full real-tmux
loop: palette → API → tmux move-window batch → SSE derive tick → sidebar order.

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
- `runPaletteSort(page, label)` opens the palette (`Meta+k`), fills the action
  label into the `Type a command` input, and presses Enter.
- `swapWindows(a, b)` scrambles order with `tmux swap-window` on exact-match
  session-qualified targets (`=session:=name`).
- `waitForSessionVisible(page)` waits until the spec's session renders in the
  sidebar — the palette entries' current-session gate is the snapshot-derived
  `sessionName`, which needs the SSE session list to have landed.

## Tests

### `sort by created restores ascending @N order after a scramble`

**What it proves:** after physically scrambling the window order, invoking
`Session: Sort windows by created` from the palette restores the ascending
`@N` (creation) order — in tmux itself and in the sidebar.

**Steps:**
1. Resolve the first window, navigate to its terminal route, and wait for the
   session to render in the sidebar (the current-session gate).
2. `swap-window` the first and last windows; assert the tmux-side order reads
   `[alpha, zed, mid]` (the scramble landed).
3. Run the `Session: Sort windows by created` palette action.
4. Poll `list-windows` until the order returns to creation order
   `[mid, zed, alpha]`.
5. Poll the sidebar's window rows (filtered by `TAG`) until they show the same
   creation order (the reorder arrived via SSE).

### `sort by status puts a waiting window first`

**What it proves:** a window whose pane carries a live `waiting` agent state
outranks plain windows — after `Session: Sort windows by status` it sits at
the top of the session, in tmux and in the sidebar.

**Steps:**
1. Read the last window's pane pid (`list-panes -F "#{pane_pid}"`) and set the
   pane option `@rk_agent_state` to `waiting:<epoch>:<pid>` — the 3-segment
   form carrying the pane's own live pid (a 2-segment value on a shell pane
   would be reconciled away).
2. Navigate to the first window's terminal route and wait for the session to
   render in the sidebar (the current-session gate).
3. Run the `Session: Sort windows by status` palette action.
4. Poll `list-windows` until the waiting window is first:
   `[alpha, mid, zed]` (the two plain windows keep their relative order —
   stable sort).
5. Poll the sidebar's window rows until they show the same order.
