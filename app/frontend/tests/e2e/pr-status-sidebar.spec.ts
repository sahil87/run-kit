import { test, expect, type Page } from "@playwright/test";

// This spec is fully mocked: the isolated e2e tmux server has no real
// change-bound PRs and `gh` is unavailable in CI, so we inject the SSE
// `sessions` payload (and the server list) via page.route. That lets us
// exercise the frontend display gate deterministically without any network or
// gh dependency. See pr-status-sidebar.spec.md for intent + steps.
//
// PR status renders in the Pane panel (the per-window metadata panel in the
// sidebar), NOT on the window-tree rows — so each assertion first selects the
// target window, then reads the Pane panel.

const SERVER = "default";

// One change-bound window with a PR (gate satisfied) and one scratch window
// with NO fabChange (gate fails — PR row must be absent even if a prNumber
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

// The Pane panel renders the *selected* window (URL `/$server/$window`), so the
// tests navigate to the window route. `@` is percent-encoded in the path.
const BOUND_WINDOW_URL = `/${SERVER}/%401`; // @1 — change-bound window with a PR
const SCRATCH_WINDOW_URL = `/${SERVER}/%402`; // @2 — scratch window, no PR

/** Install routes that fully mock the server list and the SSE sessions stream. */
async function mockBackend(page: Page) {
  // Stub the relay WebSocket so the terminal route mounts without a backend —
  // the Pane panel lives in the sidebar and renders regardless, but stubbing
  // the WS keeps the page from churning on failed relay reconnects.
  await page.routeWebSocket(/\/relay\//, () => {
    /* accept and hold the socket open; send nothing */
  });

  // Selecting a window POSTs to /select — accept it so clicks/nav don't error.
  await page.route("**/api/windows/*/select", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }),
  );

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

test.describe("Pane panel PR status", () => {
  test.beforeEach(async ({ page }) => {
    await mockBackend(page);
  });

  test("Pane panel shows the PR row for a change-bound window and hides it for a scratch window", async ({
    page,
  }) => {
    // Select the change-bound window (@1) — the Pane panel reflects the selected
    // window, which is keyed off the URL's window segment.
    await page.goto(BOUND_WINDOW_URL);

    // Change-bound window (@1): Pane panel carries the pr row.
    const prRow = page.locator("[title='https://github.com/o/r/pull/386']");
    await expect(prRow).toBeVisible();
    await expect(prRow).toContainText("#386");
    await expect(prRow).toContainText("open");

    // Scratch window (@2) — not change-bound → no pr row.
    await page.goto(SCRATCH_WINDOW_URL);
    await expect(page.locator("[title='https://github.com/o/r/pull/386']")).toHaveCount(0);
    // No PR-number text anywhere in the Pane panel for the scratch window.
    await expect(page.getByText(/#386/)).toHaveCount(0);
  });

  test("Pane panel PR row renders at 375px (mobile) and 1024px (desktop)", async ({ page }) => {
    // Mobile: open the sidebar drawer (which hosts the Pane panel), assert the
    // pr row for the selected change-bound window (@1).
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(BOUND_WINDOW_URL);
    await page.locator("button[aria-label='Toggle navigation']").click();
    await expect(
      page.locator("[title='https://github.com/o/r/pull/386']"),
    ).toContainText("#386");

    // Desktop: persistent sidebar column — the pr row still renders.
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto(BOUND_WINDOW_URL);
    await expect(
      page.locator("[title='https://github.com/o/r/pull/386']"),
    ).toContainText("#386");
  });
});
