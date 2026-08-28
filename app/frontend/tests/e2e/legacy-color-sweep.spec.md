# legacy-color-sweep.spec.ts

Regression spec for the session-scoped legacy-`@color` leak. tmux format
expansion resolves `#{@foo}` by walking pane → window → session → global, so a
`@color` set at session scope used to tint every window row in the session,
and the window picker's clear was a silent no-op (the window scope never held
the key). Window colors now read the scope-named `@rk_win_color`, so the
legacy key no longer leaks into reads, and the once-per-daemon legacy sweep
(hooked at the managed-conf reload seams) purges the wrong-scope key without
copying its value forward.

## Shared setup

- `beforeAll` creates a dedicated scratch tmux server inside this worktree's
  socket family (`${TMUX_FAMILY}legacy-<pid>-<epoch>`) with one session
  (`e2e-legacy-<timestamp>`, one window `legacy-win`) via the shared `_tmux`
  helpers — `createSession` marks the server `@rk_managed`, so the managed-only
  sweep gate passes. It then seeds the bug: `set-option -t =<session>: @color
  1+3` (SESSION scope, exact-match target). A dedicated server is required
  because the sweep runs at most once per server per daemon lifetime — the
  seed must land on a server this daemon process has never swept.
- `afterAll` kills the scratch server (`killServer`).
- `expectSessionOption` polls `show-options -qv -t =<session>: <option>` on the
  scratch server until it reads the expected value (`""` = unset).

## Tests

### `a session-scoped legacy @color tints nothing, the sweep purges it, and the picker clear stays a no-op`

**What it proves:** A session-scoped legacy `@color` no longer tints any window
row (the snapshot's window `color` field reads `@rk_win_color`, which the
legacy key can never reach, and the row button carries no inline tint);
triggering the reload-config sweep hook purges the wrong-scope key and copies
nothing forward (no `@rk_ses_color` appears); and the picker's `Clear color`
against the purged key leaves the row uncolored — the clear that used to
silently fail against the inherited tint.

**Steps:**
1. Sanity-check the seed: `@color` reads `1+3` at session scope on the scratch
   server.
2. Navigate to `/<scratch-server>` and wait for `Connected` and the session
   row; `resolveWindow` the window and assert its `color` field is empty.
3. Assert the row button's inline `background-color` style is empty (the tint
   is an inline style applied only for a known color value).
4. POST `/api/tmux/reload-config?server=<scratch-server>` (an attach-equivalent
   sweep hook; first call for this server runs the once-guarded sweep); assert
   the response is OK.
5. Poll until `@color` reads unset at session scope; assert the session gained
   no `@rk_ses_color` (wrong-scope values are purged, never copied) and the
   window's `color` field is still empty.
6. Open the row's `Label picker` from the `Set tab label` zone; click
   `Clear color`; poll the snapshot until the window's `color` field is empty
   and assert the row button still carries no inline tint.
7. Close the picker via the `Close picker` (✕) cell.
