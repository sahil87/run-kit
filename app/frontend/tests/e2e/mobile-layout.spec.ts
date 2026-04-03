import { test, expect } from "@playwright/test";

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-e2e";
// iPhone 14 viewport
const MOBILE_VIEWPORT = { width: 375, height: 812 };

test.describe("Mobile layout", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
  });

  test("page does not overflow horizontally", async ({ page }) => {
    await page.goto(`/${TMUX_SERVER}`);
    // The document should not be wider than the viewport
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(MOBILE_VIEWPORT.width);
  });

  test("top bar line 2 is hidden on mobile", async ({ page }) => {
    await page.goto(`/${TMUX_SERVER}`);
    // Theme toggle should not be visible on mobile (hidden sm:flex)
    await expect(
      page.getByRole("button", { name: /theme/i }),
    ).not.toBeVisible();
  });

  test("top bar line 2 is visible on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(`/${TMUX_SERVER}`);
    // Theme toggle is always rendered on desktop (hidden sm:flex, visible at >=640px)
    await expect(
      page.getByRole("button", { name: /theme/i }),
    ).toBeVisible();
  });

  test("mobile drawer opens below top bar", async ({ page }) => {
    await page.goto(`/${TMUX_SERVER}`);
    const toggle = page.getByRole("button", { name: "Toggle navigation" });

    // Open drawer
    await toggle.click();

    // The sidebar navigation should be visible
    const sidebar = page.getByRole("navigation", { name: "Sessions" });
    await expect(sidebar).toBeVisible();

    // Toggle button should still be visible (not covered by drawer)
    await expect(toggle).toBeVisible();

    // The sidebar should be below the top bar — its top should be > 0
    const sidebarBox = await sidebar.boundingBox();
    expect(sidebarBox).toBeTruthy();
    expect(sidebarBox!.y).toBeGreaterThan(0);

    // Clicking toggle again should close the drawer
    await toggle.click();
    await expect(sidebar).not.toBeVisible();
  });
});
