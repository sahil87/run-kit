import { test, expect, type Page } from "@playwright/test";
import { openPalette } from "./_ready";
import { pinWindow, trackPin, unpinAll, unpinWindow } from "./_boards";
import { TMUX_SERVER, createSession, killSession, listWindows } from "./_tmux";

// End-to-end contract for the per-board desktop autofit toggle: the top-bar
// board-mode button, the `Board: Toggle Autofit` palette action (Constitution
// V parity), the DesktopRow flex-fill layout branch (equal-share panes ≤ 4,
// ~25% floor + horizontal scroll > 4), hidden resize handles while on, the
// non-destructive round-trip (stored per-pane widths untouched), and
// per-board localStorage persistence across reload. The observable behavior
// IS the rendered layout, so the spec asserts real DOM geometry (pane
// bounding-box widths, the scroll-row's scrollWidth vs clientWidth) against a
// live desktop board built by pinning real idle tmux windows via the API.
//
// Shared setup: beforeAll creates a fresh session `e2e-board-autofit-<ts>` on
// E2E_TMUX_SERVER (default `rk-test-e2e`) with 6 windows `win-0..win-5`, each
// running `sleep 300` so panes are stable and long-lived (the same
// deterministic setup as boards-desktop-suspend). afterAll unpins every
// tracked pin via the shared `_boards.ts` registry (unpinAll) and kills the
// session (best-effort — any surviving `_rk-pin-*` is reaped by the
// isolated-server global teardown). Each test uses fresh board names and
// resets autofit to off + unpins at the end so a persisted localStorage key
// never leaks between tests.

// Own session per file to avoid cross-test interference.
const TEST_SESSION = `e2e-board-autofit-${Date.now()}`;
// Board names are constrained to alphanumeric/-/_ — fresh names per run so a
// prior run's persisted autofit key (localStorage is per-origin, cleared per
// test via a fresh context, but the board itself is server-side) never bleeds.
const BOARD_A = `afa${Date.now().toString().slice(-6)}`;
const BOARD_B = `afb${Date.now().toString().slice(-6)}`;

// A wide desktop viewport so (a) fixed-width panes (480px) leave an obvious dead
// strip on the row (the pain point), and (b) 25% of the scrollport (~480px)
// clears the 280px `BOARD_PANE_MIN_WIDTH` floor — the equal-fill / 25%-floor
// arithmetic the spec asserts is the percentage arm, not the 280px arm.
const VIEWPORT = { width: 1920, height: 900 };

// Six windows: enough to build a 3-pane board (equal-fill) and a 5-pane board
// (25% floor + scroll) from the same session.
const WINDOW_COUNT = 6;

/** Resolve the tmux window ids for win-0..win-N in index order. */
function windowIds(): string[] {
  const wins = listWindows(TEST_SESSION);
  const ids: string[] = [];
  for (let i = 0; i < WINDOW_COUNT; i++) {
    const id = wins.find((w) => w.name === `win-${i}`)?.windowId;
    expect(id, `window id for win-${i}`).toBeTruthy();
    ids.push(id!);
  }
  return ids;
}

/** Pin a window to `board` via the shared ok-asserted helper and track it for
 *  the afterAll `unpinAll` sweep. */
async function pin(page: Page, board: string, windowId: string) {
  await pinWindow(page.request, board, TMUX_SERVER, windowId);
  trackPin({ board, server: TMUX_SERVER, windowId });
}

/** The desktop pane root elements (role=group, aria-label "board pane ..."). */
function panes(page: Page) {
  return page.locator('[role="group"][aria-label^="board pane"]');
}

/** The horizontal-scroll row container. */
function row(page: Page) {
  return page.locator(".overflow-x-auto").first();
}

/** Toggle autofit via the top-bar button and return the button locator. The
 *  1920px viewport keeps L2 controls in-bar (registry-driven overflow,
 *  260715-h1ck); `getByRole` matches the accessibility tree, which excludes the
 *  always-present `aria-hidden` measurement probe copy (so this resolves to the
 *  single in-bar button — a `:visible` CSS filter would also match the sized
 *  off-screen probe). */
function autofitButton(page: Page) {
  return page.getByRole("button", { name: "Toggle board autofit" });
}

