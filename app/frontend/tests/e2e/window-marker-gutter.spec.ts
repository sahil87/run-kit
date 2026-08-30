/**
 * Window marker-well e2e coverage. The describe-scoped hooks create and kill
 * `TEST_SESSION`; its timestamp avoids reusing a fixed tmux session name across
 * runs. The shared `_tmux` helpers create windows and seed `@rk_win_marker`,
 * while `_ready` navigates to the server and resolves windows from its snapshot.
 * The local `resolveWindow` binds those reads to the test server and session,
 * and `expectMarker` polls until the resolved marker equals the seeded value.
 * The spec uses Playwright's default viewport and installs no `page.route`
 * stubs. Marked rows paint a flush 22px well in fixed marker ink, blocked mode
 * alone adds the static hazard wedge, and terminal rows expose the same strip
 * for the spring-loaded pad while preserving that committed-marker geometry.
 */
import { test, expect, type Page } from "@playwright/test";
import { gotoServerReady, resolveWindow as resolveWindowRaw } from "./_ready";
import {
  TMUX_SERVER,
  createSession,
  killSession,
  newWindow,
  setWindowOption,
} from "./_tmux";

const TEST_SESSION = `e2e-marker-${Date.now()}`;

const resolveWindow = (page: Page, windowName: string) =>
  resolveWindowRaw(page, TMUX_SERVER, TEST_SESSION, windowName);

async function expectMarker(page: Page, windowName: string, expected: string): Promise<void> {
  await expect
    .poll(
      async () => (await resolveWindow(page, windowName)).marker ?? "",
      { timeout: 6_000 },
    )
    .toBe(expected);
}

async function setWindowOptions(
  page: Page,
  windowId: string,
  options: Record<string, string | null>,
): Promise<void> {
  const response = await page.request.post(
    `/api/windows/${encodeURIComponent(windowId)}/options?server=${encodeURIComponent(TMUX_SERVER)}`,
    { data: { options } },
  );
  expect(response.ok(), `setting options on ${windowId}`).toBeTruthy();
}

