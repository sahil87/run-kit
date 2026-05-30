# server-create-waiting.spec.ts

Behavioural contract for the create-server flow's terminal state. When the user
creates a new tmux server from the command palette while at least one server
already exists, the UI must navigate to the new server's view and must never
leave the user on the "Server not found" screen. This is the end-to-end guard
against the transient not-found flash fixed by change `df8y` (the brief
`ServerWaiting` provisioning frame is covered by the unit/route-guard tests, not
here, since it can be too fast to assert reliably).

## Shared setup

- No `beforeAll` is needed for the pre-existing server: the e2e harness
  (`scripts/test-e2e.sh`) already seeds the default tmux server
  (`E2E_TMUX_SERVER`, default `rk-test-e2e`) with an `e2e-init` session, so the
  server list is non-empty at navigate time — the exact precondition that used
  to trip the immediate not-found flash.
- The server created through the UI is named
  `rk-test-e2e-waiting-<pid>-<suffix>`, where `<pid>` is the Playwright
  `process.pid` placed as the second-to-last hyphen field so the harness
  post-sweep can parse and reap it.
- `afterAll` `kill-server`s the created server (best-effort; the harness reaper
  sweeps `rk-test-e2e-*` sockets as a backstop).
- The test uses the desktop viewport (1024×768).

## Tests

### `creating a server shows the provisioning state, never a Server not found screen`

**What it proves:** Creating a new server via the command palette while a
pre-existing server is present navigates to the new server's route and renders
the brief `ServerWaiting` provisioning state ("Creating…") rather than the
`ServerNotFound` error screen — the exact regression this change fixes.

**Steps:**
1. Set desktop viewport and navigate to `/${PRE_EXISTING_SERVER}`.
2. Wait for the `Connected` indicator (the pre-existing server is streaming, so
   the server list is loaded and non-empty — the precondition under which the
   old `servers.length > 0` guard flashed not-found).
3. Open the command palette by poll-dispatching the `palette:open` DOM event
   until the lazily-loaded palette input (`placeholder="Type a command..."`)
   appears.
4. Fill the palette search with `Server: Create` and press Enter to open the
   create dialog.
5. Fill the `Server name` input with the new server name and press Enter.
6. Assert the page URL now matches `/${NEW_SERVER}` (immediate navigation).
7. Assert the `Creating…` provisioning text is visible (`ServerWaiting`, not
   `ServerNotFound`).
8. Assert the text `Server not found` has count `0` (never the terminal state).

## Notes

- Port 3020, isolated tmux server, best-effort teardown — same harness contract
  as the other multi-server e2e specs.
- The test asserts the provisioning frame (`Creating…`) rather than the
  waiting→view swap. The swap depends on the refreshed `/api/servers` list
  including the new server, whose timing is environment-dependent; the brief
  waiting state itself is the deterministic, robust signal that the not-found
  flash is gone. The deterministic waiting→view swap and the pending-clear
  lifecycle are covered by the unit / route-guard tests
  (`session-context.test.tsx`, `server-guard.test.tsx`).
- The palette is opened via the `palette:open` event (not `Cmd/Ctrl+K`) because
  the headless-browser modifier mapping is unreliable, and via the event rather
  than the BottomBar trigger because that trigger is not always in the desktop
  layout.
