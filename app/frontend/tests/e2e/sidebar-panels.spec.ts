import { test, expect, type Page } from "@playwright/test";
import { READY_TIMEOUT, gotoServerReady } from "./_ready";
import { TMUX_SERVER, createSession, killSession, listWindows } from "./_tmux";

const TEST_SESSION = `e2e-panels-${Date.now()}`;

const MOBILE_VIEWPORT = { width: 375, height: 812 };

/**
 * The PANE/HOST panels are visibility-gated per section (iha5): both default
 * OFF on every viewport, so the mobile drawer tests below first opt the
 * sections in via `addInitScript` seeds of `runkit-sidebar-section-pane|host`
 * (the 260814-ldbs drawer-only fork became a default, not a hard `isMobile`
 * gate). `hasTouch: true` flips Chromium's `(pointer: coarse)` media query —
 * combined with the 375px width, `useIsMobile()` reports mobile (the same
 * seam bottom-bar-chip-size.spec.ts uses).
 */

/** Navigate at the mobile viewport, then open the drawer (the panels' only
 *  home). Gates on the `Toggle navigation` button, NOT the sidebar-footed
 *  `Connected` dot — a closed drawer leaves it unmounted. Returns the drawer
 *  (`role="dialog"`). `readyText` gates LAZY routes (the board chunk): the
 *  top bar's toggle renders before the route's slot registration effect runs,
 *  so a click that lands early is a noop — wait for a content string from the
 *  route body first. */
async function gotoDrawer(page: Page, path: string, readyText?: string | RegExp) {
  await page.goto(path);
  if (readyText) {
    await expect(page.getByText(readyText).first()).toBeVisible({ timeout: READY_TIMEOUT });
  }
  const toggle = page.getByRole("button", { name: "Toggle navigation" });
  await expect(toggle).toBeVisible({ timeout: READY_TIMEOUT });
  await toggle.click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible({ timeout: READY_TIMEOUT });
  return drawer;
}

/** Re-open the drawer if it is closed (post-navigation auto-close, or a
 *  reload landing on the persisted sidebar preference either way). */
async function ensureDrawerOpen(page: Page) {
  const drawer = page.getByRole("dialog");
  if (await drawer.isVisible().catch(() => false)) return drawer;
  const toggle = page.getByRole("button", { name: "Toggle navigation" });
  await expect(toggle).toBeVisible({ timeout: READY_TIMEOUT });
  await toggle.click();
  await expect(drawer).toBeVisible({ timeout: READY_TIMEOUT });
  return drawer;
}

