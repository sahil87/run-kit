import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-e2e";
const TEST_SESSION = `e2e-peek-${Date.now()}`;

// E2E coverage for the inline output-peek feature.
// Each test emits text to a target tmux pane (via send-keys) and then checks
// the sidebar for the last-line preview / expanded peek block.
test.describe("Sidebar Output Peek", () => {
  test.beforeAll(() => {
    try {
      execSync(
        `tmux -L ${TMUX_SERVER} new-session -d -s ${TEST_SESSION} -x 80 -y 24`,
        { stdio: "ignore" },
      );
    } catch {
      // Session may already exist
    }
    // Emit a detectable line into the first window's active pane so the SSE
    // enrichment can pick it up as lastLine.
    execSync(
      `tmux -L ${TMUX_SERVER} send-keys -t ${TEST_SESSION}:0 "echo peek-window-0-banner" C-m`,
      { stdio: "ignore" },
    );
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

  test("window row shows last-line preview from SSE", async ({ page }) => {
    await page.goto(`/${TMUX_SERVER}`);

    await expect(
      page.locator("[aria-label='Connected']"),
    ).toBeVisible({ timeout: 10_000 });

    const sidebar = page.locator("nav[aria-label='Sessions']");

    // Wait for at least one SSE tick (2.5s) after the echo. The enrichment
    // picks up the most recent non-empty line from the pane.
    await expect(
      sidebar.locator("text=peek-window-0-banner"),
    ).toBeVisible({ timeout: 8_000 });
  });

  test("toggle expands peek block showing fetched lines, collapse removes it", async ({
    page,
  }) => {
    await page.goto(`/${TMUX_SERVER}`);

    await expect(
      page.locator("[aria-label='Connected']"),
    ).toBeVisible({ timeout: 10_000 });

    const sidebar = page.locator("nav[aria-label='Sessions']");

    // Locate the peek toggle on window 0 — the chevron is in the
    // hover-reveal cluster. Aria-label disambiguates.
    const expandBtn = sidebar.getByRole("button", {
      name: /^Expand output peek/,
    }).first();
    await expect(expandBtn).toBeAttached({ timeout: 5_000 });

    // Force-click to bypass the hover-reveal opacity requirement.
    await expandBtn.click({ force: true });

    // After click, the button should become the collapse variant.
    const collapseBtn = sidebar.getByRole("button", {
      name: /^Collapse output peek/,
    }).first();
    await expect(collapseBtn).toBeVisible({ timeout: 5_000 });
    await expect(collapseBtn).toHaveAttribute("aria-expanded", "true");

    // The peek block should appear with captured lines. Our send-keys emitted
    // "peek-window-0-banner" — it must appear inside the peek block.
    await expect(
      sidebar.locator('[data-testid="window-peek"]').first(),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      sidebar.locator('[data-testid="window-peek"]').first(),
    ).toContainText("peek-window-0-banner", { timeout: 5_000 });

    // Collapse again.
    await collapseBtn.click({ force: true });
    await expect(
      sidebar.locator('[data-testid="window-peek"]').first(),
    ).toBeHidden({ timeout: 5_000 });
  });

  test("a second window's expansion is independent of the first", async ({
    page,
  }) => {
    // Create a second window with its own identifiable output.
    const secondWindowName = `peek-w2-${Date.now()}`;
    execSync(
      `tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n "${secondWindowName}"`,
      { stdio: "ignore" },
    );
    execSync(
      `tmux -L ${TMUX_SERVER} send-keys -t ${TEST_SESSION}:${secondWindowName} "echo peek-second-banner" C-m`,
      { stdio: "ignore" },
    );

    await page.goto(`/${TMUX_SERVER}`);

    await expect(
      page.locator("[aria-label='Connected']"),
    ).toBeVisible({ timeout: 10_000 });

    const sidebar = page.locator("nav[aria-label='Sessions']");

    // Wait for the second window to show up.
    await expect(
      sidebar.locator(`text=${secondWindowName}`),
    ).toBeVisible({ timeout: 8_000 });

    // Expand BOTH windows' peeks.
    const firstExpand = sidebar
      .getByRole("button", { name: /^Expand output peek/ })
      .first();
    await expect(firstExpand).toBeAttached({ timeout: 5_000 });
    await firstExpand.click({ force: true });

    // After first click, the next remaining "Expand..." is the second window.
    const secondExpand = sidebar
      .getByRole("button", { name: /^Expand output peek/ })
      .first();
    await expect(secondExpand).toBeAttached({ timeout: 5_000 });
    await secondExpand.click({ force: true });

    // Both peek blocks should be visible with their independent content.
    const peeks = sidebar.locator('[data-testid="window-peek"]');
    await expect(peeks).toHaveCount(2, { timeout: 5_000 });
  });
});
