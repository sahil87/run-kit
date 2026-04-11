import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-e2e";
const TEST_SESSION = `e2e-panels-${Date.now()}`;

test.describe("Sidebar Host & Window Panels", () => {
  test.beforeAll(() => {
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

  test("Host panel shows real system metrics via SSE", async ({ page }) => {
    await page.goto(`/${TMUX_SERVER}`);

    // Wait for SSE connection
    await expect(
      page.locator("[aria-label='Connected']"),
    ).toBeVisible({ timeout: 10_000 });

    // Host panel header is visible and expanded (exact match avoids other "Host" buttons)
    const hostButton = page.getByRole("button", { name: /^Host/ });
    await expect(hostButton).toBeVisible();
    await expect(hostButton).toHaveAttribute("aria-expanded", "true");

    // Host panel container is the button's parent div
    const hostPanel = hostButton.locator("..");

    // Wait for metrics to arrive via SSE (at least one tick ~2.5s)
    // CPU line with label and percentage
    await expect(hostPanel.locator("text=cpu")).toBeVisible({ timeout: 8_000 });
    await expect(hostPanel.locator("text=/%/").first()).toBeVisible();

    // Memory line with label and gauge
    await expect(hostPanel.locator("text=mem")).toBeVisible();

    // Load line with label
    await expect(hostPanel.locator("text=load")).toBeVisible();

    // Disk + uptime line
    await expect(hostPanel.locator("text=dsk")).toBeVisible();
    await expect(hostPanel.locator("text=/up /")).toBeVisible();

    // Memory should show real values (not 0/0)
    await expect(hostPanel.locator("text=0/0")).not.toBeVisible();

    // Disk should show real values with G suffix
    await expect(hostPanel.locator("text=/\\d+\\/\\d+G/")).toBeVisible();
  });

  test("Window panel shows selected window info", async ({ page }) => {
    await page.goto(`/${TMUX_SERVER}`);

    await expect(
      page.locator("[aria-label='Connected']"),
    ).toBeVisible({ timeout: 10_000 });

    // Window panel header (exact match to avoid "Kill window ..." buttons)
    const windowButton = page.getByRole("button", { name: "Window", exact: true });
    await expect(windowButton).toBeVisible();
    await expect(windowButton).toHaveAttribute("aria-expanded", "true");

    const windowPanel = windowButton.locator("..");

    // Before selecting a window — shows fallback text
    await expect(
      windowPanel.locator("text=No window selected"),
    ).toBeVisible();

    // Click the session's "Navigate to" button — selects the first window
    const sidebar = page.locator("nav[aria-label='Sessions']");
    const navButton = sidebar.getByRole("button", {
      name: new RegExp(`Navigate to ${TEST_SESSION}`),
    });
    await expect(navButton).toBeVisible({ timeout: 5_000 });
    await navButton.click();

    // After selecting — should show cwd and win lines
    // Use regex to avoid matching "Window" button text (case-insensitive text= would match)
    await expect(windowPanel.locator("text=/^cwd /")).toBeVisible({ timeout: 3_000 });
    await expect(windowPanel.locator("text=/^win /")).toBeVisible();
  });

  test("Collapsible panel toggle and persistence", async ({ page }) => {
    await page.goto(`/${TMUX_SERVER}`);

    await expect(
      page.locator("[aria-label='Connected']"),
    ).toBeVisible({ timeout: 10_000 });

    // Wait for metrics so Host panel has content
    const hostButton = page.getByRole("button", { name: /^Host/ });
    await expect(hostButton).toBeVisible();
    await expect(hostButton).toHaveAttribute("aria-expanded", "true");

    const hostPanel = hostButton.locator("..");
    await expect(hostPanel.locator("text=cpu")).toBeVisible({ timeout: 8_000 });

    // Collapse the Host panel
    await hostButton.click();
    await expect(hostButton).toHaveAttribute("aria-expanded", "false");

    // Verify localStorage was set
    const stored = await page.evaluate(() =>
      localStorage.getItem("runkit-panel-host"),
    );
    expect(stored).toBe("false");

    // Reload page — panel should remain collapsed
    await page.reload();
    await expect(
      page.locator("[aria-label='Connected']"),
    ).toBeVisible({ timeout: 10_000 });

    const hostButtonAfter = page.getByRole("button", { name: /^Host/ });
    await expect(hostButtonAfter).toHaveAttribute("aria-expanded", "false");

    // Expand it back
    await hostButtonAfter.click();
    await expect(hostButtonAfter).toHaveAttribute("aria-expanded", "true");

    // Content reappears
    await expect(
      hostButtonAfter.locator("..").locator("text=cpu"),
    ).toBeVisible({ timeout: 8_000 });

    // Clean up localStorage for other tests
    await page.evaluate(() => localStorage.removeItem("runkit-panel-host"));
  });

  test("Host panel metrics update over multiple SSE ticks", async ({ page }) => {
    await page.goto(`/${TMUX_SERVER}`);

    await expect(
      page.locator("[aria-label='Connected']"),
    ).toBeVisible({ timeout: 10_000 });

    const hostPanel = page.getByRole("button", { name: /^Host/ }).locator("..");

    // Wait for first metrics tick
    await expect(hostPanel.locator("text=cpu")).toBeVisible({ timeout: 8_000 });

    // Wait for at least 2 SSE ticks (2.5s each = ~5s) and verify content is still present
    await page.waitForTimeout(5_500);

    // Panel still shows metrics (not stale or disconnected)
    await expect(hostPanel.locator("text=cpu")).toBeVisible();
    await expect(hostPanel.locator("text=mem")).toBeVisible();
    await expect(hostPanel.locator("text=load")).toBeVisible();
    await expect(hostPanel.locator("text=dsk")).toBeVisible();
  });
});
