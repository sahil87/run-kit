import { test, expect, type Page } from "@playwright/test";
import { mockStateSocket } from "./_state-socket-mock";

// Session-row and server-tile identity tips (xb77) — the slim tier-1-weight
// hover-cards sharing the window flyout's title-bar grammar: title bar =
// identity (`Session <full name>` / `Server <name>`), body = one plain-text
// facts line (`$N · N windows · ~/{path}` / `tmux -L <name> · N sessions`).
// Fully mocked, same idiom as row-flyout.spec.ts — see the sibling .spec.md
// for intent + steps.

const SERVER = "default";

const sessionsPayload = JSON.stringify([
  {
    name: "dev",
    sessionId: "$4",
    sessionPath: "/home/sahil/code/sahil87/run-kit",
    windows: [
      {
        windowId: "@1",
        index: 0,
        name: "feature-work",
        worktreePath: "/tmp/wt",
        activity: "idle",
        isActiveWindow: true,
        activityTimestamp: 0,
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

async function mockBackend(page: Page) {
  await page.routeWebSocket(/\/ws\/terminals/, () => {
    /* accept and hold the socket open; send nothing */
  });

  await page.route("**/api/servers", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ name: SERVER, sessionCount: 1 }]),
    }),
  );

  await mockStateSocket(page, { sessions: sessionsPayload });
}

const sessionRow = (page: Page) =>
  page.locator("[role='treeitem'][data-session-row='default:dev']");
const serverTile = (page: Page) => page.getByRole("option", { name: "default" });
const sessionTip = (page: Page) => page.getByTestId("session-tip");
const serverTip = (page: Page) => page.getByTestId("server-tip");

test.describe("Session/server identity tips (fine pointer)", () => {
  test.beforeEach(async ({ page }) => {
    await mockBackend(page);
    await page.goto(`/${SERVER}`);
    await expect(sessionRow(page)).toBeVisible({ timeout: 10_000 });
    await expect(serverTile(page)).toBeVisible();
  });

  test("hovering a session row opens its identity tip (full name + $N · N windows · ~/path)", async ({
    page,
  }) => {
    await expect(sessionTip(page)).toHaveCount(0);
    await sessionRow(page).hover();

    const tip = sessionTip(page);
    await expect(tip).toBeVisible();
    // Title bar = identity: the full (untruncated) session name.
    await expect(tip.getByTestId("popup-title-bar")).toContainText("Session dev");
    // Body = facts: tmux session id, window count, ~-abbreviated root path.
    await expect(tip).toContainText("$4 · 2 windows · ~/code/sahil87/run-kit");
    // Tier-1 weight: no interactive content.
    await expect(tip.locator("a, button")).toHaveCount(0);
  });

  test("keyboard: focusing a session row opens the tip; Escape dismisses it", async ({ page }) => {
    await sessionRow(page).focus();
    await expect(sessionTip(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sessionTip(page)).toHaveCount(0);
  });

  test("hovering a server tile opens its identity tip (socket flag); the tile has no native title", async ({
    page,
  }) => {
    // The native title attribute is REPLACED by the card (the double-tooltip
    // rule) — assert its absence before opening anything.
    await expect(serverTile(page)).not.toHaveAttribute("title");
    await expect(serverTip(page)).toHaveCount(0);

    await serverTile(page).hover();
    const tip = serverTip(page);
    await expect(tip).toBeVisible();
    await expect(tip.getByTestId("popup-title-bar")).toContainText("Server default");
    await expect(tip).toContainText("tmux -L default · 1 session");
    await expect(tip.locator("a, button")).toHaveCount(0);
  });
});
