import { test, expect } from "@playwright/test";
import { TMUX_SERVER } from "./_tmux";

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

  test("theme is reachable via the settings dialog on mobile (no chrome theme button anywhere)", async ({
    page,
  }) => {
    // Theme switching lives in the settings dialog's Appearance picker and
    // the palette (260819-qkow) — the chevron menu carries no Theme… row and
    // the sidebar footer carries no theme button, drawer open or closed.
    await page.goto(`/${TMUX_SERVER}`);
    const chevron = page.getByRole("button", { name: "More controls" });
    await expect(chevron).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: / theme$/ })).toHaveCount(0);
    await chevron.click();
    const menu = page.getByRole("menu", { name: "More controls" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /Theme…/ })).toHaveCount(0);
    // Settings reaches the Appearance theme picker. The gear is a fit
    // candidate: when it still fits in-bar at 375px there is no menu row, so
    // take whichever surface rendered.
    await page.keyboard.press("Escape");
    const gear = page.getByRole("button", { name: "Open settings" });
    if (await gear.isVisible()) {
      await gear.click();
    } else {
      await chevron.click();
      await menu.getByRole("menuitem", { name: "Settings" }).click();
    }
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("tab", { name: "Appearance" }).click();
    await expect(dialog.getByTestId("theme-picker-trigger")).toBeVisible();
    await page.keyboard.press("Escape");
    // Even with the drawer open, the footer has no theme button.
    await page.getByRole("button", { name: "Toggle navigation" }).click();
    await expect(
      page.getByRole("navigation", { name: "Sessions" }).getByRole("button", { name: / theme$/ }),
    ).toHaveCount(0);
  });

  test("no chrome theme control on desktop either (sidebar footer and top bar both clean)", async ({ page }) => {
    // On desktop the sidebar is open by default — its footer is a passive
    // status row (260812-d1at) and the chevron menu carries no Theme… row
    // (260819-qkow): theme switching is the settings dialog + palette.
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(`/${TMUX_SERVER}`);
    await expect(
      page.getByRole("navigation", { name: "Sessions" }).getByRole("button", { name: / theme$/ }),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("top-bar-right").getByRole("button", { name: / theme$/ }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "More controls" }).click();
    await expect(
      page.getByRole("menu", { name: "More controls" }).getByRole("menuitem", { name: /Theme…/ }),
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
