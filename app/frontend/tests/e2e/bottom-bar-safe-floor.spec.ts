import { test, expect, type Page } from "@playwright/test";
import { TMUX_SERVER } from "./_tmux";

/**
 * Keyboard-aware safe-area floor on the bottom-bar toolbar.
 * `env(safe-area-inset-bottom)` resolves to 0 in in-browser iOS Safari for
 * this fixed-position app, so the corner-arc/home-indicator clearance comes
 * from a raised `--bottom-bar-floor` (1rem) on coarse pointers, applied only
 * while the on-screen keyboard is collapsed — `useVisualViewport` toggles
 * `html.kb-open` when the keyboard opens, dropping the floor back to 6px. The
 * pad is the `globals.css`-owned `--bottom-bar-pad`:
 * `max(--bottom-bar-floor, env(safe-area-inset-bottom))` while the keyboard is
 * collapsed, floor-only under `html.kb-open` — the env arm must not win under
 * the keyboard (in standalone PWA mode `env()` keeps reporting the 34pt
 * home-indicator inset while the keyboard covers that zone).
 *
 * Shared setup:
 * - Viewport is iPhone 14-sized (375×812) in both describes via `test.use`;
 *   the touch describe adds `hasTouch: true`, flipping Chromium's
 *   `(pointer: coarse)` media query — activating the raised-floor rule in
 *   `globals.css`.
 * - Padding is read as the computed `padding-bottom` of the
 *   `toolbar[name='Terminal keys']` element; the rendered gap is read as
 *   `window.innerHeight` minus the lowest chip `getBoundingClientRect().bottom`
 *   (`chipGapToViewportBottom`).
 * - Chromium reports `env()` as 0, so the computed `padding-bottom` IS the
 *   floor arm of the `max()` expression — the env() arm and the real keyboard
 *   signal are out of e2e reach (device-verified only; the signal derivation
 *   is unit-tested in `use-visual-viewport.test.ts`).
 * - The keyboard-open state is simulated by adding/removing `kb-open` on
 *   `<html>` via `page.evaluate` — Playwright cannot summon a real on-screen
 *   keyboard.
 * - The floor is asserted twice, on purpose: once as computed `padding-bottom`
 *   (the CSS is right) and once as rendered chip position (the padding actually
 *   became screen gap) — a fixed-height frame around the toolbar can clip the
 *   padding against the app-shell's `overflow: hidden` while computed style
 *   still reads 16px.
 */

// iPhone 14 viewport
const MOBILE_VIEWPORT = { width: 375, height: 812 };

/** Raised coarse-pointer floor: --bottom-bar-floor = 1rem while the keyboard
 * is collapsed (globals.css, 260805-fi9m). */
const RAISED_FLOOR = "16px";
/** Base floor: --bottom-bar-floor default = 0.375rem (fine pointers always;
 * coarse pointers while html.kb-open is set). */
const BASE_FLOOR = "6px";
const RAISED_FLOOR_PX = 16;
const BASE_FLOOR_PX = 6;

async function toolbarPaddingBottom(page: Page): Promise<string> {
  const toolbar = page.getByRole("toolbar", { name: "Terminal keys" });
  await expect(toolbar).toBeVisible({ timeout: 10_000 });
  return toolbar.evaluate((el) => getComputedStyle(el).paddingBottom);
}

/** Rendered gap between the chips' lowest bottom edge and the viewport
 * bottom — the property the floor exists to guarantee. Computed padding can
 * read 16px while a fixed-height frame clips the row against the app-shell's
 * overflow:hidden (the 260816-4v2o clipping bug), so this measures position,
 * not style. */
async function chipGapToViewportBottom(page: Page): Promise<number> {
  const toolbar = page.getByRole("toolbar", { name: "Terminal keys" });
  await expect(toolbar).toBeVisible({ timeout: 10_000 });
  return toolbar.evaluate((el) => {
    const chips = Array.from(el.querySelectorAll("button"));
    const lowest = Math.max(...chips.map((c) => c.getBoundingClientRect().bottom));
    return window.innerHeight - lowest;
  });
}

