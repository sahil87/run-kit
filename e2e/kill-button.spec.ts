import { test, expect } from "@playwright/test";
import { createTestSession, killTestSession, TEST_SESSION } from "./helpers";

test.describe("Kill Button Visibility", () => {
  test.beforeAll(async () => {
    await createTestSession(TEST_SESSION);
  });

  test.afterAll(async () => {
    await killTestSession(TEST_SESSION);
  });

  test("kill button visible on session card without hover", async ({ page }) => {
    await page.goto("/");
    // Wait for sessions to load
    await page.waitForSelector(`text=${TEST_SESSION}`);

    // Kill button on window card — always visible (no hover needed)
    const killButton = page.locator(`button[aria-label^="Kill window"]`).first();
    await expect(killButton).toBeVisible();
  });

  test("kill button visible on session header without hover", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(`text=${TEST_SESSION}`);

    // Kill button on session header
    const killSessionButton = page.locator(`button[aria-label="Kill session ${TEST_SESSION}"]`);
    await expect(killSessionButton).toBeVisible();
  });

  test("clicking kill button opens confirmation dialog", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(`text=${TEST_SESSION}`);

    // Click the session kill button
    const killButton = page.locator(`button[aria-label="Kill session ${TEST_SESSION}"]`);
    await killButton.click();

    // Confirmation dialog appears
    const dialog = page.locator("text=Kill session?");
    await expect(dialog).toBeVisible();

    // Cancel and Kill buttons in dialog
    await expect(page.locator("button", { hasText: "Cancel" })).toBeVisible();
    await expect(page.locator("button", { hasText: "Kill" }).last()).toBeVisible();

    // Dismiss dialog without killing
    await page.locator("button", { hasText: "Cancel" }).click();
    await expect(dialog).not.toBeVisible();
  });
});
