# api-integration.spec.ts

Integration check that sessions created outside the UI surface via SSE and can
be killed through the sidebar's confirm-dialog flow end-to-end.

## Shared setup

- Each run picks the tmux server named by `E2E_TMUX_SERVER` (default `rk-e2e`).
- `beforeAll` creates a long-lived session `e2e-test-<timestamp>` so the
  dashboard never renders the empty state mid-test; `afterAll` kills it.

## Tests

### `session appears via SSE and can be killed through the sidebar UI`

**What it proves:** A tmux session created via the CLI shows up in the sidebar
within a couple of SSE poll cycles, and the sidebar's Kill action + confirm
dialog removes it cleanly.

**Steps:**
1. Run `tmux new-session -d -s e2e-api-victim-<ts>` on the e2e server.
   (Name deliberately avoids the substring "kill" — otherwise
   `button:has-text('Kill')` would match the session card's own expand
   button.)
2. Navigate to `/${TMUX_SERVER}` and wait for `[aria-label='Connected']`.
3. Assert the `Navigate to <sessionName>` button appears in the Sessions nav
   within 8s (allowing for the 2.5s SSE poll interval).
4. Click the sidebar's `Kill session <sessionName>` button.
5. Click the `Kill` button inside `[role='dialog']` (scoped to the dialog to
   avoid matching any sidebar row whose text contains "Kill").
6. Assert the `Navigate to <sessionName>` button is gone within 5s.
7. `finally` block runs `kill-session` as a best-effort cleanup.