test.describe("Bottom bar safe floor — touch device", () => {
  // hasTouch flips Chromium's `(pointer: coarse)` media query, activating the
  // raised-floor rule in globals.css.
  test.use({ hasTouch: true, viewport: MOBILE_VIEWPORT });

  /**
   * Proves: on a touch device the toolbar's bottom padding is the raised 16px
   * floor while the keyboard is collapsed (chips clear the phone's curved
   * corners), and setting the keyboard-open signal reverts it to 6px so no
   * padding is wasted above the keyboard — in both directions.
   *
   * Steps:
   * 1. Navigate to `/${TMUX_SERVER}` with `hasTouch: true` at 375×812.
   * 2. Assert the toolbar's computed `padding-bottom` is `16px`.
   * 3. Add `kb-open` to `<html>` via `page.evaluate`; assert it becomes `6px`.
   * 4. Remove `kb-open`; assert it returns to `16px`.
   */
  test("keyboard collapsed uses the raised floor; kb-open reverts to 6px", async ({
    page,
  }) => {
    await page.goto(`/${TMUX_SERVER}`);
    expect(await toolbarPaddingBottom(page)).toBe(RAISED_FLOOR);

    // Simulate the useVisualViewport keyboard-open signal directly — Playwright
    // cannot summon a real on-screen keyboard, and the signal derivation itself
    // is unit-tested (use-visual-viewport.test.ts).
    await page.evaluate(() => document.documentElement.classList.add("kb-open"));
    expect(await toolbarPaddingBottom(page)).toBe(BASE_FLOOR);

    await page.evaluate(() => document.documentElement.classList.remove("kb-open"));
    expect(await toolbarPaddingBottom(page)).toBe(RAISED_FLOOR);
  });

  /**
   * Proves: the raised floor is actually visible on screen — the chips' bottom
   * edge clears the viewport bottom by the full 16px while the keyboard is
   * collapsed, and the gap relaxes below the raised floor (but not below 6px)
   * when the keyboard opens. This catches the failure mode the padding test
   * cannot: a fixed-height frame (`h-[48px]`) swallowing the floor while
   * computed padding still reads 16px. The bar's frame is `min-h-[48px]` and
   * grows with the row (61px collapsed, 51px kb-open on coarse pointers).
   *
   * Steps:
   * 1. Navigate to `/${TMUX_SERVER}` with `hasTouch: true` at 375×812.
   * 2. Measure the rendered gap (viewport height minus the lowest chip bottom);
   *    assert it is ≥ 16px.
   * 3. Add `kb-open` to `<html>`; assert the gap is ≥ 6px and < 16px.
   * 4. Remove `kb-open`; assert the gap returns to ≥ 16px.
   */
  test("the floor is rendered screen gap, not just computed padding", async ({
    page,
  }) => {
    await page.goto(`/${TMUX_SERVER}`);

    // Keyboard collapsed: the chips' bottom edge clears the corner-arc zone by
    // the full raised floor.
    expect(await chipGapToViewportBottom(page)).toBeGreaterThanOrEqual(RAISED_FLOOR_PX);

    // kb-open: the floor drops to 6px; the min-48px frame may leave a little
    // extra slack, but the gap stays below the raised floor.
    await page.evaluate(() => document.documentElement.classList.add("kb-open"));
    const openGap = await chipGapToViewportBottom(page);
    expect(openGap).toBeGreaterThanOrEqual(BASE_FLOOR_PX);
    expect(openGap).toBeLessThan(RAISED_FLOOR_PX);

    await page.evaluate(() => document.documentElement.classList.remove("kb-open"));
    expect(await chipGapToViewportBottom(page)).toBeGreaterThanOrEqual(RAISED_FLOOR_PX);
  });
});

test.describe("Bottom bar safe floor — fine pointer", () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  /**
   * Proves: on a fine pointer the bar is gated out of existence at any width,
   * so there is no floor to measure — and the `kb-open` signal cannot resurrect
   * it. The safe-floor rules are exercised only in the touch describe above,
   * where the bar exists.
   *
   * Steps:
   * 1. Navigate to `/${TMUX_SERVER}` at 375×812 (no touch emulation).
   * 2. Assert the `Terminal keys` toolbar has count 0.
   * 3. Add `kb-open` to `<html>`; assert the toolbar still has count 0.
   */
  test("the bar does not render, kb-open or not", async ({ page }) => {
    await page.goto(`/${TMUX_SERVER}`);
    await page.waitForLoadState("domcontentloaded");
    const toolbar = page.getByRole("toolbar", { name: "Terminal keys" });
    await expect(toolbar).toHaveCount(0);

    await page.evaluate(() => document.documentElement.classList.add("kb-open"));
    await expect(toolbar).toHaveCount(0);
  });
});
