import { test, expect } from "@playwright/test";
import { gotoServerReady } from "./_ready";
import { TMUX_SERVER, createSession, killSession } from "./_tmux";

/**
 * Base SSE pipeline: once a tmux server is running, the UI must report
 * `Connected` and populate the sidebar with real session data within one
 * poll cycle.
 *
 * Shared setup: uses the tmux server in E2E_TMUX_SERVER (default
 * `rk-test-e2e`). beforeAll creates `e2e-sse-<timestamp>` so the test has a
 * concrete session to assert against; afterAll kills it.
 */

const TEST_SESSION = `e2e-sse-${Date.now()}`;

test.describe("SSE Connection", () => {
  test.beforeAll(() => {
    createSession(TEST_SESSION);
  });

  test.afterAll(() => {
    killSession(TEST_SESSION);
  });

  /**
   * Proves: SSE is wired up — connection status changes to Connected and
   * live session data reaches the sidebar without a page refresh.
   *
   * Steps:
   * 1. Navigate to /${TMUX_SERVER} and wait for the
   *    [aria-label='Connected'] dot via the shared gotoServerReady helper
   *    (READY_TIMEOUT: 10s local, 20s on CI — covers the first SSE
   *    round-trip plus any initial HTTP warmup).
   * 2. Assert nav[aria-label='Sessions'] is visible (sidebar mounted).
   * 3. Assert the pre-created e2e-sse-<ts> session name appears in the
   *    sidebar within 5s — confirms session list payload deserialization
   *    and rendering, not just the status dot.
   */
  test("SSE delivers session data and connection status shows connected", async ({
    page,
  }) => {
    // Wait for the connection status dot to show "Connected"
    const sidebar = await gotoServerReady(page, TMUX_SERVER);

    // Verify session data populates the sidebar
    await expect(sidebar).toBeVisible();

    // The self-managed test session should appear in the sidebar
    await expect(
      sidebar.locator(`text=${TEST_SESSION}`).first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});
