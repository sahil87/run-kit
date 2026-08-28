import { test, expect } from "@playwright/test";
import { pinWindow, trackPin, unpinAll } from "./_boards";
import { TMUX_SERVER, createSession, killSession, listWindows, newWindow } from "./_tmux";

// The board page renders as a single-pane swipe carousel on mobile viewports
// (the `min-width: 640px` breakpoint gates the carousel layout), with a
// pagination indicator showing the current slot.
//
// Shared setup: beforeAll creates an `e2e-board-mobile-<timestamp>` session on
// the e2e tmux server with three named windows (m-a, m-b, m-c) so the carousel
// has multiple slots to render. A unique board name (`mob<digits>`) is used
// per run. Every pin is registered with the shared `_boards.ts` cleanup
// registry (trackPin); afterAll runs unpinAll (best-effort unpin of every
// tracked entry, so the persistent e2e server carries no stale `_rk-pin-*`
// pin-sessions into later runs) and kills the test session.

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

  /**
   * Proves: at a 375px-wide viewport the board page renders one pane card at a
   * time with a 3-dot pagination indicator, the first dot annotated as
   * `current` — the mobile breakpoint gates the carousel layout.
   *
   * Steps:
   * 1. Set the viewport to 375×812 (iPhone-class).
   * 2. Reconcile windows: list (name, id) pairs and create any of m-a/m-b/m-c
   *    that are missing — re-runs must not accumulate duplicates, otherwise
   *    pinning by name becomes non-deterministic.
   * 3. Re-list windows, build a name → id map, and POST
   *    /api/boards/<name>/pin for each of m-a/m-b/m-c BY NAME (not by slicing
   *    the first three ids). Record each entry for cleanup.
   * 4. Navigate to /board/<name>.
   * 5. Locate the pagination strip ([aria-label^='pane ']) and assert it
   *    contains 3 dots, the first labelled with `current`.
   * 6. Assert exactly 3 role=group board-pane elements render (matching the
   *    entry count) but only 1 is visible — the others are hidden via the
   *    carousel's slot-switching CSS.
   */
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
