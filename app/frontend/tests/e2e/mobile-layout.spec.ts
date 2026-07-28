import { test, expect } from "@playwright/test";

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";
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

  test("theme is reachable via the sidebar drawer footer on mobile (not in the top bar or menu)", async ({
    page,
  }) => {
    // 260724-6j1v moved the theme toggle out of the top bar entirely — it lives
    // in the SIDEBAR FOOTER now. On mobile the sidebar is a drawer: with it
    // closed there is no theme button anywhere; opening the drawer (hamburger)
    // surfaces the footer's theme button. The chevron menu no longer carries a
    // Theme row either.
    await page.goto(`/${TMUX_SERVER}`);
    const chevron = page.getByRole("button", { name: "More controls" });
    await expect(chevron).toBeVisible({ timeout: 10_000 });
    // No theme button while the drawer is closed (top bar carries none).
    await expect(page.getByRole("button", { name: / theme$/ })).toHaveCount(0);
    // The chevron menu carries no Theme row anymore.
    await chevron.click();
    const menu = page.getByRole("menu", { name: "More controls" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /Theme:/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    // Open the drawer: the footer theme button is reachable there.
    await page.getByRole("button", { name: "Toggle navigation" }).click();
    await expect(page.getByRole("button", { name: / theme$/ })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("theme renders in the sidebar footer on desktop (never in the top bar)", async ({ page }) => {
    // On desktop the sidebar is open by default, so the footer theme button is
    // directly visible — while the top-bar right cell carries no theme control
    // at any width (260724-6j1v).
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(`/${TMUX_SERVER}`);
    const theme = page.getByRole("button", { name: / theme$/ });
    await expect(theme).toBeVisible({ timeout: 10_000 });
    // It lives in the sidebar nav, not the top-bar right cell.
    await expect(
      page.getByRole("navigation", { name: "Sessions" }).getByRole("button", { name: / theme$/ }),
    ).toBeVisible();
    await expect(
      page.getByTestId("top-bar-right").getByRole("button", { name: / theme$/ }),
    ).toHaveCount(0);
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
