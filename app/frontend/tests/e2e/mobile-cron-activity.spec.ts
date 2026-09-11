// Mobile cron Activity feed — the operator route's Operator Terminal |
// Activity | Operator Tasks segmented header and the `?tab=` deep links.
//
// Shared setup: fully mocked (no tmux). The sessions payload rides the
// state-socket mock — a `dev` session with a work window `@1` plus a
// `monitored: true` window `@2` (carrying `monitoredChange`/`monitoredStage`/
// `monitoredRepo`, the Operator Tasks rows; the server-clock-dashboard spec's
// stub shape) and `operatorLastTickAt` stamped on the sessions, plus an
// operator window `@9` with
// `role: "operator"` in `_rk-operator` (the header's gate reads the role from
// this payload, so the header can only appear after the snapshot lands).
// `GET /api/cron` is stubbed via page.route (trailing `*` — the client
// appends `?server=` via withServer) with one entry and one delivery so the
// feed has rows. `/ws/terminals` is a no-op socket mock: the terminal mounts
// its xterm frame without stream data, and the mobile arrival gate polls the
// terminal's `__rkTerminals` registration (the mobile specs' idiom). Mobile
// tests run at 375×812; the desktop case runs at 1024×768.
import { test, expect, type Page } from "@playwright/test";
import { mockStateSocket } from "./_state-socket-mock";

const SERVER = "default";
const MOBILE_VIEWPORT = { width: 375, height: 812 };
const DESKTOP_VIEWPORT = { width: 1024, height: 768 };

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
        panes: [{ paneId: "%1", paneIndex: 0, cwd: "/tmp/wt", command: "zsh", isActive: true }],
      },
      {
        windowId: "@2",
        index: 1,
        name: "watched-worker",
        worktreePath: "/tmp/wt2",
        activity: "idle",
        isActiveWindow: false,
        activityTimestamp: 0,
        monitored: true,
        monitoredChange: "wuiu",
        monitoredStage: "review",
        monitoredRepo: "/home/user/code/run-kit",
        agentState: "waiting",
        agentIdleDuration: "6m",
        panes: [{ paneId: "%2", paneIndex: 0, cwd: "/tmp/wt2", command: "claude", isActive: true }],
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
      id: "a3f9",
      name: "operator tick",
      schedule: { kind: "backoff", min: "60s", max: "30m" },
      target: { kind: "role", role: "operator" },
      payload: "tick",
      lastFired: 0,
    },
  ],
  deliveries: [],
});

/** Install the mocked backend (state socket + cron + the select seam). */
async function mockBackend(page: Page) {
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
  await page.route("**/api/windows/*/select*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }),
  );
}

/** Mobile-pattern arrival: direct goto + a poll on the terminal's
 *  `__rkTerminals` registration. The window id's `@` is dropped in the URL
 *  (the router's segment form). */
async function gotoWindowMobile(page: Page, windowId: string, search = "") {
  await page.goto(`/${SERVER}/${windowId.replace(/^@/, "")}${search}`);
  await expect
    .poll(
      () =>
        page.evaluate(
          (wid) =>
            Boolean(
              (window as unknown as { __rkTerminals?: Record<string, unknown> }).__rkTerminals?.[wid],
            ),
          windowId,
        ),
      { timeout: 10_000 },
    )
    .toBe(true);
}

