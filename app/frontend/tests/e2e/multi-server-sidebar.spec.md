# multi-server-sidebar.spec.ts

Validates that the unified sidebar renders one collapsible group per tmux
server discovered via `/api/servers`, and that cross-server navigation works
end-to-end through the URL — the core multi-server requirements from the
spec.

## Shared setup

- `beforeAll` creates a session on the primary tmux server
  (`E2E_TMUX_SERVER`, default `rk-test-e2e`) and a second tmux server
  (`rk-test-e2e-msb-<pid>-<suffix>`, where `<pid>` is the Playwright
  `process.pid` so the automatic post-sweep can parse it and the e2e teardown
  glob `rk-test-e2e*` reaps it) with its own session, each containing one named
  window (`msb-a-win`, `msb-b-win`). The second-server pattern matches
  `boards-multi-server.spec.ts`.
- `afterAll` kills the primary session and the secondary tmux server
  entirely (mirroring `boards-multi-server.spec.ts`).

## Tests

### `renders one collapsible group per server in the Sessions area`

**What it proves:** The unified sidebar enumerates every server returned by
`/api/servers` and renders a per-server collapsible group, with the
current server visually marked. Aligns with spec requirements
"One collapsible group per server" and "Current-server visual marker".

**Steps:**

1. Navigate to `/${TMUX_SERVER_A}` and wait for `Connected` (warms SSE).
2. Assert a header with `data-server='${TMUX_SERVER_A}'` is visible.
3. Assert a header with `data-server='${TMUX_SERVER_B}'` is visible.
4. Assert `data-current-server='true'` is present on the `${TMUX_SERVER_A}`
   header (since that's the matched route's server param).

### `clicking a session in the second server's group navigates to /$secondServer/...`

**What it proves:** Cross-server navigation works — a click on a session in
a non-current server's tree routes to `/{otherServer}/{windowId}` on the
2-segment route (the session is derived from the SSE snapshot, not the URL),
flipping the URL and (via the route-driven dispatch) `currentServer`.
Aligns with spec requirement "Cross-server window navigation".

**Steps:**

1. Navigate to `/${TMUX_SERVER_A}` and wait for `Connected`.
2. Click the "Expand …" button inside the second server's group header
   (default-collapsed for non-current servers).
3. Locate the session row by its accessible name `Navigate to
   ${TEST_SESSION_B}` and click it.
4. Assert the URL matches `/${TMUX_SERVER_B}/%40<N>` — server B plus the
   session's first window id (`@N`, percent-encoded; no session segment),
   via Playwright `toHaveURL` regex.
