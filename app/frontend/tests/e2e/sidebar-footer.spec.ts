import { test, expect } from "@playwright/test";
import { gotoServerReady } from "./_ready";

/**
 * Sidebar footer global-chrome row (260724-6j1v): the connection dot + version
 * readout sit LEFT (passive readouts) and Help · Theme · Gear sit RIGHT
 * (actions) at the very bottom of the sidebar — the chrome that moved down
 * from the top bar. Runs against the isolated e2e server (`just test-e2e`),
 * desktop viewport (the sidebar is open by default there).
 */

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";

const sidebar = (page: import("@playwright/test").Page) =>
  page.getByRole("navigation", { name: "Sessions" });

test.describe("Sidebar footer chrome (260724-6j1v)", () => {
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

  test("renders Help · Theme · Gear as borderless right-cluster actions", async ({ page }) => {
    await gotoServerReady(page, TMUX_SERVER);
    const nav = sidebar(page);

    // Help — an anchor to the shared docs URL, safe new tab.
    const help = nav.getByRole("link", { name: "Help — run-kit docs" });
    await expect(help).toBeVisible();
    await expect(help).toHaveAttribute("href", "https://shll.ai/run-kit");
    await expect(help).toHaveAttribute("target", "_blank");
    await expect(help).toHaveAttribute("rel", /noopener/);
    await expect(help).toHaveAttribute("rel", /noreferrer/);
    await expect(help).not.toHaveAttribute("title", /.*/);

    // Theme — present with its mode label (cycles on click, asserted below).
    await expect(nav.getByRole("button", { name: / theme$/ })).toBeVisible();

    // Gear — the settings trigger (o7q8), still present as the last action.
    await expect(nav.getByRole("button", { name: "Open settings" })).toBeVisible();
  });

  test("theme button cycles the mode from the footer", async ({ page }) => {
    await gotoServerReady(page, TMUX_SERVER);
    const theme = sidebar(page).getByRole("button", { name: / theme$/ });
    const before = await theme.getAttribute("aria-label");
    await theme.click();
    // The aria-label follows the effective mode, so a successful cycle
    // changes it (system → light → dark → system).
    await expect
      .poll(async () => sidebar(page).getByRole("button", { name: / theme$/ }).getAttribute("aria-label"))
      .not.toBe(before);
    // Cycle twice more to land back on the original preference (no persistent
    // theme drift for later specs).
    await sidebar(page).getByRole("button", { name: / theme$/ }).click();
    await sidebar(page).getByRole("button", { name: / theme$/ }).click();
    await expect
      .poll(async () => sidebar(page).getByRole("button", { name: / theme$/ }).getAttribute("aria-label"))
      .toBe(before);
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

  test("gear opens the settings dialog from the footer", async ({ page }) => {
    await gotoServerReady(page, TMUX_SERVER);
    await sidebar(page).getByRole("button", { name: "Open settings" }).click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible({
      timeout: 10_000,
    });
  });
});
