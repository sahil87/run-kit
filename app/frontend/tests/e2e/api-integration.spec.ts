import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-e2e";
const TEST_SESSION = `e2e-test-${Date.now()}`;

test.describe("API Integration", () => {
  test.beforeAll(() => {
    // Create a self-managed tmux session for testing
    try {
      execSync(
        `tmux -L ${TMUX_SERVER} new-session -d -s ${TEST_SESSION} -x 80 -y 24`,
        { stdio: "ignore" },
      );
    } catch {
      // Session may already exist
    }
  });

  test.afterAll(() => {
    try {
      execSync(`tmux -L ${TMUX_SERVER} kill-session -t ${TEST_SESSION}`, {
        stdio: "ignore",
      });
    } catch {
      // Best effort
    }
    // Clean up the session created by the test
    try {
      execSync(`tmux -L ${TMUX_SERVER} kill-session -t e2e-new-session`, {
        stdio: "ignore",
      });
    } catch {
      // Best effort
    }
  });

  test("create session via sidebar, verify it appears, then kill it", async ({
    page,
  }) => {
    await page.goto(`/${TMUX_SERVER}`);

    // Wait for SSE to connect and dashboard to populate
    await expect(
      page.locator("[aria-label='Connected']"),
    ).toBeVisible({ timeout: 10_000 });

    // Click "+ New Session" button on the dashboard
    await page.click("button:has-text('+ New Session')");

    // Fill in session name
    const nameInput = page.locator("input[aria-label='Session name']");
    await nameInput.fill("e2e-new-session");

    // Click Create (enabled once name is filled)
    await page.click("button:has-text('Create')");

    // Verify session appears in the sidebar via SSE
    const sidebar = page.locator("nav[aria-label='Sessions']");
    await expect(
      sidebar.locator(`text=e2e-new-session`).first(),
    ).toBeVisible({ timeout: 5_000 });

    // Kill the session
    await sidebar.locator(
      "button[aria-label='Kill session e2e-new-session']",
    ).click();

    // Confirm kill
    await page.click("button:has-text('Kill')");

    // Verify session is removed from sidebar (use Navigate button as unique anchor)
    await expect(
      sidebar.getByRole("button", { name: "Navigate to e2e-new-session" }),
    ).not.toBeVisible({ timeout: 5_000 });
  });
});
