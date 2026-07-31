import { test, expect } from "@playwright/test";
import { gotoServerReady } from "./_ready";
import { TMUX_SERVER, createSession, killSession } from "./_tmux";

const TEST_SESSION = `e2e-sse-${Date.now()}`;

test.describe("SSE Connection", () => {
  test.beforeAll(() => {
    createSession(TEST_SESSION);
  });

  test.afterAll(() => {
    killSession(TEST_SESSION);
  });

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
