import { test, expect } from "@playwright/test";
import { pinWindow, trackPin, unpinAll } from "./_boards";
import { TMUX_SERVER, createSession, killSession, listWindows, newWindow } from "./_tmux";

const TEST_SESSION = `e2e-board-mobile-${Date.now()}`;
const BOARD_NAME = `mob${Date.now().toString().slice(-6)}`;

test.describe("Boards: mobile carousel", () => {
  test.beforeAll(() => {
    createSession(TEST_SESSION, { windows: ["m-a", "m-b", "m-c"] });
  });

  test.afterAll(async ({ request }) => {
    // Unpin while the tmux server is still alive — each pin lives in a
    // `_rk-pin-*` session that persists across restarts (and survives killing
    // the source session), so stale pin-sessions would otherwise pollute the
    // persistent `rk-test-e2e` server across runs.
    await unpinAll(request);

    killSession(TEST_SESSION);
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

    const existing = new Set(listWindows(TEST_SESSION).map((w) => w.name));
    for (const name of requiredWindows) {
      if (existing.has(name)) continue;
      try {
        newWindow(TEST_SESSION, name);
      } catch {
        // ignore — best-effort recovery; the assertion below catches a
        // genuinely broken state.
      }
    }

    // Pin the three windows by *name* — not by `slice(0, 3)` of all ids,
    // which would mis-pick if extra windows exist. This makes the test
    // deterministic regardless of session leftovers.
    const namesToIds = new Map(listWindows(TEST_SESSION).map((w) => [w.name, w.windowId]));
    for (const name of requiredWindows) {
      const id = namesToIds.get(name);
      expect(id, `window ${name} should exist`).toBeTruthy();
      await pinWindow(page.request, BOARD_NAME, TMUX_SERVER, id!);
      trackPin({ board: BOARD_NAME, server: TMUX_SERVER, windowId: id! });
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
