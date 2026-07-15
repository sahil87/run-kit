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

  test("theme is reachable via the overflow menu on mobile (not a bare in-bar button)", async ({
    page,
  }) => {
    // 260715-h1ck removed the `hidden sm:flex` cliff: below `sm` the theme
    // control no longer VANISHES — it overflows into the always-visible chevron
    // menu (mobile gains theme/refresh/help access it previously lost entirely).
    // At 375px the narrow right track overflows the L3 controls into the menu,
    // so there is no visible in-bar theme button; opening the chevron surfaces a
    // "Theme: {current}" menu row.
    await page.goto(`/${TMUX_SERVER}`);
    const chevron = page.getByRole("button", { name: "More controls" });
    await expect(chevron).toBeVisible({ timeout: 10_000 });
    // No IN-BAR theme button. `getByRole` matches the ACCESSIBILITY tree, which
    // excludes the always-present measurement probe (it is `aria-hidden`) — so a
    // count of 0 here means the in-bar theme toggle genuinely overflowed into the
    // menu (a `:visible` CSS filter does NOT work: the probe sits off-screen at
    // -9999px but Playwright still considers a sized element "visible").
    await expect(page.getByRole("button", { name: / theme$/ })).toHaveCount(0);
    // The theme control is reachable in the menu instead.
    await chevron.click();
    const menu = page.getByRole("menu", { name: "More controls" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /Theme:/ })).toBeVisible();
  });

  test("theme renders as an in-bar button on desktop", async ({ page }) => {
    // At a wide desktop width the L3 controls fit in-bar (registry-driven
    // overflow, 260715-h1ck) — the theme toggle renders directly in the bar,
    // visible and interactive without opening the chevron menu. Scope to the
    // right cell's VISIBLE bar and exclude the hidden measurement probe (which
    // is `inert` + off-screen) so the query resolves to a single element.
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(`/${TMUX_SERVER}`);
    // `getByRole` matches the accessibility tree, excluding the `aria-hidden`
    // measurement probe copy — so this resolves to the single in-bar theme toggle
    // (a `:visible` CSS filter would also match the sized off-screen probe).
    await expect(page.getByRole("button", { name: / theme$/ })).toBeVisible({
      timeout: 10_000,
    });
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
