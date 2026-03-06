import { test, expect } from "@playwright/test";
import { createTestSession, killTestSession, TEST_SESSION } from "./helpers";

test.describe("Compose Buffer", () => {
  test.beforeAll(async () => {
    await createTestSession(TEST_SESSION);
  });

  test.afterAll(async () => {
    await killTestSession(TEST_SESSION);
  });

  test("opens when compose button is clicked", async ({ page }) => {
    await page.goto(`/p/${TEST_SESSION}/0?name=main`);
    const composeButton = page.locator('button[aria-label="Compose text"]');
    await expect(composeButton).toBeVisible();

    // Click compose
    await composeButton.click();

    // Textarea appears
    const textarea = page.locator('textarea[aria-label="Compose text to send to terminal"]');
    await expect(textarea).toBeVisible();

    // Terminal dims when compose is open
    const terminal = page.locator('[role="application"]');
    const opacity = await terminal.evaluate((el) => getComputedStyle(el).opacity);
    expect(Number(opacity)).toBeLessThan(1);
  });

  test("dismisses on Escape", async ({ page }) => {
    await page.goto(`/p/${TEST_SESSION}/0?name=main`);

    // Open compose
    await page.locator('button[aria-label="Compose text"]').click();
    const textarea = page.locator('textarea[aria-label="Compose text to send to terminal"]');
    await expect(textarea).toBeVisible();

    // Press Escape
    await textarea.press("Escape");

    // Textarea disappears
    await expect(textarea).not.toBeVisible();

    // Terminal opacity returns to normal
    const terminal = page.locator('[role="application"]');
    const opacity = await terminal.evaluate((el) => getComputedStyle(el).opacity);
    expect(Number(opacity)).toBe(1);
  });

  test("Send button is visible when compose is open", async ({ page }) => {
    await page.goto(`/p/${TEST_SESSION}/0?name=main`);
    await page.locator('button[aria-label="Compose text"]').click();

    const sendButton = page.locator("button", { hasText: "Send" });
    await expect(sendButton).toBeVisible();
  });

  test("accepts multiline text", async ({ page }) => {
    await page.goto(`/p/${TEST_SESSION}/0?name=main`);
    await page.locator('button[aria-label="Compose text"]').click();

    const textarea = page.locator('textarea[aria-label="Compose text to send to terminal"]');
    await textarea.fill("line 1\nline 2\nline 3");

    const value = await textarea.inputValue();
    expect(value).toContain("\n");
    expect(value.split("\n")).toHaveLength(3);
  });
});
