import { test, expect } from "@playwright/test";
import { createTestSession, killTestSession, TEST_SESSION } from "./helpers";

test.describe("Mobile Viewport", () => {
  test.beforeAll(async () => {
    await createTestSession(TEST_SESSION);
  });

  test.afterAll(async () => {
    await killTestSession(TEST_SESSION);
  });

  test("bottom bar renders on mobile terminal page", async ({ page }) => {
    await page.goto(`/p/${TEST_SESSION}/0?name=main`);
    const toolbar = page.locator('[role="toolbar"][aria-label="Terminal keys"]');
    await expect(toolbar).toBeVisible();
  });

  test("bottom bar buttons meet minimum tap height", async ({ page }) => {
    await page.goto(`/p/${TEST_SESSION}/0?name=main`);
    const toolbar = page.locator('[role="toolbar"][aria-label="Terminal keys"]');
    await expect(toolbar).toBeVisible();

    const buttons = toolbar.locator("button");
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const box = await buttons.nth(i).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(30);
    }
  });

  test("command-K badge visible on mobile (not yet hidden per design spec)", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("header");

    // Current implementation: ⌘K badge is always rendered, even on mobile.
    // The design spec says it should be hidden on mobile and replaced by ⋯,
    // but that hasn't been implemented yet. This test documents current behavior.
    // TODO: When mobile Line 2 collapse is implemented, flip to expect not visible.
    const cmdKBadge = page.locator("kbd", { hasText: "⌘K" });
    await expect(cmdKBadge).toBeVisible();
  });
});
