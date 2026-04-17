import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-e2e";
const MOBILE_VIEWPORT = { width: 375, height: 812 };
const DESKTOP_VIEWPORT = { width: 1024, height: 768 };
const SETUP_SESSIONS = [
  `e2e-sp-grid-${Date.now()}-a`,
  `e2e-sp-grid-${Date.now()}-b`,
];

test.describe("Server Panel Tile Grid", () => {
  test.beforeAll(() => {
    for (const name of SETUP_SESSIONS) {
      try {
        execSync(
          `tmux -L ${TMUX_SERVER} new-session -d -s ${name} -x 80 -y 24`,
          { stdio: "ignore" },
        );
      } catch {
        // Session may already exist
      }
    }
  });

  test.afterAll(() => {
    for (const name of SETUP_SESSIONS) {
      try {
        execSync(`tmux -L ${TMUX_SERVER} kill-session -t ${name}`, {
          stdio: "ignore",
        });
      } catch {
        // Best effort
      }
    }
  });

  test("Desktop: tile grid renders with session counts", async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto(`/${TMUX_SERVER}`);

    await expect(
      page.locator("[aria-label='Connected']"),
    ).toBeVisible({ timeout: 10_000 });

    const tmuxButton = page.getByRole("button", { name: /^Tmux/ });
    await expect(tmuxButton).toBeVisible();
    await tmuxButton.click(); // expand

    const grid = page.getByRole("listbox", { name: /Tmux servers/ });
    await expect(grid).toBeVisible({ timeout: 5_000 });

    // At least one tile — the e2e tmux server itself.
    const activeOption = grid.getByRole("option", { name: new RegExp(TMUX_SERVER) });
    await expect(activeOption).toBeVisible();

    // A session-count meta line is rendered somewhere in the grid.
    await expect(grid.locator("text=/\\d+ sess/").first()).toBeVisible();
  });

  test("Desktop: active tile has aria-current", async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto(`/${TMUX_SERVER}`);

    await expect(
      page.locator("[aria-label='Connected']"),
    ).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /^Tmux/ }).click();

    const grid = page.getByRole("listbox", { name: /Tmux servers/ });
    const activeOption = grid.getByRole("option", { name: new RegExp(TMUX_SERVER) });
    await expect(activeOption).toHaveAttribute("aria-current", "true");
  });

  test("Mobile: grid renders as a single horizontal row", async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto(`/${TMUX_SERVER}`);

    // Mobile sidebar is a drawer — open it via the toggle button.
    await page.getByRole("button", { name: "Toggle navigation" }).click();
    const sidebar = page.getByRole("navigation", { name: "Sessions" });
    await expect(sidebar).toBeVisible();

    await sidebar.getByRole("button", { name: /^Tmux/ }).click();

    const grid = sidebar.getByRole("listbox", { name: /Tmux servers/ });
    await expect(grid).toBeVisible();

    const gridFlow = await grid.evaluate((el) => getComputedStyle(el).gridAutoFlow);
    expect(gridFlow).toContain("column");

    const overflowX = await grid.evaluate((el) => getComputedStyle(el).overflowX);
    expect(["auto", "scroll"]).toContain(overflowX);
  });

  test("Mobile: drag handle is hidden", async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto(`/${TMUX_SERVER}`);

    await page.getByRole("button", { name: "Toggle navigation" }).click();
    const sidebar = page.getByRole("navigation", { name: "Sessions" });
    await expect(sidebar).toBeVisible();

    await sidebar.getByRole("button", { name: /^Tmux/ }).click();

    await expect(
      sidebar.getByRole("separator", { name: /Resize.*Tmux/ }),
    ).not.toBeVisible();
  });

  test("Desktop: drag handle is visible on resizable panel", async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto(`/${TMUX_SERVER}`);

    await expect(
      page.locator("[aria-label='Connected']"),
    ).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /^Tmux/ }).click();

    await expect(
      page.getByRole("separator", { name: /Resize.*Tmux/ }),
    ).toBeVisible();
  });
});
