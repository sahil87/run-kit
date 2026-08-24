import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { mockStateSocket } from "./_state-socket-mock";

// Fully mocked host-page spec: the server list comes from a `GET /api/servers`
// route fulfill, the state socket is the shared protocol mock. The rk-daemon
// server's sessions carry rk-jobs (one window) + rk-remotes (two windows) and
// NO rk-code-server session, so the card proves the running/not-running fork.
// The version slot carries the additive started/port fields (a ~1h-old daemon).
const STARTED = Math.floor(Date.now() / 1000) - 3600;

const DAEMON_SESSIONS = JSON.stringify([
  {
    name: "rk-jobs",
    windows: [
      {
        windowId: "@7",
        index: 0,
        name: "update-check",
        worktreePath: "/tmp",
        activity: "idle",
        isActiveWindow: true,
        activityTimestamp: 0,
      },
    ],
  },
  {
    name: "rk-remotes",
    windows: [
      {
        windowId: "@11",
        index: 0,
        name: "box-1",
        worktreePath: "/tmp",
        activity: "idle",
        isActiveWindow: true,
        activityTimestamp: 0,
      },
      {
        windowId: "@12",
        index: 1,
        name: "box-2",
        worktreePath: "/tmp",
        activity: "idle",
        isActiveWindow: false,
        activityTimestamp: 0,
      },
    ],
  },
]);

const REGULAR_SESSIONS = JSON.stringify([{ name: "main", windows: [] }]);

async function mockBackend(page: Page) {
  await page.routeWebSocket(/\/ws\/terminals/, () => {
    /* accept and hold the socket open; send nothing */
  });

  await page.route("**/api/servers", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { name: "regular", sessionCount: 1 },
        { name: "rk-daemon", sessionCount: 2 },
      ]),
    }),
  );

  await mockStateSocket(page, {
    sessionsByServer: {
      "rk-daemon": DAEMON_SESSIONS,
      regular: REGULAR_SESSIONS,
    },
    version: { version: "3.9.1", boot: "b1", brew: false, started: STARTED, port: 3000 },
  });
}

test.describe("run-kit system card (HOST HEALTH zone)", () => {
  test("renders the daemon line, service rows, and the rk-daemon shield glyph on the tile grid", async ({
    page,
  }) => {
    await mockBackend(page);
    await page.goto("/");

    // The card renders inside the Host health zone (no metrics slot was
    // mocked — the card is independent of the metrics stream).
    const zone = page.getByRole("region", { name: "Host health" });
    const card = zone.getByLabel("run-kit system");
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText("v3.9.1");
    await expect(card).toContainText("up 1h");
    await expect(card).toContainText(":3000");
    await expect(card.getByRole("button", { name: "Restart" })).toBeVisible();

    // Service rows: jobs + remotes running with View links, code-server not
    // running with none.
    await expect(card.getByText("1 job")).toBeVisible();
    await expect(card.getByText("2 tunnels")).toBeVisible();
    await expect(card.getByText("not running")).toBeVisible();
    await expect(card.getByRole("button", { name: "View" })).toHaveCount(2);

    // The shield glyph marks the rk-daemon tile (derived) and leaves the
    // unprotected regular tile unmarked.
    await expect(page.getByTestId("shield-rk-daemon")).toBeVisible();
    await expect(page.getByTestId("shield-regular")).toHaveCount(0);
  });

  test("a service row's View deep-link lands on the daemon window's terminal route", async ({
    page,
  }) => {
    await mockBackend(page);
    await page.goto("/");

    const card = page.getByLabel("run-kit system");
    await expect(card).toBeVisible({ timeout: 10_000 });

    // The jobs row's View targets rk-jobs' active window @7 → /rk-daemon/7.
    await card.getByRole("button", { name: "View" }).first().click();
    await expect(page).toHaveURL(/\/rk-daemon\/7$/);

    // The terminal route renders the window's heading — terminal access kept.
    await expect(page.getByText("update-check").first()).toBeVisible({ timeout: 10_000 });
  });
});
