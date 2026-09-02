import { test, expect, type Page } from "@playwright/test";
import { TMUX_SERVER } from "./_tmux";

/**
 * Uniform chip sizing in the bottom bar at mobile width: every visible button
 * in the `Terminal keys` toolbar (Tab, `^`, `⌥`, `F▴`, the ArrowPad trigger,
 * `>_`, `⌘K`, and the coarse-only `⌨` toggle) must render the exact same box.
 * All chips share one class (`KBD_CLASS` in `src/components/kbd-chip.ts`); a
 * chip that hardcodes its own size drifts.
 *
 * Shared setup:
 * - Viewport is iPhone 14-sized (375×812) via `test.use`.
 * - `hasTouch: true` flips Chromium's
 *   `(pointer: coarse)` media query — activating the Tailwind `coarse:` variant
 *   (the real 36×36 touch-target path) and revealing the coarse-only `⌨` chip.
 * - Chips are measured by `collectChipSizes`: every button inside
 *   `toolbar[name='Terminal keys']` via `getByRole` (accessibility-tree match,
 *   so pointer-hidden chips are excluded automatically), bounding boxes rounded
 *   to whole px. Popup contents (F▴ menu, arrow popup) stay closed and unmeasured.
 */

// iPhone 14 viewport
const MOBILE_VIEWPORT = { width: 375, height: 812 };

/** Coarse-pointer touch target minimum (px) — KBD_CLASS `coarse:min-h/w-[36px]`. */
const TOUCH_TARGET_MIN = 36;

type ChipSize = { label: string; width: number; height: number };

/**
 * Measure every visible button in the bottom-bar toolbar. `getByRole` matches
 * the accessibility tree, so chips hidden by the pointer split (the
 * coarse-only ⌨ keyboard toggle on fine pointers) are excluded automatically.
 * Sizes are rounded to whole px — the chips are integer-sized by design, and
 * any real divergence (the pre-fix arrow trigger was 32px vs 36px) is ≥1px.
 */
async function collectChipSizes(page: Page): Promise<ChipSize[]> {
  const toolbar = page.getByRole("toolbar", { name: "Terminal keys" });
  await expect(toolbar).toBeVisible({ timeout: 10_000 });

  const buttons = toolbar.getByRole("button");
  const count = await buttons.count();
  expect(count).toBeGreaterThan(0);

  const sizes: ChipSize[] = [];
  for (let i = 0; i < count; i++) {
    const btn = buttons.nth(i);
    const box = await btn.boundingBox();
    expect(box, `button ${i} has no bounding box`).not.toBeNull();
    sizes.push({
      label: (await btn.getAttribute("aria-label")) ?? `button ${i}`,
      width: Math.round(box!.width),
      height: Math.round(box!.height),
    });
  }
  return sizes;
}

function distinctSizes(sizes: ChipSize[]): string[] {
  return [...new Set(sizes.map((s) => `${s.width}x${s.height}`))];
}

test.describe("Bottom bar chip size — touch device", () => {
  // hasTouch flips Chromium's `(pointer: coarse)` media query, activating the
  // Tailwind `coarse:` variant — the real mobile touch-target path.
  test.use({ hasTouch: true, viewport: MOBILE_VIEWPORT });

  /**
   * Proves: on a touch device at mobile width the chip row is visually uniform
   * (one distinct width×height across all chips) and every chip meets the 36px
   * minimum touch target from `coarse:min-h/w-[36px]`.
   *
   * Steps:
   * 1. Navigate to `/${TMUX_SERVER}` with `hasTouch: true` at 375×812.
   * 2. Collect the size of every button in the `Terminal keys` toolbar.
   * 3. Assert the set of distinct `width×height` values has exactly one entry
   *    (the failure message lists every chip's label and size).
   * 4. Assert each chip's width and height is ≥ 36.
   */
  test("all chips share one size and meet the 36px touch target", async ({
    page,
  }) => {
    await page.goto(`/${TMUX_SERVER}`);
    const sizes = await collectChipSizes(page);

    expect(
      distinctSizes(sizes),
      `chips diverge: ${JSON.stringify(sizes)}`,
    ).toHaveLength(1);

    for (const s of sizes) {
      expect(s.width, `${s.label} width below touch target`).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN);
      expect(s.height, `${s.label} height below touch target`).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN);
    }
  });
});
