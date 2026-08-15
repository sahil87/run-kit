# code-folder-latch.spec.ts

Proves the per-window code-folder LATCH (change
`260813-if5d-latch-code-surface-folder`; `docs/specs/right-panel.md` § The code
lens + § Surface Registry): the code surface's folder is derived exactly once —
the first time the surface is opened for a window — and the terminal never moves
it afterwards. The backend keeps deriving `gitRoot` from the ACTIVE pane's cwd
every SSE tick, so before this change a pane switch out of the repo made the
code lens unavailable (rail button and tile strobing away) and a switch to a
different repo re-navigated the embedded editor, losing its in-flight state. The
spec drives the real thing: a window with a second pane at a non-repo cwd, where
the live derivation observably goes empty while the tile, its header, and the
iframe element all stay exactly as they were.

Scope limit (recorded per plan T006): the FOLLOW half of the rule — code-server's
own File > Open Folder navigation re-latching the folder — is unit-tested only
(`src/components/code-surface.test.tsx`), because the e2e harness has no live
code-server to navigate; the stub below serves a single static page. What e2e
covers is the seed-once rule and its consequences (pane switch, tile
close/reopen, reload).

## Shared setup

- **Readiness gate**: the status bar's `Connected` dot (`getByTestId("status-bar")`) — the desktop sidebar footer is gone, so the old nav-scoped gate no longer resolves on desktop.

- **tmux server**: the isolated `rk-test-e2e` socket (`E2E_TMUX_SERVER`),
  started by `scripts/test-e2e.sh` on port 3020. Never run Playwright directly —
  `just test-e2e code-folder-latch` / `just pw test code-folder-latch`.
- **code-server stub**: code-server is not installable in the test env, so
  `beforeAll` binds a stub HTTP server on `RK_CODE_SERVER_PORT` (default 3939 —
  the same env the test-e2e script seeds the backend with) serving a minimal
  page, making the surface REACHABLE so the iframe renders instead of the
  not-running empty state. The port is validated against the backend's 1-65535
  range first, so a bad env value fails with a named error. `workers: 1` (serial)
  is what lets this file and `code-surface.spec.ts` share the port.
- **`beforeAll`**: create one dedicated session `e2e-codelatch-<ts>` (80×24) so
  this file never collides with other specs, start the stub, then warm the dev
  server with a throwaway terminal-route page load (Vite's cold transform of the
  app + xterm graph would otherwise eat the first test's budget).
- **`afterAll`**: close the stub and kill the session.
- **`beforeEach`**: desktop viewport (1440×800) — the rail is desktop-only.
- **`makeWindow(name)`**: create a repo-cwd window (windows inherit the tmux
  server's repo-root cwd) and return its stable `@N` id.
- **`splitPaneOutsideRepo(id)`**: `tmux split-window -c /tmp` on the window. tmux
  makes the new pane ACTIVE, so the backend's active-pane-preferring
  `deriveGitRoot` starts returning `""` — the intake's screenshot scenario
  without a human switching panes.
- **`expectDerivedGitRoot(page, id, expected)`**: retrying read of the window's
  `gitRoot` in `GET /api/sessions` (`omitempty` — an absent field IS the empty
  derivation). Every test asserts the derivation actually MOVED, so a passing run
  can never be the vacuous "nothing changed anywhere" case.
- **`GIT_ROOT` / `GIT_ROOT_BASENAME` / `LATCHED_SRC`**: `git rev-parse
  --show-toplevel` from the spec process, its basename (what the tile header
  chip shows), and the expected iframe `src` `/code/?folder=<encoded root>`.
- **Locators**: the `Code tile` rail toggle (role + accessible name), the
  `surface-tile-code` tile testid, the `Code editor` iframe title, and the
  `.xterm` terminal surface.
- **Budgets**: both tests call `test.setTimeout(30_000)` — each drives several
  SSE round trips plus a real tmux split, well past the 10s default.

## Tests

### the code tile survives the active pane leaving the repo, and reopens at the latched folder
What it proves: derivation SEEDS the latch at first open and never moves the
editor again. Once the active pane leaves the repo (live `gitRoot` → `""`) the
rail affordance, the tile, its header basename, and the iframe `src` are all
unchanged, and the iframe is the SAME element — the parent never re-navigated it
(spec P3: a re-set `src` reloads the workbench even to the URL it is already
at). Closing and reopening the tile in that state re-derives nothing: intake
decision 1 explicitly rejected re-deriving on reopen.
Steps:
1. Create a repo-cwd window; navigate with `?layout=split-h:tty,code`; wait for
   the SSE connection.
2. Assert the `Code editor` iframe is visible with `src=/code/?folder=<git
   root>` and the tile header contains the repo basename; capture the iframe's
   element handle.
3. `split-window -c /tmp` on the window; poll `GET /api/sessions` until the
   window's derived `gitRoot` is `""`.
4. Assert the `Code tile` rail button, the tile, its header basename, and the
   iframe `src` are all still there; assert the iframe element handle is
   IDENTICAL to the one captured in step 2; assert the terminal is still
   visible.
5. Click the `Code tile` rail toggle to close the tile (assert hidden), click it
   again to reopen (assert visible), and assert the reopened iframe `src` and
   header basename are still the latched folder.

### a reload with the active pane outside the repo still renders the latched folder
What it proves: the latch is persistent (per-browser localStorage), not
in-memory session state. After a full reload — which discards every in-memory
trace of the seed — a `?layout=single:code` deep link still resolves the code
lens and boots the editor at the latched folder; on a derivation-only
availability rule the layout would degrade to `single:tty` and render a
terminal.
Steps:
1. Create a repo-cwd window; navigate with `?layout=single:code`; assert the
   iframe is visible at `src=/code/?folder=<git root>` (this seeds the latch).
2. `split-window -c /tmp`; poll until the derived `gitRoot` is `""`.
3. `page.reload()`.
4. Assert the `Code editor` iframe is visible at the same latched `src` and the
   tile header still contains the repo basename.
