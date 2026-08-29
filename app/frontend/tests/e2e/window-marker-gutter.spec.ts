/**
 * Window marker well + 3×3 pad e2e coverage.
 *
 * Shared setup: this file owns one isolated tmux session and creates a fresh
 * named window for each scenario. Window rows are resolved through
 * `/api/sessions` and addressed by stable `data-window-id`. Marker, color,
 * and flair writes are verified against that same API snapshot, proving the
 * UI persisted the corresponding tmux option rather than only repainting
 * local state. The suite runs sequentially (`fullyParallel: false`).
 */
import { test, expect, type Locator, type Page } from "@playwright/test";
import { gotoServerReady, resolveWindow as resolveWindowRaw } from "./_ready";
import { TMUX_SERVER, createSession, killSession, newWindow } from "./_tmux";

const TEST_SESSION = `e2e-marker-${Date.now()}`;

const resolveWindow = (page: Page, windowName: string) =>
  resolveWindowRaw(page, TMUX_SERVER, TEST_SESSION, windowName);

async function expectWindowField(
  page: Page,
  windowName: string,
  field: "marker" | "color" | "flair",
  expected: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `/api/sessions?server=${encodeURIComponent(TMUX_SERVER)}`,
        );
        if (!response.ok()) return "<fetch-failed>";
        const sessions = (await response.json()) as Array<{
          name: string;
          windows: Array<Record<string, string | undefined>>;
        }>;
        const win = sessions
          .find((session) => session.name === TEST_SESSION)
          ?.windows.find((candidate) => candidate.name === windowName);
        return win?.[field] ?? "";
      },
      { timeout: 8_000 },
    )
    .toBe(expected);
}

const expectMarker = (page: Page, windowName: string, expected: string) =>
  expectWindowField(page, windowName, "marker", expected);
const expectColor = (page: Page, windowName: string, expected: string) =>
  expectWindowField(page, windowName, "color", expected);
const expectFlair = (page: Page, windowName: string, expected: string) =>
  expectWindowField(page, windowName, "flair", expected);

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

async function createVisibleWindow(page: Page, prefix: string) {
  const name = `${prefix}-${Date.now()}`;
  newWindow(TEST_SESSION, name);
  await gotoServerReady(page, TMUX_SERVER);
  const win = await resolveWindow(page, name);
  const row = page
    .locator("nav[aria-label='Sessions']")
    .locator(`[data-window-id="${win.windowId}"]`);
  await expect(row).toBeVisible({ timeout: 8_000 });
  return { name, win, row };
}

async function pointerAtCenter(page: Page, locator: Locator, action: "down" | "up") {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  if (action === "down") await page.mouse.down();
  else await page.mouse.up();
}

