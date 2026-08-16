import { test, expect, type Page } from "@playwright/test";
import { TMUX_SERVER } from "./_tmux";

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

// Chromium reports env(safe-area-inset-bottom) as 0, so the computed
// padding-bottom IS the floor arm of the max() expression — the env() arm is
// not exercisable here (see the project's Playwright env() limitation) and no
// test below pretends otherwise.

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

  // 260814-ldbs R3: the bar is pointer-gated out of existence on FINE
  // pointers at any width, so there is no floor to measure — the safe-floor
  // rules are exercised only where the bar exists (the touch describe above).
  test("the bar does not render, kb-open or not", async ({ page }) => {
    await page.goto(`/${TMUX_SERVER}`);
    await page.waitForLoadState("domcontentloaded");
    const toolbar = page.getByRole("toolbar", { name: "Terminal keys" });
    await expect(toolbar).toHaveCount(0);

    await page.evaluate(() => document.documentElement.classList.add("kb-open"));
    await expect(toolbar).toHaveCount(0);
  });
});
