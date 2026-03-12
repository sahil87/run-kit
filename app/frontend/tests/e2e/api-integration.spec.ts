import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

const TEST_SESSION = `e2e-test-${Date.now()}`;

test.describe("API Integration", () => {
  test.beforeAll(() => {
    // Create a self-managed tmux session for testing
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

  test("create session via sidebar, verify it appears, then kill it", async ({
    page,
  }) => {
    await page.goto("/");

    // Wait for the app to load with SSE data
    await page.waitForSelector("nav[aria-label='Sessions']", { timeout: 10_000 });

    // Click "+ New Session" button
    await page.click("text=+ New Session");

    // Fill in session name
    const nameInput = page.locator("input[aria-label='Session name']");
    await nameInput.fill("e2e-new-session");

    // Click Create
    await page.click("button:has-text('Create')");

    // Verify session appears in sidebar via SSE
    await expect(
      page.locator("text=e2e-new-session"),
    ).toBeVisible({ timeout: 5_000 });

    // Kill the session
    await page.click(
      `button[aria-label='Kill session e2e-new-session']`,
    );

    // Confirm kill
    await page.click("button:has-text('Kill')");

    // Verify session is removed
    await expect(
      page.locator("text=e2e-new-session"),
    ).not.toBeVisible({ timeout: 5_000 });
  });
});
