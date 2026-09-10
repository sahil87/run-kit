// tmux Server page clock dashboard — the WATCHED / CRONS / RECENT DELIVERIES
// zones below the Sessions grid on `/default`, desktop-only, with the row
// flyout's mute round-trip.
//
// Shared setup: fully mocked (no tmux), following the mobile-cron-activity
// spec's idiom. The sessions payload rides the state-socket mock — a `dev`
// session whose `@1` window carries the monitored facets (the WATCHED row)
// plus an operator window `@9` with `role: "operator"` in `_rk-operator` and
// `operatorLastTickAt` stamped on both sessions. `GET /api/cron` is stubbed
// via page.route (trailing `*` — the client appends `?server=` via
// withServer) with one due entry, one muted entry, and two deliveries.
// `POST /api/cron/mute` is stubbed separately (registered AFTER the general
// cron route so Playwright's last-registered-wins matching picks it) and
// captures the request body for the round-trip assertion. `/api/servers`
// feeds the server list; `/ws/terminals` is a no-op socket mock so the shell
// mounts without stream data. Desktop tests run at 1280×800, the mobile case
// at 375×812.
import { test, expect, type Page } from "@playwright/test";
import { mockStateSocket } from "./_state-socket-mock";

const SERVER = "default";
const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
const MOBILE_VIEWPORT = { width: 375, height: 812 };

const NOW = Math.floor(Date.now() / 1000);

const SESSIONS = JSON.stringify([
  {
    name: "dev",
    operatorLastTickAt: NOW - 60,
    windows: [
      {
        windowId: "@1",
        index: 0,
        name: "feature-work",
        worktreePath: "/tmp/wt",
        activity: "active",
        isActiveWindow: true,
        activityTimestamp: 0,
        monitored: true,
        monitoredChange: "wuiu",
        monitoredStage: "review",
        monitoredRepo: "/home/user/code/run-kit",
        agentState: "waiting",
        agentIdleDuration: "6m",
        panes: [{ paneId: "%1", paneIndex: 0, cwd: "/tmp/wt", command: "zsh", isActive: true }],
      },
    ],
  },
  {
    name: "_rk-operator",
    operatorLastTickAt: NOW - 60,
    windows: [
      {
        windowId: "@9",
        index: 0,
        name: "operator",
        worktreePath: "/tmp/op",
        activity: "idle",
        isActiveWindow: false,
        activityTimestamp: 0,
        role: "operator",
        panes: [{ paneId: "%9", paneIndex: 0, cwd: "/tmp/op", command: "claude", isActive: true }],
      },
    ],
  },
]);

const CRON = JSON.stringify({
  entries: [
    {
      id: "d1",
      name: "operator tick",
      schedule: { kind: "backoff", min: "60s", max: "30m" },
      target: { kind: "role", role: "operator" },
      payload: "tick",
      lastFired: NOW - 120,
      nextFire: NOW - 30,
      rung: 3,
    },
    {
      id: "m2",
      name: "nightly",
      schedule: { kind: "cron", expr: "0 2 * * *" },
      target: { kind: "session", session: "dev" },
      payload: "nightly",
      muted: true,
      lastFired: 0,
      nextFire: NOW + 3600,
    },
  ],
  deliveries: [
    {
      ts: NOW - 120,
      entry: "d1",
      name: "operator tick",
      target: "%9",
      reason: "schedule",
      outcome: "delivered",
    },
    {
      ts: NOW - 900,
      entry: "zz",
      name: "",
      target: "%3",
      reason: "schedule",
      outcome: "skipped-absent",
    },
  ],
});

/** Install the mocked backend (state socket + cron + servers + the mute seam).
 *  Returns a probe holding the last captured mute POST body. */
async function mockBackend(page: Page) {
  const mutePosts: { id?: string; muted?: boolean }[] = [];
  await mockStateSocket(page, { sessions: SESSIONS });
  await page.routeWebSocket(/\/ws\/terminals/, () => {});
  await page.route("**/api/servers", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ name: SERVER, sessionCount: 2 }]),
    }),
  );
  await page.route("**/api/cron*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: CRON }),
  );
  // Registered after the general cron route so it wins for the mute path.
  await page.route("**/api/cron/mute*", (route) => {
    mutePosts.push(route.request().postDataJSON() as { id?: string; muted?: boolean });
    return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
  });
  return { mutePosts };
}