test.describe("Sidebar Host & Window Panels (visibility-gated, iha5)", () => {
  test.beforeAll(() => {
    createSession(TEST_SESSION);
  });

  test.afterAll(() => {
    killSession(TEST_SESSION);
  });

  test("desktop sidebar renders NO PANE/HOST panels under the defaults (both sections default off; the status bar carries the registers)", async ({
    page,
  }) => {
    // Desktop (fine pointer, wide), nothing seeded: both sections default off,
    // so the panels are gone and the session region owns the freed height; the
    // window/host values live in the status bar instead. (A desktop user can
    // opt back in via the rail — covered by sidebar-section-rail.spec.ts.)
    await gotoServerReady(page, TMUX_SERVER);
    await expect(page.getByRole("button", { name: /^Pane/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Host/ })).toHaveCount(0);
    await expect(page.getByTestId("status-bar")).toBeVisible();
  });

  test.describe("mobile drawer", () => {
    test.use({ hasTouch: true, viewport: MOBILE_VIEWPORT });

    test.beforeEach(async ({ page }) => {
      // Opt the Pane/Host sections in — both default OFF (iha5), and these
      // tests exercise the panels themselves. The seed survives the in-test
      // `page.reload()` (init scripts re-run on every navigation).
      await page.addInitScript(() => {
        localStorage.setItem("runkit-sidebar-section-pane", "true");
        localStorage.setItem("runkit-sidebar-section-host", "true");
      });
    });

    test("Host panel shows real system metrics via SSE", async ({ page }) => {
      await gotoDrawer(page, `/${TMUX_SERVER}`);

      // Host panel header is visible and expanded (exact match avoids other "Host" buttons)
      const hostButton = page.getByRole("button", { name: /^Host/ });
      await expect(hostButton).toBeVisible();
      await expect(hostButton).toHaveAttribute("aria-expanded", "true");

      // CollapsiblePanel renders: <outer-div> > <header-div> > <button> and
      // <outer-div> > <content-div>. Two ups from the button reaches the outer
      // panel div, which contains both the header and the content.
      const hostPanel = hostButton.locator("../..");

      // Wait for metrics to arrive via SSE (at least one tick ~2.5s)
      // CPU line with label and percentage
      await expect(hostPanel.locator("text=cpu")).toBeVisible({ timeout: 8_000 });
      await expect(hostPanel.locator("text=/%/").first()).toBeVisible();

      // Memory line with label and gauge
      await expect(hostPanel.locator("text=mem")).toBeVisible();

      // Load line with label
      await expect(hostPanel.locator("text=/^ld/")).toBeVisible();

      // Disk + uptime line
      await expect(hostPanel.locator("text=dsk")).toBeVisible();
      await expect(hostPanel.locator("text=/up /")).toBeVisible();

      // Memory should show real values (not 0/0)
      await expect(hostPanel.locator("text=0/0")).not.toBeVisible();

      // Disk should show real values with G suffix (fractional GB like
      // "9.4G/460G" allowed — the host's real disk size is not our choice).
      await expect(hostPanel.locator("text=/\\d+(\\.\\d+)?[GM]\\/\\d+G/")).toBeVisible();
    });

    test("Window panel shows selected window info", async ({ page }) => {
      await gotoDrawer(page, `/${TMUX_SERVER}`);

      // Pane panel header (exact match to avoid other buttons containing "Pane")
      const paneButton = page.getByRole("button", { name: /^Pane/ });
      await expect(paneButton).toBeVisible();
      await expect(paneButton).toHaveAttribute("aria-expanded", "true");

      const panePanel = paneButton.locator("../..");

      // Before selecting a window — shows fallback text
      await expect(
        panePanel.locator("text=No window selected"),
      ).toBeVisible();

      // Click the session's "Navigate to" button — selects the first window.
      // The drawer AUTO-CLOSES on the destination tap, so reopen it to see
      // the panel.
      const drawer = page.getByRole("dialog");
      const navButton = drawer.getByRole("button", {
        name: new RegExp(`Navigate to ${TEST_SESSION}`),
      });
      await expect(navButton).toBeVisible({ timeout: READY_TIMEOUT });
      await navButton.click();
      await ensureDrawerOpen(page);

      // After selecting — should show tmx and cwd lines
      await expect(panePanel.locator("text=/^tmx /")).toBeVisible({ timeout: 3_000 });
      await expect(panePanel.locator("text=/^cwd /")).toBeVisible();
    });

    test("Collapsible panel toggle and persistence", async ({ page }) => {
      await gotoDrawer(page, `/${TMUX_SERVER}`);

      // Wait for metrics so Host panel has content
      const hostButton = page.getByRole("button", { name: /^Host/ });
      await expect(hostButton).toBeVisible();
      await expect(hostButton).toHaveAttribute("aria-expanded", "true");

      const hostPanel = hostButton.locator("../..");
      await expect(hostPanel.locator("text=cpu")).toBeVisible({ timeout: 8_000 });

      // Collapse the Host panel
      await hostButton.click();
      await expect(hostButton).toHaveAttribute("aria-expanded", "false");

      // Verify localStorage was set
      const stored = await page.evaluate(() =>
        localStorage.getItem("runkit-panel-host"),
      );
      expect(stored).toBe("false");

      // Reload page — panel should remain collapsed. The drawer lands open or
      // closed per the persisted sidebar preference; either way, open it.
      await page.reload();
      await ensureDrawerOpen(page);

      const hostButtonAfter = page.getByRole("button", { name: /^Host/ });
      await expect(hostButtonAfter).toHaveAttribute("aria-expanded", "false");

      // Expand it back
      await hostButtonAfter.click();
      await expect(hostButtonAfter).toHaveAttribute("aria-expanded", "true");

      // Content reappears
      await expect(
        hostButtonAfter.locator("../..").locator("text=cpu"),
      ).toBeVisible({ timeout: 8_000 });

      // Clean up localStorage for other tests
      await page.evaluate(() => localStorage.removeItem("runkit-panel-host"));
    });

    test("board route populates PANE (focused tile) and HOST (host-metrics fallback)", async ({ page }) => {
      test.setTimeout(30_000);
      // Pin the test session's window to a fresh board via the API (deterministic;
      // the pin UI is exercised elsewhere). Board pins are LINK-based, so the
      // window's home-session copy keeps flowing through the sessions stream —
      // that enriched copy is what the PANE panel resolves by windowId.
      const boardName = `panels${Date.now().toString().slice(-6)}`;
      const winId = listWindows(TEST_SESSION)[0]?.windowId;
      expect(winId).toBeTruthy();
      const pinRes = await page.request.post(`/api/boards/${boardName}/pin`, {
        data: { server: TMUX_SERVER, windowId: winId },
      });
      expect(pinRes.ok()).toBeTruthy();

      try {
        // The board route is a LAZY chunk — gate on the pinned window's name
        // rendering in the page body before opening the drawer (an early
        // toggle click lands before the route's top-bar slot registration and
        // is a noop).
        const winName = listWindows(TEST_SESSION)[0]?.name;
        await gotoDrawer(page, `/board/${boardName}`, winName);

        // PANE panel — no route window on /board/$name, so the panel follows the
        // board's focused tile (index 0). The tmx/cwd identity rows render from
        // the resolved home-session copy instead of "No window selected".
        const paneButton = page.getByRole("button", { name: /^Pane/ });
        await expect(paneButton).toBeVisible({ timeout: 10_000 });
        const panePanel = paneButton.locator("../..");
        await expect(panePanel.locator("text=/^tmx /")).toBeVisible({ timeout: 10_000 });
        await expect(panePanel.locator("text=/^cwd /")).toBeVisible();
        await expect(panePanel.locator("text=No window selected")).not.toBeVisible();

        // HOST panel — no currentServer on the board route, so the panel falls
        // back to the host-global metrics broadcast instead of "No metrics".
        // The header carries no connection dot (the sidebar FOOTER dot owns
        // that signal), so its absence is asserted rather than an "SSE" title.
        const hostButton = page.getByRole("button", { name: /^Host/ });
        await expect(hostButton).toBeVisible();
        const hostPanel = hostButton.locator("../..");
        await expect(hostPanel.locator("text=cpu")).toBeVisible({ timeout: 8_000 });
        await expect(hostPanel.locator("text=mem")).toBeVisible();
        await expect(hostPanel.locator("text=No metrics")).not.toBeVisible();
        await expect(hostPanel.locator("[title*='SSE']")).toHaveCount(0);
      } finally {
        // Unpin so the shared server carries no leftover board (empty boards are
        // reaped server-side).
        await page.request.post(`/api/boards/${boardName}/unpin`, {
          data: { server: TMUX_SERVER, windowId: winId },
        });
      }
    });

    test("Host panel metrics update over multiple SSE ticks", async ({ page }) => {
      await gotoDrawer(page, `/${TMUX_SERVER}`);

      const hostPanel = page.getByRole("button", { name: /^Host/ }).locator("../..");

      // Wait for first metrics tick
      await expect(hostPanel.locator("text=cpu")).toBeVisible({ timeout: 8_000 });

      // Wait for at least 2 SSE ticks (2.5s each = ~5s) and verify content is still present
      await page.waitForTimeout(5_500);

      // Panel still shows metrics (not stale or disconnected)
      await expect(hostPanel.locator("text=cpu")).toBeVisible();
      await expect(hostPanel.locator("text=mem")).toBeVisible();
      await expect(hostPanel.locator("text=/^ld/")).toBeVisible();
      await expect(hostPanel.locator("text=dsk")).toBeVisible();
    });
  });
});
