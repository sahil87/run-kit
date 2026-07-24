import { test, expect, type Page } from "@playwright/test";

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";
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

test.describe("Bottom bar chip size — fine pointer", () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test("all chips share one size at mobile width", async ({ page }) => {
    await page.goto(`/${TMUX_SERVER}`);
    const sizes = await collectChipSizes(page);

    expect(
      distinctSizes(sizes),
      `chips diverge: ${JSON.stringify(sizes)}`,
    ).toHaveLength(1);
  });
});
