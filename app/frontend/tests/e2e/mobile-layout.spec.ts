import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

// iPhone 14 viewport
const MOBILE_VIEWPORT = { width: 375, height: 812 };

const TEST_SESSION = `e2e-mobile-${Date.now()}`;

test.describe("Mobile layout", () => {
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

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
  });

  test("page does not overflow horizontally", async ({ page }) => {
    await page.goto("/");
    // The document should not be wider than the viewport
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(MOBILE_VIEWPORT.width);
  });

  test("bottom bar buttons fit in a single row", async ({ page }) => {
    // Wait for SSE on dashboard first, then navigate to terminal page
    await page.goto("/");
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({ timeout: 10_000 });
    await page.goto(`/${TEST_SESSION}/0`);

    const toolbar = page.getByRole("toolbar", { name: "Terminal keys" });
    await expect(toolbar).toBeVisible({ timeout: 5_000 });

    // Key buttons should be visible
    await expect(page.getByRole("button", { name: "Escape" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Tab" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Control" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Option" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Function keys" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Compose text" })).toBeVisible();

    // Toolbar should not be taller than a single row (~50px accounts for padding)
    const box = await toolbar.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.height).toBeLessThan(50);
  });

  test("top bar line 2 is hidden on mobile", async ({ page }) => {
    await page.goto("/");
    // Fixed-width toggle should not be visible on mobile
    await expect(
      page.getByRole("button", { name: "Toggle fixed terminal width" }),
    ).not.toBeVisible();
    // Action buttons should not be visible
    await expect(page.getByText("+ Session")).not.toBeVisible();
  });

  test("top bar line 2 is visible on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Toggle fixed terminal width" }),
    ).toBeVisible();
  });

  test("mobile drawer opens below top bar", async ({ page }) => {
    await page.goto("/");
    const logo = page.getByRole("button", { name: "Toggle navigation" });

    // Open drawer
    await logo.click();

    // The sidebar navigation should be visible
    const sidebar = page.getByRole("navigation", { name: "Sessions" });
    await expect(sidebar).toBeVisible();

    // Logo button should still be visible (not covered by drawer)
    await expect(logo).toBeVisible();

    // The sidebar should be below the top bar — its top should be > 0
    const sidebarBox = await sidebar.boundingBox();
    expect(sidebarBox).toBeTruthy();
    expect(sidebarBox!.y).toBeGreaterThan(0);

    // Clicking logo again should close the drawer
    await logo.click();
    await expect(sidebar).not.toBeVisible();
  });

  test("function keys popup opens and is visible", async ({ page }) => {
    // Wait for SSE on dashboard first, then navigate to terminal page
    await page.goto("/");
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({ timeout: 10_000 });
    await page.goto(`/${TEST_SESSION}/0`);

    const fnButton = page.getByRole("button", { name: "Function keys" });
    await expect(fnButton).toBeVisible({ timeout: 5_000 });
    await fnButton.click();

    const fnMenu = page.getByRole("menu", { name: "Function and navigation keys" });
    await expect(fnMenu).toBeVisible();

    // F1 and F12 should be visible
    await expect(page.getByRole("menuitem", { name: "F1", exact: true })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "F12", exact: true })).toBeVisible();

    // Navigation keys too
    await expect(page.getByRole("menuitem", { name: "PgUp" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Del" })).toBeVisible();
  });

  test("arrow pad popup opens and is visible", async ({ page }) => {
    // Wait for SSE on dashboard first, then navigate to terminal page
    await page.goto("/");
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({ timeout: 10_000 });
    await page.goto(`/${TEST_SESSION}/0`);

    const arrowButton = page.getByRole("button", { name: "Arrow keys" });
    await expect(arrowButton).toBeVisible({ timeout: 5_000 });
    await arrowButton.click();

    // Arrow buttons should be visible
    await expect(page.getByRole("button", { name: "Up arrow" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Down arrow" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Left arrow" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Right arrow" })).toBeVisible();
  });
});
