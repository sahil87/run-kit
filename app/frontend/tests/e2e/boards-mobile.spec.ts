import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-e2e";
const TEST_SESSION = `e2e-board-mobile-${Date.now()}`;
const BOARD_NAME = `mob${Date.now().toString().slice(-6)}`;

test.describe("Boards: mobile carousel", () => {
  test.beforeAll(() => {
    try {
      execSync(
        `tmux -L ${TMUX_SERVER} new-session -d -s ${TEST_SESSION} -x 80 -y 24 -n m-a`,
        { stdio: "ignore" },
      );
      execSync(
        `tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n m-b`,
        { stdio: "ignore" },
      );
      execSync(
        `tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n m-c`,
        { stdio: "ignore" },
      );
    } catch {
      // Best-effort
    }
  });

  test.afterAll(() => {
    try {
      execSync(`tmux -L ${TMUX_SERVER} kill-session -t ${TEST_SESSION}`, {
        stdio: "ignore",
      });
    } catch {
      // Best-effort
    }
  });

  test("at 375x812 the board renders one pane card at a time with pagination dots", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    await page.setViewportSize({ width: 375, height: 812 });

    // Belt-and-suspenders: ensure the session has 3 windows even if a
    // previous run left only some of them. Idempotent: tmux ignores
    // duplicate window names if the session/window already has them, but
    // `new-window` creates fresh ones — so we tolerate failure.
    const requiredWindows = ["m-a", "m-b", "m-c"];
    for (const name of requiredWindows) {
      try {
        execSync(
          `tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n "${name}"`,
          { stdio: "ignore" },
        );
      } catch {
        // ignore — window may already exist
      }
    }

    // Pin three windows via the HTTP API directly so the test doesn't depend
    // on the mobile drawer dance.
    const ids = execSync(
      `tmux -L ${TMUX_SERVER} list-windows -t ${TEST_SESSION} -F "#{window_id}"`,
    )
      .toString()
      .trim()
      .split("\n");
    expect(ids.length).toBeGreaterThanOrEqual(3);
    for (const id of ids.slice(0, 3)) {
      const r = await page.request.post(`/api/boards/${BOARD_NAME}/pin`, {
        data: { server: TMUX_SERVER, windowId: id },
      });
      expect(r.ok()).toBeTruthy();
    }

    await page.goto(`/board/${BOARD_NAME}`);

    // Pagination strip: three dots with the first one highlighted. (The
    // strip lives outside the AppShell's connection indicator, which is
    // hidden by Tailwind at this viewport — no need to wait for it here.)
    const dots = page.locator("[aria-label^='pane ']");
    await expect(dots).toHaveCount(3, { timeout: 10_000 });
    await expect(dots.nth(0)).toHaveAttribute(
      "aria-label",
      /pane 1.*current/i,
    );

    // Only one pane is visible on mobile — the carousel uses Tailwind
    // `hidden` on off-slots and `block` on the active slot. Count truly
    // visible board-pane groups.
    const allPanes = page.locator("[role='group'][aria-label^='board pane ']");
    await expect(allPanes).toHaveCount(3, { timeout: 10_000 });
    let visibleCount = 0;
    for (let i = 0; i < (await allPanes.count()); i++) {
      if (await allPanes.nth(i).isVisible()) visibleCount++;
    }
    expect(visibleCount).toBe(1);
  });
});
