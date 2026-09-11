// Mobile cron tabs — the operator route's `Operator Terminal | Operator
// Tasks | Cron List | Cron Log` segmented header, the `?tab=` deep links (the
// legacy `activity` token normalizes to `log`), the stale banner above either
// cron tab, and the Cron List action surfaces (`+ New entry`, the detail
// sheet's Edit row and `Mute for…` presets).
//
// Shared setup: fully mocked (no tmux). The sessions payload rides the
// state-socket mock — a `dev` session with a work window `@1` plus a
// `monitored: true` window `@2` (carrying `monitoredChange`/`monitoredStage`/
// `monitoredRepo` — the Operator Tasks row) and `operatorLastTickAt` stamped,
// plus an operator window `@9` with `role: "operator"` in `_rk-operator` (the
// header's gate reads the role from this payload, so the header can only
// appear after the snapshot lands). A payload variant stamps `operatorStale`
// on the `dev` session for the banner test. `GET /api/cron` is stubbed via
// page.route (trailing `*` — the client appends `?server=` via withServer)
// with one entry and one delivery so both cron tabs have a row.
// `POST /api/cron/mute` and `POST /api/cron/edit` are stubbed separately
// (registered AFTER the general cron route so Playwright's
// last-registered-wins matching picks them) and capture the request bodies
// for the round-trip assertions. `/ws/terminals` is a no-op socket mock: the
// terminal mounts its xterm frame without stream data, and the mobile arrival
// gate polls the terminal's `__rkTerminals` registration (the mobile specs'
// idiom). Mobile tests run at 375×812; the desktop gate case runs at
// 1024×768. No host-global state is saved or restored.
import { test, expect, type Page } from "@playwright/test";
import { mockStateSocket } from "./_state-socket-mock";

const SERVER = "default";
const MOBILE_VIEWPORT = { width: 375, height: 812 };
const DESKTOP_VIEWPORT = { width: 1024, height: 768 };

const NOW = Math.floor(Date.now() / 1000);

