# board-close-and-unpin.spec.ts

Validates the board pane-management controls after `co9z` (link-based pinning +
kill-vs-unpin legibility). On `/board/<name>` the **tile-header** pin glyph is
the unpin affordance (safe, reversible, unconfirmed), while the **top-bar ✕** is
a consequence-gated **Kill**: it reads `Kill` (verb discipline) and opens a
confirm dialog whose safe `Unpin instead` action is default-focused, because a
board Kill is a real window-kill that destroys the window everywhere (its home
session included). Because Pin now **links** (not moves) the window, a pinned
window also stays a member of its home session (dual presence). These e2e tests
prove the data-flow contracts the backend and the board UI agree on:

1. The tile-header unpin button (`Unpin <window> from board`) drives
   `POST /api/boards/<name>/unpin` directly (unconfirmed).
2. A pinned window is still listed under a NON-pin session by
   `GET /api/sessions` — the honest, tmux-derived dual-presence signal the
   SESSIONS sidebar renders from (it was absent under the old move model).
3. The top-bar ✕ reads `Kill`, opens the confirm dialog (with `Unpin instead`
   default-focused), and — on confirm — drives `POST /api/windows/<id>/kill` (a
   WINDOW-kill, not a close-pane); the single-pane tile then self-heals away and
   the emptied board vanishes.
4. The dialog's `Unpin instead` escape drives `POST /api/boards/<name>/unpin`
   and leaves the window alive on the tmux server.

The per-mode button set, the disabled-at-no-focused-tile rule, the board
SplitButtons, the pin-glyph rendering, the `{session} › {window}` crumb, the
sidebar pinned-row → board navigation, and the `Board: Split/Kill/Unpin Focused
Pane` palette actions are covered by unit tests (`top-bar.test.tsx`,
`board-header.test.tsx`, `window-row.test.tsx`,
`command-palette.boards.test.tsx`); this e2e focuses on the click → HTTP →
board-state contract and the dialog gating.

## Shared setup

- `beforeAll` creates an `e2e-board-close-<timestamp>` tmux session on
  `rk-test-e2e` with three named windows (`win-a`, `win-b`, `win-c`); `afterAll`
  kills it.
- Each test uses a fresh board name with a per-test prefix + a timestamp suffix
  (`unpin<digits>` / `dual<digits>` / `krm<digits>` / `esc<digits>`) so reruns
  don't collide on the persistent tmux server.
- `windowId(name)` reads a window's `#{window_id}` by matching
  `#{window_id}:#{window_name}` lines from `tmux list-windows -F`.

## Tests

### `the per-tile header pin glyph unpins the focused pane (POST /unpin), emptying the board`

**What it proves:** With `win-a` pinned via the HTTP API, `/board/<name>`
renders the tile and the tile-header unpin button exposes the per-window
`Unpin win-a from board` label; clicking it drives the click-triggered
`POST /api/boards/<name>/unpin` directly (the tile-header unpin stays
UNCONFIRMED — unpin is reversible), and the now-empty board is dropped from
`GET /api/boards`.

**Steps:**

1. Pin `win-a` via `POST /api/boards/<board>/pin`.
2. Navigate to `/board/<board>` (waitUntil `domcontentloaded`).
3. Assert `win-a` is visible (tile-header content).
4. Assert the tile-header button named `Unpin win-a from board` is visible.
5. Arm a `waitForRequest` for the click-triggered `POST /api/boards/<board>/unpin`,
   click the header unpin glyph, and await that request.
6. Poll `GET /api/boards` until the board disappears (empty boards are removed).

### `a pinned window stays a member of its home session (dual presence)`

**What it proves:** Because Pin now LINKS (not moves) the window, a pinned
window remains a member of its home session and therefore is still listed under
a NON-pin session by `GET /api/sessions` — the same derive-from-tmux source the
SESSIONS sidebar renders from. This is the core dual-presence win of the change
(the window would be ABSENT here under the old move model), asserted against the
backend session listing (deterministic — no sidebar-expand DOM timing).

**Steps:**

1. Pin `win-c` via `POST /api/boards/<board>/pin`.
2. Poll `GET /api/sessions?server=<server>` until some NON-`_rk-pin-*` session
   lists a window whose `windowId` matches `win-c` (dual presence via the
   backend snapshot).
3. Navigate to `/board/<board>` and assert `win-c` is visible — board
   membership is unaffected.
4. Unpin via `POST /api/boards/<board>/unpin` to clean up (board vanishes).

### `the top-bar ✕ opens the consequence-gated Kill dialog; confirming Kill destroys the window (POST /kill) and the tile self-heals away`

**What it proves:** With `win-b` pinned, the board top-bar ✕ reads `Kill` (never
`Close pane` / `Unpin pane from board`) and is consequence-gated: clicking it
opens a confirm dialog whose `Unpin instead` action is default-focused;
confirming `Kill` drives `POST /api/windows/<id>/kill` (a WINDOW-kill — "closes
it everywhere"). Killing the single-pane window collapses the pin-session with
no `board-changed` event, so ONLY the board page's own refetch (driven by
`executeKillWindow`'s `onSettled`) can drop the dead tile — the test asserts the
tile disappears from the DOM (empty-state appears) to exercise that self-heal
refetch directly, then confirms the emptied board also vanishes from the server
listing.

**Steps:**

1. Pin `win-b` via `POST /api/boards/<board>/pin` (single-window pin — its
   window-kill is the self-heal path).
2. Navigate to `/board/<board>` and assert `win-b` is visible.
3. Scope to the `top-bar-right` cluster: assert NO `Close pane` / `Unpin pane
   from board` button exists and the `Kill` ✕ is visible (verb discipline), then
   click the ✕.
4. Assert the `dialog` appears and its `Unpin instead` button is focused.
5. Arm a `waitForRequest` for the click-triggered `POST /api/windows/<id>/kill`,
   click the dialog's exact `Kill` button, and await that request.
6. Assert the `win-b` tile disappears from the DOM (`toHaveCount(0)`) and the
   `No panes pinned to this board yet.` empty-state becomes visible — the
   load-bearing self-heal-refetch assertion.
7. Poll `GET /api/boards` until the board disappears.

### the Kill dialog's `Unpin instead` unpins (POST /unpin) without killing the window

**What it proves:** The dialog's `Unpin instead` escape is the SAFE path: it
drives `POST /api/boards/<name>/unpin` (not `/kill`), empties the board, and
leaves the window alive on the tmux server.

**Steps:**

1. Pin `win-a` to a fresh board via `POST /api/boards/<board>/pin`.
2. Navigate to `/board/<board>` and assert `win-a` is visible.
3. Click the top-bar `Kill` ✕ (scoped to the `top-bar-right` cluster) to open
   the dialog; assert the `dialog` is visible.
4. Arm a `waitForRequest` for `POST /api/boards/<board>/unpin`, click
   `Unpin instead`, and await that request.
5. Poll `GET /api/boards` until the board disappears.
6. Assert the window id is still present in `tmux list-windows` — unpin did not
   destroy it.
