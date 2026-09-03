import { test, expect } from "@playwright/test";
import { gotoServerReady } from "./_ready";
import { TMUX_SERVER, createSession, killSession } from "./_tmux";

/**
 * Behavioural contract for the ServerPanel tile grid — a swatch-style grid of
 * tile buttons. Validates that tiles render per server (bare window-count
 * meta; the shared server flyout card replaces the native `title` attribute),
 * active-tile state, click-to-switch behaviour, and the mobile single-row
 * horizontal-swipe layout. The panel defaults open, so tests assert the grid
 * directly without an expand click.
 *
 * Shared setup: `beforeAll` creates two temporary sessions on the e2e tmux
 * server (`E2E_TMUX_SERVER`, default `rk-test-e2e`) so the active server's
 * tile shows a non-zero window count and there is enough content to exercise
 * the grid; `afterAll` kills them. Resize drag interaction itself and the
 * collapsed → open transition are covered by unit tests
 * (`collapsible-panel.test.tsx`, `server-panel.test.tsx`) — e2e coverage here
 * focuses on presence + layout.
 */

const MOBILE_VIEWPORT = { width: 375, height: 812 };
const DESKTOP_VIEWPORT = { width: 1024, height: 768 };
const SETUP_SESSIONS = [
  `e2e-sp-grid-${Date.now()}-a`,
  `e2e-sp-grid-${Date.now()}-b`,
];

