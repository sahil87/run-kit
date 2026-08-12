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

  test("theme is reachable via the chevron menu's Theme… row on mobile (the footer carries no actions)", async ({
    page,
  }) => {
    // 260812-d1at relocated the footer actions to the top bar: theme lives in
    // the overflow chevron menu's App section as a menuOnly `Theme…` row that
    // opens the theme selector (click-cycling is retired). The sidebar footer
    // carries no theme button anymore — drawer open or closed.
    await page.goto(`/${TMUX_SERVER}`);
    const chevron = page.getByRole("button", { name: "More controls" });
    await expect(chevron).toBeVisible({ timeout: 10_000 });
    // No theme button anywhere in the bar (the row is menuOnly).
    await expect(page.getByRole("button", { name: / theme$/ })).toHaveCount(0);
    // The chevron menu carries the Theme… row; clicking it opens the selector.
    await chevron.click();
    const menu = page.getByRole("menu", { name: "More controls" });
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitem", { name: /Theme…/ }).click();
    await expect(page.getByRole("dialog", { name: "Theme selector" })).toBeVisible();
    await page.keyboard.press("Escape");
    // Even with the drawer open, the footer has no theme button.
    await page.getByRole("button", { name: "Toggle navigation" }).click();
    await expect(
      page.getByRole("navigation", { name: "Sessions" }).getByRole("button", { name: / theme$/ }),
    ).toHaveCount(0);
  });

  test("theme lives in the top-bar overflow menu on desktop (never in the sidebar footer)", async ({ page }) => {
    // On desktop the sidebar is open by default — its footer is a passive
    // status row now (260812-d1at), so no theme button renders there; the
    // Theme… row sits in the top bar's chevron menu (menuOnly — never in-bar).
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
