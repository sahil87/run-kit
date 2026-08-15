# focus-restore.spec.ts

Proves the per-window focus-restore router and the code-server steal guard
(`docs/specs/right-panel.md` § The code lens). On a window switch the tile grid
remounts and nothing would otherwise reclaim DOM focus — and the code tile's
reloading iframe lets the workbench's one-shot load-time `focus()` grab win by
default, silently flipping the focused tile kind to `code` and killing the
`ttyOnly` keybindings. The restore router returns focus to the window's
RECORDED kind (`tty`/`compose`/`code`, default `tty`), and the armed steal
guard reverts the grab whenever it contradicts that recorded choice. `code` is
recorded only from genuine in-frame interaction, so a programmatic grab can
never write itself into memory.

## Shared setup

- **tmux server**: the isolated `rk-test-e2e` socket (`E2E_TMUX_SERVER`),
  started by `scripts/test-e2e.sh` on port 3020. Never run Playwright directly —
  `just test-e2e focus-restore` / `just pw test focus-restore`.
- **Workshop grab stub**: code-server is not installable in the test env, so
  `beforeAll` binds a stub HTTP server on `RK_CODE_SERVER_PORT` (default 3939 —
  the code-surface spec's pattern; `workers: 1` lets the files share the port)
  serving a page with one focusable button. 300ms after each load the page
  focuses the button ONCE (a `didFocus` flag keeps the revert's focus churn
  from retriggering it — matching the real one-shot editor-restore grab) and
  retitles its document `grabbed`. Focusing an element inside the same-origin
  frame chains focus up, making the iframe ELEMENT the parent document's
  `activeElement`, exactly like the real steal. The stub makes the backend's
  reachability probe genuinely true — no probe mock.
- **`beforeAll`**: one dedicated session `e2e-focusrestore-<ts>` (80×24), the
  stub, and a throwaway terminal-route page load to absorb Vite's cold
  transform outside any test's budget.
- **`afterAll`**: close the stub, kill the session.
- **`beforeEach`**: desktop viewport (1440×800) — restore and guard are
  desktop-only by design.
- **The code tile is opened via the `Code tile` rail toggle**, not a
  `?layout=` URL param: a rail click is a layout MUTATION persisted to
  `rk-layout:{server}:{@N}`, so the tile survives in-app window switches (a
  URL param is dropped by sidebar navigation and never persisted). The click's
  pointerdown also disarms that visit's guard, so the grab on the tile-opening
  visit stands — the revert under test happens on the away-and-back RETURN.
- **Window switches go through the sidebar row** (`switchToWindow`), never
  `page.goto`: focus memory is in-memory by design, so a reload would wipe the
  state under test.
- **`expectGrabFired(page)`**: polls the iframe's `contentDocument.title` until
  it reads `grabbed` — every focus assertion is gated on the grab having
  actually fired, so a pass can never be the vacuous "the grab never happened".
- **`expectActiveElement(page, target)`**: polls `document.activeElement` until
  it is inside `.xterm`, is the `compose-strip-input` textarea, or is the
  `Code editor` iframe element.
- **Budgets**: every test calls `test.setTimeout(30_000)` — each drives two
  in-app window switches plus iframe reloads, past the 10s default.

## Tests

### (a) a window remembered as tty reverts the workbench grab to the terminal, and typing lands in the pane
What it proves: the first visit to a window focuses the terminal on its own
(the `tty` default, replacing the accidental code-wins behavior), and after an
away-and-back switch with the code tile open, the stub's grab is reverted to
the xterm textarea and real keystrokes reach the tmux pane.
Steps:
1. Create window A running `cat` (typed STDIN echoes into the pane) and window
   B; navigate to A; assert `document.activeElement` lands inside `.xterm`
   (first visit ⇒ the `tty` default).
2. Click the `Code tile` rail toggle (a persisted mutation; its pointerdown
   disarms this visit's guard); wait for the iframe and for the grab to fire;
   assert focus is on the iframe (the grab stands after a manual open).
3. Switch to B via the sidebar, then back to A; wait for the remounted
   iframe's grab to fire again.
4. Assert `document.activeElement` is inside `.xterm` — the armed guard
   reverted the grab to the remembered (default) `tty`.
5. Type a unique marker; poll `tmux capture-pane` until it echoes — the
   keystrokes landed in the pane, not the iframe.

### (b) a window remembered as compose reverts the grab to the strip textarea
What it proves: focusing the compose textarea records `compose` for the window,
and on return the restore router focuses the strip — and the re-fired grab is
reverted to it, not to the editor or the terminal.
Steps:
1. Create windows A and B; navigate to A; wait for the terminal relay to
   attach (the strip's target and the recording seam's key).
2. Enable the strip via the `Compose text` chip; click the textarea; assert it
   holds focus (the genuine gesture that records `compose`).
3. Click the `Code tile` rail toggle; wait for the iframe and the grab (the
   click disarmed this visit's guard, so the grab stands here).
4. Switch to B via the sidebar, then back to A; wait for the remounted
   iframe's grab to fire.
5. Assert `document.activeElement` is the `compose-strip-input` textarea.

### (c) a window remembered as code lets the grab through — the grab IS the restore
What it proves: after a genuine click into the editor (the only seam that
records `code`), returning to the window lets the workbench's grab stand — the
guard never fights a recorded `code` choice, so there is no revert loop.
Steps:
1. Create windows A and B; navigate to A; open the code tile via the rail
   toggle; wait for the iframe and the grab.
2. Click the stub editor's button through the frame; assert focus lands on the
   iframe element (records `code`, disarms the guard).
3. Switch to B via the sidebar, then back to A; wait for the remounted
   iframe's grab to fire.
4. Assert `document.activeElement` is the `Code editor` iframe — the grab was
   NOT reverted.
