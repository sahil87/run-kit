# new-window-unnamed.spec.ts

Proves the frontend→API contract for change 260707-j66b (unnamed windows
auto-name to their folder): the sidebar `+ New Window` action no longer pins a
hardcoded `"zsh"` name — it issues a create request with NO `name` key, which
the backend interprets as "let tmux auto-name the window to its folder basename"
(via `automatic-rename-format '#{b:pane_current_path}'`). The tmux-native rename
behavior itself is covered by the Go config/arg-builder tests; this e2e verifies
only the deterministic request-shape seam (the e2e tmux server's config
application to `automatic-rename-format` is not guaranteed, so asserting the
rendered folder name in the sidebar would be flaky).

## Shared setup

- FILE-LEVEL `beforeAll` creates a dedicated tmux session (`e2e-unnamed-<ts>`)
  on the isolated test server (`rk-test-e2e`, or `E2E_TMUX_SERVER`) so this file
  never collides with other specs; file-level `afterAll` kills it.
- The `+ New Window` seam is the session row's
  `button[aria-label="New window in <session>"]`.

## Tests

### `+ New Window omits the name from the create request (tmux auto-names)`

**What it proves:** Clicking the session's `+ New Window` button sends
`POST /api/sessions/<session>/windows` with a body that contains NO `name` key
(previously it hardcoded `name: "zsh"`). An omitted name is the signal that tmux
should auto-name the window to its folder basename.

**Steps:**
1. Register a route interception on `**/api/sessions/*/windows*` (trailing `*`
   so the `?server=` query the client appends still matches). For a POST,
   capture the request body via `postDataJSON()` and fulfill with a 201
   `{ ok: true }` so the optimistic flow settles without mutating real tmux.
2. Navigate to `/<server>` and wait for the `Connected` indicator.
3. Locate and click the session row's `New window in <session>` button.
4. Poll until the create request has been captured, then assert the captured
   body does NOT have a `name` property.
