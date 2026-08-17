import { test, expect, type Page } from "@playwright/test";
import { READY_TIMEOUT, gotoServerReady } from "./_ready";
import { TMUX_SERVER } from "./_tmux";

const MOBILE_VIEWPORT = { width: 375, height: 812 };

/**
 * Section-visibility micro-rail (iha5): four icon-only toggles (Boards ·
 * Server · Pane · Host) at the top of the sidebar `<nav>`, gating the
 * optional sections on persisted booleans. Defaults reproduce the pre-rail
 * rendering (Boards/Server on, Pane/Host off) on BOTH viewports. See
 * sidebar-section-rail.spec.md for intent + steps.
 */

/** A rail toggle by its state-stable aria-label. */
function railToggle(page: Page, section: string) {
  return page.getByRole("button", { name: `Toggle ${section} section` });
}

/** Open the mobile drawer (the sidebar's coarse-pointer home) and return it. */
async function gotoDrawer(page: Page, path: string) {
  await page.goto(path);
  const toggle = page.getByRole("button", { name: "Toggle navigation" });
  await expect(toggle).toBeVisible({ timeout: READY_TIMEOUT });
  await toggle.click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible({ timeout: READY_TIMEOUT });
  return drawer;
}

/** Re-open the drawer if a reload landed on a closed sidebar preference. */
async function ensureDrawerOpen(page: Page) {
  const drawer = page.getByRole("dialog");
  if (await drawer.isVisible().catch(() => false)) return drawer;
  const toggle = page.getByRole("button", { name: "Toggle navigation" });
  await expect(toggle).toBeVisible({ timeout: READY_TIMEOUT });
  await toggle.click();
  await expect(drawer).toBeVisible({ timeout: READY_TIMEOUT });
  return drawer;
}

test.describe("Sidebar section-visibility rail", () => {
  test("rail renders four toggles in order with the defaults (Boards/Server pressed, Pane/Host not)", async ({
    page,
  }) => {
    const sidebar = await gotoServerReady(page, TMUX_SERVER);
    const rail = sidebar.getByTestId("section-rail");
    await expect(rail).toBeVisible();

    // Exactly four toggles, in the fixed order — Sessions has none.
    const labels = await rail.getByRole("button").evaluateAll((buttons) =>
      buttons.map((b) => b.getAttribute("aria-label")),
    );
    expect(labels).toEqual([
      "Toggle Boards section",
      "Toggle Server section",
      "Toggle Pane section",
      "Toggle Host section",
    ]);
    await expect(page.getByRole("button", { name: /Sessions section/ })).toHaveCount(0);

    // Defaults: Boards/Server pressed, Pane/Host not — and the gated sections
    // render accordingly (PANE/HOST absent by default).
    await expect(railToggle(page, "Boards")).toHaveAttribute("aria-pressed", "true");
    await expect(railToggle(page, "Server")).toHaveAttribute("aria-pressed", "true");
    await expect(railToggle(page, "Pane")).toHaveAttribute("aria-pressed", "false");
    await expect(railToggle(page, "Host")).toHaveAttribute("aria-pressed", "false");
    await expect(sidebar.getByRole("button", { name: /^Pane/ })).toHaveCount(0);
    await expect(sidebar.getByRole("button", { name: /^Host/ })).toHaveCount(0);
  });

  test("toggling Pane on mounts the PANE panel and persists across reload (desktop)", async ({
    page,
  }) => {
    const sidebar = await gotoServerReady(page, TMUX_SERVER);
    await railToggle(page, "Pane").click();
    await expect(railToggle(page, "Pane")).toHaveAttribute("aria-pressed", "true");
    await expect(sidebar.getByRole("button", { name: /^Pane/ })).toBeVisible();

    await page.reload();
    const sidebarAfter = page.locator("nav[aria-label='Sessions']");
    await expect(railToggle(page, "Pane")).toHaveAttribute("aria-pressed", "true", {
      timeout: READY_TIMEOUT,
    });
    await expect(sidebarAfter.getByRole("button", { name: /^Pane/ })).toBeVisible({
      timeout: READY_TIMEOUT,
    });
  });

  test("toggling Boards off removes the section (desktop)", async ({ page }) => {
    const sidebar = await gotoServerReady(page, TMUX_SERVER);
    await expect(sidebar.getByRole("button", { name: /^Boards/ })).toBeVisible({
      timeout: READY_TIMEOUT,
    });

    await railToggle(page, "Boards").click();
    await expect(railToggle(page, "Boards")).toHaveAttribute("aria-pressed", "false");
    await expect(sidebar.getByRole("button", { name: /^Boards/ })).toHaveCount(0);
    // The rail itself always renders (not self-hideable).
    await expect(sidebar.getByTestId("section-rail")).toBeVisible();
  });

  test.describe("mobile drawer (375px, coarse)", () => {
    test.use({ hasTouch: true, viewport: MOBILE_VIEWPORT });

    test("rail defaults hold in the drawer; toggling Pane on mounts the panel and persists across reload", async ({
      page,
    }) => {
      const drawer = await gotoDrawer(page, `/${TMUX_SERVER}`);

      // Defaults in the drawer: Pane/Host off — the drawer is pure nav + footer.
      await expect(railToggle(page, "Pane")).toHaveAttribute("aria-pressed", "false");
      await expect(railToggle(page, "Host")).toHaveAttribute("aria-pressed", "false");
      await expect(drawer.getByRole("button", { name: /^Pane/ })).toHaveCount(0);
      await expect(drawer.getByRole("button", { name: /^Host/ })).toHaveCount(0);

      await railToggle(page, "Pane").click();
      await expect(drawer.getByRole("button", { name: /^Pane/ })).toBeVisible();

      await page.reload();
      const drawerAfter = await ensureDrawerOpen(page);
      await expect(drawerAfter.getByRole("button", { name: /^Pane/ })).toBeVisible({
        timeout: READY_TIMEOUT,
      });
    });
  });
});