test.describe("Boards: desktop autofit toggle (738w)", () => {
  test.use({ viewport: VIEWPORT });

  test.beforeAll(() => {
    // First window via new-session; the rest via new-window. Each idles so the
    // pane is stable and long-lived (matches boards-desktop-suspend).
    createSession(TEST_SESSION, {
      windows: Array.from({ length: WINDOW_COUNT }, (_, i) => ({
        name: `win-${i}`,
        command: "sh -c 'sleep 300'",
      })),
    });
  });

  test.afterAll(async ({ request }) => {
    await unpinAll(request);
    killSession(TEST_SESSION);
  });

  /**
   * Proves: with 2 panes, autofit OFF leaves a large dead strip (fixed 480px
   * panes don't fill a 1920px row) and shows resize handles; toggling ON via
   * the top-bar button makes the panes equal-share flex items that fill the
   * row with no horizontal scroll and no resize handles; toggling OFF restores
   * the exact prior fixed-width layout (the stored per-pane widths were never
   * mutated).
   *
   * Steps:
   * 1. Pin win-0..win-1 to board A; goto /board/A; assert 2 panes.
   * 2. OFF baseline: read pane widths + row box; assert total pane width is
   *    well under the row width (dead strip); assert a `resize pane` handle is
   *    attached.
   * 3. Assert the `Toggle board autofit` button is visible with
   *    aria-pressed="false"; click it; assert aria-pressed="true".
   * 4. ON: assert pane widths are equal within 3px (flex 1 1 0); assert the
   *    total pane width jumped by >200px vs OFF; assert the row's
   *    scrollWidth ≤ clientWidth + 2 (no scroll); assert 0 resize handles.
   * 5. Click the button again; assert aria-pressed="false" and the restored
   *    total pane width equals the OFF baseline within 3px; assert a handle is
   *    attached.
   * 6. Unpin win-0..win-1.
   */
  test("autofit ON with 2 panes fills the row equally with no horizontal scroll; OFF restores fixed widths", async ({
    page,
  }) => {
    test.setTimeout(45_000);
    const ids = windowIds();

    // Pin 2 windows to board A. At 480px each they leave a large dead strip on
    // the 1920px row — the pain point autofit fixes.
    for (const id of ids.slice(0, 2)) await pin(page, BOARD_A, id);

    await page.goto(`/board/${BOARD_A}`, { waitUntil: "domcontentloaded" });
    await expect(panes(page)).toHaveCount(2, { timeout: 10_000 });

    // OFF (default): fixed per-pane widths — panes do NOT fill the row (total
    // pane width well under the scrollport, the dead strip).
    const rowBoxBefore = await row(page).boundingBox();
    expect(rowBoxBefore).toBeTruthy();
    const paneBoxesOff = await panes(page).evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().width),
    );
    const totalOff = paneBoxesOff.reduce((a, b) => a + b, 0);
    expect(totalOff).toBeLessThan(rowBoxBefore!.width - 200);
    // The resize handle is present while off.
    await expect(page.locator('[aria-label="resize pane"]').first()).toBeAttached();

    // Toggle autofit ON via the top-bar button.
    const btn = autofitButton(page);
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAttribute("aria-pressed", "false");
    await btn.click();
    await expect(btn).toHaveAttribute("aria-pressed", "true");

    // ON: 2 equal-share panes fill the row and there is no horizontal scroll.
    const paneBoxesOn = await panes(page).evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().width),
    );
    // Equal widths (flex: 1 1 0) — within a few px of each other.
    const minW = Math.min(...paneBoxesOn);
    const maxW = Math.max(...paneBoxesOn);
    expect(maxW - minW).toBeLessThanOrEqual(3);
    // Fills the row: the panes now cover much more of the scrollport than the
    // fixed 480px layout did.
    const totalOn = paneBoxesOn.reduce((a, b) => a + b, 0);
    expect(totalOn).toBeGreaterThan(totalOff + 200);
    // No horizontal scroll (scrollWidth ≈ clientWidth).
    const scroll = await row(page).evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth + 2);
    // Resize handles are hidden while autofit is on.
    await expect(page.locator('[aria-label="resize pane"]')).toHaveCount(0);

    // Toggle OFF again — fixed widths are restored (autofit never wrote the
    // stored per-pane widths, so this is exactly the pre-toggle layout).
    await btn.click();
    await expect(btn).toHaveAttribute("aria-pressed", "false");
    const paneBoxesRestored = await panes(page).evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().width),
    );
    const totalRestored = paneBoxesRestored.reduce((a, b) => a + b, 0);
    expect(Math.abs(totalRestored - totalOff)).toBeLessThanOrEqual(3);
    await expect(page.locator('[aria-label="resize pane"]').first()).toBeAttached();

    // Cleanup: reset to off so the persisted key does not leak into the reload
    // test, and unpin.
    for (const id of ids.slice(0, 2)) {
      await unpinWindow(page.request, BOARD_A, TMUX_SERVER, id);
    }
  });

  /**
   * Proves: with 5 panes and autofit ON, each pane floors at ~25% of the
   * scrollport (the percentage arm resolves against the row's client box, not
   * the scrolled content width) and the row overflows horizontally — the
   * "max 4 visible, scroll past 4" behavior.
   *
   * Steps:
   * 1. Pin win-0..win-4 to board A; goto /board/A; assert 5 panes.
   * 2. Click the autofit button; assert aria-pressed="true".
   * 3. Read the row's clientWidth; assert each pane width is within ~10px of
   *    clientWidth × 0.25 (gap-adjusted calc(25% - 4.5px)).
   * 4. Assert the row's scrollWidth > clientWidth (horizontal scroll present).
   * 5. Toggle off; unpin win-0..win-4.
   */
  test("autofit ON with 5 panes floors each at ~25% and the row scrolls horizontally", async ({
    page,
  }) => {
    test.setTimeout(45_000);
    const ids = windowIds();

    for (const id of ids.slice(0, 5)) await pin(page, BOARD_A, id);

    await page.goto(`/board/${BOARD_A}`, { waitUntil: "domcontentloaded" });
    await expect(panes(page)).toHaveCount(5, { timeout: 10_000 });

    const btn = autofitButton(page);
    await btn.click();
    await expect(btn).toHaveAttribute("aria-pressed", "true");

    // Each pane floors at ~25% of the scrollport (the percentage arm, since
    // 25% of 1400 ≈ 350 > 280). Measure against the row's CLIENT width (the
    // scrollport), not the scrolled content width.
    const clientWidth = await row(page).evaluate((el) => el.clientWidth);
    const paneWidths = await panes(page).evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().width),
    );
    const target = clientWidth * 0.25;
    for (const w of paneWidths) {
      // Within ~8px of 25% (gap-adjustment is calc(25% - 4.5px)).
      expect(Math.abs(w - target)).toBeLessThanOrEqual(10);
    }

    // The row overflows: 5 × 25% > 100%, so it scrolls horizontally.
    const scroll = await row(page).evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth);

    // Reset to off + unpin.
    await btn.click();
    for (const id of ids.slice(0, 5)) {
      await unpinWindow(page.request, BOARD_A, TMUX_SERVER, id);
    }
  });

  /**
   * Proves: the `Board: Toggle Autofit` palette action flips the same state
   * the button reflects (Constitution V parity); the preference persists
   * per-board across a full page reload; and board B has its own independent
   * key (still off when board A is on).
   *
   * Steps:
   * 1. Pin 2 panes to board A and 2 panes to board B.
   * 2. goto /board/A; assert 2 panes and aria-pressed="false".
   * 3. Open the palette (`openPalette`), filter "Toggle Autofit", click the
   *    `Board: Toggle Autofit` option; assert the button now reads
   *    aria-pressed="true".
   * 4. Reload the page; assert board A's button is still aria-pressed="true"
   *    (persisted).
   * 5. goto /board/B; assert aria-pressed="false" (per-board isolation).
   * 6. Return to board A, reset it to off via the button, and unpin all panes.
   */
  test("autofit preference persists per board across reload, and the palette action flips it", async ({
    page,
  }) => {
    test.setTimeout(45_000);
    const ids = windowIds();

    // Board A: 2 panes; Board B: 2 panes.
    for (const id of ids.slice(0, 2)) await pin(page, BOARD_A, id);
    for (const id of ids.slice(2, 4)) await pin(page, BOARD_B, id);

    // Turn autofit ON for board A via the PALETTE action (parity with the
    // button — Constitution V).
    await page.goto(`/board/${BOARD_A}`, { waitUntil: "domcontentloaded" });
    await expect(panes(page)).toHaveCount(2, { timeout: 10_000 });
    await expect(autofitButton(page)).toHaveAttribute("aria-pressed", "false");

    await openPalette(page);
    // The palette input is a combobox (role="combobox") labelled "Search commands".
    await page.getByRole("combobox", { name: "Search commands" }).fill("Toggle Autofit");
    await page.getByRole("option", { name: /Board: Toggle Autofit/ }).first().click();
    await expect(autofitButton(page)).toHaveAttribute("aria-pressed", "true");

    // Reload: board A's preference persists (still ON).
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(panes(page)).toHaveCount(2, { timeout: 10_000 });
    await expect(autofitButton(page)).toHaveAttribute("aria-pressed", "true");

    // Board B has its own key — still OFF (per-board isolation).
    await page.goto(`/board/${BOARD_B}`, { waitUntil: "domcontentloaded" });
    await expect(panes(page)).toHaveCount(2, { timeout: 10_000 });
    await expect(autofitButton(page)).toHaveAttribute("aria-pressed", "false");

    // Reset board A to off (button) so no persisted key leaks past this run.
    await page.goto(`/board/${BOARD_A}`, { waitUntil: "domcontentloaded" });
    await expect(autofitButton(page)).toHaveAttribute("aria-pressed", "true", { timeout: 10_000 });
    await autofitButton(page).click();
    await expect(autofitButton(page)).toHaveAttribute("aria-pressed", "false");

    // Unpin all.
    for (const id of ids.slice(0, 2)) {
      await unpinWindow(page.request, BOARD_A, TMUX_SERVER, id);
    }
    for (const id of ids.slice(2, 4)) {
      await unpinWindow(page.request, BOARD_B, TMUX_SERVER, id);
    }
  });
});