test.describe("Window marker well + pad", () => {
  test.beforeAll(() => {
    createSession(TEST_SESSION);
  });

  test.afterAll(() => {
    killSession(TEST_SESSION);
  });

  /**
   * Proves: the fine-pointer strip owns the spring-loaded gesture; a one-cell
   * horizontal drag advances `manual:1` to `manual:2`, persists the marker,
   * closes the pad on release, and never selects the underlying row.
   *
   * Steps:
   * 1. Create a target window plus a newer active window so the target starts
   *    unselected; seed the target with `manual:1` through the options API.
   * 2. Press the target's 22px marker strip, drag one 26px pad pitch right,
   *    and release.
   * 3. Poll `/api/sessions` for `marker: manual:2`.
   * 4. Assert the pad closed and the target row never became current.
   */
  test("press-drag-release persists manual:2 without selecting the row", async ({ page }) => {
    const targetName = `marker-drag-${Date.now()}`;
    newWindow(TEST_SESSION, targetName);
    newWindow(TEST_SESSION, `marker-active-${Date.now()}`);
    await gotoServerReady(page, TMUX_SERVER);

    const target = await resolveWindow(page, targetName);
    await setWindowOptions(page, target.windowId, { "@rk_win_marker": "manual:1" });
    await expectMarker(page, targetName, "manual:1");

    const row = page.locator(`[data-window-id="${target.windowId}"]`);
    const rowButton = row.locator(":scope > button");
    await expect(rowButton).not.toHaveAttribute("aria-current", "page");
    const strip = row.getByTestId("marker-strip");
    const box = await strip.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + box!.width / 2;
    const startY = box!.y + box!.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await expect(page.getByTestId("marker-pad")).toBeVisible();
    await page.mouse.move(startX + 26, startY);
    await expect(page.getByTestId("marker-pad-header")).toHaveText("manual · mid");
    await page.mouse.up();

    await expectMarker(page, targetName, "manual:2");
    await expect(page.getByTestId("marker-pad")).toHaveCount(0);
    await expect(rowButton).not.toHaveAttribute("aria-current", "page");
  });

  /**
   * Proves: a no-move strip release becomes a click menu; a direct cell pick
   * commits immediately; wheel changes only the stage of a marked row.
   *
   * Steps:
   * 1. Create an unmarked window and press/release the strip at one point.
   * 2. Assert the pad stays open, then click `blocked:3` and poll persistence.
   * 3. Hover the strip and wheel upward once.
   * 4. Poll `/api/sessions` for `blocked:2` (mode unchanged, stage stepped).
   */
  test("no-move release opens the click menu and wheel steps a marked stage", async ({ page }) => {
    const { name, row } = await createVisibleWindow(page, "marker-menu");
    const strip = row.getByTestId("marker-strip");

    await pointerAtCenter(page, strip, "down");
    await pointerAtCenter(page, strip, "up");
    const pad = page.getByTestId("marker-pad");
    await expect(pad).toBeVisible();
    await pad.getByRole("option", { name: "Marker blocked:3" }).click();
    await expectMarker(page, name, "blocked:3");
    await expect(pad).toHaveCount(0);

    await strip.hover();
    await page.mouse.wheel(0, -100);
    await expectMarker(page, name, "blocked:2");
  });

  /**
   * Proves: the display well exists only for marked rows, is flush with the
   * row at x=0 and exactly 22px wide, and the static hazard texture belongs
   * only to blocked mode.
   *
   * Steps:
   * 1. Create manual, auto, blocked, and unmarked windows.
   * 2. Persist `manual:1`, `auto:2`, and `blocked:3` via the options API.
   * 3. Compare each marked well's bounding box with its row (same x, 22px).
   * 4. Assert only blocked has `.rk-hazard`; assert the unmarked row has no
   *    well and none of the three non-blocked rows has a hazard.
   */
  test("marked rows alone render a flush 22px well and blocked alone renders hazard", async ({ page }) => {
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
    await setWindowOptions(page, windows.manual.windowId, { "@rk_win_marker": "manual:1" });
    await setWindowOptions(page, windows.auto.windowId, { "@rk_win_marker": "auto:2" });
    await setWindowOptions(page, windows.blocked.windowId, { "@rk_win_marker": "blocked:3" });
    await expectMarker(page, names.manual, "manual:1");
    await expectMarker(page, names.auto, "auto:2");
    await expectMarker(page, names.blocked, "blocked:3");

    for (const mode of ["manual", "auto", "blocked"] as const) {
      const row = page.locator(`[data-window-id="${windows[mode].windowId}"]`);
      const rowBox = await row.boundingBox();
      const wellBox = await row.getByTestId("marker-well").boundingBox();
      expect(rowBox).not.toBeNull();
      expect(wellBox).not.toBeNull();
      expect(Math.abs(wellBox!.x - rowBox!.x)).toBeLessThan(0.5);
      expect(wellBox!.width).toBe(22);
      await expect(row.locator(":scope > .rk-hazard")).toHaveCount(mode === "blocked" ? 1 : 0);
    }

    const emptyRow = page.locator(`[data-window-id="${windows.empty.windowId}"]`);
    await expect(emptyRow.getByTestId("marker-well")).toHaveCount(0);
    await expect(emptyRow.locator(":scope > .rk-hazard")).toHaveCount(0);
  });

  /**
   * Proves: the flyout exposes Marker directly after Change color, while
   * Change color still opens the two-axis color + flair picker with no marker
   * band; both remaining axes persist through their existing write seams.
   *
   * Steps:
   * 1. Create a fresh window and hover its row until the card opens.
   * 2. Assert Change color precedes Marker, then invoke Change color.
   * 3. Assert the Label picker contains `[ color ]` and `[ flair ]`, but no
   *    `[ marker ]` header and no `Marker none` option.
   * 4. Pick orange and scan; poll color `1+3` and flair `scan` persistence.
   */
  test("Change color keeps color + flair persistence and contains no marker band", async ({ page }) => {
    const { name, row } = await createVisibleWindow(page, "marker-label");
    await row.hover();
    const card = page.getByTestId("row-flyout-card");
    await expect(card).toBeVisible({ timeout: 5_000 });
    const colorAction = card.getByTestId("row-flyout-color-action");
    const markerAction = card.getByTestId("row-flyout-marker-action");
    await expect(colorAction).toBeVisible();
    await expect(markerAction).toBeVisible();
    const colorBox = await colorAction.boundingBox();
    const markerBox = await markerAction.boundingBox();
    expect(colorBox).not.toBeNull();
    expect(markerBox).not.toBeNull();
    expect(colorBox!.y).toBeLessThan(markerBox!.y);

    await colorAction.click();
    const picker = page.getByRole("listbox", { name: "Label picker" });
    await expect(picker).toBeVisible();
    await expect(picker.getByText("[ color ]", { exact: true })).toBeVisible();
    await expect(picker.getByText("[ flair ]", { exact: true })).toBeVisible();
    await expect(picker.getByText("[ marker ]", { exact: true })).toHaveCount(0);
    await expect(picker.getByRole("option", { name: "Marker none" })).toHaveCount(0);

    await picker.getByRole("option", { name: "Color orange", exact: true }).click();
    await expectColor(page, name, "1+3");
    await picker.getByRole("option", { name: "Flair scan" }).click();
    await expectFlair(page, name, "scan");
    await expect(picker).toBeVisible();
  });
});
