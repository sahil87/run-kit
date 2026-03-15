import { test, expect } from "@playwright/test";

// iPhone 14 viewport
const MOBILE_VIEWPORT = { width: 375, height: 812 };

test.describe("Mobile layout", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
  });

  test("page does not overflow horizontally", async ({ page }) => {
    await page.goto("/");
    // The document should not be wider than the viewport
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(MOBILE_VIEWPORT.width);
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
});
