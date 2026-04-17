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

    // Ctrl+click performs an instant optimistic kill (no confirm dialog).
    // We use this path because the dialog path relies on a killTargetRef that
    // is reset to null synchronously on handleKill, making it unreliable to
    // observe the "killed entry persists" edge case via the UI.
    await sidebar
      .locator(`button[aria-label="Kill window ${windowName}"]`)
      .click({ modifiers: ["Control"] });

    // Killed window should disappear from the sidebar (optimistic + confirmed)
    await expect(
      sidebar.locator(`text=${windowName}`),
    ).not.toBeVisible({ timeout: 5_000 });

    // Immediately create a replacement window externally. Tmux commonly
    // assigns the next available index — which may be the same slot the
    // killed window occupied. The store's reconciliation (syncWindows) must
    // not suppress this new window just because a prior windowId was marked
    // killed.
    execSync(
      `tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n "${newWindowName}"`,
      { stdio: "ignore" },
    );

    await expect(
      sidebar.locator(`text=${newWindowName}`),
    ).toBeVisible({ timeout: 5_000 });

    await expect(
      sidebar.locator(`text=${windowName}`),
    ).not.toBeVisible();
  });
});
