import { test, expect, type Page } from "@playwright/test";

// This spec is fully mocked: the top-bar RefreshButton is gated on a current
// window, so we inject the SSE `sessions` payload (and the server list) via
// page.route and navigate to a terminal window route. That reaches the
// `currentWindow` cluster group deterministically without a real tmux server or
// `gh`. See top-bar-refresh.spec.md for intent + steps.
//
// The RefreshButton calls window.location.reload() — the routes installed via
// page.route persist across the in-page reload, so the app re-mounts on the
// same mocked data and the button reappears after the reload settles.

const SERVER = "default";

// One session with two windows. The URL deep-links to `@1`, but `@2` is the
// tmux-active window (`isActiveWindow: true`) — so app.tsx's mount-time
// alignment fires exactly one `selectWindow(server, "@1")` POST to bring tmux
// into agreement with the URL, and records a pending intent that holds the URL
// on `@1` (the URL-writeback bounce is suppressed until SSE confirms). This is
// deliberate: it makes the `/select` mock actually fire (so its interception is
// verifiable — see `selectHits` below) instead of the no-op path a URL that
// already matches the active window would take. `currentWindow` keys on the URL
// (`@1`), so the RefreshButton (and the Close/Split cluster) still render.
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
        isActiveWindow: false,
        activityTimestamp: 0,
      },
      {
        windowId: "@2",
        index: 1,
        name: "other",
        worktreePath: "/tmp/wt2",
        activity: "active",
        isActiveWindow: true,
        activityTimestamp: 0,
      },
    ],
  },
]);

// The RefreshButton renders on the terminal window route `/$server/$window`
// (`@` percent-encoded to `%40`), where a current window exists.
const WINDOW_URL = `/${SERVER}/%401`;

/**
 * Install routes that fully mock the server list and the SSE sessions stream.
 * Returns a `selectHits` counter proving the /select mock actually intercepts
 * (rather than falling through to the real :3020 backend — see the mock below).
 */
async function mockBackend(page: Page): Promise<{ selectHits: () => number }> {
  let selectHits = 0;

  // Stub the relay WebSocket so the terminal route mounts without a backend.
  await page.routeWebSocket(/\/relay\//, () => {
    /* accept and hold the socket open; send nothing */
  });

  // Selecting a window POSTs to /select — accept it so nav doesn't error.
  // Trailing `*` is REQUIRED: Playwright globs match the FULL URL including the
  // query string, and client.ts `withServer` appends `?server=default`. Without
  // it the POST falls through to the real :3020 backend and issues a live tmux
  // select-window on the default socket. `selectHits` records interception so a
  // regression to the no-trailing-star glob (silent fallthrough) fails loudly.
  await page.route("**/api/windows/*/select*", (route) => {
    selectHits += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"ok":true}',
    });
  });

  // Single known server so the app attaches exactly one SSE connection.
  await page.route("**/api/servers", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ name: SERVER, sessionCount: 1 }]),
    }),
  );

  // SSE stream: one `sessions` event carrying the mocked payload.
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

  return { selectHits: () => selectHits };
}

const refreshButton = (page: Page) => page.getByRole("button", { name: "Refresh page" });
const closeButton = (page: Page) => page.getByRole("button", { name: "Close pane" });

test.describe("Top-bar RefreshButton", () => {
  let selectHits: () => number;

  test.beforeEach(async ({ page }) => {
    ({ selectHits } = await mockBackend(page));
    await page.goto(WINDOW_URL);
    // Wait for the cluster to render (the SSE payload landed → currentWindow set).
    await expect(refreshButton(page)).toBeVisible({ timeout: 10_000 });
  });

  test("shows the refresh button next to the close button on a terminal route", async ({
    page,
  }) => {
    // The /select mock intercepted the window-selection POST fired during nav —
    // it did NOT fall through to the real :3020 backend (which would issue a live
    // tmux select-window on the default socket). This guards the trailing-`*`
    // glob fix: a regression to `**/api/windows/*/select` (no trailing star)
    // misses the `?server=default` query string and this count drops to 0.
    expect(selectHits()).toBeGreaterThan(0);

    // The Close pane button is present on a terminal (current-window) route. The
    // refresh button's visibility is already asserted in beforeEach.
    await expect(closeButton(page)).toBeVisible();

    // The refresh button renders IMMEDIATELY after the close button: each cluster
    // button is wrapped in its own `<span class="hidden sm:flex">`, and the
    // refresh span is the next element sibling of the close span (cluster order
    // is split → split → close → refresh). Asserting nextElementSibling proves
    // true adjacency — not merely "somewhere after" in document order.
    const adjacency = await page.evaluate(() => {
      const close = document.querySelector('button[aria-label="Close pane"]');
      const refresh = document.querySelector('button[aria-label="Refresh page"]');
      if (!close || !refresh) return "missing";
      const closeWrapper = close.closest("span");
      const refreshWrapper = refresh.closest("span");
      if (!closeWrapper || !refreshWrapper) return "no-wrapper";
      return closeWrapper.nextElementSibling === refreshWrapper ? "adjacent" : "not-adjacent";
    });
    expect(adjacency).toBe("adjacent");
  });

  test("clicking the refresh button reloads the page", async ({ page }) => {
    // Plant a marker on the current window object. A full reload creates a fresh
    // window, so the marker is gone afterwards — the observable proof of reload.
    await page.evaluate(() => {
      (window as unknown as { __refreshMarker?: boolean }).__refreshMarker = true;
    });
    expect(
      await page.evaluate(
        () => (window as unknown as { __refreshMarker?: boolean }).__refreshMarker === true,
      ),
    ).toBe(true);

    // Clicking triggers window.location.reload() → a real navigation.
    await Promise.all([page.waitForEvent("load"), refreshButton(page).click()]);

    // After the reload settles the app re-mounts on the same mocked data and the
    // button reappears — but the pre-reload marker is gone (fresh window).
    await expect(refreshButton(page)).toBeVisible({ timeout: 10_000 });
    expect(
      await page.evaluate(
        () => (window as unknown as { __refreshMarker?: boolean }).__refreshMarker,
      ),
    ).toBeUndefined();
  });
});
