import { test, expect } from "@playwright/test";
import { gotoServerReady } from "./_ready";
import { TMUX_SERVER } from "./_tmux";

/**
 * Sidebar footer status row (260812-d1at): with the four action chips
 * relocated to the top bar (Settings as a right-cluster gear chip; Help /
 * Keyboard / Theme as chevron-menu App-section rows), the footer is a PASSIVE
 * row — connection dot + version readout LEFT, a quiet status/hints slot
 * RIGHT (empty at rest; unit tests cover the update-available hint). Runs
 * against the isolated e2e server (`just test-e2e`), desktop viewport (the
 * sidebar is open by default there).
 */

const sidebar = (page: import("@playwright/test").Page) =>
  page.getByRole("navigation", { name: "Sessions" });

test.describe("Sidebar footer status row (260812-d1at)", () => {
  test("hosts the connection dot (left readout) — and the top bar carries none", async ({
    page,
  }) => {
    await gotoServerReady(page, TMUX_SERVER);
    // gotoServerReady already waited for [aria-label='Connected'] — prove it
    // resolved INSIDE the sidebar footer, not the top bar.
    await expect(sidebar(page).locator("[aria-label='Connected']")).toBeVisible();
    await expect(
      page.getByTestId("top-bar-right").locator('[role="status"]'),
    ).toHaveCount(0);
  });

  test("the four action chips are GONE from the footer (relocated to the top bar)", async ({
    page,
  }) => {
    await gotoServerReady(page, TMUX_SERVER);
    const nav = sidebar(page);
    // Help · Keyboard · Theme · Gear no longer render anywhere in the sidebar.
    await expect(nav.getByRole("link", { name: /Help/ })).toHaveCount(0);
    await expect(nav.getByRole("button", { name: "Keyboard shortcuts" })).toHaveCount(0);
    await expect(nav.getByRole("button", { name: / theme$/ })).toHaveCount(0);
    await expect(nav.getByRole("button", { name: "Open settings" })).toHaveCount(0);
  });

  test("version readout copies the displayed version form", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await gotoServerReady(page, TMUX_SERVER);
    const version = sidebar(page).getByRole("button", { name: /RunKit .*\(copy\)/ });
    // The readout renders only once the daemon reported a version; the SSE
    // `version` event always precedes `Connected`-gated data on this route.
    await expect(version).toBeVisible({ timeout: 10_000 });
    const text = (await version.textContent())?.trim() ?? "";
    await version.click();
    // A numeric version copies its displayed `v…` form; the dev sentinel is a
    // bare `dev` (never `vdev`) and copies as-is.
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(text);
  });
});
