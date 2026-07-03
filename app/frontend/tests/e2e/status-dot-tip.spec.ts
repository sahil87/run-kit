import { test, expect, type Page } from "@playwright/test";

// This spec is fully mocked: the isolated e2e tmux server has no real
// change-bound PRs and `gh` is unavailable in CI, so we inject the SSE
// `sessions` payload (and the server list) via page.route. That lets us
// exercise the custom status-dot hover-card (StatusDotTip) deterministically.
// See status-dot-tip.spec.md for intent + steps.
//
// The status dot renders on the sidebar window-tree rows (leading position).
// We target it by its accessible name: a change-bound PR window with passing
// checks reads "PR — open".

const SERVER = "default";

// One change-bound window WITH a PR (purple "PR — open" dot, gets the PR link)
// and one plain scratch window (gray "idle" dot, no PR link, docs icon only).
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
        fabChange: "260616-37ub-status-dot-tooltip",
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
  await page.routeWebSocket(/\/relay\//, () => {
    /* accept and hold the socket open; send nothing */
  });

  await page.route("**/api/windows/*/select", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }),
  );

  await page.route("**/api/servers", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ name: SERVER, sessionCount: 1 }]),
    }),
  );

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

/** The purple PR dot on the change-bound window row reads "PR — open". */
function prDot(page: Page) {
  return page.getByRole("img", { name: "PR — open" });
}

/** The gray dot on the scratch window row reads "idle". */
function scratchDot(page: Page) {
  return page.getByRole("img", { name: "idle" });
}

const card = (page: Page) => page.getByTestId("status-dot-tip");

test.describe("Status-dot hover-card", () => {
  test.beforeEach(async ({ page }) => {
    await mockBackend(page);
    await page.goto(`/${SERVER}`);
    // Wait for the SSE payload to render the change-bound window's dot.
    await expect(prDot(page)).toBeVisible({ timeout: 10_000 });
  });

  test("hovering a PR dot opens a card with the label, PR link, and docs link", async ({
    page,
  }) => {
    await prDot(page).hover();
    await expect(card(page)).toBeVisible();
    // Card carries the dot's label text.
    await expect(card(page)).toContainText("PR — open");
    // PR-phase dot → the "Open PR #N" link to prUrl, in a new tab.
    const prLink = page.getByTestId("dot-tip-pr-link");
    await expect(prLink).toBeVisible();
    await expect(prLink).toHaveText("Open PR #386");
    await expect(prLink).toHaveAttribute("href", "https://github.com/o/r/pull/386");
    await expect(prLink).toHaveAttribute("target", "_blank");
    await expect(prLink).toHaveAttribute("rel", "noopener noreferrer");
    // Docs link present on every dot.
    const docsLink = page.getByTestId("dot-tip-docs-link");
    await expect(docsLink).toBeVisible();
    await expect(docsLink).toHaveAttribute(
      "href",
      "https://github.com/sahil87/run-kit/blob/main/docs/site/status-dot.md",
    );
    await expect(docsLink).toHaveAttribute("target", "_blank");
  });

  test("a non-PR dot's card shows the docs link but NO PR link", async ({ page }) => {
    await scratchDot(page).hover();
    await expect(card(page)).toBeVisible();
    await expect(card(page)).toContainText("idle");
    await expect(page.getByTestId("dot-tip-docs-link")).toBeVisible();
    await expect(page.getByTestId("dot-tip-pr-link")).toHaveCount(0);
  });

  test("the PR link does not select/navigate the window row (stopPropagation)", async ({
    page,
  }) => {
    await prDot(page).hover();
    await expect(card(page)).toBeVisible();
    // Block the new-tab navigation so the assertion stays on the SPA route.
    const prLink = page.getByTestId("dot-tip-pr-link");
    await prLink.evaluate((a) => a.removeAttribute("href"));
    await prLink.click();
    // The click did not bubble to the row → still on the server route, not a
    // window route (/default/1).
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/?$`));
  });

  test("focusing the dot via keyboard opens the card (keyboard-first)", async ({ page }) => {
    // Focus the dot directly (the span carries the floating-ui focus handlers).
    await prDot(page).focus();
    await expect(card(page)).toBeVisible();
    await expect(card(page)).toContainText("PR — open");
  });

  test("Escape dismisses an open card", async ({ page }) => {
    await prDot(page).hover();
    await expect(card(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(card(page)).toHaveCount(0);
  });
});
