# legacy-scope-sweep.spec.ts

Regression spec for the scope-prefix rename's once-per-daemon migration sweep.
Pre-renamed servers in the wild (and the e2e rig — `scripts/test-e2e.sh`
pre-seed) carry legacy `@rk_role`/`@rk_url`/`@rk_note` window options and
legacy `@rk_origin`/`@rk_session_order` server options; the `legacyOptions`
table converges each onto its scope-prefixed name (`@rk_win_*` at window
scope, `@rk_srv_*` at server scope) on the first managed attach
(`POST /api/tmux/reload-config`, same hook as the color sweep). This spec
seeds a deterministic fresh set of legacy names on a scratch server and
asserts copy-then-unset at each scope.

## Shared setup

- `beforeAll` creates a dedicated scratch tmux server inside this worktree's
  socket family (`${TMUX_FAMILY}scope-sweep-<pid>-<epoch>`) with one session
  (`e2e-sweep-<timestamp>`, one window `sweep-win`) via the shared `_tmux`
  helpers — `createSession` marks the server `@rk_srv_managed`, so the
  managed-only sweep gate passes. It resolves the window's `window_id` and
  seeds the bug: window-scope `@rk_role=operator`, `@rk_url=/about:blank`,
  `@rk_note=1:e2e-legacy-note`, plus server-scope `@rk_origin=e2e-legacy`,
  `@rk_session_order=["<session>"]`. A dedicated server is required because
  the sweep runs at most once per server per daemon lifetime — the seed must
  land on a server this daemon process has never swept.
- `afterAll` kills the scratch server (`killServer`).
- `windowOption` reads `show-options -qv -w -t <window_id> <option>` on the
  scratch server (`""` = unset); `serverOption` reads `show-options -s -qv
  <option>`. Poll helpers wrap each read in `expect.poll`.

## Tests

### `window- and server-scope legacy names converge onto the scope-prefixed rk names`

**What it proves:** After one `reload-config` call, every seeded legacy name
is unset at its scope while the corresponding scope-prefixed new name carries
the exact seeded value at the same scope — the rename's copy-then-unset
semantics exercised end-to-end on the e2e subscription stack.

**Steps:**
1. Sanity-check each seed: window-scope `@rk_role=operator`,
   `@rk_url=/about:blank`, `@rk_note=1:e2e-legacy-note` and server-scope
   `@rk_origin=e2e-legacy`, `@rk_session_order=["<session>"]` read back their
   seeded values.
2. Navigate to `/<scratch-server>` and wait for `Connected` (`gotoServerReady`)
   so the spec runs on the managed-server arm, mirroring real attaches.
3. POST `/api/tmux/reload-config?server=<scratch-server>` (the
   attach-equivalent sweep hook; first call for this server runs the
   once-guarded sweep); assert the response is OK.
4. For each window-scope legacy name: poll until `show-options -w` reads it
   unset; assert the new name (`@rk_win_role`/`@rk_win_url`/`@rk_win_note`)
   reads the seeded value at window scope.
5. For each server-scope legacy name: poll until `show-options -s` reads it
   unset; assert the new name (`@rk_srv_origin`/`@rk_srv_session_order`) reads
   the seeded value at server scope.
