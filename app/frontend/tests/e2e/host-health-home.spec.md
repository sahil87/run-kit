# host-health-home.spec.ts

Verifies the Cockpit host-console home: the HOST HEALTH zone on `/`
(`ServerListPage`) renders live host-global metrics from the server-independent
`useHostMetrics()` stream, above the existing tmux-server tile grid, and the
grid itself is unaffected.

## Shared setup

- `beforeAll`: create a detached tmux session (`e2e-host-health-<ts>`) on the
  isolated e2e tmux server (`E2E_TMUX_SERVER`, default `rk-test-e2e`) so the
  server-tile grid has a server to render.
- `afterAll`: kill that session (best-effort).

## Tests

### `renders live host metrics on / above the server grid`

**What it proves**: On the home route `/`, the HOST HEALTH zone is present,
shows live host metrics once the ~2.5s server-independent metrics tick arrives,
and the server-tile grid below it still renders — confirming the new zone is
additive and the metrics reach `/` without an attached server.

**Steps**:
1. Navigate to `/`.
2. Assert the `Host health` region (labelled section) is visible.
3. Assert its `Host Health` heading is visible.
4. Wait for the `cpu` metric label to appear — proving the server-neutral
   `?metrics=1` stream delivered a snapshot to `/` (the backend sends its cached
   metrics on connect) and the shared `HostMetrics` component replaced the "No
   metrics" placeholder. The 10s timeout only absorbs a cold air-compiled
   backend on the first connection.
5. Assert the `mem` metric label is also visible.
6. Assert the `+ New Server` button (always present in the server-tile grid) is
   visible — proving the existing grid still renders below the new zone.
