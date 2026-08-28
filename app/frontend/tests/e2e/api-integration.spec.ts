import { test, expect } from "@playwright/test";
import { gotoServerReady } from "./_ready";
import { TMUX_SERVER, createSession, killSession } from "./_tmux";

// Live e2e against the isolated e2e tmux server named by E2E_TMUX_SERVER
// (default `rk-test-e2e`) — no page.route mocks. beforeAll creates a
// long-lived session `e2e-test-<timestamp>` so the dashboard never renders
// the empty state mid-test; afterAll kills it.

const TEST_SESSION = `e2e-test-${Date.now()}`;

test.describe("API Integration", () => {
  test.beforeAll(() => {
    // Create a self-managed tmux session for testing
    createSession(TEST_SESSION);
  });

  test.afterAll(() => {
    killSession(TEST_SESSION);
  });

  /**
   * Proves: a tmux session created outside the UI (via the CLI) surfaces in
   * the sidebar within a couple of SSE poll cycles, and the sidebar's Kill
   * action + confirm dialog removes it cleanly end-to-end.
   *
   * Steps:
   * 1. Create `e2e-api-victim-<ts>` on the e2e tmux server.
   * 2. Navigate to /${TMUX_SERVER} and wait for the status bar's Connected dot.
   * 3. Assert the `Navigate to <sessionName>` button appears in the Sessions
   *    nav within 8s (allows for the 2.5s SSE poll interval).
   * 4. Click the sidebar's `Kill session <sessionName>` button, then the `Kill`
   *    button inside the confirm dialog (scoped to role=dialog so no sidebar
   *    row whose text contains "Kill" can match).
   * 5. Assert the `Navigate to <sessionName>` button is gone within 5s.
   * 6. finally: kill-session as best-effort cleanup.
   */
  test("session appears via SSE and can be killed through the sidebar UI", async ({
    page,
  }) => {
    // Unique session name per run avoids collisions with other tests or
    // leftover state on the shared rk-test-e2e tmux server.
    const sessionName = `e2e-api-victim-${Date.now()}`;
    createSession(sessionName);

    try {
      // Wait for SSE to connect and dashboard to populate
      const sidebar = await gotoServerReady(page, TMUX_SERVER);

      // The session created via tmux CLI should appear via SSE within a few
      // poll cycles
      const navigateBtn = sidebar.getByRole("button", {
        name: `Navigate to ${sessionName}`,
      });
      await expect(navigateBtn).toBeVisible({ timeout: 8_000 });

      // Kill via the sidebar's kill action (opens confirm dialog)
      await sidebar
        .locator(`button[aria-label='Kill session ${sessionName}']`)
        .click();

      // Click the Kill confirm button inside the dialog. Scope the selector
      // to role=dialog to avoid picking up any sidebar row whose text
      // coincidentally contains "Kill".
      await page.locator("[role='dialog'] button:has-text('Kill')").click();

      // Session row disappears (optimistic + confirmed via SSE)
      await expect(navigateBtn).not.toBeVisible({ timeout: 5_000 });
    } finally {
      killSession(sessionName);
    }
  });
});
