// Responsive-layout guardrails: mobile viewports must not leak horizontal
// overflow, must keep theme switching REACHABLE (it lives in the settings
// dialog's Appearance picker and the palette — the chevron menu carries no
// Theme… row), and must expose a drawer-style navigation that sits *below*
// (not over) the top bar.
// beforeEach sets an iPhone 14-sized viewport (375×812) so every test starts
// from a mobile baseline; tests that need desktop override with
// page.setViewportSize inline.
import { test, expect } from "@playwright/test";
import { TMUX_SERVER } from "./_tmux";

// iPhone 14 viewport
const MOBILE_VIEWPORT = { width: 375, height: 812 };

test.describe("Mobile layout", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
  });

  /**
   * Proves: layout never introduces a horizontal scrollbar at 375px. A
   * regression here is usually from an absolutely-positioned element or an
   * xterm.js canvas without `overflow: hidden` on its column.
   *
   * Steps:
   * 1. Navigate to `/${TMUX_SERVER}`.
   * 2. Read `document.body.scrollWidth` via `page.evaluate`.
   * 3. Assert it is `≤ 375` (the viewport width).
   */
  test("page does not overflow horizontally", async ({ page }) => {
    await page.goto(`/${TMUX_SERVER}`);
    // The document should not be wider than the viewport
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(MOBILE_VIEWPORT.width);
  });

  /**
   * Proves: theme switching lives in the settings dialog's Appearance picker
   * and the palette: the chevron menu carries no `Theme…` row, the bar
   * carries no theme button, and the sidebar footer carries none either —
   * even with the drawer open — yet the Settings row still reaches the
   * Appearance theme picker.
   *
   * Steps:
   * 1. Navigate to `/${TMUX_SERVER}` (viewport is 375px).
   * 2. Assert the `More controls` chevron is visible, and that no `* theme`
   *    button exists in the bar.
   * 3. Open the chevron menu; assert it has NO `Theme…` menuitem; open
   *    Settings via the in-bar gear (or the menu's `Settings` row when the
   *    gear overflowed), switch to the Appearance tab, and assert the
   *    `theme-picker-trigger` renders; Escape-close the dialog.
   * 4. Click `Toggle navigation` (the hamburger) and assert the sidebar nav
   *    still contains zero theme buttons.
   */
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

  /**
   * Proves: on desktop the sidebar is open by default — its footer is a
   * passive status row and the chevron menu carries no `Theme…` row: theme
   * switching is the settings dialog + palette.
   *
   * Steps:
   * 1. Resize viewport to 1024×768.
   * 2. Navigate to `/${TMUX_SERVER}`.
   * 3. Assert zero theme buttons inside `navigation[name='Sessions']` (the
   *    sidebar) and inside the top-bar right cell
   *    (`data-testid="top-bar-right"`).
   * 4. Open the chevron menu and assert it has NO `Theme…` menuitem.
   */
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

  /**
   * Proves: the mobile hamburger opens a drawer that does NOT cover the top
   * bar — the user must always be able to close it by tapping the same
   * toggle.
   *
   * Steps:
   * 1. Navigate to `/${TMUX_SERVER}`.
   * 2. Click the `Toggle navigation` button.
   * 3. Assert `navigation[name='Sessions']` is visible.
   * 4. Assert the toggle button is still visible (not covered by drawer
   *    overlay).
   * 5. Assert the sidebar's bounding-box `y` is `> 0` — i.e. drawer starts
   *    below the top bar, not at viewport origin.
   * 6. Click the toggle again and assert the sidebar is no longer visible.
   */
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