test.describe("window marker well", () => {
  test.beforeAll(() => {
    createSession(TEST_SESSION);
  });

  test.afterAll(() => {
    killSession(TEST_SESSION);
  });

  /**
   * Proves: manual, auto, and blocked markers share a flush 22px fixed-ink
   * well; their stage renderers remain distinct; only blocked adds the static
   * hazard wedge; an unmarked row has neither well nor hazard.
   *
   * Steps:
   * 1. Create manual, auto, blocked, and unmarked windows with the shared tmux
   *    helpers, then resolve their stable window ids.
   * 2. Set `manual:2`, `auto:3`, and `blocked:1` directly in
   *    `@rk_win_marker` and poll the session snapshot for each value.
   * 3. Assert every marked well begins at the row edge, is 22px wide within
   *    subpixel tolerance, and uses the fixed marker-ink wash and right border.
   * 4. Assert manual paints a 15px solid fill, auto draws three chevrons, and
   *    blocked paints a 7px hatch plus the row hazard wedge.
   * 5. Assert the unmarked row renders neither the well nor the hazard wedge.
   */
  test("marked rows render the fixed well and blocked alone renders hazard", async ({ page }) => {
    const names = {
      manual: `marker-manual-${Date.now()}`,
      auto: `marker-auto-${Date.now()}`,
      blocked: `marker-blocked-${Date.now()}`,
      empty: `marker-empty-${Date.now()}`,
    };
    for (const name of Object.values(names)) newWindow(TEST_SESSION, name);

    await gotoServerReady(page, TMUX_SERVER);

    const windows = {
      manual: await resolveWindow(page, names.manual),
      auto: await resolveWindow(page, names.auto),
      blocked: await resolveWindow(page, names.blocked),
      empty: await resolveWindow(page, names.empty),
    };
    setWindowOption(windows.manual.windowId, "@rk_win_marker", "manual:2");
    setWindowOption(windows.auto.windowId, "@rk_win_marker", "auto:3");
    setWindowOption(windows.blocked.windowId, "@rk_win_marker", "blocked:1");
    await expectMarker(page, names.manual, "manual:2");
    await expectMarker(page, names.auto, "auto:3");
    await expectMarker(page, names.blocked, "blocked:1");

    const rows = {
      manual: page.locator(`[data-window-id="${windows.manual.windowId}"]`),
      auto: page.locator(`[data-window-id="${windows.auto.windowId}"]`),
      blocked: page.locator(`[data-window-id="${windows.blocked.windowId}"]`),
      empty: page.locator(`[data-window-id="${windows.empty.windowId}"]`),
    };

    for (const mode of ["manual", "auto", "blocked"] as const) {
      const row = rows[mode];
      const well = row.getByTestId("marker-well");
      await expect(well).toBeVisible({ timeout: 5_000 });
      const rowBox = await row.boundingBox();
      const wellBox = await well.boundingBox();
      expect(rowBox).not.toBeNull();
      expect(wellBox).not.toBeNull();
      expect(Math.abs(wellBox!.x - rowBox!.x)).toBeLessThan(0.5);
      expect(Math.abs(wellBox!.width - 22)).toBeLessThanOrEqual(0.5);
      await expect(well).toHaveCSS("background-color", /rgb/);
      await expect(well).toHaveCSS("border-right-width", "1px");
      expect(await well.getAttribute("style")).toContain("var(--color-marker-ink) 12%");
      expect(await well.getAttribute("style")).toContain("var(--color-marker-ink) 30%");
    }

    const manualFill = rows.manual.getByTestId("marker-well").locator(":scope > span");
    await expect(manualFill).toHaveCSS("width", "15px");
    await expect(manualFill).toHaveCSS("background-color", /rgb/);

    await expect(rows.auto.getByTestId("marker-well").locator("path")).toHaveCount(3);

    const blockedFill = rows.blocked.getByTestId("marker-well").locator(":scope > span");
    await expect(blockedFill).toHaveCSS("width", "7px");
    await expect(blockedFill).toHaveCSS("background-image", /linear-gradient/);
    await expect(rows.blocked.locator(":scope > .rk-hazard")).toHaveCount(1);
    await expect(rows.manual.locator(":scope > .rk-hazard")).toHaveCount(0);
    await expect(rows.auto.locator(":scope > .rk-hazard")).toHaveCount(0);

    await expect(rows.empty.getByTestId("marker-well")).toHaveCount(0);
    await expect(rows.empty.locator(":scope > .rk-hazard")).toHaveCount(0);
  });

  /**
   * Proves: a fine-pointer press dragged one grid pitch to the right commits
   * `manual:2`, closes the marker pad, and never selects the source row.
   *
   * Steps:
   * 1. Create a marked target window followed by a newer active window, then
   *    seed the target with `manual:1` through the tmux option helper.
   * 2. Press the target's marker strip, drag 26px right, and release.
   * 3. Poll the session snapshot for `manual:2`, and assert the pad
   *    closed while the target row remains unselected.
   */
  test("press-drag-release persists manual:2 without selecting the row", async ({ page }) => {
    const targetName = `marker-drag-${Date.now()}`;
    const activeName = `marker-active-${Date.now()}`;
    newWindow(TEST_SESSION, targetName);
    newWindow(TEST_SESSION, activeName);

    await gotoServerReady(page, TMUX_SERVER);

    const target = await resolveWindow(page, targetName);
    await setWindowOptions(page, target.windowId, { "@rk_win_marker": "manual:1" });
    await expectMarker(page, targetName, "manual:1");

    const row = page.locator(`[data-window-id="${target.windowId}"]`);
    const rowButton = row.locator(":scope > button");
    await expect(row.getByTestId("marker-well").locator(":scope > span")).toHaveCSS("width", "7px");
    const strip = row.getByTestId("marker-strip");
    const stripBox = await strip.boundingBox();
    expect(stripBox).not.toBeNull();

    await page.mouse.move(stripBox!.x + stripBox!.width / 2, stripBox!.y + stripBox!.height / 2);
    await page.mouse.down();
    await expect(page.getByTestId("marker-pad")).toBeVisible();
    await page.mouse.move(stripBox!.x + stripBox!.width / 2 + 26, stripBox!.y + stripBox!.height / 2);
    await page.mouse.up();

    await expectMarker(page, targetName, "manual:2");
    await expect(page.getByTestId("marker-pad")).toHaveCount(0);
    await expect(rowButton).not.toHaveAttribute("aria-current", "page");
  });

  /**
   * Proves: releasing a fine-pointer press without displacement leaves the
   * click menu open, and a nonzero wheel gesture steps a committed marker.
   *
   * Steps:
   * 1. Create an unmarked window and press then release its strip at the same
   *    coordinates, asserting the marker pad remains visible.
   * 2. Choose `blocked:3` from the pad and poll until that value persists and
   *    the click menu closes.
   * 3. Hover the strip, wheel upward, and poll until the stage steps once to
   *    `blocked:2`.
   */
  test("no-move release opens the click menu and wheel steps a marked stage", async ({ page }) => {
    const windowName = `marker-click-wheel-${Date.now()}`;
    newWindow(TEST_SESSION, windowName);

    await gotoServerReady(page, TMUX_SERVER);

    const target = await resolveWindow(page, windowName);
    const row = page.locator(`[data-window-id="${target.windowId}"]`);
    const strip = row.getByTestId("marker-strip");
    const stripBox = await strip.boundingBox();
    expect(stripBox).not.toBeNull();

    const x = stripBox!.x + stripBox!.width / 2;
    const y = stripBox!.y + stripBox!.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.up();
    await expect(page.getByTestId("marker-pad")).toBeVisible();

    await page.getByRole("option", { name: "Marker blocked:3" }).click();
    await expectMarker(page, windowName, "blocked:3");
    await expect(page.getByTestId("marker-pad")).toHaveCount(0);

    await strip.hover();
    await page.mouse.wheel(0, -120);
    await expectMarker(page, windowName, "blocked:2");
  });
});
