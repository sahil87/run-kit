import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

const TEST_SESSION = `e2e-sse-${Date.now()}`;

test.describe("SSE Connection", () => {
  test.beforeAll(() => {
    try {
      execSync(`tmux new-session -d -s ${TEST_SESSION} -x 80 -y 24`, {
        stdio: "ignore",
      });
    } catch {
      // Session may already exist
    }
  });

  test.afterAll(() => {
    try {
      execSync(`tmux kill-session -t ${TEST_SESSION}`, { stdio: "ignore" });
    } catch {
      // Best effort
    }
  });

  test("SSE delivers session data and connection status shows connected", async ({
    page,
  }) => {
    await page.goto("/");

    // Wait for the connection status dot to show "Connected"
    const status = page.locator("[aria-label='Connected']");
    await expect(status).toBeVisible({ timeout: 10_000 });

    // Verify session data populates the sidebar
    const sidebar = page.locator("nav[aria-label='Sessions']");
    await expect(sidebar).toBeVisible();

    // The self-managed test session should appear in the sidebar
    await expect(
      sidebar.locator(`text=${TEST_SESSION}`).first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});
