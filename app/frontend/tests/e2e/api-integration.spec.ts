import { test, expect } from "@playwright/test";
import { gotoServerReady } from "./_ready";
import { TMUX_SERVER, createSession, killSession } from "./_tmux";

const TEST_SESSION = `e2e-test-${Date.now()}`;

test.describe("API Integration", () => {
  test.beforeAll(() => {
    // Create a self-managed tmux session for testing
    createSession(TEST_SESSION);
  });

  test.afterAll(() => {
    killSession(TEST_SESSION);
  });

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
