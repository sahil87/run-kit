import { test, expect, type Page } from "@playwright/test";

// This spec is fully mocked: the isolated e2e tmux server has no real
// change-bound PRs and `gh` is unavailable in CI, so we inject the SSE
// `sessions` payload (and the server list) via page.route. That lets us
// exercise the frontend display gate deterministically without any network or
// gh dependency. See pr-status-sidebar.spec.md for intent + steps.

const SERVER = "default";

// One change-bound window with a PR (gate satisfied) and one scratch window
// with NO fabChange (gate fails — PR line must be absent even if a prNumber
// were present). The change-bound window carries prState/prChecks/prReview as
// the backend SSE join would attach them.
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
        fabChange: "260610-596o-pr-status-sidebar",
        fabStage: "apply",
        prUrl: "https://github.com/o/r/pull/386",
        prNumber: 386,
        prState: "open",
        prChecks: "pass",
        prReview: "approved",
      },
      {
        windowId: "@2",
        index: 1,
        name: "scratch-shell",
        worktreePath: "/tmp/scratch",
        activity: "idle",
        isActiveWindow: false,
        activityTimestamp: 0,
      },
    ],
  },
]);

/** Install routes that fully mock the server list and the SSE sessions stream. */
async function mockBackend(page: Page) {
  // Single known server so the app attaches exactly one SSE connection.
  await page.route("**/api/servers", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ name: SERVER, sessionCount: 1 }]),
    }),
  );

  // SSE stream: emit one `sessions` event carrying the mocked payload. The
  // body is a complete SSE frame; EventSource parses the event, then may
  // reconnect and receive the same frame again — idempotent for our assertions.
  await page.route("**/api/sessions/stream*", (route) =>
    route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
      body: `event: sessions\ndata: ${sessionsPayload}\n\n`,
    }),
  );
}

test.describe("Sidebar PR status line", () => {
  test.beforeEach(async ({ page }) => {
    await mockBackend(page);
  });

  test("renders the PR line for a change-bound window and hides it for a scratch window", async ({
    page,
  }) => {
    await page.goto(`/${SERVER}`);

    const sidebar = page.locator("nav[aria-label='Sessions']");
    await expect(sidebar).toBeVisible();

    // Change-bound window (@1) shows the PR line, linking to the PR URL.
    const boundRow = sidebar.locator("[data-window-id='@1']");
    const prLine = boundRow.locator("[data-testid='pr-status-line']");
    await expect(prLine).toBeVisible();
    await expect(prLine).toContainText("PR #386");
    await expect(prLine).toContainText("open");
    const link = boundRow.locator("[data-testid='pr-status-link']");
    await expect(link).toHaveAttribute("href", "https://github.com/o/r/pull/386");
    await expect(link).toHaveAttribute("target", "_blank");

    // Scratch window (@2) is not change-bound → no PR line.
    const scratchRow = sidebar.locator("[data-window-id='@2']");
    await expect(scratchRow).toBeVisible();
    await expect(scratchRow.locator("[data-testid='pr-status-line']")).toHaveCount(0);
  });

  test("PR line renders at 375px (mobile) and 1024px (desktop)", async ({ page }) => {
    // Mobile: the sidebar is a drawer — open it via the top-bar toggle, then
    // assert the PR line renders within the mobile drawer's Sessions nav.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/${SERVER}`);
    await page.locator("button[aria-label='Toggle navigation']").click();
    const mobileSidebar = page.locator("nav[aria-label='Sessions']");
    await expect(mobileSidebar).toBeVisible();
    await expect(
      mobileSidebar.locator("[data-window-id='@1'] [data-testid='pr-status-line']"),
    ).toContainText("PR #386");

    // Desktop: the sidebar is a persistent column — the PR line still renders.
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto(`/${SERVER}`);
    const desktopSidebar = page.locator("nav[aria-label='Sessions']");
    await expect(
      desktopSidebar.locator("[data-window-id='@1'] [data-testid='pr-status-line']"),
    ).toContainText("PR #386");
  });
});