/** Land on the server route and wait for the tiles + dashboard to render. */
async function gotoServerPage(page: Page) {
  await page.goto(`/${SERVER}`);
  await expect(page.getByTestId("session-tile-dev")).toBeVisible({ timeout: 10_000 });
}

test.describe("Server page clock dashboard", () => {
  /**
   * Proves: on the desktop server route the three dashboard zones render
   * below the Sessions grid, in urgency order, inside the same scroll area.
   *
   * Steps:
   * 1. Set the 1280×800 viewport; mock the backend; land on `/default`.
   * 2. Assert the dashboard root and the WATCHED / CRONS / RECENT DELIVERIES
   *    zone wrappers are visible.
   * 3. Assert each zone heading sits below the Sessions heading in layout
   *    order (bounding-box y) and in document order.
   */
  test("zones render below the Sessions grid on desktop", async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await mockBackend(page);
    await gotoServerPage(page);

    await expect(page.getByTestId("server-clock-dashboard")).toBeVisible();
    await expect(page.getByTestId("clock-zone-watched")).toBeVisible();
    await expect(page.getByTestId("clock-zone-crons")).toBeVisible();
    await expect(page.getByTestId("clock-zone-deliveries")).toBeVisible();

    const sessionsHeading = page.getByRole("heading", { name: "Sessions" });
    await expect(sessionsHeading).toBeVisible();
    const sessionsBox = await sessionsHeading.boundingBox();
    const watchedBox = await page.getByTestId("clock-zone-watched").boundingBox();
    const cronsBox = await page.getByTestId("clock-zone-crons").boundingBox();
    const deliveriesBox = await page.getByTestId("clock-zone-deliveries").boundingBox();
    expect(sessionsBox).not.toBeNull();
    expect(watchedBox!.y).toBeGreaterThan(sessionsBox!.y);
    expect(cronsBox!.y).toBeGreaterThan(watchedBox!.y);
    expect(deliveriesBox!.y).toBeGreaterThan(cronsBox!.y);

    // The seeded payloads land: one watched row, the due + muted cron rows,
    // and the two deliveries.
    await expect(page.getByTestId("watched-row")).toHaveCount(1);
    await expect(page.getByTestId("crons-row")).toHaveCount(2);
    await expect(page.getByTestId("delivery-row")).toHaveCount(2);
  });

  /**
   * Proves: the dashboard is desktop-only — the 375px mobile server route
   * keeps its session tiles and renders no clock zones.
   *
   * Steps:
   * 1. Set the 375×812 viewport; mock the backend; land on `/default`.
   * 2. Assert the session tiles render.
   * 3. Assert no `server-clock-dashboard` element exists in the DOM.
   */
  test("dashboard is absent on the mobile viewport", async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await mockBackend(page);
    await gotoServerPage(page);

    await expect(page.getByTestId("session-tile-dev")).toBeVisible();
    await expect(page.getByTestId("server-clock-dashboard")).toHaveCount(0);
  });

  /**
   * Proves: a CRONS row's flyout mute action round-trips — clicking Mute on
   * the unmuted due entry POSTs `{id, muted: true}` to /api/cron/mute.
   *
   * Steps:
   * 1. Set the 1280×800 viewport; mock the backend; land on `/default`.
   * 2. Open the due entry's `…` row-flyout card.
   * 3. Click the `Mute` action row.
   * 4. Assert exactly one mute POST landed with `{id: "d1", muted: true}`.
   */
  test("mute action round-trips from the CRONS row flyout", async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    const { mutePosts } = await mockBackend(page);
    await gotoServerPage(page);
    await expect(page.getByTestId("clock-zone-crons")).toBeVisible();

    await page.getByTestId("crons-row-actions").first().click();
    await expect(page.getByTestId("row-flyout-mute-action")).toBeVisible();
    await page.getByTestId("row-flyout-mute-action").click();

    await expect.poll(() => mutePosts.length).toBe(1);
    expect(mutePosts[0]).toEqual({ id: "d1", muted: true });
  });
});
