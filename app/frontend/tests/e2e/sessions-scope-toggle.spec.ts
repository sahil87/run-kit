import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

const TMUX_SERVER_A = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";
// Second tmux server gives us a non-current group to observe while toggling
// scope. Named under the unified rk-test-e2e-* umbrella with the Playwright
// process.pid as the second-to-last hyphen field so the automatic post-sweep
// can parse it; the trailing suffix is a single hyphen-free token to keep the
// PID position unambiguous.
const TMUX_SERVER_B = `rk-test-e2e-scope-${process.pid}-${Date.now().toString().slice(-6)}`;
const SESSION_A = `e2e-scope-a-${Date.now()}`;
const SESSION_B = `e2e-scope-b-${Date.now()}`;
const DESKTOP_VIEWPORT = { width: 1024, height: 768 };

test.describe("Sidebar — sessions-pane scope toggle", () => {
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

  test("toggling scope to current narrows the Sessions tree; toggling back restores it", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto(`/${TMUX_SERVER_A}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({
      timeout: 10_000,
    });

    // Baseline: default scope `all` → both server groups render.
    await expect(page.locator(`[data-server='${TMUX_SERVER_A}']`).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(`[data-server='${TMUX_SERVER_B}']`).first()).toBeVisible({ timeout: 10_000 });

    const chip = page.getByRole("button", { name: "Toggle sessions scope" });
    await expect(chip).toHaveText("ALL");

    // Toggle to `current`: tree narrows to the current server's group.
    await chip.click();
    await expect(chip).toHaveText("CUR");
    await expect(page.locator(`[data-server='${TMUX_SERVER_A}']`).first()).toBeVisible();
    await expect(page.locator(`[data-server='${TMUX_SERVER_B}']`)).toHaveCount(0);

    // Toggle back to `all`: the multi-server tree returns.
    await chip.click();
    await expect(chip).toHaveText("ALL");
    await expect(page.locator(`[data-server='${TMUX_SERVER_A}']`).first()).toBeVisible();
    await expect(page.locator(`[data-server='${TMUX_SERVER_B}']`).first()).toBeVisible();
  });

  test("scope persists across reload", async ({ page }) => {
    test.setTimeout(30_000);
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto(`/${TMUX_SERVER_A}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator(`[data-server='${TMUX_SERVER_B}']`).first()).toBeVisible({ timeout: 10_000 });

    const chip = page.getByRole("button", { name: "Toggle sessions scope" });
    await chip.click();
    await expect(page.locator(`[data-server='${TMUX_SERVER_B}']`)).toHaveCount(0);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({
      timeout: 10_000,
    });

    // Persisted `current` scope survives the reload: still narrowed, chip
    // still reads CUR.
    await expect(
      page.getByRole("button", { name: "Toggle sessions scope" }),
    ).toHaveText("CUR");
    await expect(page.locator(`[data-server='${TMUX_SERVER_A}']`).first()).toBeVisible();
    await expect(page.locator(`[data-server='${TMUX_SERVER_B}']`)).toHaveCount(0);
  });

  test("SERVER panel expansion does not affect the Sessions tree (delink)", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto(`/${TMUX_SERVER_A}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({
      timeout: 10_000,
    });

    // The SERVER panel now defaults OPEN — the tile grid is visible on load —
    // and the tree still shows every server's group (the old coupling would
    // have narrowed it). Expansion state is asserted via the header's
    // aria-expanded: a collapsed panel merely clips its content (height 0 +
    // overflow hidden), which Playwright still counts as "visible".
    const toggle = page.getByRole("button", { name: /^Server/ });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("listbox", { name: /Tmux servers/ })).toBeVisible();
    await expect(page.locator(`[data-server='${TMUX_SERVER_A}']`).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(`[data-server='${TMUX_SERVER_B}']`).first()).toBeVisible({ timeout: 10_000 });

    // Collapse the panel: the tree is unchanged.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(`[data-server='${TMUX_SERVER_A}']`).first()).toBeVisible();
    await expect(page.locator(`[data-server='${TMUX_SERVER_B}']`).first()).toBeVisible();

    // Re-expand: still unchanged.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(`[data-server='${TMUX_SERVER_A}']`).first()).toBeVisible();
    await expect(page.locator(`[data-server='${TMUX_SERVER_B}']`).first()).toBeVisible();
  });
});
