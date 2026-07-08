import { test, expect, type Page } from "@playwright/test";

// Fully-mocked spec (same technique as top-bar-refresh.spec.ts): the server
// list, boards list, board entries, and the SSE sessions stream are injected
// via page.route so no live tmux backend is needed. See
// top-bar-persistence.spec.md for intent + steps.
//
// Regression coverage for change 260707-4vq2: the TopBar mounts ONCE in the
// persistent root layout (`AppLayout`, above the router `<Outlet>`) rather than
// three separate per-page copies. This asserts the user-facing outcomes of
// that lift:
//   1. The bar is present (its brand crumb visible) immediately after each
//      CLIENT-SIDE cross-route navigation settles — it is not torn down and
//      rebuilt as a blank between pages (the old "navbar reload" flicker). This
//      is the persistence claim, and it holds only for genuine in-app router
//      navigation: hops 1 (server tile → `/$server`) and 3 (board tile →
//      `/board/$name`) click TanStack-Router-driven controls.
//   2. Its center heading is route-derived and updates per route — Cockpit →
//      `Server Cabin <server>` → back to Cockpit → `Board <board>` — including
//      the board heading, which renders from the URL param while the lazy board
//      chunk loads.
//   3. On an unmatched route (`/board/x/y`), the bar falls back to the minimal
//      `cockpit` heading rather than leaking the fuzzy-matched board param as
//      `Board x` (the T002 not-found-fallback fix).
//
// NOTE on hop 2 (brand crumb → `/`): the brand crumb is a RAW `<a href="/">`
// (top-bar.tsx), which TanStack Router does NOT intercept — clicking it is a
// FULL document navigation, not client-side. So hop 2 is a RELOAD BOUNDARY, not
// a persistence hop: it verifies the persistent-layout chrome mounts correctly
// on a COLD load at `/` (route-derived cockpit heading present after the
// reload), NOT that the bar survived without a remount. Only hops 1 and 3 test
// no-remount persistence.
//
// (The internal implementation — a single non-remounting `RootTopBar` fed by a
// route-derived mode + a page-registered slot context — is unit-tested in
// top-bar-slot-context.test.tsx and app.tsx's structure; this e2e covers the
// observable cross-route behavior.)

const SERVER = "default";
const BOARD = "myboard";

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
      },
    ],
  },
]);

async function mockBackend(page: Page): Promise<void> {
  await page.routeWebSocket(/\/relay\//, () => {
    /* accept, send nothing */
  });
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
  await page.route("**/api/boards", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ name: BOARD, pinCount: 1 }]),
    }),
  );
  await page.route(`**/api/boards/${BOARD}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          server: SERVER,
          windowId: "@1",
          session: "dev",
          windowIndex: 0,
          windowName: "feature-work",
          orderKey: "a0",
        },
      ]),
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
  await page.route("**/api/host/metrics/stream*", (route) =>
    route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
      body: ":\n\n",
    }),
  );
}

// The brand crumb is the always-present bar element on every mode — its
// continuous visibility across navigation is the proxy for "the bar never
// blanks out".
const brand = (page: Page) => page.getByLabel("Run Kit home");

test.describe("TopBar persistence across routes (260707-4vq2)", () => {
  test.beforeEach(async ({ page }) => {
    await mockBackend(page);
  });

  test("the persistent bar stays present and its heading updates across / → /$server → /board", async ({
    page,
  }) => {
    // Cockpit. Solo `Cockpit` center heading + the persistent bar's brand crumb.
    await page.goto("/");
    await expect(page.getByLabel("Cockpit")).toBeVisible({ timeout: 10_000 });
    await expect(brand(page)).toBeVisible();

    // Hop 1: server tile (scoped to the Tmux servers region) → `/$server`. The
    // route-derived heading flips to `Server Cabin <server>` (aria-label carries
    // no colon — the `:` is presentational). The bar is present immediately.
    await page
      .getByRole("region", { name: "Tmux servers" })
      .getByRole("button", { name: SERVER, exact: false })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/${SERVER}$`));
    await expect(page.getByLabel(`Server Cabin ${SERVER}`)).toBeVisible();
    await expect(brand(page)).toBeVisible();
    // The prior mode's heading is gone (mode is route-derived, not stacked).
    await expect(page.getByLabel("Cockpit")).toHaveCount(0);

    // Hop 2 (RELOAD BOUNDARY, not persistence): the brand crumb is a raw
    // `<a href="/">` that TanStack Router does NOT intercept, so clicking it is
    // a FULL document navigation. We assert the persistent-layout chrome mounts
    // correctly on a cold load at `/` — route-derived `Cockpit` heading present,
    // prior `Server Cabin` heading gone — NOT that the bar survived a remount.
    await brand(page).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByLabel("Cockpit")).toBeVisible();
    await expect(brand(page)).toBeVisible();
    await expect(page.getByLabel(`Server Cabin ${SERVER}`)).toHaveCount(0);

    // Hop 3 (client-side): board tile → `/board/$name`. The board chunk is
    // lazy, but the route-derived heading renders `Board <board>` from the URL
    // param while the chunk loads — and the bar (brand crumb) stays present
    // throughout without a remount (this IS a persistence hop).
    await page
      .getByRole("region", { name: "Boards" })
      .getByRole("button", { name: BOARD, exact: false })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/board/${BOARD}$`));
    await expect(page.getByLabel(`Board ${BOARD}`)).toBeVisible();
    await expect(brand(page)).toBeVisible();
  });

  test("an unmatched route falls back to the minimal cockpit heading (not the fuzzy-matched board param)", async ({
    page,
  }) => {
    // `/board/x/y` fuzzy-matches the board route (`name=x`) then bubbles to the
    // app-layout route's `notFoundComponent` (NotFoundPage). TanStack Router
    // RETAINS the partially-matched param in `useMatches()`, so without the
    // not-found signal the bar would derive `board` mode and show `Board x`.
    // NotFoundPage signals not-found into the slot context, forcing the minimal
    // `cockpit` fallback (T002 fix, R10 / A-015).
    await page.goto("/board/x/y");
    await expect(page.getByText("Page not found")).toBeVisible({ timeout: 10_000 });
    // The persistent bar is present with the cockpit fallback heading …
    await expect(page.getByLabel("Cockpit")).toBeVisible();
    await expect(brand(page)).toBeVisible();
    // … and it did NOT leak the fuzzy-matched board param as a `Board x` heading.
    await expect(page.getByLabel("Board x")).toHaveCount(0);
  });
});