function sessionsPayload(stale: boolean) {
  return JSON.stringify([
    {
      name: "dev",
      operatorLastTickAt: NOW - 60,
      ...(stale ? { operatorStale: true } : {}),
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
}

const CRON = JSON.stringify({
  entries: [
    {
      id: "a3f9",
      name: "operator tick",
      schedule: { kind: "backoff", min: "60s", max: "30m" },
      target: { kind: "role", role: "operator" },
      payload: "tick",
      lastFired: NOW - 120,
      nextFire: NOW + 300,
    },
  ],
  deliveries: [
    {
      ts: NOW - 120,
      entry: "a3f9",
      name: "operator tick",
      target: "%9",
      reason: "schedule",
      outcome: "delivered",
    },
  ],
});

/** Install the mocked backend (state socket + cron + the select seam).
 *  Returns probes holding the captured mute/edit POST bodies. */
async function mockBackend(page: Page, opts: { stale?: boolean } = {}) {
  const mutePosts: Record<string, unknown>[] = [];
  const editPosts: Record<string, unknown>[] = [];
  await mockStateSocket(page, { sessions: sessionsPayload(opts.stale === true) });
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
  // Registered after the general cron route so they win for their paths.
  await page.route("**/api/cron/mute*", (route) => {
    mutePosts.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
  });
  await page.route("**/api/cron/edit*", (route) => {
    editPosts.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"id":"a3f9"}',
    });
  });
  await page.route("**/api/windows/*/select*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }),
  );
  return { mutePosts, editPosts };
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

const tabStrip = (page: Page) => page.getByRole("tablist", { name: "Console view" });

test.describe("Mobile cron tabs", () => {
  /**
   * Proves: at 375px the segment strip renders exactly the four segments —
   * `Operator Terminal`, `Operator Tasks`, `Cron List`, `Cron Log` — in that
   * order, and no label wraps or truncates or pushes the strip/page past the
   * 375px width.
   *
   * Steps:
   * 1. Set the 375×812 viewport; mock the backend; land on the operator route
   *    `/default/9`.
   * 2. Assert the four tab labels in exact order, with Operator Terminal
   *    selected by default.
   * 3. Assert every tab is nowrap and untruncated (scrollWidth ≤ clientWidth)
   *    and the strip and page stay within the 375px width.
   */
  test("the four segments render in order at 375px without wrap or truncation", async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await mockBackend(page);
    await gotoWindowMobile(page, "@9");

    const tabs = tabStrip(page);
    await expect(tabs).toBeVisible({ timeout: 10_000 });
    const buttons = tabs.getByRole("tab");
    await expect(buttons).toHaveCount(4);
    expect(await buttons.allTextContents()).toEqual([
      "Operator Terminal",
      "Operator Tasks",
      "Cron List",
      "Cron Log",
    ]);
    await expect(buttons.nth(0)).toHaveAttribute("aria-selected", "true");

    const noTruncation = await tabs.evaluate((el) =>
      Array.from(el.querySelectorAll('[role="tab"]')).every(
        (b) =>
          b.scrollWidth <= b.clientWidth && getComputedStyle(b).whiteSpace === "nowrap",
      ),
    );
    expect(noTruncation).toBe(true);

    const fitsWidth = await tabs.evaluate(
      (el) =>
        el.getBoundingClientRect().right <= window.innerWidth &&
        document.body.scrollWidth <= window.innerWidth,
    );
    expect(fitsWidth).toBe(true);
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

    await expect(tabStrip(page)).toHaveCount(0);
  });

  /**
   * Proves: the header is form-factor-gated — the desktop operator route
   * renders no segmented header (the desktop cron views live in the console
   * drawer).
   *
   * Steps:
   * 1. Keep the desktop 1024×768 viewport; mock the backend.
   * 2. Land on the operator route `/default/9`.
   * 3. Assert the terminal registered but no `Console view` tablist renders.
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

    await expect(tabStrip(page)).toHaveCount(0);
  });

  /**
   * Proves: tapping a cron segment swaps the content in place — the Cron Log
   * body appears, the URL gains `?tab=log`, and the page does NOT reload (an
   * in-page probe survives the tap, and the terminal's relay registration
   * persists — the terminal is hidden, not unmounted).
   *
   * Steps:
   * 1. Set the 375×812 viewport; mock the backend; land on `/default/9`.
   * 2. Stamp `window.__cronProbe` as a reload tripwire.
   * 3. Tap the Cron Log tab.
   * 4. Assert the log renders, the URL carries `tab=log`, the probe is still
   *    set, and `__rkTerminals["@9"]` is still registered.
   */
  test("tapping Cron Log switches content without a full reload", async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await mockBackend(page);
    await gotoWindowMobile(page, "@9");
    await page.evaluate(() => {
      (window as unknown as { __cronProbe?: string }).__cronProbe = "alive";
    });

    await page.getByRole("tab", { name: "Cron Log" }).click();

    await expect(page.getByTestId("cron-log")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/tab=log/);
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
   * Proves: a legacy `?tab=activity` deep link (the `rk notify` deep-link
   * shape, aliased for one release) lands directly on the Cron Log segment
   * with no extra tap.
   *
   * Steps:
   * 1. Set the 375×812 viewport; mock the backend.
   * 2. Navigate straight to `/default/9?tab=activity`.
   * 3. Assert the Cron Log body renders with its delivery row and the Cron Log
   *    tab is selected (the header gate resolves once the sessions payload
   *    lands).
   */
  test("?tab=activity deep link lands on the Cron Log segment", async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await mockBackend(page);
    await page.goto(`/${SERVER}/9?tab=activity`);

    await expect(page.getByTestId("cron-log")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("cron-delivery-row-a3f9")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Cron Log" })).toHaveAttribute("aria-selected", "true");
  });

  /**
   * Proves: a `?tab=list` deep link lands directly on the Cron List segment
   * with no extra tap.
   *
   * Steps:
   * 1. Set the 375×812 viewport; mock the backend.
   * 2. Navigate straight to `/default/9?tab=list`.
   * 3. Assert the Cron List body renders with its entry row and the Cron List
   *    tab is selected.
   */
  test("?tab=list deep link lands on the Cron List segment", async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await mockBackend(page);
    await page.goto(`/${SERVER}/9?tab=list`);

    await expect(page.getByTestId("cron-list")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("cron-list-row-a3f9")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Cron List" })).toHaveAttribute("aria-selected", "true");
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
  test("?tab=tasks deep link lands on the Operator Tasks segment", async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await mockBackend(page);
    await page.goto(`/${SERVER}/9?tab=tasks`);

    const tasks = page.getByTestId("watched-tasks");
    await expect(tasks).toBeVisible({ timeout: 10_000 });
    await expect(tasks.getByText("watched-worker")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Operator Tasks" })).toHaveAttribute("aria-selected", "true");
  });

  /**
   * Proves: the operator-staleness banner pins ABOVE either cron tab's body
   * when a session reports `operatorStale`, and does not render above the
   * Operator Terminal segment.
   *
   * Steps:
   * 1. Set the 375×812 viewport; mock the backend with a stale operator tick;
   *    land on `/default/9` (the terminal segment).
   * 2. Assert no banner renders.
   * 3. Tap Cron Log; assert the banner is visible and sits above the log body
   *    (bounding-box y).
   * 4. Tap Cron List; assert the banner is visible above the list body.
   * 5. Tap Operator Terminal; assert the banner is gone.
   */
  test("the stale banner mounts above both cron tabs and never above the terminal", async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await mockBackend(page, { stale: true });
    await gotoWindowMobile(page, "@9");

    await expect(tabStrip(page)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("cron-activity-banner")).toHaveCount(0);

    await page.getByRole("tab", { name: "Cron Log" }).click();
    const banner = page.getByTestId("cron-activity-banner");
    await expect(banner).toBeVisible({ timeout: 10_000 });
    const bannerBox = await banner.boundingBox();
    const logBox = await page.getByTestId("cron-log").boundingBox();
    expect(bannerBox!.y).toBeLessThan(logBox!.y);

    await page.getByRole("tab", { name: "Cron List" }).click();
    await expect(page.getByTestId("cron-list")).toBeVisible({ timeout: 10_000 });
    await expect(banner).toBeVisible();
    const bannerBox2 = await banner.boundingBox();
    const listBox = await page.getByTestId("cron-list").boundingBox();
    expect(bannerBox2!.y).toBeLessThan(listBox!.y);

    await page.getByRole("tab", { name: "Operator Terminal" }).click();
    await expect(page.getByTestId("cron-activity-banner")).toHaveCount(0);
  });

  /**
   * Proves: Cron List's `+ New entry` affordance opens the create dialog.
   *
   * Steps:
   * 1. Set the 375×812 viewport; mock the backend; land on `/default/9` and
   *    switch to Cron List.
   * 2. Click `+ New entry`.
   * 3. Assert the `New cron entry` dialog renders.
   */
  test("+ New entry opens the create dialog", async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await mockBackend(page);
    await page.goto(`/${SERVER}/9?tab=list`);
    await expect(page.getByTestId("cron-list")).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("cron-list-new").click();

    await expect(page.getByRole("dialog", { name: "New cron entry" })).toBeVisible();
  });

  /**
   * Proves: the entry detail sheet's `Edit` row opens the create dialog in
   * edit mode (`Edit entry` title, `Save` submit), and saving POSTs ONLY the
   * changed fields to `/api/cron/edit`.
   *
   * Steps:
   * 1. Set the 375×812 viewport; mock the backend; land on
   *    `/default/9?tab=list`.
   * 2. Open the entry's detail sheet from its Cron List row.
   * 3. Click the `Edit` row; assert the `Edit entry` dialog renders.
   * 4. Change only the Name field and click Save.
   * 5. Assert exactly one edit POST landed with `{id, name}` (no unchanged
   *    fields) and the dialog closed.
   */
  test("the detail sheet's Edit row opens the edit-mode dialog and saves changed fields only", async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    const { editPosts } = await mockBackend(page);
    await page.goto(`/${SERVER}/9?tab=list`);
    await expect(page.getByTestId("cron-list")).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("cron-list-row-a3f9").click();
    const sheet = page.getByTestId("cron-entry-sheet");
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Edit", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "Edit entry" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("textbox", { name: "Name" }).fill("renamed tick");
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect.poll(() => editPosts).toEqual([{ id: "a3f9", name: "renamed tick" }]);
    await expect(page.getByRole("dialog", { name: "Edit entry" })).toHaveCount(0);
  });

  /**
   * Proves: the detail sheet's `Mute for…` expander offers the lease presets
   * and picking `2h` POSTs `{id, muted: true, for: "2h"}` to
   * `/api/cron/mute` — the lease rides the existing mute route as an additive
   * field.
   *
   * Steps:
   * 1. Set the 375×812 viewport; mock the backend; land on
   *    `/default/9?tab=list`.
   * 2. Open the entry's detail sheet from its Cron List row.
   * 3. Expand `Mute for…`; assert the four presets render.
   * 4. Click `2h`; assert exactly one mute POST landed with the `for` field.
   */
  test("the Mute for… 2h preset posts the additive lease field", async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    const { mutePosts } = await mockBackend(page);
    await page.goto(`/${SERVER}/9?tab=list`);
    await expect(page.getByTestId("cron-list")).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("cron-list-row-a3f9").click();
    const sheet = page.getByTestId("cron-entry-sheet");
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Mute for…" }).click();
    const presets = sheet.getByRole("group", { name: "Mute duration" });
    await expect(presets.getByRole("button")).toHaveText(["30m", "2h", "8h", "until unmuted"]);

    await presets.getByRole("button", { name: "2h", exact: true }).click();

    await expect.poll(() => mutePosts).toEqual([{ id: "a3f9", muted: true, for: "2h" }]);
  });
});
