import { test, expect, type Page } from "@playwright/test";
import { openPalette } from "./_ready";
import { mockStateSocket } from "./_state-socket-mock";

// The screen-break Easter-egg layer, fired from the command palette. Fully
// mocked backend: the isolated e2e tmux server has no real sessions to view,
// so /api/servers answers one server `default` and /ws/state (via
// mockStateSocket) carries session `dev` with one window (@1) — the palette
// entries are global, so any mounted route works.
//
// Shared setup: beforeEach installs the routes below before navigation —
// **/api/servers → [default]; **/ws/state → the sessions payload;
// /ws/terminals and /api/windows/*/select are accepted-and-held stubs so the
// terminal route mounts cleanly (route globs carry a trailing `*` because the
// client appends `?server=`). The mount test opts OUT of the config-wide
// `reducedMotion: "reduce"` context (the layer never mounts under reduced
// motion — that gate is the feature's accessibility contract and the second
// test's subject) and pins a 1280×800 viewport (the store no-ops below 640 px
// wide).

const SERVER = "default";

const sessionsPayload = JSON.stringify([
  {
    name: "dev",
    windows: [
      {
        windowId: "@1",
        index: 0,
        name: "feature-work",
        worktreePath: "/tmp/wt",
        activity: "active",
        isActiveWindow: true,
        activityTimestamp: 0,
      },
    ],
  },
]);

async function mockBackend(page: Page) {
  await page.routeWebSocket(/\/ws\/terminals/, () => {
    /* accept and hold the socket open; send nothing */
  });
  await page.route("**/api/windows/*/select", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }),
  );
  await page.route("**/api/servers*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ name: SERVER, sessionCount: 1 }]),
    }),
  );
  await mockStateSocket(page, { sessions: sessionsPayload });
}

async function selectSmash(page: Page) {
  const input = await openPalette(page);
  await input.fill("Easter");
  await page.getByRole("option", { name: /^Easter egg: Smash/ }).click();
}

test.describe("screen-break eggs — motion allowed", () => {
  test.use({
    contextOptions: { reducedMotion: "no-preference" },
    viewport: { width: 1280, height: 800 },
  });

  test.beforeEach(async ({ page }) => {
    await mockBackend(page);
  });

  /**
   * Proves: the palette's `Easter egg: Smash` entry mounts the one-shot
   * screen-break layer over the app, and the layer detaches itself after the
   * ~4.2 s flight with the glass (`.app-root`) left clean of inline mutations.
   * Steps:
   * 1. Navigate to the mocked window route and open the palette.
   * 2. Filter to "Easter" and select `Easter egg: Smash`.
   * 3. Assert `[data-testid="screen-break"]` is visible (the flight started).
   * 4. Assert the layer detaches within 6 s (the rAF loop ran to t = 1).
   * 5. Assert `.app-root` carries no inline `clip-path` or `transform`.
   */
  test("palette Smash mounts the layer, which detaches after the flight with the glass cleaned", async ({
    page,
  }) => {
    await page.goto(`/${SERVER}/1`);
    await expect(
      page.getByTestId("status-bar").locator("[aria-label='Connected']"),
    ).toBeVisible();

    await selectSmash(page);

    await expect(page.getByTestId("screen-break")).toBeVisible();
    await expect(page.getByTestId("screen-break")).toHaveCount(0, { timeout: 6_000 });
    await expect(page.locator(".app-root")).not.toHaveAttribute("style", /clip-path/);
    await expect(page.locator(".app-root")).not.toHaveAttribute("style", /transform/);
  });
});

test.describe("screen-break eggs — reduced motion (config default)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test.beforeEach(async ({ page }) => {
    await mockBackend(page);
  });

  /**
   * Proves: under `prefers-reduced-motion: reduce` (the config-wide context
   * default) the palette entry is a silent no-op — the layer never mounts.
   * Steps:
   * 1. Navigate to the mocked window route and open the palette.
   * 2. Filter to "Easter" and select `Easter egg: Smash`.
   * 3. Wait past the mount window and assert no `[data-testid="screen-break"]`
   *    ever exists.
   */
  test("palette Smash under reduced motion never mounts the layer", async ({ page }) => {
    await page.goto(`/${SERVER}/1`);
    await expect(
      page.getByTestId("status-bar").locator("[aria-label='Connected']"),
    ).toBeVisible();

    await selectSmash(page);

    await page.waitForTimeout(600);
    await expect(page.getByTestId("screen-break")).toHaveCount(0);
  });
});
