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
    const ts = Date.now();
    const windowName = `ext-win-${ts}`;

    await page.goto(`/${TMUX_SERVER}`);

    await expect(
      page.locator("[aria-label='Connected']"),
    ).toBeVisible({ timeout: 10_000 });

    const sidebar = page.locator("nav[aria-label='Sessions']");

    execSync(
      `tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n "${windowName}"`,
      { stdio: "ignore" },
    );

    // SSE poll interval is 2500ms; 5000ms covers ≥2 full cycles
    await expect(
      sidebar.locator(`text=${windowName}`),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("external window rename reflects without page reload", async ({
    page,
  }) => {
    const ts = Date.now();
    const srcName = `rename-src-${ts}`;
    const dstName = `rename-dst-${ts}`;

    execSync(
      `tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n "${srcName}"`,
      { stdio: "ignore" },
    );

    await page.goto(`/${TMUX_SERVER}`);

    await expect(
      page.locator("[aria-label='Connected']"),
    ).toBeVisible({ timeout: 10_000 });

    const sidebar = page.locator("nav[aria-label='Sessions']");

    // Confirm source window is visible before renaming
    await expect(
      sidebar.locator(`text=${srcName}`),
    ).toBeVisible({ timeout: 5_000 });

    execSync(
      `tmux -L ${TMUX_SERVER} rename-window -t "${TEST_SESSION}:${srcName}" "${dstName}"`,
      { stdio: "ignore" },
    );

    await expect(
      sidebar.locator(`text=${dstName}`),
    ).toBeVisible({ timeout: 5_000 });

    // Old name should be gone (SSE will have already updated by the time dstName appeared)
    await expect(
      sidebar.locator(`text=${srcName}`),
    ).not.toBeVisible({ timeout: 5_000 });
  });

  test("kill-then-create at same index does not suppress new window", async ({
    page,
  }) => {
    const ts = Date.now();
    const windowName = `kill-win-${ts}`;
    const newWindowName = `win-new-${ts}`;

    // Create the window to kill
    execSync(
      `tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n "${windowName}"`,
      { stdio: "ignore" },
    );

    await page.goto(`/${TMUX_SERVER}`);

    await expect(
      page.locator("[aria-label='Connected']"),
    ).toBeVisible({ timeout: 10_000 });

    const sidebar = page.locator("nav[aria-label='Sessions']");

    // Confirm the window is visible before killing
    await expect(
      sidebar.locator(`text=${windowName}`),
    ).toBeVisible({ timeout: 5_000 });

    // Delay the kill response so the initiating component can unmount first
    let releaseKill!: () => void;
    await page.route("**/kill", async (route) => {
      await new Promise<void>((resolve) => { releaseKill = resolve; });
      await route.continue();
    });

    await sidebar.locator(`[aria-label="Kill window ${windowName}"]`).click();

    // Wait for the confirmation dialog's Kill button to be visible before clicking.
    const confirmButton = page.locator("button:has-text('Kill')").last();
    await confirmButton.waitFor({ state: "visible" });
    await confirmButton.click();

    // Navigate away to unmount the sidebar/kill initiator while request is in-flight
    await page.goto(`/${TMUX_SERVER}`);

    // Release the kill request to resolve (component is now unmounted)
    releaseKill();

    // Create a replacement window externally — may land at the same index
    execSync(
      `tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n "${newWindowName}"`,
      { stdio: "ignore" },
    );

    // The fix ensures onAlwaysSettled clears the killed entry even though initiator was unmounted
    await expect(
      sidebar.locator(`text=${newWindowName}`),
    ).toBeVisible({ timeout: 5_000 });

    await expect(
      sidebar.locator(`text=${windowName}`),
    ).not.toBeVisible();
  });
});
