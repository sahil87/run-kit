import { test, expect, type Page } from "@playwright/test";
import { mockStateSocket } from "./_state-socket-mock";

// Row Minimalism (docs/specs/status-pyramid.md § Row Minimalism): the window
// ROW renders NO stage word and NO duration text — the row's externally
// visible status signals are the leading StatusDot plus, for a window with an
// owned PR, the rest-state PR glyph in the trailing cluster (the fixtures
// here carry no `prNumber`, so no glyph renders in these tests); the exact
// stage + durations live in the row flyout card and the PANE panel register
// view.
//
// Shared setup: fully mocked — no tmux server, no `gh`, no real backend
// reads (the isolated e2e tmux server has neither, and `gh` is unavailable in
// CI). `**/api/servers` serves a single `default` server;
// `**/api/windows/*/select*` answers 200 (window selection POST); the
// `/ws/terminals` mux WebSocket is stubbed so the terminal route mounts
// without churn; `/ws/state` (via mockStateSocket) serves a session `dev`
// with two windows — `@1` "feature-work", a fab window at stage `review`
// (active), and `@2` "scratch-shell", an idle agent window with a 2m idle
// duration. `beforeEach` installs the routes before navigation.

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
  await page.routeWebSocket(/\/ws\/terminals/, () => {});
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

  /**
   * Proves: the trailing status cluster (stage word + duration) is removed
   * from the window row — neither the "review" stage word nor the "2m"
   * duration appears anywhere in the sidebar navigation tree — while the
   * window names and the leading StatusDot remain.
   *
   * Steps:
   * 1. Navigate to `/default/1`; wait for the sidebar tree to populate from
   *    the mocked SSE frame.
   * 2. Assert both window names ("feature-work", "scratch-shell") are visible
   *    (the rows render).
   * 3. Scope to the sidebar tree (`role="tree"`) and assert it contains no
   *    exact "review" text (count 0) and no exact "2m" text (count 0).
   * 4. Assert the leading StatusDot is present as the status signal: the fab
   *    review window shows the blue `role="img"` dot with aria-label
   *    `building — at rest` (compositional vocabulary — the label composes hue
   *    word + liveness word, not the stage word; with no live agent the dot
   *    rests).
   */
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
    // a composed aria-label). The fab review window reads the blue
    // "building — at rest" dot (compositional vocabulary — review is a pre-PR
    // building stage, and with no live agent on the window the liveness shape
    // is the ring; rendered in both the tree row and the panel header, so
    // match the tree-scoped one).
    await expect(tree.getByRole("img", { name: "building — at rest" })).toBeVisible();
  });
});
