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
  });

  test("session appears via SSE and can be killed through the sidebar UI", async ({
    page,
  }) => {
    // Unique session name per run avoids collisions with other tests or
    // leftover state on the shared rk-e2e tmux server. Note: the name must
    // not contain "Kill" — `button:has-text('Kill')` would otherwise match
    // the session card's expand button and click the wrong target.
    const sessionName = `e2e-api-victim-${Date.now()}`;
    execSync(
      `tmux -L ${TMUX_SERVER} new-session -d -s ${sessionName} -x 80 -y 24`,
      { stdio: "ignore" },
    );

    try {
      await page.goto(`/${TMUX_SERVER}`);

      // Wait for SSE to connect and dashboard to populate
      await expect(
        page.locator("[aria-label='Connected']"),
      ).toBeVisible({ timeout: 10_000 });

      const sidebar = page.locator("nav[aria-label='Sessions']");

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
      try {
        execSync(`tmux -L ${TMUX_SERVER} kill-session -t ${sessionName}`, {
          stdio: "ignore",
        });
      } catch {
        // Best effort — may already be gone
      }
    }
  });
});
