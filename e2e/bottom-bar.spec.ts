import { test, expect } from "@playwright/test";
import { createTestSession, killTestSession, TEST_SESSION } from "./helpers";

test.describe("Bottom Bar", () => {
  test.beforeAll(async () => {
    await createTestSession(TEST_SESSION);
  });

  test.afterAll(async () => {
    await killTestSession(TEST_SESSION);
  });

  test("visible on terminal page only", async ({ page }) => {
    const toolbar = page.locator('[role="toolbar"][aria-label="Terminal keys"]');

    // Dashboard — no bottom bar
    await page.goto("/");
    await page.waitForSelector("header");
    await expect(toolbar).toHaveCount(0);

    // Project page — no bottom bar
    await page.goto(`/p/${TEST_SESSION}`);
    await page.waitForSelector("header");
    await expect(toolbar).toHaveCount(0);

    // Terminal page — bottom bar present
    await page.goto(`/p/${TEST_SESSION}/0?name=main`);
    await expect(toolbar).toBeVisible();
  });

  test("modifier key armed state", async ({ page }) => {
    await page.goto(`/p/${TEST_SESSION}/0?name=main`);
    const ctrlButton = page.locator('button[aria-label="Control"]');
    await expect(ctrlButton).toBeVisible();

    // Initially not armed
    await expect(ctrlButton).toHaveAttribute("aria-pressed", "false");

    // Click to arm
    await ctrlButton.click();
    await expect(ctrlButton).toHaveAttribute("aria-pressed", "true");
  });

  test("Fn dropdown opens and closes on selection", async ({ page }) => {
    await page.goto(`/p/${TEST_SESSION}/0?name=main`);
    const fnButton = page.locator('button[aria-label="Function keys"]');
    await expect(fnButton).toBeVisible();

    // Open dropdown
    await fnButton.click();
    const menu = page.locator('[role="menu"][aria-label="Function keys"]');
    await expect(menu).toBeVisible();

    // Verify F1 through F12 buttons exist
    for (let i = 1; i <= 12; i++) {
      await expect(menu.locator(`button[aria-label="F${i}"]`)).toBeVisible();
    }

    // Click F1 — dropdown should close
    await menu.locator('button[aria-label="F1"]').click();
    await expect(menu).not.toBeVisible();
  });

  test("Esc and Tab buttons present", async ({ page }) => {
    await page.goto(`/p/${TEST_SESSION}/0?name=main`);
    const toolbar = page.locator('[role="toolbar"][aria-label="Terminal keys"]');

    await expect(toolbar.locator('button[aria-label="Escape"]')).toBeVisible();
    await expect(toolbar.locator('button[aria-label="Tab"]')).toBeVisible();
  });

  test("Compose text button present", async ({ page }) => {
    await page.goto(`/p/${TEST_SESSION}/0?name=main`);
    const toolbar = page.locator('[role="toolbar"][aria-label="Terminal keys"]');
    await expect(toolbar.locator('button[aria-label="Compose text"]')).toBeVisible();
  });
});
