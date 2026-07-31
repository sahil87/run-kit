import { test, expect } from "@playwright/test";
import { READY_TIMEOUT, gotoWindow, resolveWindow } from "./_ready";
import { TMUX_SERVER, createSession, killSession, newWindow } from "./_tmux";

// Each test file uses its own session to avoid cross-test interference.
const TEST_SESSION = `e2e-scroll-${Date.now()}`;
// Enough windows that the session tree overflows its scroll container on the
// default desktop viewport (1280×720) — the last window sits below the fold.
const WINDOW_COUNT = 30;

const lastWindowName = `scroll-w-${String(WINDOW_COUNT).padStart(2, "0")}`;

test.describe("Sidebar Autoscroll", () => {
  test.beforeAll(() => {
    createSession(TEST_SESSION);
    for (let i = 1; i <= WINDOW_COUNT; i++) {
      newWindow(TEST_SESSION, `scroll-w-${String(i).padStart(2, "0")}`);
    }
  });

  test.afterAll(() => {
    killSession(TEST_SESSION);
  });

  test("deep link to a below-the-fold window scrolls its sidebar row into view", async ({
    page,
  }) => {
    // Resolve the LAST window's stable tmux id (@N) from the API snapshot —
    // with 30 windows above it, its row starts far below the tree's fold.
    const { windowId } = await resolveWindow(
      page,
      TMUX_SERVER,
      TEST_SESSION,
      lastWindowName,
    );

    // Direct URL load: the route resolves before the SSE snapshot lands, so
    // this exercises the pending-scroll retry (row not rendered on first run).
    await gotoWindow(page, TMUX_SERVER, windowId);

    // The selected row renders with aria-current="page" once SSE data lands.
    const tree = page.locator('[role="tree"]');
    const row = tree.locator(
      `[data-window-id="${windowId}"] [aria-current="page"]`,
    );
    await expect(row).toBeVisible({ timeout: READY_TIMEOUT });

    // Geometry assertion: Playwright's `visible` ignores scroll position, so
    // measure that the row's box actually lies within the tree scrollport and
    // that the tree really overflowed + scrolled (scrollTop > 0 — the row
    // started below the fold, so an unscrolled tree would fail).
    await expect
      .poll(
        async () =>
          page.evaluate((id) => {
            const treeEl = document.querySelector('[role="tree"]');
            const rowEl = treeEl?.querySelector(`[data-window-id="${id}"]`);
            if (!treeEl || !rowEl) return null;
            const t = treeEl.getBoundingClientRect();
            const r = rowEl.getBoundingClientRect();
            return {
              overflows: treeEl.scrollHeight > treeEl.clientHeight,
              scrolled: treeEl.scrollTop > 0,
              // 1px tolerance for fractional layout rounding.
              rowInView: r.top >= t.top - 1 && r.bottom <= t.bottom + 1,
            };
          }, windowId),
        { timeout: READY_TIMEOUT },
      )
      .toEqual({ overflows: true, scrolled: true, rowInView: true });

    // Scroll-only invariant: the autoscroll must not steal focus into the
    // sidebar tree (desktop navigation keeps focus for terminal typing).
    const focusInTree = await page.evaluate(() => {
      const treeEl = document.querySelector('[role="tree"]');
      return treeEl?.contains(document.activeElement) ?? false;
    });
    expect(focusInTree).toBe(false);
  });
});
