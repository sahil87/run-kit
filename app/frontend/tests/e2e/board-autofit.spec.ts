import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";
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

const pinned: Array<{ board: string; server: string; windowId: string }> = [];

/** Resolve the tmux window ids for win-0..win-N in index order. */
function windowIds(): string[] {
  const lines = execSync(
    `tmux -L ${TMUX_SERVER} list-windows -t ${TEST_SESSION} -F "#{window_id}:#{window_name}"`,
  )
    .toString()
    .trim()
    .split("\n");
  const ids: string[] = [];
  for (let i = 0; i < WINDOW_COUNT; i++) {
    const id = lines.find((l) => l.endsWith(`:win-${i}`))?.split(":")[0];
    expect(id, `window id for win-${i}`).toBeTruthy();
    ids.push(id!);
  }
  return ids;
}

async function pin(page: Page, board: string, windowId: string) {
  const res = await page.request.post(`/api/boards/${board}/pin`, {
    data: { server: TMUX_SERVER, windowId },
  });
  expect(res.ok(), `pin ${windowId} → ${res.status()}`).toBeTruthy();
  pinned.push({ board, server: TMUX_SERVER, windowId });
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
    try {
      // First window via new-session; the rest via new-window. Each idles so the
      // pane is stable and long-lived (matches boards-desktop-suspend).
      execSync(
        `tmux -L ${TMUX_SERVER} new-session -d -s ${TEST_SESSION} -x 80 -y 24 -n win-0 "sh -c 'sleep 300'"`,
        { stdio: "ignore" },
      );
      for (let i = 1; i < WINDOW_COUNT; i++) {
        execSync(
          `tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n win-${i} "sh -c 'sleep 300'"`,
          { stdio: "ignore" },
        );
      }
    } catch {
      // Best-effort
    }
  });

  test.afterAll(async ({ request }) => {
    for (const entry of pinned) {
      try {
        await request.post(`/api/boards/${entry.board}/unpin`, {
          data: { server: entry.server, windowId: entry.windowId },
        });
      } catch {
        // Best-effort
      }
    }
    pinned.length = 0;
    try {
      execSync(`tmux -L ${TMUX_SERVER} kill-session -t ${TEST_SESSION}`, {
        stdio: "ignore",
      });
    } catch {
      // Best-effort
    }
  });

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
      await page.request.post(`/api/boards/${BOARD_A}/unpin`, {
        data: { server: TMUX_SERVER, windowId: id },
      });
    }
  });

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
      // Within ~8px of 25% (gap-adjustment is calc(25% - 3px)).
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
      await page.request.post(`/api/boards/${BOARD_A}/unpin`, {
        data: { server: TMUX_SERVER, windowId: id },
      });
    }
  });

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

    await page.keyboard.press("Control+k");
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
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
      await page.request.post(`/api/boards/${BOARD_A}/unpin`, {
        data: { server: TMUX_SERVER, windowId: id },
      });
    }
    for (const id of ids.slice(2, 4)) {
      await page.request.post(`/api/boards/${BOARD_B}/unpin`, {
        data: { server: TMUX_SERVER, windowId: id },
      });
    }
  });
});
