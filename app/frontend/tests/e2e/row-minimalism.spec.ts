import { test, expect, type Page } from "@playwright/test";
import { mockStateSocket } from "./_state-socket-mock";

// Fully mocked (no tmux/gh) — inject the SSE `sessions` payload + server list
// via page.route, exercising the frontend Row-Minimalism display rule
// deterministically. See row-minimalism.spec.md for intent + steps.
//
// Row Minimalism (260706-y1ar; status-pyramid.md § Row Minimalism): the window
// ROW renders NO stage word and NO duration text — the leading StatusDot is the
// row's only externally visible status signal.

const SERVER = "default";

// A fab window at `review` (would previously print a "review" stage word + a
// duration) and an idle agent window (would previously print "idle 2m"). Under
// Row Minimalism neither string appears in the sidebar tree.
const sessionsPayload = JSON.stringify([
  {
    name: "dev",
    windows: [
      {
        windowId: "@1",
        index: 0,
        name: "feature-work",
        worktreePath: "/tmp/wt",
        activity: "idle",
        isActiveWindow: true,
        activityTimestamp: 0,
        fabChange: "260706-y1ar-status-pyramid-ui-surfacing",
        fabStage: "review",
        fabDisplayState: "active",
      },
      {
        windowId: "@2",
        index: 1,
        name: "scratch-shell",
        worktreePath: "/tmp/scratch",
        activity: "idle",
        isActiveWindow: false,
        activityTimestamp: 0,
        agentState: "idle",
        agentIdleDuration: "2m",
      },
    ],
  },
]);

async function mockBackend(page: Page) {
  await page.routeWebSocket(/\/relay\//, () => {});
  await page.route("**/api/windows/*/select*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }),
  );
  await page.route("**/api/servers", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ name: SERVER, sessionCount: 1 }]),
    }),
  );
  await mockStateSocket(page, { sessions: sessionsPayload });
}

test.describe("Row Minimalism", () => {
  test.beforeEach(async ({ page }) => {
    await mockBackend(page);
  });

  test("window rows show no stage word and no duration text (only the dot + name)", async ({ page }) => {
    await page.goto(`/${SERVER}/1`);

    // Wait for the sidebar tree to populate from the mocked SSE frame.
    const tree = page.locator("[role='tree']");
    await expect(tree).toBeVisible({ timeout: 10_000 });
    await expect(tree.locator("[role='treeitem']").first()).toBeVisible({ timeout: 10_000 });

    // The window-tree rows render the window names.
    await expect(tree.getByText("feature-work")).toBeVisible();
    await expect(tree.getByText("scratch-shell")).toBeVisible();

    // Row Minimalism: the tree carries NO stage word and NO duration text — the
    // dot is the row's only status signal.
    await expect(tree.getByText("review", { exact: true })).toHaveCount(0);
    await expect(tree.getByText("2m", { exact: true })).toHaveCount(0);

    // The leading StatusDot IS present as the row's status signal (role=img with
    // a composed aria-label). The fab review window reads the green
    // "review — active" dot (rendered in both the tree row and the panel header,
    // so match the tree-scoped one).
    await expect(tree.getByRole("img", { name: "review — active" })).toBeVisible();
  });
});
