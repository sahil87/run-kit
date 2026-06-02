import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

const TMUX_SERVER_A = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";
// Second tmux server gives us a non-current tile to click during the
// switch-server portion of the headline flow. Named under the unified
// rk-test-e2e-* umbrella with the Playwright process.pid as the second-to-last
// hyphen field so the automatic post-sweep can parse it; the trailing suffix
// is a single hyphen-free token to keep the PID position unambiguous.
const TMUX_SERVER_B = `rk-test-e2e-coupling-${process.pid}-${Date.now().toString().slice(-6)}`;
const SESSION_A = `e2e-coupling-a-${Date.now()}`;
const SESSION_B = `e2e-coupling-b-${Date.now()}`;
const DESKTOP_VIEWPORT = { width: 1024, height: 768 };

test.describe("Sidebar — Server Pane / Sessions Pane coupling", () => {
  test.beforeAll(() => {
    try {
      execSync(
        `tmux -L ${TMUX_SERVER_A} new-session -d -s ${SESSION_A} -x 80 -y 24`,
        { stdio: "ignore" },
      );
      execSync(
        `tmux -L ${TMUX_SERVER_B} new-session -d -s ${SESSION_B} -x 80 -y 24`,
        { stdio: "ignore" },
      );
    } catch {
      // Best-effort
    }
  });

  test.afterAll(() => {
    try {
      execSync(`tmux -L ${TMUX_SERVER_A} kill-session -t ${SESSION_A}`, {
        stdio: "ignore",
      });
    } catch {
      // Best-effort
    }
    try {
      execSync(`tmux -L ${TMUX_SERVER_B} kill-server`, { stdio: "ignore" });
    } catch {
      // Best-effort
    }
  });

  test("opening the Server Pane narrows the Sessions tree to the current server", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto(`/${TMUX_SERVER_A}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({
      timeout: 10_000,
    });

    // Baseline: both server groups visible when the Server Pane is collapsed.
    await expect(page.locator(`[data-server='${TMUX_SERVER_A}']`).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(`[data-server='${TMUX_SERVER_B}']`).first()).toBeVisible({ timeout: 10_000 });

    // Open the Server Pane via its header.
    await page.getByRole("button", { name: /^Server/ }).click();
    await expect(page.getByRole("listbox", { name: /Tmux servers/ })).toBeVisible();

    // Tree narrows: current server's group is still rendered; the other is gone.
    await expect(page.locator(`[data-server='${TMUX_SERVER_A}']`).first()).toBeVisible();
    await expect(page.locator(`[data-server='${TMUX_SERVER_B}']`)).toHaveCount(0);
  });

  test("clicking a non-current tile in the Server Pane switches the filtered group", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto(`/${TMUX_SERVER_A}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole("button", { name: /^Server/ }).click();

    const grid = page.getByRole("listbox", { name: /Tmux servers/ });
    await expect(grid).toBeVisible();

    // Click the non-current server's tile — this is the only switch affordance
    // while the Server Pane is open (the tree no longer shows its group).
    await grid.getByRole("option", { name: new RegExp(TMUX_SERVER_B) }).click();

    await expect(page).toHaveURL(new RegExp(`/${TMUX_SERVER_B}`));
    // Tree now shows server B's group, server A's is filtered out.
    await expect(page.locator(`[data-server='${TMUX_SERVER_B}']`).first()).toBeVisible();
    await expect(page.locator(`[data-server='${TMUX_SERVER_A}']`)).toHaveCount(0);
  });

  test("closing the Server Pane restores the multi-server tree", async ({ page }) => {
    test.setTimeout(30_000);
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto(`/${TMUX_SERVER_A}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({
      timeout: 10_000,
    });

    const toggle = page.getByRole("button", { name: /^Server/ });
    await toggle.click();
    await expect(page.locator(`[data-server='${TMUX_SERVER_B}']`)).toHaveCount(0);

    // Close the Server Pane → both groups reappear.
    await toggle.click();
    await expect(page.locator(`[data-server='${TMUX_SERVER_A}']`).first()).toBeVisible();
    await expect(page.locator(`[data-server='${TMUX_SERVER_B}']`).first()).toBeVisible();
  });
});
