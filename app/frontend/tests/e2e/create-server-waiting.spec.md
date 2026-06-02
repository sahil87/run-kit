# create-server-waiting.spec.ts

Behavioural contract for the fix to the transient "Server not found" flash
after creating a tmux server (change `260602-3i5d`). Validates that creating a
server through the command palette lands on the working server view without
ever rendering the "Server not found" error screen, and that the not-found
screen is still shown for a genuinely-unknown server URL.

## Shared setup

- No `beforeAll` session setup is needed — the first test relies only on the
  always-present e2e tmux server (`E2E_TMUX_SERVER`, default `rk-test-e2e`)
  being non-empty so the server list is loaded and non-empty (the exact
  precondition under which the old `servers.length > 0` guard misfired).
- `afterAll` `kill-server`s the server the test created. The name is built
  under the `rk-test-e2e-*` umbrella with the Playwright `process.pid` as the
  second-to-last hyphen field, so the global teardown glob also reaps it if
  `afterAll` is missed.
- Desktop viewport (1024×768).

## Tests

### `creating a server lands on the server view, never flashing 'Server not found'`

**What it proves:** When the user creates a new server via the command palette
while at least one server already exists (list loaded and non-empty), the UI
navigates to the new server and reaches the connected server view without the
"Server not found" error screen appearing — the pending-marker + three-way
guard suppress the false negative that the old binary guard produced.

**Steps:**
1. Navigate to the existing e2e server (`/${TMUX_SERVER_A}`) and wait for the
   `Connected` indicator (list is now loaded and non-empty).
2. Open the command palette (`Meta+k`), type `Server: Create`, press Enter.
3. In the "Create tmux server" dialog, fill the `Server name` field with the
   freshly-generated server name and click the `Create` button.
4. Assert the URL navigates to `/${CREATED_SERVER}`.
5. Race two outcomes against each other — whichever appears first wins: the
   `Connected` indicator becoming visible (working server view loaded) vs. the
   "Server not found" text becoming visible. Each side swallows its own 15s
   timeout so the loser can't surface as an unhandled rejection.
6. Assert the race winner is `connected`, not `not-found`. Racing (rather than
   asserting `toHaveCount(0)` only after `Connected` settles) is what lets the
   test catch a *transient* flash: if the error screen renders even briefly
   during navigation it wins the race and the test fails.

### `a genuinely-unknown server URL still shows 'Server not found'`

**What it proves:** The not-found screen is preserved for real typos / deleted
servers — a name that was never created and is not pending fails fast once the
server list has loaded.

**Steps:**
1. Navigate directly to a randomly-generated, never-created server URL.
2. Assert the "Server not found" screen becomes visible.
