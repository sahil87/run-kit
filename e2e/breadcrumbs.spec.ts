import { test, expect } from "@playwright/test";
import { createTestSession, killTestSession, TEST_SESSION } from "./helpers";

test.describe("Breadcrumbs", () => {
  test.beforeAll(async () => {
    await createTestSession(TEST_SESSION);
  });

  test.afterAll(async () => {
    await killTestSession(TEST_SESSION);
  });

  test("Dashboard shows only logo, no text breadcrumbs", async ({ page }) => {
    await page.goto("/");
    const nav = page.locator('nav[aria-label="Breadcrumb"]');
    await expect(nav).toBeVisible();

    // Logo image should be present
    const logo = nav.locator('a[aria-label="RunKit home"] img');
    await expect(logo).toBeVisible();

    // No breadcrumb text segments (separator + label spans)
    const separators = nav.locator("text=›");
    await expect(separators).toHaveCount(0);
  });

  test("Project page shows logo > session name", async ({ page }) => {
    await page.goto(`/p/${TEST_SESSION}`);
    const nav = page.locator('nav[aria-label="Breadcrumb"]');
    await expect(nav).toBeVisible();

    // Logo present
    await expect(nav.locator('a[aria-label="RunKit home"]')).toBeVisible();

    // One separator and session name
    const segments = nav.locator(`text=${TEST_SESSION}`);
    await expect(segments.first()).toBeVisible();

    // No "project:" prefix
    await expect(nav.locator("text=project:")).toHaveCount(0);
  });

  test("Terminal page shows logo > session > window", async ({ page }) => {
    await page.goto(`/p/${TEST_SESSION}/0?name=main`);
    const nav = page.locator('nav[aria-label="Breadcrumb"]');
    await expect(nav).toBeVisible();

    // Session name is a link (non-final segment)
    const sessionLink = nav.locator(`a:has-text("${TEST_SESSION}")`);
    await expect(sessionLink).toBeVisible();
    const href = await sessionLink.getAttribute("href");
    expect(href).toContain(`/p/${TEST_SESSION}`);

    // Window name visible
    await expect(nav.locator("text=main")).toBeVisible();

    // No prefixes
    await expect(nav.locator("text=project:")).toHaveCount(0);
    await expect(nav.locator("text=window:")).toHaveCount(0);
  });

  test("non-final segments are links, final segment is not", async ({ page }) => {
    await page.goto(`/p/${TEST_SESSION}/0?name=main`);
    const nav = page.locator('nav[aria-label="Breadcrumb"]');

    // Logo is a link to dashboard
    const logoLink = nav.locator('a[aria-label="RunKit home"]');
    await expect(logoLink).toHaveAttribute("href", "/");

    // Session name is a link
    const sessionLink = nav.locator(`a:has-text("${TEST_SESSION}")`);
    await expect(sessionLink).toBeVisible();

    // Final segment (window name "main") should NOT be a link — it's a <span> with aria-current
    const currentPage = nav.locator('[aria-current="page"]');
    await expect(currentPage).toBeVisible();
    const tagName = await currentPage.evaluate((el) => el.tagName.toLowerCase());
    expect(tagName).toBe("span");
  });
});
