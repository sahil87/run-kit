import { test, expect } from "@playwright/test";
import { createTestSession, killTestSession, TEST_SESSION } from "./helpers";

test.describe("Chrome Stability", () => {
  test.beforeAll(async () => {
    await createTestSession(TEST_SESSION);
  });

  test.afterAll(async () => {
    await killTestSession(TEST_SESSION);
  });

  test("top bar bounding box stays constant across all pages", async ({ page }) => {
    // Dashboard
    await page.goto("/");
    await page.waitForSelector("header");
    const dashboardBox = await page.locator("header").boundingBox();
    expect(dashboardBox).not.toBeNull();

    // Project page
    await page.goto(`/p/${TEST_SESSION}`);
    await page.waitForSelector("header");
    const projectBox = await page.locator("header").boundingBox();
    expect(projectBox).not.toBeNull();
    expect(projectBox!.y).toBeCloseTo(dashboardBox!.y, 0);
    expect(projectBox!.height).toBeCloseTo(dashboardBox!.height, 0);

    // Terminal page — need a window index, use 0
    await page.goto(`/p/${TEST_SESSION}/0?name=main`);
    await page.waitForSelector("header");
    const terminalBox = await page.locator("header").boundingBox();
    expect(terminalBox).not.toBeNull();
    expect(terminalBox!.y).toBeCloseTo(dashboardBox!.y, 0);
    expect(terminalBox!.height).toBeCloseTo(dashboardBox!.height, 0);

    // Back to dashboard
    await page.goto("/");
    await page.waitForSelector("header");
    const returnBox = await page.locator("header").boundingBox();
    expect(returnBox).not.toBeNull();
    expect(returnBox!.y).toBeCloseTo(dashboardBox!.y, 0);
    expect(returnBox!.height).toBeCloseTo(dashboardBox!.height, 0);
  });

  test("Line 2 maintains minimum height on all pages", async ({ page }) => {
    // Line 2 is the last child div of <header>, which has min-h-[36px]
    const line2 = page.locator("header > div:last-child");

    // Dashboard — Line 2 has content (action buttons + summary)
    await page.goto("/");
    await expect(line2).toBeVisible();
    const dashLine2 = await line2.boundingBox();
    expect(dashLine2).not.toBeNull();
    expect(dashLine2!.height).toBeGreaterThanOrEqual(36);

    // Project page
    await page.goto(`/p/${TEST_SESSION}`);
    await expect(line2).toBeVisible();
    const projLine2 = await line2.boundingBox();
    expect(projLine2).not.toBeNull();
    expect(projLine2!.height).toBeGreaterThanOrEqual(36);

    // Terminal page
    await page.goto(`/p/${TEST_SESSION}/0?name=main`);
    await expect(line2).toBeVisible();
    const termLine2 = await line2.boundingBox();
    expect(termLine2).not.toBeNull();
    expect(termLine2!.height).toBeGreaterThanOrEqual(36);
  });

  test("chrome container has max-width 896px on all pages", async ({ page }) => {
    // The chrome wrapper is the first child of .app-shell > .shrink-0, containing TopBarChrome
    // We verify the computed max-width of the container that wraps the header
    const chromeWrapper = page.locator("header").locator("..");

    await page.goto("/");
    await expect(chromeWrapper).toBeVisible();
    const dashWidth = await chromeWrapper.evaluate(
      (el) => getComputedStyle(el).maxWidth,
    );
    expect(dashWidth).toBe("896px");

    await page.goto(`/p/${TEST_SESSION}`);
    await expect(chromeWrapper).toBeVisible();
    const projWidth = await chromeWrapper.evaluate(
      (el) => getComputedStyle(el).maxWidth,
    );
    expect(projWidth).toBe("896px");

    await page.goto(`/p/${TEST_SESSION}/0?name=main`);
    await expect(chromeWrapper).toBeVisible();
    const termWidth = await chromeWrapper.evaluate(
      (el) => getComputedStyle(el).maxWidth,
    );
    expect(termWidth).toBe("896px");
  });
});