test.describe("Server Panel Tile Grid", () => {
  test.beforeAll(() => {
    for (const name of SETUP_SESSIONS) createSession(name);
  });

  test.afterAll(() => {
    for (const name of SETUP_SESSIONS) killSession(name);
  });

  /**
   * Proves: on a desktop viewport (1024×768), the Server panel is open by
   * default and renders a grid of server tiles. The e2e server's tile carries
   * NO native `title` attribute — hovering it opens the shared server flyout
   * card (`Server <name>` title bar; `tmux -L <name> · N sessions` facts
   * line — the socket flag + session count) — the tile's visible count line
   * is a bare window-count number, and the old `N sess` meta line no longer
   * renders.
   *
   * Steps:
   * 1. Navigate to `/${TMUX_SERVER}` and wait for `Connected`.
   * 2. Locate the Server header button (`name: /^Server/`); assert visible
   *    and `aria-expanded="true"` (default-open, no click).
   * 3. Locate the grid listbox via `getByRole('listbox', { name: /Tmux servers/ })`.
   * 4. Within the grid, assert at least one `option` tile whose name includes
   *    the e2e server.
   * 5. Assert that tile has no `title` attribute; hover it and assert the
   *    `row-flyout-card` card appears with `Server <name>` in its title bar
   *    and a `tmux -L <name> · N sessions` facts line.
   * 6. Assert the old meta line `/\d+ sess/` has zero matches in the grid.
   */
  test("Desktop: tile grid renders with session counts", async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await gotoServerReady(page, TMUX_SERVER);

    // The panel defaults open — no expand click needed.
    const serverButton = page.getByRole("button", { name: /^Server/ });
    await expect(serverButton).toBeVisible();
    await expect(serverButton).toHaveAttribute("aria-expanded", "true");

    const grid = page.getByRole("listbox", { name: /Tmux servers/ });
    await expect(grid).toBeVisible({ timeout: 5_000 });

    // At least one tile — the e2e tmux server itself.
    const activeOption = grid.getByRole("option", { name: new RegExp(TMUX_SERVER) });
    await expect(activeOption).toBeVisible();

    // The tile count is a bare window-count number; the server flyout card
    // carries the socket flag + session count. The native `title` attribute is
    // gone (replaced by the card — the double-tooltip rule).
    await expect(activeOption).not.toHaveAttribute("title");
    await activeOption.hover();
    const card = page.getByTestId("row-flyout-card");
    await expect(card).toBeVisible();
    await expect(card.getByTestId("popup-title-bar")).toContainText(`Server ${TMUX_SERVER}`);
    await expect(card).toContainText(new RegExp(`tmux -L ${TMUX_SERVER} · \\d+ sessions?`));
    // The old "N sess" meta line is gone from the grid.
    await expect(grid.locator("text=/\\d+ sess/")).toHaveCount(0);
  });

  /**
   * Proves: the active server's tile carries `aria-current="true"` in the
   * default-open grid.
   *
   * Steps:
   * 1. Navigate to `/${TMUX_SERVER}` and wait for `Connected`.
   * 2. Locate the grid listbox directly (panel defaults open — no click).
   * 3. Find the tile option matching the current server; assert
   *    `aria-current="true"`.
   */
  test("Desktop: active tile has aria-current", async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await gotoServerReady(page, TMUX_SERVER);

    // Panel defaults open — the grid is available without a click.
    const grid = page.getByRole("listbox", { name: /Tmux servers/ });
    const activeOption = grid.getByRole("option", { name: new RegExp(TMUX_SERVER) });
    await expect(activeOption).toHaveAttribute("aria-current", "true");
  });

  /**
   * Proves: on a 375×812 viewport, the tile grid does not wrap into multiple
   * rows — it lays out as a single horizontal strip with `overflow-x: auto`.
   *
   * Steps:
   * 1. Set viewport 375×812.
   * 2. Navigate to `/${TMUX_SERVER}`.
   * 3. Click the `Toggle navigation` button to open the mobile sidebar drawer.
   * 4. Within the `Sessions` navigation region, locate the grid listbox
   *    (panel defaults open — no expand click).
   * 5. Evaluate the grid element's computed `grid-auto-flow` — assert
   *    `column` (desktop would be `row`).
   * 6. Evaluate `overflow-x` — assert `auto` or `scroll`.
   */
  test("Mobile: grid renders as a single horizontal row", async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto(`/${TMUX_SERVER}`);

    // Mobile sidebar is a drawer — open it via the toggle button.
    await page.getByRole("button", { name: "Toggle navigation" }).click();
    const sidebar = page.getByRole("navigation", { name: "Sessions" });
    await expect(sidebar).toBeVisible();

    // Panel defaults open — the grid is available without a click.
    const grid = sidebar.getByRole("listbox", { name: /Tmux servers/ });
    await expect(grid).toBeVisible();

    const gridFlow = await grid.evaluate((el) => getComputedStyle(el).gridAutoFlow);
    expect(gridFlow).toContain("column");

    const overflowX = await grid.evaluate((el) => getComputedStyle(el).overflowX);
    expect(["auto", "scroll"]).toContain(overflowX);
  });

  /**
   * Proves: the resize drag handle (`role="separator"` with name matching
   * `Resize Server panel`) is NOT rendered on mobile viewports — the
   * single-row layout does not need vertical resize — even with the panel
   * open by default.
   *
   * Steps:
   * 1. Set viewport 375×812.
   * 2. Navigate and open the mobile sidebar drawer via `Toggle navigation`.
   * 3. Assert the grid listbox is visible (default-open).
   * 4. Assert `getByRole('separator', { name: /Resize.*Server/ })` is not
   *    visible.
   */
  test("Mobile: drag handle is hidden", async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto(`/${TMUX_SERVER}`);

    await page.getByRole("button", { name: "Toggle navigation" }).click();
    const sidebar = page.getByRole("navigation", { name: "Sessions" });
    await expect(sidebar).toBeVisible();

    // Panel defaults open — no expand click; the handle must still be absent.
    await expect(
      sidebar.getByRole("listbox", { name: /Tmux servers/ }),
    ).toBeVisible();
    await expect(
      sidebar.getByRole("separator", { name: /Resize.*Server/ }),
    ).not.toBeVisible();
  });

  /**
   * Proves: on a 1024×768 desktop viewport, the Server panel is resizable —
   * the bottom drag handle is rendered and reachable from the default-open
   * state.
   *
   * Steps:
   * 1. Set viewport 1024×768.
   * 2. Navigate, wait for `Connected`.
   * 3. Assert `getByRole('separator', { name: /Resize.*Server/ })` is visible
   *    (no expand click — the panel defaults open).
   */
  test("Desktop: drag handle is visible on resizable panel", async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await gotoServerReady(page, TMUX_SERVER);

    // Panel defaults open — the resizable panel's handle renders without a click.
    await expect(
      page.getByRole("separator", { name: /Resize.*Server/ }),
    ).toBeVisible();
  });
});