test.describe("Mobile cron activity feed", () => {
  /**
   * Proves: the Operator Terminal | Activity | Operator Tasks segmented
   * header renders on the mobile operator window's terminal route.
   *
   * Steps:
   * 1. Set the 375×812 viewport; mock the backend with an operator window.
   * 2. Land on the operator route `/default/9`.
   * 3. Assert the `Console view` tablist with the three tabs is visible, with
   *    Operator Terminal selected by default.
   */
  test("segmented header appears on the mobile operator route", async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await mockBackend(page);
    await gotoWindowMobile(page, "@9");

    const tabs = page.getByRole("tablist", { name: "Console view" });
    await expect(tabs).toBeVisible({ timeout: 10_000 });
    await expect(tabs.getByRole("tab", { name: "Operator Terminal" })).toHaveAttribute("aria-selected", "true");
    await expect(tabs.getByRole("tab", { name: "Activity" })).toHaveAttribute("aria-selected", "false");
    await expect(tabs.getByRole("tab", { name: "Operator Tasks" })).toHaveAttribute("aria-selected", "false");
  });

  /**
   * Proves: the header is role-gated — a mobile non-operator window route
   * renders no segmented header.
   *
   * Steps:
   * 1. Set the 375×812 viewport; mock the backend.
   * 2. Land on the plain work-window route `/default/1`.
   * 3. Assert no `Console view` tablist renders.
   */
  test("no segmented header on a non-operator route", async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await mockBackend(page);
    await gotoWindowMobile(page, "@1");

    await expect(page.getByRole("tablist", { name: "Console view" })).toHaveCount(0);
  });

  /**
   * Proves: the header is form-factor-gated — the desktop operator route
   * renders no segmented header.
   *
   * Steps:
   * 1. Keep the desktop 1024×768 viewport; mock the backend.
   * 2. Land on the operator route `/default/9`.
   * 3. Assert the terminal surface renders but no `Console view` tablist does.
   */
  test("no segmented header on desktop", async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await mockBackend(page);
    await page.goto(`/${SERVER}/9`);
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean((window as unknown as { __rkTerminals?: Record<string, unknown> }).__rkTerminals?.["@9"]),
        ),
      )
      .toBe(true);

    await expect(page.getByRole("tablist", { name: "Console view" })).toHaveCount(0);
  });

  /**
   * Proves: tapping the Activity segment swaps the content in place — the
   * feed appears, the URL gains `?tab=activity`, and the page does NOT
   * reload (an in-page probe survives the tap, and the terminal's relay
   * registration persists — the terminal is hidden, not unmounted).
   *
   * Steps:
   * 1. Set the 375×812 viewport; mock the backend; land on `/default/9`.
   * 2. Stamp `window.__cronProbe` as a reload tripwire.
   * 3. Tap the Activity tab.
   * 4. Assert the feed renders, the URL carries `tab=activity`, the probe is
   *    still set, and `__rkTerminals["@9"]` is still registered.
   */
  test("tapping Activity switches content without a full reload", async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await mockBackend(page);
    await gotoWindowMobile(page, "@9");
    await page.evaluate(() => {
      (window as unknown as { __cronProbe?: string }).__cronProbe = "alive";
    });

    await page.getByRole("tab", { name: "Activity" }).click();

    await expect(page.getByTestId("cron-activity-feed")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/tab=activity/);
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { __cronProbe?: string }).__cronProbe ?? null),
      )
      .toBe("alive");
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean((window as unknown as { __rkTerminals?: Record<string, unknown> }).__rkTerminals?.["@9"]),
        ),
      )
      .toBe(true);
  });

  /**
   * Proves: a `?tab=activity` deep link (the `rk notify` deep-link shape)
   * lands directly on the Activity segment with no extra tap.
   *
   * Steps:
   * 1. Set the 375×812 viewport; mock the backend.
   * 2. Navigate straight to `/default/9?tab=activity`.
   * 3. Assert the feed renders and the Activity tab is selected (the header
   *    gate resolves once the sessions payload lands).
   */
  test("?tab=activity deep link lands on the Activity segment", async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await mockBackend(page);
    await page.goto(`/${SERVER}/9?tab=activity`);

    await expect(page.getByTestId("cron-activity-feed")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("tab", { name: "Activity" })).toHaveAttribute("aria-selected", "true");
  });

  /**
   * Proves: tapping the Operator Tasks segment swaps the content in place —
   * the watchlist (the monitored worker rows) appears, the URL gains
   * `?tab=tasks`, and the page does NOT reload (an in-page probe survives the
   * tap, and the terminal's relay registration persists — the terminal is
   * hidden, not unmounted).
   *
   * Steps:
   * 1. Set the 375×812 viewport; mock the backend (the @2 window carries the
   *    monitored facets); land on `/default/9`.
   * 2. Stamp `window.__tasksProbe` as a reload tripwire.
   * 3. Tap the Operator Tasks tab.
   * 4. Assert the watchlist renders the worker row, the URL carries
   *    `tab=tasks`, the probe is still set, and `__rkTerminals["@9"]` is
   *    still registered.
   */
  test("tapping Operator Tasks swaps the content slot without a full reload", async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await mockBackend(page);
    await gotoWindowMobile(page, "@9");
    await page.evaluate(() => {
      (window as unknown as { __tasksProbe?: string }).__tasksProbe = "alive";
    });

    await page.getByRole("tab", { name: "Operator Tasks" }).click();

    const tasks = page.getByTestId("watched-tasks");
    await expect(tasks).toBeVisible({ timeout: 10_000 });
    await expect(tasks.getByTestId("watched-row")).toHaveCount(1);
    await expect(tasks.getByText("watched-worker")).toBeVisible();
    await expect(page).toHaveURL(/tab=tasks/);
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { __tasksProbe?: string }).__tasksProbe ?? null),
      )
      .toBe("alive");
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean((window as unknown as { __rkTerminals?: Record<string, unknown> }).__rkTerminals?.["@9"]),
        ),
      )
      .toBe(true);
  });

  /**
   * Proves: a `?tab=tasks` deep link lands directly on the Operator Tasks
   * segment (the watchlist) with no extra tap.
   *
   * Steps:
   * 1. Set the 375×812 viewport; mock the backend.
   * 2. Navigate straight to `/default/9?tab=tasks`.
   * 3. Assert the watchlist renders with the worker row and the Operator
   *    Tasks tab is selected (the header gate resolves once the sessions
   *    payload lands).
   */
  test("?tab=tasks deep link lands on Operator Tasks", async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await mockBackend(page);
    await page.goto(`/${SERVER}/9?tab=tasks`);

    const tasks = page.getByTestId("watched-tasks");
    await expect(tasks).toBeVisible({ timeout: 10_000 });
    await expect(tasks.getByText("watched-worker")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Operator Tasks" })).toHaveAttribute("aria-selected", "true");
  });
});
