import { test, expect } from "@playwright/test";

/**
 * Visual drift guard for the shared control vocabulary. The dev-only gallery
 * route `/__controls` (registered only when `import.meta.env.DEV`) renders the
 * full control-variant × state matrix — icon / chip / chip ringed / toggle /
 * segment / menu-row / wide / confirm, each in rest + its applicable
 * pressed/open/disabled/danger/checked states — composed from the same Control
 * primitive the production surfaces consume. These tests screenshot the
 * whole matrix per pointer class against committed baselines, so any drift in
 * a control recipe (geometry, state arm, disabled recipe) fails here.
 *
 * Chromium-scoped by config (the only Playwright project): cross-browser font
 * rasterization differences would read as false drift, and the dev rig and CI
 * shards both run chromium on Linux.
 *
 * Shared setup:
 * - No fixtures or tmux state: the gallery page is self-contained, so the only
 *   gate is the matrix root being visible plus `document.fonts.ready` (the
 *   self-hosted Monaspice webfont must be settled before pixels are compared).
 * - The global `contextOptions.reducedMotion: "reduce"` zeroes the hover-animation
 *   vocabulary (glint etc.), so captured pixels are the static compositions.
 * - The screenshot target is the matrix root element, not the page: the
 *   persistent top bar carries live chrome (clock, update chip) that is
 *   legitimately non-deterministic and out of scope for this guard.
 * - The coarse run sets `hasTouch: true`, which flips Chromium's
 *   `(any-pointer: coarse)` media query, activating the Tailwind `coarse:`
 *   variant — the real 40px-floor path. A bounding-box assertion on a chip
 *   cell proves the emulation took effect (coarse floor exercised, not
 *   assumed); the fine run asserts the mirror (33px chip axis).
 */

const GALLERY = "control-gallery";

async function gotoGallery(page: import("@playwright/test").Page) {
  await page.goto("/__controls");
  const matrix = page.getByTestId(GALLERY);
  await expect(matrix).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return matrix;
}

test.describe("Control gallery — visual drift guard", () => {
  /**
   * Proves: on a fine pointer the gallery matrix renders pixel-identically to
   * the committed baseline, and the chip variant sits on its 33px fine axis
   * (proving the pointer-class split is real, not a collapsed single size).
   *
   * Steps:
   * 1. Navigate to `/__controls` and wait for the matrix root + webfonts.
   * 2. Measure the `ctl-chip-rest` button; assert its height is below the 40px
   *    coarse floor (the fine 33px axis).
   * 3. Screenshot the full matrix and compare against the `fine` baseline.
   */
  test("matrix matches the baseline on a fine pointer", async ({ page }) => {
    const matrix = await gotoGallery(page);

    const chip = page.getByTestId("ctl-chip-rest").getByRole("button");
    const box = await chip.boundingBox();
    expect(box, "chip cell has no bounding box").not.toBeNull();
    expect(box!.height).toBeLessThan(40);

    await expect(matrix).toHaveScreenshot("control-gallery-fine.png");
  });
});

test.describe("Control gallery — coarse pointer", () => {
  // hasTouch flips Chromium's `(any-pointer: coarse)` media query, activating
  // the Tailwind `coarse:` variant — the real 40px-floor path.
  test.use({ hasTouch: true });

  /**
   * Proves: under coarse-pointer emulation (`hasTouch: true`) the gallery
   * matrix renders pixel-identically to the committed baseline, and the chip
   * variant actually exercises its 40px coarse floor (the emulation took
   * effect — the capture is not a fine-pointer duplicate).
   *
   * Steps:
   * 1. Navigate to `/__controls` with `hasTouch: true`; wait for the matrix
   *    root + webfonts.
   * 2. Measure the `ctl-chip-rest` button; assert its height meets the 40px
   *    coarse touch floor.
   * 3. Screenshot the full matrix and compare against the `coarse` baseline.
   */
  test("matrix matches the baseline on a coarse pointer", async ({ page }) => {
    const matrix = await gotoGallery(page);

    const chip = page.getByTestId("ctl-chip-rest").getByRole("button");
    const box = await chip.boundingBox();
    expect(box, "chip cell has no bounding box").not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(40);

    await expect(matrix).toHaveScreenshot("control-gallery-coarse.png");
  });
});
