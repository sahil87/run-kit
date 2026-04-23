import { test, expect } from "@playwright/test";

const PINS_STORAGE_KEY = "runkit-lanes-pins";

test.describe("Lanes page", () => {
  test.afterEach(async ({ page }) => {
    // Clean up localStorage pins so tests are independent
    await page.evaluate((key) => localStorage.removeItem(key), PINS_STORAGE_KEY);
  });

  test("empty state renders when no pins exist", async ({ page }) => {
    await page.goto("/lanes");

    await expect(page.getByText("No panes pinned")).toBeVisible();
    await expect(
      page.getByText(
        "Pin windows from the sidebar or command palette to monitor them here",
      ),
    ).toBeVisible();
    await expect(page.getByText("Back to server list")).toBeVisible();
  });

  test("Lanes title and chrome are present", async ({ page }) => {
    await page.goto("/lanes");

    await expect(page.getByText("Lanes")).toBeVisible();
    // Back link to root
    const backLink = page.locator("a", { hasText: "Run Kit" });
    await expect(backLink).toBeVisible();
    await expect(backLink).toHaveAttribute("href", "/");
  });

  test("pin a window via localStorage and verify lane appears after reload", async ({
    page,
  }) => {
    // Start at empty lanes page
    await page.goto("/lanes");
    await expect(page.getByText("No panes pinned")).toBeVisible();

    // Inject a pin into localStorage (simulating what the sidebar/command palette does)
    const pin = { server: "default", session: "test-session", windowIndex: 0 };
    await page.evaluate(
      ({ key, pins }) => localStorage.setItem(key, JSON.stringify(pins)),
      { key: PINS_STORAGE_KEY, pins: [pin] },
    );

    // Reload to pick up the localStorage change
    await page.reload();

    // The empty state should be gone
    await expect(page.getByText("No panes pinned")).not.toBeVisible();

    // The lane should render (via its aria-label)
    await expect(
      page.locator("[aria-label='Lane: default/test-session/0']"),
    ).toBeVisible({ timeout: 10_000 });

    // Pin count badge should show 1
    await expect(page.locator("header").getByText("1")).toBeVisible();
  });

  test("unpin via localStorage and verify lane removal after reload", async ({
    page,
  }) => {
    const pin = { server: "default", session: "test-session", windowIndex: 0 };

    // Pre-seed a pin
    await page.goto("/lanes");
    await page.evaluate(
      ({ key, pins }) => localStorage.setItem(key, JSON.stringify(pins)),
      { key: PINS_STORAGE_KEY, pins: [pin] },
    );
    await page.reload();

    // Lane should be visible
    await expect(
      page.locator("[aria-label='Lane: default/test-session/0']"),
    ).toBeVisible({ timeout: 10_000 });

    // Remove the pin from localStorage
    await page.evaluate(
      ({ key }) => localStorage.setItem(key, JSON.stringify([])),
      { key: PINS_STORAGE_KEY },
    );
    await page.reload();

    // Empty state should return
    await expect(page.getByText("No panes pinned")).toBeVisible();
  });

  test("multiple pins render multiple lanes", async ({ page }) => {
    const pins = [
      { server: "default", session: "work", windowIndex: 0 },
      { server: "default", session: "work", windowIndex: 1 },
      { server: "remote", session: "build", windowIndex: 0 },
    ];

    await page.goto("/lanes");
    await page.evaluate(
      ({ key, data }) => localStorage.setItem(key, JSON.stringify(data)),
      { key: PINS_STORAGE_KEY, data: pins },
    );
    await page.reload();

    // All three lanes should be visible
    await expect(
      page.locator("[aria-label='Lane: default/work/0']"),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator("[aria-label='Lane: default/work/1']"),
    ).toBeVisible();
    await expect(
      page.locator("[aria-label='Lane: remote/build/0']"),
    ).toBeVisible();

    // Pin count badge should show 3
    await expect(page.locator("header").getByText("3")).toBeVisible();
  });
});
