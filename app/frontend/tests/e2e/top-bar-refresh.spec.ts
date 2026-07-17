import { test, expect, type Page } from "@playwright/test";
import { mockStateSocket } from "./_state-socket-mock";

// This spec is fully mocked: we inject the SSE `sessions` payload (and the
// server list) via page.route and navigate to a terminal window route. The
// RefreshButton rides the L3 always-block (260704-9o7k) and renders at first
// paint; the Close pane button is still gated on a current window, so IT is the
// synchronization anchor proving the mocked SSE payload landed. See
// top-bar-refresh.spec.md for intent + steps.
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
// (`@1`), so the Close/Split cluster still renders.
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

// The terminal window route `/$server/$window` (`@` percent-encoded to `%40`),
// where a current window exists and the full three-level cluster renders.
const WINDOW_URL = `/${SERVER}/%401`;

/**
 * Install routes that fully mock the server list and the SSE sessions stream.
 * Returns a `selectHits` counter proving the /select mock actually intercepts
 * (rather than falling through to the real :3020 backend — see the mock below).
 */
async function mockBackend(page: Page): Promise<{ selectHits: () => number }> {
  let selectHits = 0;

  // Stub the terminals mux WebSocket so the terminal route mounts without a
  // backend (the per-pane /relay/ socket was retired for /ws/terminals in
  // 260717-803u).
  await page.routeWebSocket(/\/ws\/terminals/, () => {
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
  await mockStateSocket(page, { sessions: sessionsPayload });

  return { selectHits: () => selectHits };
}

const refreshButton = (page: Page) => page.getByRole("button", { name: "Refresh page" });
const closeButton = (page: Page) => page.getByRole("button", { name: "Close pane" });

test.describe("Top-bar RefreshButton", () => {
  let selectHits: () => number;

  test.beforeEach(async ({ page }) => {
    ({ selectHits } = await mockBackend(page));
    await page.goto(WINDOW_URL);
    // Wait for the currentWindow-gated cluster to render (the SSE payload
    // landed → currentWindow set). The refresh button can no longer be this
    // anchor: it rides the L3 always-block (260704-9o7k) and is visible at
    // first paint, BEFORE the mocked SSE event is processed — anchoring on it
    // raced the mount-time /select POST and `selectHits` read 0. The Close pane
    // button is still terminal-gated, so its visibility proves the session
    // data arrived.
    await expect(closeButton(page)).toBeVisible({ timeout: 10_000 });
  });

  test("renders refresh in the L3 pyramid order (Theme → Refresh → Help), chevron then dot right-most, on a terminal route", async ({
    page,
  }) => {
    // The /select mock intercepted the window-selection POST fired during nav —
    // it did NOT fall through to the real :3020 backend (which would issue a live
    // tmux select-window on the default socket). This guards the trailing-`*`
    // glob fix: a regression to `**/api/windows/*/select` (no trailing star)
    // misses the `?server=default` query string and this count drops to 0.
    // Polled: the POST fires in a mount-time effect that runs fractionally
    // after the close button (the beforeEach anchor) becomes visible.
    await expect.poll(selectHits).toBeGreaterThan(0);

    // Wide viewport so the L3 controls stay IN-BAR (registry-driven overflow,
    // 260715-h1ck): the flat-wrapper pyramid is gone — each control renders
    // directly (no `hidden sm:flex` span), the always-present overflow chevron
    // precedes the dot, and the dot is the deepest-last status element of the
    // right cell (nested in the trailing exempt block).
    await page.setViewportSize({ width: 1280, height: 800 });

    // Refresh renders in-bar on a terminal route at a wide width.
    await expect(refreshButton(page)).toBeVisible();

    // Pyramid order via document position (coordinate-free, robust to whether a
    // control is in-bar or the measurement probe): Theme → Refresh → Help →
    // chevron → dot. Theme's aria-label is dynamic ("System theme" fresh) →
    // suffix match; Help is a docs anchor.
    const order = await page.evaluate(() => {
      const cluster = document.querySelector('[data-testid="top-bar-right"]');
      if (!cluster) return "no-cluster";
      const theme = document.querySelector('button[aria-label$=" theme"]');
      const refresh = document.querySelector('button[aria-label="Refresh page"]');
      const help = document.querySelector('a[aria-label^="Help"]');
      const chevron = document.querySelector('button[aria-label="More controls"]');
      const dot = cluster.querySelector('[role="status"]');
      if (!theme || !refresh || !help || !chevron || !dot) return "missing";
      const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
      const follows = (a: Element, b: Element) =>
        Boolean(a.compareDocumentPosition(b) & FOLLOWING);
      if (!follows(theme, refresh)) return "theme-not-before-refresh";
      if (!follows(refresh, help)) return "refresh-not-before-help";
      if (!follows(help, chevron)) return "help-not-before-chevron";
      if (!follows(chevron, dot)) return "chevron-not-before-dot";
      // The dot is the deepest-last status element of the right cell.
      const statuses = cluster.querySelectorAll('[role="status"]');
      return statuses[statuses.length - 1] === dot ? "pyramid" : "dot-not-last";
    });
    expect(order).toBe("pyramid");
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
