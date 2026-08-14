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

// Chromium reports env(safe-area-inset-bottom) as 0, so the computed
// padding-bottom IS the floor arm of the max() expression — the env() arm is
// not exercisable here (see the project's Playwright env() limitation) and no
// test below pretends otherwise.

async function toolbarPaddingBottom(page: Page): Promise<string> {
  const toolbar = page.getByRole("toolbar", { name: "Terminal keys" });
  await expect(toolbar).toBeVisible({ timeout: 10_000 });
  return toolbar.evaluate((el) => getComputedStyle(el).paddingBottom);
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
