# sse-connection.spec.ts

Verifies the base SSE pipeline: once a tmux server is running, the UI must
report `Connected` and populate the sidebar with real session data within one
poll cycle.

## Shared setup

- Uses the tmux server in `E2E_TMUX_SERVER` (default `rk-e2e`).
- `beforeAll` creates `e2e-sse-<timestamp>` so the test has a concrete session
  to assert against; `afterAll` kills it.

## Tests

### `SSE delivers session data and connection status shows connected`

**What it proves:** SSE is wired up — connection status changes to Connected
and live session data reaches the sidebar without a page refresh.

**Steps:**
1. Navigate to `/${TMUX_SERVER}`.
2. Assert `[aria-label='Connected']` is visible within 10s (covers first
   SSE round-trip plus any initial HTTP warmup).
3. Assert `nav[aria-label='Sessions']` is visible (sidebar mounted).
4. Assert the pre-created `e2e-sse-<ts>` session name appears in the
   sidebar within 5s — confirms session list payload deserialization and
   rendering, not just the status dot.
