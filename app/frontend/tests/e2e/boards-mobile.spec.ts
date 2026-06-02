import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";
const TEST_SESSION = `e2e-board-mobile-${Date.now()}`;
const BOARD_NAME = `mob${Date.now().toString().slice(-6)}`;

const pinnedEntries: Array<{ server: string; windowId: string }> = [];

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

  test.afterAll(async ({ request }) => {
    // Unpin while the tmux server is still alive — each pin lives in a
    // `_rk-pin-*` session that persists across restarts (and survives killing
    // the source session), so stale pin-sessions would otherwise pollute the
    // persistent `rk-test-e2e` server across runs.
    for (const entry of pinnedEntries) {
      try {
        await request.post(`/api/boards/${BOARD_NAME}/unpin`, {
          data: entry,
        });
      } catch {
        // Best-effort
      }
    }
    pinnedEntries.length = 0;

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

    // Ensure the session has the three required windows — m-a/m-b/m-c. We
    // check first via `list-windows -F` and only create the missing names so
    // re-runs don't accumulate duplicate windows (which would make later
    // pinning non-deterministic about which `m-*` window each id refers to).
    const requiredWindows = ["m-a", "m-b", "m-c"];
    const listNamesIds = () =>
      execSync(
        `tmux -L ${TMUX_SERVER} list-windows -t ${TEST_SESSION} -F "#{window_name}\t#{window_id}"`,
      )
        .toString()
        .trim()
        .split("\n")
        .map((line) => {
          const [name, id] = line.split("\t");
          return { name, id };
        });

    const existing = new Set(listNamesIds().map((w) => w.name));
    for (const name of requiredWindows) {
      if (existing.has(name)) continue;
      try {
        execSync(
          `tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n "${name}"`,
          { stdio: "ignore" },
        );
      } catch {
        // ignore — best-effort recovery; the assertion below catches a
        // genuinely broken state.
      }
    }

    // Pin the three windows by *name* — not by `slice(0, 3)` of all ids,
    // which would mis-pick if extra windows exist. This makes the test
    // deterministic regardless of session leftovers.
    const namesToIds = new Map(listNamesIds().map((w) => [w.name, w.id]));
    for (const name of requiredWindows) {
      const id = namesToIds.get(name);
      expect(id, `window ${name} should exist`).toBeTruthy();
      const r = await page.request.post(`/api/boards/${BOARD_NAME}/pin`, {
        data: { server: TMUX_SERVER, windowId: id },
      });
      expect(r.ok()).toBeTruthy();
      if (id) pinnedEntries.push({ server: TMUX_SERVER, windowId: id });
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
