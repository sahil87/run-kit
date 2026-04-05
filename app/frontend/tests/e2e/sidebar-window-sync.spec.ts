import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-e2e";
// Each test file uses its own session to avoid cross-test interference.
// Tests within this file share the session and execute in order (fullyParallel: false).
const TEST_SESSION = `e2e-sync-${Date.now()}`;

test.describe("Sidebar Window Sync", () => {
  test.beforeAll(() => {
    try {
      execSync(
        `tmux -L ${TMUX_SERVER} new-session -d -s ${TEST_SESSION} -x 80 -y 24`,
        { stdio: "ignore" },
      );
    } catch {
      // Session may already exist
    }
  });

  test.afterAll(() => {
    try {
      execSync(`tmux -L ${TMUX_SERVER} kill-session -t ${TEST_SESSION}`, {
        stdio: "ignore",
      });
    } catch {
      // Best effort
    }
  });

  test("external window creation appears without page reload", async ({
    page,
  }) => {
    await page.goto(`/${TMUX_SERVER}`);

    await expect(
      page.locator("[aria-label='Connected']"),
    ).toBeVisible({ timeout: 10_000 });

    const sidebar = page.locator("nav[aria-label='Sessions']");

    execSync(
      `tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n "ext-win-1"`,
      { stdio: "ignore" },
    );

    // SSE poll interval is 2500ms; 5000ms covers ≥2 full cycles
    await expect(
      sidebar.locator("text=ext-win-1"),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("external window rename reflects without page reload", async ({
    page,
  }) => {
    // State from previous test: session has index-0 (default) + index-1 (ext-win-1)
    await page.goto(`/${TMUX_SERVER}`);

    await expect(
      page.locator("[aria-label='Connected']"),
    ).toBeVisible({ timeout: 10_000 });

    const sidebar = page.locator("nav[aria-label='Sessions']");

    // Rename ext-win-1 (created in previous test) by name
    execSync(
      `tmux -L ${TMUX_SERVER} rename-window -t "${TEST_SESSION}:ext-win-1" "renamed-win"`,
      { stdio: "ignore" },
    );

    await expect(
      sidebar.locator("text=renamed-win"),
    ).toBeVisible({ timeout: 5_000 });

    // Old name should be gone (SSE will have already updated by the time renamed-win appeared)
    await expect(
      sidebar.locator("text=ext-win-1"),
    ).not.toBeVisible({ timeout: 5_000 });
  });

  test("kill-then-create at same index does not suppress new window", async ({
    page,
  }) => {
    // State: session has index-0 (default) + index-1 (renamed-win)
    await page.goto(`/${TMUX_SERVER}`);

    await expect(
      page.locator("[aria-label='Connected']"),
    ).toBeVisible({ timeout: 10_000 });

    const sidebar = page.locator("nav[aria-label='Sessions']");

    // Derive the name of whichever window is currently first in the sidebar
    const killLabel = await sidebar
      .locator(`[aria-label^="Kill window "]`)
      .first()
      .getAttribute("aria-label");
    const windowName = killLabel?.replace("Kill window ", "") ?? "";

    // Kill the window via the sidebar (exercises the optimistic kill path)
    await sidebar.locator(`[aria-label="Kill window ${windowName}"]`).click();

    // Wait for the confirmation dialog's Kill button to be visible before clicking.
    // The sidebar kill icon and the confirmation button both contain the text "Kill";
    // waiting for the dialog button guards against clicking the wrong element.
    const confirmButton = page.locator("button:has-text('Kill')").last();
    await confirmButton.waitFor({ state: "visible" });

    // Wait for kill API to complete before creating the replacement window.
    // This ensures onSettled runs (clearing the killed entry) before the SSE
    // poll delivers the new window — the core scenario of the bug fix.
    const killDone = page.waitForResponse(
      (resp) =>
        resp.url().includes("/kill") &&
        resp.request().method() === "POST" &&
        resp.status() === 200,
    );
    await confirmButton.click();
    await killDone;

    // Create a replacement window externally — may land at the same index
    execSync(
      `tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n "win-new"`,
      { stdio: "ignore" },
    );

    await expect(
      sidebar.locator("text=win-new"),
    ).toBeVisible({ timeout: 5_000 });

    await expect(
      sidebar.locator(`text=${windowName}`),
    ).not.toBeVisible();
  });
});
